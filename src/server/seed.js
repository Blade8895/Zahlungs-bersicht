import { id, hashPassword } from './auth.js';
import { nowIso } from './db.js';

export function ensureSeedData(db, seedMode = 'demo') {
  if (seedMode !== 'demo') return;
  const now = nowIso();
  const tenantCount = db.prepare('SELECT COUNT(*) AS count FROM tenants').get().count;
  if (!tenantCount) {
    const tenants = [
      { id: id('ten'), name: 'Privat', color: '#2dd4bf', categories: ['Versicherung'] },
      { id: id('ten'), name: 'Haus', color: '#f59e0b', categories: ['Versicherung'] },
      { id: id('ten'), name: 'Firma', color: '#38bdf8', categories: ['Krankenkasse', 'Warenbestellung', 'Inkasso'] }
    ];
    const insertTenant = db.prepare('INSERT INTO tenants (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertCategory = db.prepare('INSERT INTO categories (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const tenant of tenants) {
      insertTenant.run(tenant.id, tenant.name, tenant.color, now, now);
      for (const category of tenant.categories) {
        insertCategory.run(id('cat'), tenant.id, category, now, now);
      }
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (!userCount) {
    const adminId = id('usr');
    const userId = id('usr');
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, is_default_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ADMIN', 1, ?, ?)
    `).run(adminId, 'admin@zahlung.local', 'Standard Admin', hashPassword('Admin123!'), now, now);
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'USER', ?, ?)
    `).run(userId, 'benutzer@zahlung.local', 'Max Mustermann', hashPassword('Benutzer123!'), now, now);

    const tenants = db.prepare('SELECT id, name FROM tenants WHERE is_active = 1').all();
    const assign = db.prepare('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)');
    for (const tenant of tenants) assign.run(adminId, tenant.id);
    for (const tenant of tenants.filter((tenant) => tenant.name !== 'Firma')) assign.run(userId, tenant.id);
  }

  const paymentCount = db.prepare('SELECT COUNT(*) AS count FROM payments').get().count;
  if (!paymentCount) {
    const admin = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('ADMIN');
    const tenants = db.prepare('SELECT id, name FROM tenants').all();
    const categories = db.prepare('SELECT id, tenant_id, name FROM categories').all();
    const insertPayment = db.prepare(`
      INSERT INTO payments (
        id, tenant_id, category_id, recipient_name, iban, purpose, amount, due_date, status, notes,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const due = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const category = (tenantName, categoryName) => {
      const tenant = tenants.find((item) => item.name === tenantName);
      return categories.find((item) => item.tenant_id === tenant?.id && item.name === categoryName);
    };
    const samples = [
      ['Privat', 'Versicherung', 'Allianz Versicherung', 'DE89370400440532013000', 'Police 2026-05', '89.90', due(5), 'Ausstehend', 'Jährliche Haftpflicht.'],
      ['Haus', 'Versicherung', 'GebäudeDirekt AG', 'DE12500105170648489890', 'Gebäudeversicherung Juni', '245.00', due(11), 'Verzögert (Deckung)', 'Deckung morgen prüfen.'],
      ['Firma', 'Krankenkasse', 'Techniker Krankenkasse', 'DE44500105175407324931', 'Beiträge Mai', '1320.40', due(2), 'Mahnstatus', 'Priorität hoch.'],
      ['Firma', 'Warenbestellung', 'Musterhandel GmbH', 'DE02120300000000202051', 'Bestellung WH-22019', '468.75', due(16), 'Teilbezahlt', 'Restbetrag offen.'],
      ['Privat', 'Versicherung', null, null, null, null, due(22), 'Ausstehend', 'Unvollständiger Entwurf.']
    ];
    for (const item of samples) {
      const tenant = tenants.find((value) => value.name === item[0]);
      const cat = category(item[0], item[1]);
      insertPayment.run(id('pay'), tenant.id, cat?.id || null, item[2], item[3], item[4], item[5], item[6], item[7], item[8], admin.id, admin.id, now, now);
    }
  }
}
