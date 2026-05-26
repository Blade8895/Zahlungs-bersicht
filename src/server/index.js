import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDatabase, nowIso, bool } from './db.js';
import {
  authenticateRequest,
  createSession,
  hashPassword,
  id,
  normalizeUser,
  parseCookies,
  randomToken,
  revokeSession,
  serializeCookie,
  verifyPassword
} from './auth.js';
import { parseMultipart, readJson } from './multipart.js';
import { createQrSvgForPayment } from './qr.js';
import { PAYMENT_STATUSES, ARCHIVE_STATUSES, badRequest, normalizePaymentInput, safeText, validateQrPayment } from './validation.js';
import { ensureSeedData } from './seed.js';

const db = openDatabase();
ensureSeedData(db, config.seedMode);
const server = http.createServer((req, res) => handleRequest(req, res).catch((error) => sendError(res, error)));

server.listen(config.port, config.host, () => {
  console.log(`Zahlungserfassung läuft auf http://${config.host}:${config.port}`);
});

async function handleRequest(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }
  serveStatic(res, url.pathname);
}

async function handleApi(req, res, url) {
  const context = authenticateRequest(db, req);
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') verifyCsrf(req, context);

  if (method === 'GET' && url.pathname === '/api/auth/csrf') {
    const token = context?.csrfToken || parseCookies(req.headers.cookie || '')[config.csrfCookie] || randomToken(24);
    setCsrfCookie(res, token);
    sendJson(res, { csrfToken: token });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const email = safeText(body.email, 320)?.toLowerCase();
    const password = String(body.password || '');
    const remember = Boolean(body.remember);
    const user = email ? db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email) : null;
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      throw badRequest('E-Mail oder Passwort ist falsch.', 401);
    }
    const session = createSession(db, user.id, remember);
    setSessionCookie(res, session.token, session.expiresAt);
    setCsrfCookie(res, session.csrfToken);
    sendJson(res, { user: normalizeUser(user), tenants: getAccessibleTenants(user), csrfToken: session.csrfToken });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    if (context) revokeSession(db, context.session.id);
    clearAuthCookies(res);
    sendJson(res, { ok: true });
    return;
  }

  requireAuth(context);

  if (method === 'GET' && url.pathname === '/api/auth/me') {
    sendJson(res, { user: context.user, tenants: getAccessibleTenants(context.user), csrfToken: context.csrfToken });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/meta') {
    sendJson(res, { statuses: PAYMENT_STATUSES, maxPdfBytes: config.maxPdfBytes });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/dashboard') {
    sendJson(res, getDashboard(context, url));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/tenants') {
    sendJson(res, { tenants: getAccessibleTenants(context.user) });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/categories') {
    const tenantId = url.searchParams.get('tenantId');
    assertTenantAccess(context, tenantId);
    sendJson(res, { categories: getCategories(tenantId, false) });
    return;
  }

  if (url.pathname === '/api/payments' && method === 'GET') {
    sendJson(res, { payments: listPayments(context, url) });
    return;
  }

  if (url.pathname === '/api/payments' && method === 'POST') {
    const body = await readJson(req);
    sendJson(res, { payment: createPayment(context, body) }, 201);
    return;
  }

  if (url.pathname === '/api/qr/preview' && method === 'POST') {
    const body = await readJson(req);
    const payment = {
      recipientName: safeText(body.recipientName, 255),
      iban: safeText(body.iban, 64),
      purpose: safeText(body.purpose, 255),
      amount: safeText(body.amount, 32)
    };
    validateQrPayment(payment);
    const { payload, svg } = createQrSvgForPayment(payment);
    sendJson(res, { payload, svg, dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
    return;
  }

  const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)(?:\/([^/]+))?$/);
  if (paymentMatch) {
    await handlePaymentRoute(req, res, url, context, paymentMatch[1], paymentMatch[2]);
    return;
  }

  if (url.pathname.startsWith('/api/admin/')) {
    requireAdmin(context);
    await handleAdminRoute(req, res, url, context);
    return;
  }

  throw badRequest('API-Endpunkt wurde nicht gefunden.', 404);
}

async function handlePaymentRoute(req, res, url, context, paymentId, action) {
  const method = req.method || 'GET';
  const payment = getPaymentForUser(context, paymentId);
  if (!payment) throw badRequest('Zahlung wurde nicht gefunden.', 404);

  if (!action && method === 'GET') {
    sendJson(res, { payment });
    return;
  }

  if (!action && method === 'PUT') {
    const body = await readJson(req);
    sendJson(res, { payment: updatePayment(context, paymentId, body) });
    return;
  }

  if (action === 'archive' && method === 'PATCH') {
    const archived = Boolean((await readJson(req)).archived);
    db.prepare('UPDATE payments SET is_archived = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(bool(archived), context.user.id, nowIso(), paymentId);
    sendJson(res, { payment: getPaymentForUser(context, paymentId) });
    return;
  }

  if (action === 'document' && method === 'GET') {
    const document = db.prepare('SELECT * FROM documents WHERE payment_id = ?').get(paymentId);
    if (!document) throw badRequest('Dokument wurde nicht gefunden.', 404);
    const filePath = path.join(config.uploadDir, document.stored_name);
    if (!existsSync(filePath)) throw badRequest('Dokumentdatei fehlt auf dem Server.', 404);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': statSync(filePath).size,
      'Content-Disposition': `inline; filename="${encodeHeaderFileName(document.original_name)}"`
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  if (action === 'document' && method === 'POST') {
    const parts = await parseMultipart(req, config.maxPdfBytes + 1024 * 32);
    const file = parts.find((part) => part.filename);
    if (!file || !file.data.length) throw badRequest('Bitte eine PDF-Datei auswählen.');
    if (file.mimeType !== 'application/pdf' || !file.filename.toLowerCase().endsWith('.pdf')) {
      throw badRequest('Es sind nur PDF-Dateien erlaubt.');
    }
    if (!file.data.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw badRequest('Die Datei ist keine gültige PDF-Datei.');
    }
    if (file.data.length > config.maxPdfBytes) throw badRequest('Die PDF-Datei ist zu groß.', 413);
    saveDocument(context, paymentId, file);
    sendJson(res, { payment: getPaymentForUser(context, paymentId) });
    return;
  }

  if (action === 'document' && method === 'DELETE') {
    deleteDocument(paymentId);
    sendJson(res, { payment: getPaymentForUser(context, paymentId) });
    return;
  }

  if (action === 'qr' && method === 'POST') {
    const fresh = getPaymentForUser(context, paymentId);
    validateQrPayment(fresh);
    const { payload, svg } = createQrSvgForPayment(fresh);
    db.prepare('UPDATE payments SET qr_payload = ?, qr_generated_at = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(payload, nowIso(), context.user.id, nowIso(), paymentId);
    sendJson(res, { payload, svg, dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
    return;
  }

  throw badRequest('Zahlungsaktion wurde nicht gefunden.', 404);
}

async function handleAdminRoute(req, res, url, context) {
  const method = req.method || 'GET';

  if (url.pathname === '/api/admin/users' && method === 'GET') {
    sendJson(res, { users: listUsers() });
    return;
  }

  if (url.pathname === '/api/admin/users' && method === 'POST') {
    const body = await readJson(req);
    sendJson(res, { user: saveUser(body) }, 201);
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && method === 'PUT') {
    const body = await readJson(req);
    sendJson(res, { user: saveUser(body, userMatch[1], context.user.id) });
    return;
  }

  if (userMatch && method === 'DELETE') {
    deleteUser(userMatch[1], context.user.id);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === '/api/admin/tenants' && method === 'GET') {
    sendJson(res, { tenants: listAdminTenants() });
    return;
  }

  if (url.pathname === '/api/admin/tenants' && method === 'POST') {
    const body = await readJson(req);
    sendJson(res, { tenant: saveTenant(body) }, 201);
    return;
  }

  const tenantMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)(?:\/([^/]+))?$/);
  if (tenantMatch) {
    const tenantId = tenantMatch[1];
    const action = tenantMatch[2];
    if (!action && method === 'PUT') {
      const body = await readJson(req);
      sendJson(res, { tenant: saveTenant(body, tenantId) });
      return;
    }
    if (!action && method === 'DELETE') {
      deleteTenant(tenantId);
      sendJson(res, { ok: true });
      return;
    }
    if (action === 'categories' && method === 'POST') {
      const body = await readJson(req);
      const name = safeText(body.name, 120);
      if (!name) throw badRequest('Kategoriename ist erforderlich.');
      db.prepare('INSERT INTO categories (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id('cat'), tenantId, name, nowIso(), nowIso());
      sendJson(res, { tenant: getAdminTenant(tenantId) }, 201);
      return;
    }
  }

  const categoryMatch = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (categoryMatch && method === 'DELETE') {
    db.prepare('UPDATE categories SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), categoryMatch[1]);
    sendJson(res, { ok: true });
    return;
  }

  throw badRequest('Admin-Endpunkt wurde nicht gefunden.', 404);
}

function createPayment(context, body) {
  const input = normalizePaymentInput(body);
  assertTenantAccess(context, input.tenantId);
  assertCategoryBelongsToTenant(input.categoryId, input.tenantId);
  const now = nowIso();
  const paymentId = id('pay');
  const archived = ARCHIVE_STATUSES.has(input.status);
  const paidAt = input.status === 'Bezahlt' ? now : null;
  db.prepare(`
    INSERT INTO payments (
      id, tenant_id, category_id, recipient_name, iban, purpose, amount, due_date, status, notes,
      is_archived, paid_at, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paymentId,
    input.tenantId,
    input.categoryId,
    input.recipientName,
    input.iban,
    input.purpose,
    input.amount,
    input.dueDate,
    input.status,
    input.notes,
    bool(archived),
    paidAt,
    context.user.id,
    context.user.id,
    now,
    now
  );
  return getPaymentForUser(context, paymentId);
}

function updatePayment(context, paymentId, body) {
  const existing = getPaymentForUser(context, paymentId);
  if (!existing) throw badRequest('Zahlung wurde nicht gefunden.', 404);
  const input = normalizePaymentInput(body);
  assertTenantAccess(context, input.tenantId);
  assertCategoryBelongsToTenant(input.categoryId, input.tenantId);
  const archived = ARCHIVE_STATUSES.has(input.status) || Boolean(body.isArchived);
  const now = nowIso();
  const paidAt = input.status === 'Bezahlt' ? (existing.paidAt || now) : null;
  db.prepare(`
    UPDATE payments
    SET tenant_id = ?, category_id = ?, recipient_name = ?, iban = ?, purpose = ?, amount = ?,
        due_date = ?, status = ?, notes = ?, is_archived = ?, paid_at = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.tenantId,
    input.categoryId,
    input.recipientName,
    input.iban,
    input.purpose,
    input.amount,
    input.dueDate,
    input.status,
    input.notes,
    bool(archived),
    paidAt,
    context.user.id,
    now,
    paymentId
  );
  return getPaymentForUser(context, paymentId);
}

function listPayments(context, url) {
  const params = url.searchParams;
  const tenantFilter = params.get('tenantId');
  const accessible = getAccessibleTenantIds(context.user);
  const conditions = [];
  const values = [];

  if (tenantFilter && tenantFilter !== 'all') {
    assertTenantAccess(context, tenantFilter);
    conditions.push('p.tenant_id = ?');
    values.push(tenantFilter);
  } else {
    conditions.push(`p.tenant_id IN (${accessible.map(() => '?').join(',') || "''"})`);
    values.push(...accessible);
  }

  const scope = params.get('scope') || 'active';
  if (scope === 'archive') conditions.push('p.is_archived = 1');
  if (scope === 'active') conditions.push('p.is_archived = 0');
  if (params.get('categoryId')) {
    conditions.push('p.category_id = ?');
    values.push(params.get('categoryId'));
  }
  if (params.get('status')) {
    conditions.push('p.status = ?');
    values.push(params.get('status'));
  }
  if (params.get('from')) {
    conditions.push('p.due_date >= ?');
    values.push(params.get('from'));
  }
  if (params.get('to')) {
    conditions.push('p.due_date <= ?');
    values.push(params.get('to'));
  }
  if (params.get('minAmount')) {
    conditions.push('CAST(p.amount AS REAL) >= ?');
    values.push(Number(params.get('minAmount')));
  }
  if (params.get('maxAmount')) {
    conditions.push('CAST(p.amount AS REAL) <= ?');
    values.push(Number(params.get('maxAmount')));
  }
  if (params.get('q')) {
    const query = params.get('q').trim();
    const like = `%${query}%`;
    const dotAmountLike = `%${query.replace(',', '.')}%`;
    const commaAmountLike = `%${query.replace('.', ',')}%`;
    conditions.push(`(
      p.recipient_name LIKE ? OR p.iban LIKE ? OR p.purpose LIKE ? OR
      printf('%.2f', CAST(p.amount AS REAL)) LIKE ? OR
      REPLACE(printf('%.2f', CAST(p.amount AS REAL)), '.', ',') LIKE ? OR
      c.name LIKE ? OR t.name LIKE ? OR p.status LIKE ?
    )`);
    values.push(like, like, like, dotAmountLike, commaAmountLike, like, like, like);
  }

  const rows = db.prepare(`
    ${paymentSelectSql()}
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(p.due_date, '9999-12-31') ASC, p.updated_at DESC
    LIMIT 250
  `).all(...values);
  return rows.map(serializePayment);
}

function getPaymentForUser(context, paymentId) {
  const payment = db.prepare(`${paymentSelectSql()} WHERE p.id = ?`).get(paymentId);
  if (!payment) return null;
  assertTenantAccess(context, payment.tenant_id);
  return serializePayment(payment);
}

function paymentSelectSql() {
  return `
    SELECT p.*, t.name AS tenant_name, t.color AS tenant_color, c.name AS category_name,
           d.id AS document_id, d.original_name AS document_name, d.size_bytes AS document_size
    FROM payments p
    JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN documents d ON d.payment_id = p.id
  `;
}

function serializePayment(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantColor: row.tenant_color,
    categoryId: row.category_id,
    categoryName: row.category_name,
    recipientName: row.recipient_name,
    iban: row.iban,
    purpose: row.purpose,
    amount: row.amount,
    dueDate: row.due_date,
    status: row.status,
    notes: row.notes,
    isArchived: Boolean(row.is_archived),
    paidAt: row.paid_at,
    qrGeneratedAt: row.qr_generated_at,
    document: row.document_id ? {
      id: row.document_id,
      name: row.document_name,
      size: row.document_size,
      url: `/api/payments/${row.id}/document`
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getDashboard(context, url) {
  const tenantId = url.searchParams.get('tenantId') || 'all';
  const tenants = tenantId === 'all'
    ? getAccessibleTenants(context.user)
    : getAccessibleTenants(context.user).filter((tenant) => tenant.id === tenantId);
  if (tenantId !== 'all') assertTenantAccess(context, tenantId);
  const payments = listPayments(context, new URL(`/api/payments?scope=active&tenantId=${tenantId}`, 'http://local'));
  const upcoming = payments.filter((payment) => payment.status !== 'Bezahlt').slice(0, 8);
  const charts = tenants.map((tenant) => {
    const tenantPayments = payments.filter((payment) => payment.tenantId === tenant.id);
    const byCategory = groupTotals(tenantPayments, (payment) => payment.categoryName || 'Ohne Kategorie');
    const byStatus = groupTotals(tenantPayments, (payment) => payment.status);
    return { tenant, byCategory, byStatus, total: sumAmount(tenantPayments) };
  });
  const summary = {
    activeCount: payments.length,
    dueSoonCount: payments.filter((payment) => payment.dueDate && daysUntil(payment.dueDate) <= 7).length,
    openAmount: sumAmount(payments.filter((payment) => payment.status !== 'Bezahlt')),
    delayedCount: payments.filter((payment) => payment.status.includes('Mahn') || payment.status.includes('Verzögert')).length
  };
  return { summary, charts, upcoming };
}

function getAccessibleTenants(user) {
  if (user.role === 'ADMIN') {
    return db.prepare('SELECT id, name, color, is_active FROM tenants WHERE is_active = 1 ORDER BY name').all().map(serializeTenant);
  }
  return db.prepare(`
    SELECT t.id, t.name, t.color, t.is_active
    FROM tenants t
    JOIN user_tenants ut ON ut.tenant_id = t.id
    WHERE ut.user_id = ? AND t.is_active = 1
    ORDER BY t.name
  `).all(user.id).map(serializeTenant);
}

function getAccessibleTenantIds(user) {
  return getAccessibleTenants(user).map((tenant) => tenant.id);
}

function getCategories(tenantId, includeInactive = false) {
  const sql = `SELECT id, tenant_id, name, is_active FROM categories WHERE tenant_id = ?${includeInactive ? '' : ' AND is_active = 1'} ORDER BY name`;
  return db.prepare(sql).all(tenantId).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    isActive: Boolean(row.is_active)
  }));
}

function assertTenantAccess(context, tenantId) {
  if (!tenantId) throw badRequest('Mandant ist erforderlich.');
  if (context.user.role === 'ADMIN') {
    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ? AND is_active = 1').get(tenantId);
    if (tenant) return;
  } else if (getAccessibleTenantIds(context.user).includes(tenantId)) {
    return;
  }
  throw badRequest('Kein Zugriff auf diesen Mandanten.', 403);
}

function assertCategoryBelongsToTenant(categoryId, tenantId) {
  if (!categoryId) return;
  const category = db.prepare('SELECT id FROM categories WHERE id = ? AND tenant_id = ? AND is_active = 1').get(categoryId, tenantId);
  if (!category) throw badRequest('Kategorie gehört nicht zum gewählten Mandanten.');
}

function saveDocument(context, paymentId, file) {
  deleteDocument(paymentId);
  mkdirSync(config.uploadDir, { recursive: true });
  const storedName = `${paymentId}-${Date.now()}-${file.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  writeFileSync(path.join(config.uploadDir, storedName), file.data);
  db.prepare(`
    INSERT INTO documents (id, payment_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id('doc'), paymentId, file.filename, storedName, 'application/pdf', file.data.length, context.user.id, nowIso());
}

function deleteDocument(paymentId) {
  const document = db.prepare('SELECT * FROM documents WHERE payment_id = ?').get(paymentId);
  if (!document) return;
  const filePath = path.join(config.uploadDir, document.stored_name);
  if (existsSync(filePath)) rmSync(filePath, { force: true });
  db.prepare('DELETE FROM documents WHERE payment_id = ?').run(paymentId);
}

function listUsers() {
  return db.prepare('SELECT id, email, name, role, is_active, is_default_admin FROM users ORDER BY name').all().map((row) => ({
    ...normalizeUser(row),
    tenantIds: db.prepare('SELECT tenant_id FROM user_tenants WHERE user_id = ?').all(row.id).map((item) => item.tenant_id)
  }));
}

function saveUser(body, userId = null, currentUserId = null) {
  const email = safeText(body.email, 320)?.toLowerCase();
  const name = safeText(body.name, 160);
  const role = body.role === 'ADMIN' ? 'ADMIN' : 'USER';
  const tenantIds = Array.isArray(body.tenantIds) ? body.tenantIds : [];
  const active = body.isActive !== false;
  if (!email || !name) throw badRequest('Name und E-Mail sind erforderlich.');
  const now = nowIso();
  let idToUse = userId;
  const existing = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
  if (userId && !existing) throw badRequest('Benutzer wurde nicht gefunden.', 404);
  if (userId && !active && userId === currentUserId) throw badRequest('Der eigene Account kann nicht deaktiviert werden.');
  if (existing?.role === 'ADMIN' && existing.is_active && (!active || role !== 'ADMIN')) ensureAnotherActiveAdmin(userId);
  if (userId) {
    const password = body.password ? hashPassword(String(body.password)) : existing.password_hash;
    db.prepare('UPDATE users SET email = ?, name = ?, password_hash = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(email, name, password, role, bool(active), now, userId);
  } else {
    if (!body.password || String(body.password).length < 8) throw badRequest('Ein Passwort mit mindestens 8 Zeichen ist erforderlich.');
    idToUse = id('usr');
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(idToUse, email, name, hashPassword(String(body.password)), role, bool(active), now, now);
  }
  db.prepare('DELETE FROM user_tenants WHERE user_id = ?').run(idToUse);
  const assign = db.prepare('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)');
  for (const tenantId of tenantIds) {
    const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (tenant) assign.run(idToUse, tenantId);
  }
  return listUsers().find((user) => user.id === idToUse);
}

function deleteUser(userId, currentUserId) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) throw badRequest('Benutzer wurde nicht gefunden.', 404);
  if (userId === currentUserId) throw badRequest('Der eigene Account kann nicht gelöscht werden.');
  if (existing.role === 'ADMIN' && existing.is_active) ensureAnotherActiveAdmin(userId);

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE payments SET created_by = ? WHERE created_by = ?').run(currentUserId, userId);
    db.prepare('UPDATE payments SET updated_by = ? WHERE updated_by = ?').run(currentUserId, userId);
    db.prepare('UPDATE documents SET uploaded_by = ? WHERE uploaded_by = ?').run(currentUserId, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_tenants WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function ensureAnotherActiveAdmin(userId) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND is_active = 1 AND id <> ?').get('ADMIN', userId).count;
  if (!count) throw badRequest('Dieser Admin kann erst geändert oder gelöscht werden, wenn ein anderer aktiver Admin existiert.');
}

function listAdminTenants() {
  return db.prepare('SELECT * FROM tenants ORDER BY name').all().map((tenant) => getAdminTenant(tenant.id));
}

function getAdminTenant(tenantId) {
  const row = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!row) return null;
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM users u
    JOIN user_tenants ut ON ut.user_id = u.id
    WHERE ut.tenant_id = ?
    ORDER BY u.name
  `).all(tenantId);
  return { ...serializeTenant(row), categories: getCategories(tenantId, true), users };
}

function saveTenant(body, tenantId = null) {
  const name = safeText(body.name, 120);
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#2dd4bf';
  const active = body.isActive !== false;
  if (!name) throw badRequest('Mandantenname ist erforderlich.');
  const now = nowIso();
  const idToUse = tenantId || id('ten');
  if (tenantId && !db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) {
    throw badRequest('Mandant wurde nicht gefunden.', 404);
  }
  if (tenantId) {
    db.prepare('UPDATE tenants SET name = ?, color = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(name, color, bool(active), now, tenantId);
  } else {
    db.prepare('INSERT INTO tenants (id, name, color, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(idToUse, name, color, bool(active), now, now);
  }
  return getAdminTenant(idToUse);
}

function deleteTenant(tenantId) {
  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw badRequest('Mandant wurde nicht gefunden.', 404);

  const assignedUsers = db.prepare('SELECT COUNT(*) AS count FROM user_tenants WHERE tenant_id = ?').get(tenantId).count;
  if (assignedUsers > 0) {
    throw badRequest('Mandant kann erst gelöscht werden, wenn keine Benutzer mehr zugewiesen sind.', 409);
  }

  const documents = db.prepare(`
    SELECT d.stored_name
    FROM documents d
    JOIN payments p ON p.id = d.payment_id
    WHERE p.tenant_id = ?
  `).all(tenantId);

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('DELETE FROM payments WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM categories WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  for (const document of documents) {
    const filePath = path.join(config.uploadDir, document.stored_name);
    if (existsSync(filePath)) rmSync(filePath, { force: true });
  }
}

function serializeTenant(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isActive: Boolean(row.is_active)
  };
}

function groupTotals(payments, keyFn) {
  const groups = new Map();
  for (const payment of payments) {
    const key = keyFn(payment);
    groups.set(key, (groups.get(key) || 0) + Number(payment.amount || 0));
  }
  return [...groups.entries()].map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));
}

function sumAmount(payments) {
  return Number(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2));
}

function daysUntil(dateText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateText}T00:00:00`);
  return Math.round((date - today) / 86400000);
}

function requireAuth(context) {
  if (!context) throw badRequest('Bitte anmelden.', 401);
}

function requireAdmin(context) {
  requireAuth(context);
  if (context.user.role !== 'ADMIN') throw badRequest('Administratorrechte erforderlich.', 403);
}

function verifyCsrf(req, context) {
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[config.csrfCookie];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw badRequest('CSRF-Schutz: Anfrage wurde abgelehnt.', 403);
  }
  if (context && context.csrfToken !== headerToken) {
    throw badRequest('CSRF-Schutz: Sitzungstoken stimmt nicht.', 403);
  }
}

function setSessionCookie(res, token, expiresAt) {
  appendSetCookie(res, serializeCookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.isProduction,
    expires: expiresAt
  }));
}

function setCsrfCookie(res, token) {
  appendSetCookie(res, serializeCookie(config.csrfCookie, token, {
    sameSite: 'Lax',
    secure: config.isProduction,
    maxAge: config.rememberDays * 86400
  }));
}

function clearAuthCookies(res) {
  appendSetCookie(res, serializeCookie(config.sessionCookie, '', { httpOnly: true, sameSite: 'Lax', secure: config.isProduction, maxAge: 0 }));
  appendSetCookie(res, serializeCookie(config.csrfCookie, '', { sameSite: 'Lax', secure: config.isProduction, maxAge: 0 }));
}

function appendSetCookie(res, value) {
  const previous = res.getHeader('Set-Cookie');
  if (!previous) res.setHeader('Set-Cookie', value);
  else res.setHeader('Set-Cookie', Array.isArray(previous) ? previous.concat(value) : [previous, value]);
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(error);
  sendJson(res, { error: error.message || 'Unerwarteter Serverfehler.' }, status);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'self'; base-uri 'self'; form-action 'self'"
  );
}

function serveStatic(res, rawPath) {
  const decodedPath = decodeURIComponent(rawPath.split('?')[0]);
  const publicPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const target = path.normalize(path.join(config.publicDir, publicPath));
  const safeTarget = target.startsWith(config.publicDir) ? target : path.join(config.publicDir, 'index.html');
  const filePath = existsSync(safeTarget) && statSync(safeTarget).isFile()
    ? safeTarget
    : path.join(config.publicDir, 'index.html');
  const ext = path.extname(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
  const immutable = /\.(?:png|svg)$/.test(filePath);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  createReadStream(filePath).pipe(res);
}

function encodeHeaderFileName(filename) {
  return String(filename || 'dokument.pdf').replace(/["\r\n]/g, '_');
}
