export const PAYMENT_STATUSES = [
  'Ausstehend',
  'Verzögert (Deckung)',
  'Mahnstatus',
  'Mahnstatus II',
  'Teilbezahlt',
  'Bezahlt'
];

export const ARCHIVE_STATUSES = new Set(['Bezahlt']);

const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20,
  LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19,
  MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20
};

export function normalizePaymentInput(input) {
  const tenantId = requiredText(input.tenantId, 'Mandant');
  const categoryId = optionalText(input.categoryId);
  const recipientName = optionalText(input.recipientName);
  const iban = normalizeIban(optionalText(input.iban));
  const purpose = optionalText(input.purpose);
  const amount = normalizeAmount(input.amount);
  const dueDate = normalizeDate(input.dueDate);
  const status = input.status || 'Ausstehend';
  const notes = optionalText(input.notes);

  if (!PAYMENT_STATUSES.includes(status)) {
    throw badRequest('Unbekannter Zahlungsstatus.');
  }
  if (iban && !isValidIban(iban)) {
    throw badRequest('Die IBAN ist ungültig.');
  }

  return { tenantId, categoryId, recipientName, iban, purpose, amount, dueDate, status, notes };
}

export function validateQrPayment(payment) {
  const missing = [];
  if (!payment.recipient_name && !payment.recipientName) missing.push('Empfängername');
  if (!payment.iban || !isValidIban(payment.iban)) missing.push('gültige IBAN');
  if (!payment.purpose) missing.push('Verwendungszweck');
  if (!payment.amount) missing.push('Betrag');
  if (missing.length) {
    throw badRequest(`EPC-QR-Code kann noch nicht erzeugt werden. Es fehlen: ${missing.join(', ')}.`);
  }
}

export function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) {
    throw badRequest('Der Betrag muss eine positive Dezimalzahl mit maximal zwei Nachkommastellen sein.');
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest('Der Betrag muss größer als 0 sein.');
  }
  return number.toFixed(2);
}

export function normalizeIban(value) {
  return value ? value.replace(/\s+/g, '').toUpperCase() : null;
}

export function isValidIban(value) {
  const iban = normalizeIban(value);
  if (!iban || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expectedLength && iban.length !== expectedLength) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const fragment = code >= 65 && code <= 90 ? String(code - 55) : char;
    for (const digit of fragment) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function safeText(value, maxLength = 255) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function badRequest(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, label) {
  const text = safeText(value);
  if (!text) throw badRequest(`${label} ist erforderlich.`);
  return text;
}

function optionalText(value) {
  return safeText(value, 1000);
}

function normalizeDate(value) {
  const text = safeText(value, 32);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw badRequest('Das Fälligkeitsdatum muss im Format JJJJ-MM-TT vorliegen.');
  return text;
}
