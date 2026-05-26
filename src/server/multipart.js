import { badRequest } from './validation.js';

export async function parseMultipart(req, maxBytes) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw badRequest('Multipart-Boundary fehlt.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const body = await readRequestBuffer(req, maxBytes);
  const parts = [];
  let cursor = body.indexOf(boundary);
  if (cursor < 0) throw badRequest('Multipart-Inhalt ist ungültig.');
  cursor += boundary.length + 2;

  while (cursor < body.length) {
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), cursor);
    if (next < 0) break;
    const part = body.slice(cursor, next);
    cursor = next + boundary.length + 4;
    if (!part.length) continue;
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headerText = part.slice(0, headerEnd).toString('latin1');
    const content = part.slice(headerEnd + 4);
    const disposition = headerText.match(/content-disposition:\s*form-data;\s*([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
    if (name) parts.push({ name, filename, mimeType, data: content });
  }
  return parts;
}

export async function readJson(req, maxBytes = 1024 * 1024) {
  const buffer = await readRequestBuffer(req, maxBytes);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw badRequest('JSON konnte nicht gelesen werden.');
  }
}

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(badRequest('Die Anfrage ist zu groß.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
