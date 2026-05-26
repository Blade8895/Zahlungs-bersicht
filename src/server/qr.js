import { badRequest, validateQrPayment } from './validation.js';

const ECC_CODEWORDS_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const NUM_ERROR_CORRECTION_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const FORMAT_ECL_BITS_M = 0;

export function createEpcPayload(payment) {
  validateQrPayment(payment);
  const recipient = payment.recipient_name || payment.recipientName;
  const purpose = payment.purpose;
  const amount = Number(payment.amount).toFixed(2);
  return [
    'BCD',
    '002',
    '1',
    'SCT',
    '',
    recipient,
    String(payment.iban).replace(/\s+/g, '').toUpperCase(),
    `EUR${amount}`,
    '',
    purpose,
    ''
  ].join('\n');
}

export function createQrSvgForPayment(payment) {
  const payload = createEpcPayload(payment);
  return { payload, svg: encodeQrSvg(payload) };
}

export function encodeQrSvg(text) {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  const version = chooseVersion(bytes.length);
  const qr = makeQr(bytes, version);
  const quiet = 4;
  const size = qr.size + quiet * 2;
  const cells = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.modules[y][x]) cells.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="EPC QR Code"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#020617" d="${cells.join('')}"/></svg>`;
}

function chooseVersion(byteLength) {
  for (let version = 1; version <= 20; version += 1) {
    const dataCapacity = getNumDataCodewords(version);
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (requiredBits <= dataCapacity * 8) return version;
  }
  throw badRequest('Der EPC-QR-Code ist zu lang. Bitte Empfängername oder Verwendungszweck kürzen.');
}

function makeQr(bytes, version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));
  drawFunctionPatterns(modules, isFunction, version);
  const dataCodewords = buildDataCodewords(bytes, version);
  const allCodewords = addErrorCorrectionAndInterleave(dataCodewords, version);
  const dataBits = allCodewords.flatMap((byte) => bitsOf(byte, 8));
  drawCodewords(modules, isFunction, dataBits);

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = modules;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => row.slice());
    applyMask(candidate, isFunction, mask);
    drawFormatBits(candidate, isFunction, mask);
    const penalty = getPenaltyScore(candidate);
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestPenalty = penalty;
      bestModules = candidate;
    }
  }
  drawFormatBits(bestModules, isFunction, bestMask);
  return { modules: bestModules, size };
}

function buildDataCodewords(bytes, version) {
  const dataCapacity = getNumDataCodewords(version);
  const bits = [0, 1, 0, 0];
  bits.push(...bitsOf(bytes.length, version <= 9 ? 8 : 16));
  for (const byte of bytes) bits.push(...bitsOf(byte, 8));
  const capacityBits = dataCapacity * 8;
  bits.push(...Array(Math.min(4, capacityBits - bits.length)).fill(0));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < dataCapacity; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

function addErrorCorrectionAndInterleave(data, version) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[version];
  const rawCodewords = getNumRawDataModules(version) >> 3;
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks = [];
  let dataIndex = 0;

  for (let block = 0; block < numBlocks; block += 1) {
    const dataLen = shortBlockLen - blockEccLen + (block < numShortBlocks ? 0 : 1);
    const chunk = data.slice(dataIndex, dataIndex + dataLen);
    dataIndex += dataLen;
    const ecc = reedSolomonRemainder(chunk, blockEccLen);
    if (block < numShortBlocks) chunk.push(0);
    blocks.push(chunk.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    for (let block = 0; block < blocks.length; block += 1) {
      if (i !== shortBlockLen - blockEccLen || block >= numShortBlocks) {
        result.push(blocks[block][i]);
      }
    }
  }
  return result;
}

function drawFunctionPatterns(modules, isFunction, version) {
  const size = modules.length;
  drawFinderPattern(modules, isFunction, 3, 3);
  drawFinderPattern(modules, isFunction, size - 4, 3);
  drawFinderPattern(modules, isFunction, 3, size - 4);

  for (let i = 0; i < size; i += 1) {
    if (!isFunction[6][i]) setFunction(modules, isFunction, i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(modules, isFunction, 6, i, i % 2 === 0);
  }

  const align = alignmentPatternPositions(version);
  for (const y of align) {
    for (const x of align) {
      if (isFunction[y][x]) continue;
      drawAlignmentPattern(modules, isFunction, x, y);
    }
  }

  reserveFormatAreas(modules, isFunction);
  if (version >= 7) drawVersionBits(modules, isFunction, version);
  setFunction(modules, isFunction, 8, size - 8, true);
}

function drawFinderPattern(modules, isFunction, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= modules.length || y < 0 || y >= modules.length) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(modules, isFunction, x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignmentPattern(modules, isFunction, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(modules, isFunction, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function reserveFormatAreas(modules, isFunction) {
  const size = modules.length;
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      setFunction(modules, isFunction, 8, i, false);
      setFunction(modules, isFunction, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(modules, isFunction, size - 1 - i, 8, false);
    setFunction(modules, isFunction, 8, size - 1 - i, false);
  }
}

function drawVersionBits(modules, isFunction, version) {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) ? 0x1f25 : 0);
  }
  const bits = (version << 12) | remainder;
  const size = modules.length;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(modules, isFunction, a, b, bit);
    setFunction(modules, isFunction, b, a, bit);
  }
}

function drawCodewords(modules, isFunction, dataBits) {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (!isFunction[y][x]) {
          modules[y][x] = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
          bitIndex += 1;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(modules, isFunction, mask) {
  const size = modules.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isFunction[y][x] && maskCondition(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

function drawFormatBits(modules, isFunction, mask) {
  let data = (FORMAT_ECL_BITS_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0);
  }
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const size = modules.length;
  const bit = (i) => ((bits >>> i) & 1) !== 0;

  for (let i = 0; i <= 5; i += 1) setFunction(modules, isFunction, 8, i, bit(i));
  setFunction(modules, isFunction, 8, 7, bit(6));
  setFunction(modules, isFunction, 8, 8, bit(7));
  setFunction(modules, isFunction, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(modules, isFunction, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) setFunction(modules, isFunction, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(modules, isFunction, 8, size - 15 + i, bit(i));
  setFunction(modules, isFunction, 8, size - 8, true);
}

function setFunction(modules, isFunction, x, y, dark) {
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function alignmentPatternPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function getNumDataCodewords(version) {
  return (getNumRawDataModules(version) >> 3) - ECC_CODEWORDS_PER_BLOCK_M[version] * NUM_ERROR_CORRECTION_BLOCKS_M[version];
}

function getNumRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function bitsOf(value, width) {
  return Array.from({ length: width }, (_, index) => (value >>> (width - 1 - index)) & 1);
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function getPenaltyScore(modules) {
  const size = modules.length;
  let penalty = 0;
  for (let y = 0; y < size; y += 1) penalty += runPenalty(modules[y]);
  for (let x = 0; x < size; x += 1) penalty += runPenalty(modules.map((row) => row[x]));
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) penalty += 3;
    }
  }
  const finderPattern = [true, false, true, true, true, false, true];
  for (let y = 0; y < size; y += 1) penalty += finderPenalty(modules[y], finderPattern);
  for (let x = 0; x < size; x += 1) penalty += finderPenalty(modules.map((row) => row[x]), finderPattern);
  const dark = modules.flat().filter(Boolean).length;
  const total = size * size;
  penalty += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return penalty;
}

function runPenalty(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (line[i] === runColor) {
      runLength += 1;
    } else {
      if (runLength >= 5) penalty += runLength - 2;
      runColor = line[i];
      runLength = 1;
    }
  }
  return penalty;
}

function finderPenalty(line, pattern) {
  let penalty = 0;
  for (let i = 0; i <= line.length - 7; i += 1) {
    if (pattern.every((value, index) => line[i + index] === value)) {
      const before = line.slice(Math.max(0, i - 4), i);
      const after = line.slice(i + 7, Math.min(line.length, i + 11));
      if (before.every((v) => !v) || after.every((v) => !v)) penalty += 40;
    }
  }
  return penalty;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const message = data.concat(Array(degree).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const coefficient = message[i];
    if (coefficient === 0) continue;
    for (let j = 0; j < generator.length; j += 1) {
      message[i + j] ^= gfMultiply(generator[j], coefficient);
    }
  }
  return message.slice(data.length);
}

function reedSolomonGenerator(degree) {
  let polynomial = [1];
  for (let i = 0; i < degree; i += 1) {
    polynomial = multiplyPolynomials(polynomial, [1, GF_EXP[i]]);
  }
  return polynomial;
}

function multiplyPolynomials(left, right) {
  const result = Array(left.length + right.length - 1).fill(0);
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      result[i + j] ^= gfMultiply(left[i], right[j]);
    }
  }
  return result;
}

const GF_EXP = Array(512).fill(0);
const GF_LOG = Array(256).fill(0);
let x = 1;
for (let i = 0; i < 255; i += 1) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];

function gfMultiply(left, right) {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left] + GF_LOG[right]];
}
