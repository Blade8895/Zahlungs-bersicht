const app = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-root');

const state = {
  user: null,
  tenants: [],
  meta: { statuses: [] },
  csrfToken: '',
  selectedTenantId: localStorage.getItem('selectedTenantId') || 'all',
  sidebarOpen: false,
  editingUserId: null,
  editingTenantId: null,
  formFile: null,
  removeDocument: false,
  installPrompt: null
};

const icons = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  archive: '<path d="M3 7h18"/><path d="M5 7v12h14V7"/><path d="m8 7 1-4h6l1 4"/><path d="M10 12h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
};

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  render();
});

window.addEventListener('popstate', () => {
  resetTransientFormState();
  render();
});

document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : event.target.parentElement;
  if (!clicked) return;
  const link = clicked.closest('[data-link]');
  if (link) {
    event.preventDefault();
    navigate(link.getAttribute('href'));
    return;
  }

  const action = clicked.closest('[data-action]')?.dataset.action;
  if (!action) return;

  const target = clicked.closest('[data-action]');
  event.preventDefault();
  if (action === 'login') login(document.querySelector('#login-form'));
  if (action === 'toggle-sidebar') toggleSidebar();
  if (action === 'close-sidebar') closeSidebar();
  if (action === 'logout') logout();
  if (action === 'select-tenant') selectTenant(target.dataset.tenantId);
  if (action === 'install') installPwa();
  if (action === 'open-pdf') window.open(target.dataset.url, '_blank', 'noopener');
  if (action === 'qr-payment') showPaymentQr(target.dataset.id);
  if (action === 'qr-preview') previewFormQr();
  if (action === 'close-modal') closeModal();
  if (action === 'remove-document') markDocumentForRemoval();
  if (action === 'edit-user') { state.editingUserId = target.dataset.id; render(); }
  if (action === 'new-user') { state.editingUserId = null; render(); }
  if (action === 'delete-user') deleteUser(target.dataset.id);
  if (action === 'edit-tenant') { state.editingTenantId = target.dataset.id; render(); }
  if (action === 'new-tenant') { state.editingTenantId = null; render(); }
  if (action === 'delete-tenant') deleteTenant(target.dataset.id);
  if (action === 'delete-category') deleteCategory(target.dataset.id);
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.matches('#login-form')) {
    event.preventDefault();
    login(form);
  }
  if (form.matches('#payment-filter-form')) {
    event.preventDefault();
    applyPaymentFilters(form);
  }
  if (form.matches('#payment-form')) {
    event.preventDefault();
    savePayment(form);
  }
  if (form.matches('#user-form')) {
    event.preventDefault();
    saveUser(form);
  }
  if (form.matches('#tenant-form')) {
    event.preventDefault();
    saveTenant(form);
  }
  if (form.matches('[data-category-form]')) {
    event.preventDefault();
    addCategory(form);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('#document-file')) {
    state.formFile = event.target.files[0] || null;
    state.removeDocument = false;
    const label = document.querySelector('#document-label');
    if (label) label.textContent = state.formFile ? state.formFile.name : 'Keine Datei ausgewählt';
  }
  if (event.target.matches('[name="tenantId"][data-payment-tenant]')) {
    refreshCategoryOptions(event.target.value);
  }
});

init();

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
  await loadCsrf();
  await loadSession();
  render();
}

async function loadCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'include' });
  const data = await response.json();
  state.csrfToken = data.csrfToken;
}

async function loadSession() {
  try {
    const data = await api('/api/auth/me', { allow401: true });
    if (data?.user) {
      state.user = data.user;
      state.tenants = data.tenants || [];
      state.csrfToken = data.csrfToken || state.csrfToken;
      state.meta = await api('/api/meta');
    }
  } catch {
    state.user = null;
  }
}

async function render() {
  const path = location.pathname;
  if (!state.user) {
    app.className = '';
    app.innerHTML = loginPage();
    bindRenderedEvents();
    return;
  }
  if (path === '/login') {
    navigate('/', true);
    return;
  }
  app.className = '';
  app.innerHTML = appShell('<div class="loading"><div class="spinner" aria-label="Lädt"></div></div>');
  try {
    const content = await routeContent(path);
    app.innerHTML = appShell(content);
    bindRenderedEvents();
  } catch (error) {
    toast(error.message, 'error');
    app.innerHTML = appShell(emptyState('Ansicht konnte nicht geladen werden', error.message, '/'));
  }
}

function bindRenderedEvents() {
  const loginButton = document.querySelector('[data-action="login"]');
  if (loginButton) {
    loginButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      login(document.querySelector('#login-form'));
    }, { once: true });
  }
}

async function routeContent(path) {
  if (path === '/') return dashboardPage();
  if (path === '/payments/new') return paymentFormPage(null);
  if (path.startsWith('/payments/') && path !== '/payments/new') return paymentFormPage(path.split('/')[2]);
  if (path === '/payments') return paymentListPage('active');
  if (path === '/archive') return paymentListPage('archive');
  if (path === '/search') return searchPage();
  if (path === '/users') return adminOnly(usersPage);
  if (path === '/tenants') return adminOnly(tenantsPage);
  return emptyState('Seite nicht gefunden', 'Der gewünschte Bereich existiert nicht.', '/');
}

function adminOnly(factory) {
  if (state.user.role !== 'ADMIN') return emptyState('Kein Zugriff', 'Dieser Bereich ist Administratoren vorbehalten.', '/');
  return factory();
}

function loginPage() {
  return `
    <main class="login-page">
      <section class="login-visual">
        <div class="login-copy">
          <div class="brand-mark">Z</div>
          <h1>Zahlungen je Mandant sicher im Griff.</h1>
          <p>Installierbare PWA für Privat, Haus und Firma mit Rollenrechten, PDF-Ablage, EPC-QR-Code und Offline-Cache.</p>
        </div>
      </section>
      <section class="login-panel" aria-label="Login">
        <h2>Anmelden</h2>
        <p class="hint">Bei einer frischen Installation den ersten Admin per Server-Konsole anlegen.</p>
        <form id="login-form" class="grid">
          <div class="field">
            <label for="email">E-Mail</label>
            <input id="email" name="email" type="email" autocomplete="email" required value="admin@zahlung.local" />
          </div>
          <div class="field">
            <label for="password">Passwort</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required value="Admin123!" />
          </div>
          <label class="check-row">
            <input name="remember" type="checkbox" />
            Angemeldet bleiben
          </label>
          <button class="button primary" type="button" data-action="login">${svgIcon('logout')} Anmelden</button>
        </form>
      </section>
    </main>
  `;
}

function appShell(content) {
  const nav = [
    ['/', 'home', 'Startseite'],
    ['/payments/new', 'plus', 'Neuer Eintrag'],
    ['/payments', 'list', 'Zahlungsliste'],
    ['/archive', 'archive', 'Archiv'],
    ['/search', 'search', 'Suche']
  ];
  const adminNav = [
    ['/users', 'users', 'Benutzerverwaltung'],
    ['/tenants', 'building', 'Mandantenverwaltung']
  ];
  return `
    <div class="mobile-overlay ${state.sidebarOpen ? 'show' : ''}" data-action="close-sidebar"></div>
    <div class="app-shell">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}">
        <div class="sidebar-header">
          <div class="brand-mark">Z</div>
          <div class="brand-text"><strong>Zahlungserfassung</strong><span>PWA Verwaltung</span></div>
        </div>
        <nav class="nav-list" aria-label="Hauptnavigation">
          ${nav.map(([href, iconName, label]) => navItem(href, iconName, label)).join('')}
          ${state.user.role === 'ADMIN' ? `<div class="admin-label">Administration</div>${adminNav.map(([href, iconName, label]) => navItem(href, iconName, label)).join('')}` : ''}
        </nav>
      </aside>
      <section class="main-region">
        <header class="topbar">
          <button class="icon-button mobile-menu" type="button" data-action="toggle-sidebar" aria-label="Navigation öffnen">${svgIcon('menu')}</button>
          <div class="tenant-tabs" role="tablist" aria-label="Mandanten">
            ${state.tenants.length > 1 ? tenantTab('all', 'Alle Mandanten', '#94a8bd') : ''}
            ${state.tenants.map((tenant) => tenantTab(tenant.id, tenant.name, tenant.color)).join('')}
          </div>
          <div class="top-actions">
            ${state.installPrompt ? `<button class="button ghost" type="button" data-action="install">${svgIcon('download')} Installieren</button>` : ''}
            <div class="user-chip"><strong>${e(state.user.name)}</strong><span>${e(state.user.role === 'ADMIN' ? 'Administrator' : 'Benutzer')}</span></div>
            <button class="icon-button" type="button" data-action="logout" aria-label="Logout">${svgIcon('logout')}</button>
          </div>
        </header>
        ${content}
      </section>
    </div>
    <div id="modal-root"></div>
  `;
}

function navItem(href, iconName, label) {
  const active = location.pathname === href || (href === '/payments' && location.pathname.startsWith('/payments/') && location.pathname !== '/payments/new');
  return `<a class="nav-item ${active ? 'active' : ''}" href="${href}" data-link>${svgIcon(iconName)} <span>${label}</span></a>`;
}

function tenantTab(id, label, color) {
  const active = state.selectedTenantId === id || (!state.tenants.some((tenant) => tenant.id === state.selectedTenantId) && id === 'all');
  return `
    <button class="tenant-tab ${active ? 'active' : ''}" type="button" data-action="select-tenant" data-tenant-id="${id}">
      <span class="tenant-dot" style="background:${color}"></span>${e(label)}
    </button>
  `;
}

async function dashboardPage() {
  const dashboard = await api(`/api/dashboard?tenantId=${encodeURIComponent(selectedTenant())}`);
  return `
    <main class="page">
      <div class="page-head">
        <div class="page-title">
          <h1>Startseite</h1>
          <p>Kommende Zahlungen über alle freigegebenen Mandanten mit Kategorien, Status und Fälligkeiten.</p>
        </div>
        <a class="button primary" href="/payments/new" data-link>${svgIcon('plus')} Neue Zahlung</a>
      </div>
      <section class="grid cols-4">
        ${statCard('Aktive Zahlungen', dashboard.summary.activeCount, 'aktuell sichtbar')}
        ${statCard('Fällig in 7 Tagen', dashboard.summary.dueSoonCount, 'Handlungsbedarf')}
        ${statCard('Offener Betrag', money(dashboard.summary.openAmount), 'ohne bezahlte Einträge')}
        ${statCard('Verzögert/Mahnung', dashboard.summary.delayedCount, 'prüfen')}
      </section>
      <section class="grid cols-3" style="margin-top:16px">
        ${dashboard.charts.map((chart) => chartPanel(chart)).join('')}
      </section>
      <section class="table-panel" style="margin-top:16px">
        <div class="page-head" style="margin-bottom:8px">
          <h2 class="section-title">Nächste fällige Zahlungen</h2>
          <a class="button ghost" href="/payments" data-link>${svgIcon('list')} Zur Liste</a>
        </div>
        ${paymentTable(dashboard.upcoming)}
      </section>
    </main>
  `;
}

function statCard(label, value, detail) {
  return `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function chartPanel(chart) {
  const items = chart.byCategory.length ? chart.byCategory : [{ label: 'Keine Daten', value: 1 }];
  return `
    <article class="panel chart-card">
      ${pieChart(items)}
      <div>
        <h2 class="panel-title">${e(chart.tenant.name)}</h2>
        <p class="helper-text">${money(chart.total)} offen/aktiv</p>
        <div class="legend">${items.map((item, index) => `
          <div class="legend-row">
            <span><i class="legend-color" style="background:${chartColor(index)}"></i>${e(item.label)}</span>
            <strong>${chart.byCategory.length ? money(item.value) : '-'}</strong>
          </div>
        `).join('')}</div>
      </div>
    </article>
  `;
}

function pieChart(items) {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  let offset = 25;
  const circles = items.map((item, index) => {
    const value = Number(item.value || 0);
    const size = (value / total) * 100;
    const circle = `<circle r="15.915" cx="21" cy="21" fill="transparent" stroke="${chartColor(index)}" stroke-width="7" stroke-dasharray="${size} ${100 - size}" stroke-dashoffset="${offset}" />`;
    offset -= size;
    return circle;
  }).join('');
  return `<svg class="pie-chart" viewBox="0 0 42 42" aria-hidden="true"><circle r="15.915" cx="21" cy="21" fill="transparent" stroke="rgba(255,255,255,.08)" stroke-width="7" />${circles}</svg>`;
}

async function paymentListPage(scope) {
  const params = new URLSearchParams(location.search);
  if (!params.has('tenantId')) params.set('tenantId', selectedTenant());
  params.set('scope', scope);
  const data = await api(`/api/payments?${params.toString()}`);
  return `
    <main class="page">
      <div class="page-head">
        <div class="page-title">
          <h1>${scope === 'archive' ? 'Archiv' : 'Zahlungsliste'}</h1>
          <p>${scope === 'archive' ? 'Bezahlte oder archivierte Zahlungen mit Wiederherstellung über die Detailseite.' : 'Aktive Zahlungen mit Filtern. Bearbeitet wird immer in der Detailseite.'}</p>
        </div>
        <a class="button primary" href="/payments/new" data-link>${svgIcon('plus')} Neuer Eintrag</a>
      </div>
      ${filterPanel(params, scope)}
      <section class="table-panel">${paymentTable(data.payments, { showPaidDate: scope === 'archive' })}</section>
    </main>
  `;
}

function filterPanel(params, scope) {
  return `
    <form id="payment-filter-form" class="filters panel">
      <input type="hidden" name="scope" value="${scope}" />
      <div class="filter-grid">
        <div>
          <label>Mandant</label>
          <select name="tenantId">
            ${state.tenants.length > 1 ? `<option value="all" ${params.get('tenantId') === 'all' ? 'selected' : ''}>Alle Mandanten</option>` : ''}
            ${state.tenants.map((tenant) => `<option value="${tenant.id}" ${params.get('tenantId') === tenant.id ? 'selected' : ''}>${e(tenant.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select name="status">
            <option value="">Alle Status</option>
            ${state.meta.statuses.map((status) => `<option value="${e(status)}" ${params.get('status') === status ? 'selected' : ''}>${e(status)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Von</label>
          <input name="from" type="date" value="${e(params.get('from') || '')}" />
        </div>
        <div>
          <label>Bis</label>
          <input name="to" type="date" value="${e(params.get('to') || '')}" />
        </div>
        <div>
          <label>Suche</label>
          <input name="q" type="search" placeholder="Empfänger, IBAN, Zweck..." value="${e(params.get('q') || '')}" />
        </div>
        <div>
          <label>Betrag min.</label>
          <input name="minAmount" type="number" min="0" step="0.01" value="${e(params.get('minAmount') || '')}" />
        </div>
        <div>
          <label>Betrag max.</label>
          <input name="maxAmount" type="number" min="0" step="0.01" value="${e(params.get('maxAmount') || '')}" />
        </div>
        <div class="filter-actions">
          <button class="button" type="submit">${svgIcon('search')} Filtern</button>
        </div>
      </div>
    </form>
  `;
}

function paymentTable(payments, options = {}) {
  const showPaidDate = Boolean(options.showPaidDate);
  if (!payments.length) return emptyState('Noch keine Zahlungen vorhanden', 'Für die aktuelle Auswahl gibt es keine Einträge.', '/payments/new');
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Zahlung</th>
            <th>Mandant</th>
            <th>Kategorie</th>
            <th>Fällig</th>
            ${showPaidDate ? '<th>Bezahlt am</th>' : ''}
            <th>Status</th>
            <th>Betrag</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${payments.map((payment) => `
            <tr>
              <td>
                <div class="row-title">
                  <strong>${e(payment.recipientName || 'Unvollständiger Entwurf')}</strong>
                  <span>${e(payment.purpose || 'Kein Verwendungszweck')}</span>
                </div>
              </td>
              <td><span class="badge"><i class="tenant-dot" style="background:${payment.tenantColor}"></i>${e(payment.tenantName)}</span></td>
              <td>${e(payment.categoryName || 'Ohne Kategorie')}</td>
              <td>${e(formatDate(payment.dueDate))}</td>
              ${showPaidDate ? `<td>${e(payment.paidAt ? formatDate(payment.paidAt) : 'Noch offen')}</td>` : ''}
              <td><span class="badge ${statusClass(payment.status)}">${e(payment.status)}</span></td>
              <td><strong>${money(payment.amount)}</strong></td>
              <td>
                <div class="row-actions">
                  ${payment.document ? `<button class="icon-button" type="button" title="PDF anzeigen" data-action="open-pdf" data-url="${payment.document.url}">${svgIcon('file')}</button>` : ''}
                  <button class="icon-button" type="button" title="EPC-QR anzeigen" data-action="qr-payment" data-id="${payment.id}">${svgIcon('qr')}</button>
                  <a class="icon-button" href="/payments/${payment.id}" title="Bearbeiten" data-link>${svgIcon('edit')}</a>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function paymentFormPage(paymentId) {
  resetTransientFormState(false);
  const payment = paymentId ? (await api(`/api/payments/${paymentId}`)).payment : blankPayment();
  const tenantId = payment.tenantId || selectedTenantFallback();
  const categories = await api(`/api/categories?tenantId=${encodeURIComponent(tenantId)}`);
  return `
    <main class="page">
      <div class="detail-head">
        <div class="detail-title">
          <h1>${paymentId ? 'Zahlung bearbeiten' : 'Neuer Eintrag'}</h1>
          <p>Änderungen werden erst nach Speichern übernommen und führen zurück zur Zahlungsliste.</p>
        </div>
        <a class="button ghost" href="/payments" data-link>Abbrechen</a>
      </div>
      <form id="payment-form" class="form-panel" data-payment-id="${paymentId || ''}">
        <div class="form-grid two">
          <div class="field">
            <label>Mandant</label>
            <select name="tenantId" data-payment-tenant required>
              ${state.tenants.map((tenant) => `<option value="${tenant.id}" ${tenant.id === tenantId ? 'selected' : ''}>${e(tenant.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Kategorie</label>
            <select name="categoryId" id="category-select">
              <option value="">Ohne Kategorie</option>
              ${categories.categories.map((category) => `<option value="${category.id}" ${payment.categoryId === category.id ? 'selected' : ''}>${e(category.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Empfängername</label>
            <input name="recipientName" value="${e(payment.recipientName || '')}" placeholder="z. B. Muster GmbH" />
          </div>
          <div class="field">
            <label>IBAN</label>
            <input name="iban" value="${e(payment.iban || '')}" placeholder="DE..." />
          </div>
          <div class="field full">
            <label>Verwendungszweck</label>
            <input name="purpose" value="${e(payment.purpose || '')}" placeholder="Rechnung, Police, Beitragsnummer" />
          </div>
          <div class="field">
            <label>Betrag</label>
            <input name="amount" type="number" min="0" step="0.01" value="${e(payment.amount || '')}" />
          </div>
          <div class="field">
            <label>Fälligkeitsdatum</label>
            <input name="dueDate" type="date" value="${e(payment.dueDate || '')}" />
          </div>
          <div class="field">
            <label>Status</label>
            <select name="status">
              ${state.meta.statuses.map((status) => `<option value="${e(status)}" ${payment.status === status ? 'selected' : ''}>${e(status)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>PDF-Dokument</label>
            <div class="document-control">
              ${payment.document ? `<button class="button" type="button" data-action="open-pdf" data-url="${payment.document.url}">${svgIcon('file')} Anzeigen</button><button class="icon-button danger" type="button" data-action="remove-document" title="Dokument entfernen">${svgIcon('x')}</button>` : ''}
              <label class="button ghost" for="document-file">${svgIcon('file')} Upload</label>
              <input id="document-file" name="document" type="file" accept="application/pdf,.pdf" hidden />
              <span id="document-label" class="document-name">${payment.document ? e(payment.document.name) : 'Keine Datei ausgewählt'}</span>
            </div>
          </div>
          <div class="field full">
            <label>Notizen</label>
            <textarea name="notes" placeholder="Optional">${e(payment.notes || '')}</textarea>
          </div>
        </div>
        <div class="form-actions">
          <button class="button" type="button" data-action="qr-preview">${svgIcon('qr')} EPC-QR anzeigen</button>
          <button class="button primary" type="submit">${svgIcon('save')} Speichern</button>
        </div>
      </form>
    </main>
  `;
}

function blankPayment() {
  return {
    tenantId: selectedTenantFallback(),
    categoryId: '',
    recipientName: '',
    iban: '',
    purpose: '',
    amount: '',
    dueDate: '',
    status: 'Ausstehend',
    notes: '',
    document: null
  };
}

async function searchPage() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  const data = q ? await api(`/api/payments?scope=all&tenantId=${encodeURIComponent(selectedTenant())}&q=${encodeURIComponent(q)}`) : { payments: [] };
  return `
    <main class="page">
      <div class="page-head">
        <div class="page-title">
          <h1>Suche</h1>
          <p>Globale Suche über Empfänger, IBAN, Verwendungszweck, Betrag, Kategorie, Mandant und Status.</p>
        </div>
      </div>
      <form id="payment-filter-form" class="panel filters">
        <input type="hidden" name="scope" value="all" />
        <input type="hidden" name="tenantId" value="${selectedTenant()}" />
        <div class="filter-grid">
          <div class="field full">
            <label>Suchbegriff</label>
            <input name="q" type="search" value="${e(q)}" autofocus placeholder="z. B. Inkasso, DE89, Mahnstatus, 245.00" />
          </div>
          <div class="filter-actions">
            <button class="button primary" type="submit">${svgIcon('search')} Suchen</button>
          </div>
        </div>
      </form>
      <section class="table-panel">${q ? paymentTable(data.payments) : emptyState('Bereit für die Suche', 'Suchbegriff eingeben und Ergebnisse mandantenübergreifend anzeigen.', null)}</section>
    </main>
  `;
}

async function usersPage() {
  const [usersData, tenantsData] = await Promise.all([api('/api/admin/users'), api('/api/admin/tenants')]);
  const editing = usersData.users.find((user) => user.id === state.editingUserId) || null;
  return `
    <main class="page">
      <div class="page-head">
        <div class="page-title"><h1>Benutzerverwaltung</h1><p>Benutzer anlegen, deaktivieren, Rollen vergeben und Mandanten zuweisen.</p></div>
        <button class="button primary" type="button" data-action="new-user">${svgIcon('plus')} Neuer Benutzer</button>
      </div>
      <div class="split-layout">
        <section class="management-list">
          ${usersData.users.map((user) => {
            const canDelete = user.id !== state.user?.id;
            return `
            <article class="management-card">
              <div class="management-row">
                <div>
                  <strong>${e(user.name)}</strong>
                  <div class="helper-text">${e(user.email)} · ${e(user.role)} · ${user.isActive ? 'Aktiv' : 'Deaktiviert'}</div>
                </div>
                <div class="row-actions">
                  <button class="icon-button" type="button" title="Benutzer bearbeiten" aria-label="Benutzer bearbeiten" data-action="edit-user" data-id="${user.id}">${svgIcon('edit')}</button>
                  ${canDelete ? `<button class="icon-button danger" type="button" title="Benutzer löschen" aria-label="Benutzer löschen" data-action="delete-user" data-id="${user.id}">${svgIcon('trash')}</button>` : ''}
                </div>
              </div>
              <div class="category-list">${user.tenantIds.map((id) => `<span class="category-pill">${e(tenantsData.tenants.find((tenant) => tenant.id === id)?.name || 'Mandant')}</span>`).join('')}</div>
            </article>
          `; }).join('')}
        </section>
        <form id="user-form" class="form-panel" data-user-id="${editing?.id || ''}">
          <h2 class="section-title">${editing ? 'Benutzer bearbeiten' : 'Benutzer anlegen'}</h2>
          <div class="grid" style="margin-top:14px">
            <div class="field"><label>Name</label><input name="name" required value="${e(editing?.name || '')}" /></div>
            <div class="field"><label>E-Mail</label><input name="email" type="email" required value="${e(editing?.email || '')}" /></div>
            <div class="field"><label>Passwort ${editing ? '(leer lassen)' : ''}</label><input name="password" type="password" ${editing ? '' : 'required'} minlength="8" /></div>
            <div class="field"><label>Rolle</label><select name="role"><option value="USER" ${editing?.role === 'USER' ? 'selected' : ''}>Benutzer</option><option value="ADMIN" ${editing?.role === 'ADMIN' ? 'selected' : ''}>Administrator</option></select></div>
            <label class="check-row"><input name="isActive" type="checkbox" ${editing?.isActive !== false ? 'checked' : ''}/> Aktiv</label>
            <div class="field">
              <label>Mandanten</label>
              <div class="check-grid">
                ${tenantsData.tenants.map((tenant) => `<label class="check-row"><input name="tenantIds" value="${tenant.id}" type="checkbox" ${(editing?.tenantIds || []).includes(tenant.id) ? 'checked' : ''}/> ${e(tenant.name)}</label>`).join('')}
              </div>
            </div>
            ${editing?.isDefaultAdmin ? '<p class="helper-text">Dieser Standard-Admin kann deaktiviert werden, sobald ein anderer aktiver Admin existiert.</p>' : ''}
            <button class="button primary" type="submit">${svgIcon('save')} Speichern</button>
          </div>
        </form>
      </div>
    </main>
  `;
}

async function tenantsPage() {
  const data = await api('/api/admin/tenants');
  const editing = data.tenants.find((tenant) => tenant.id === state.editingTenantId) || null;
  return `
    <main class="page">
      <div class="page-head">
        <div class="page-title"><h1>Mandantenverwaltung</h1><p>Mandanten, Kategorien und Benutzerzuordnungen zentral verwalten.</p></div>
        <button class="button primary" type="button" data-action="new-tenant">${svgIcon('plus')} Neuer Mandant</button>
      </div>
      <div class="split-layout">
        <section class="management-list">
          ${data.tenants.map((tenant) => {
            const deleteTitle = tenant.users.length ? 'Mandant kann erst ohne Benutzerzuweisung gelöscht werden' : 'Mandant löschen';
            return `
            <article class="management-card">
              <div class="management-row">
                <div>
                  <strong><i class="tenant-dot" style="background:${tenant.color}"></i> ${e(tenant.name)}</strong>
                  <div class="helper-text">${tenant.isActive ? 'Aktiv' : 'Deaktiviert'} · ${tenant.users.length} Benutzer</div>
                </div>
                <div class="row-actions">
                  <button class="icon-button" type="button" title="Mandant bearbeiten" aria-label="Mandant bearbeiten" data-action="edit-tenant" data-id="${tenant.id}">${svgIcon('edit')}</button>
                  <button class="icon-button danger" type="button" title="${deleteTitle}" aria-label="Mandant löschen" data-action="delete-tenant" data-id="${tenant.id}">${svgIcon('trash')}</button>
                </div>
              </div>
              <div class="category-list">
                ${tenant.categories.map((category) => `<span class="category-pill">${e(category.name)} ${category.isActive ? `<button class="icon-button danger" style="width:26px;height:26px;min-height:26px" type="button" data-action="delete-category" data-id="${category.id}">${svgIcon('x')}</button>` : '(inaktiv)'}</span>`).join('')}
              </div>
              <form data-category-form data-tenant-id="${tenant.id}" class="document-control" style="margin-top:12px">
                <input name="name" placeholder="Kategorie hinzufügen" />
                <button class="button" type="submit">${svgIcon('plus')} Hinzufügen</button>
              </form>
              <p class="helper-text">Zugewiesen: ${tenant.users.map((user) => e(user.name)).join(', ') || 'keine'}</p>
            </article>
          `; }).join('')}
        </section>
        <form id="tenant-form" class="form-panel" data-tenant-id="${editing?.id || ''}">
          <h2 class="section-title">${editing ? 'Mandant bearbeiten' : 'Mandant anlegen'}</h2>
          <div class="grid" style="margin-top:14px">
            <div class="field"><label>Name</label><input name="name" required value="${e(editing?.name || '')}" /></div>
            <div class="field"><label>Farbe</label><input name="color" type="color" value="${e(editing?.color || '#2dd4bf')}" /></div>
            <label class="check-row"><input name="isActive" type="checkbox" ${editing?.isActive !== false ? 'checked' : ''}/> Aktiv</label>
            <button class="button primary" type="submit">${svgIcon('save')} Speichern</button>
          </div>
        </form>
      </div>
    </main>
  `;
}

function emptyState(title, message, href) {
  return `
    <div class="empty-state">
      <h2>${e(title)}</h2>
      <p>${e(message || '')}</p>
      ${href ? `<a class="button primary" href="${href}" data-link>${svgIcon('plus')} Eintrag erstellen</a>` : ''}
    </div>
  `;
}

async function login(form) {
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    body.remember = form.querySelector('[name="remember"]')?.checked || false;
    setBusy(form, true);
    await loadCsrf();
    const data = await api('/api/auth/login', { method: 'POST', body });
    state.user = data.user;
    state.tenants = data.tenants || [];
    state.csrfToken = data.csrfToken || state.csrfToken;
    state.meta = await api('/api/meta');
    await clearRuntimeCache();
    toast('Erfolgreich angemeldet.');
    navigate('/', true);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    // Logout should still clear local state if the server session is gone.
  }
  await clearRuntimeCache();
  state.user = null;
  state.tenants = [];
  navigate('/login', true);
}

function applyPaymentFilters(form) {
  const data = new FormData(form);
  const scope = data.get('scope') || (location.pathname === '/archive' ? 'archive' : 'active');
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (key !== 'scope' && value) params.set(key, value);
  }
  const path = scope === 'archive' ? '/archive' : location.pathname === '/search' ? '/search' : '/payments';
  navigate(`${path}?${params.toString()}`);
}

async function savePayment(form) {
  const paymentId = form.dataset.paymentId;
  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.document;
  setBusy(form, true);
  try {
    const method = paymentId ? 'PUT' : 'POST';
    const path = paymentId ? `/api/payments/${paymentId}` : '/api/payments';
    const saved = (await api(path, { method, body: payload })).payment;
    if (state.removeDocument) await api(`/api/payments/${saved.id}/document`, { method: 'DELETE' });
    if (state.formFile) {
      if (state.formFile.type !== 'application/pdf' && !state.formFile.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('Es sind nur PDF-Dateien erlaubt.');
      }
      const formData = new FormData();
      formData.append('document', state.formFile);
      await api(`/api/payments/${saved.id}/document`, { method: 'POST', formData });
    }
    resetTransientFormState();
    toast('Zahlung gespeichert.');
    state.selectedTenantId = saved.tenantId;
    localStorage.setItem('selectedTenantId', saved.tenantId);
    navigate('/payments');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
}

async function previewFormQr() {
  const form = document.querySelector('#payment-form');
  if (!form) return;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const data = await api('/api/qr/preview', { method: 'POST', body: payload });
    showQrModal(data);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function showPaymentQr(paymentId) {
  try {
    const data = await api(`/api/payments/${paymentId}/qr`, { method: 'POST', body: {} });
    showQrModal(data);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function showQrModal(data) {
  const root = document.querySelector('#modal-root') || document.body;
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="EPC QR Code">
        <div class="management-row">
          <h2 class="section-title">EPC-QR-Code</h2>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="Schließen">${svgIcon('x')}</button>
        </div>
        <div class="qr-box">${data.svg}</div>
        <div class="form-actions">
          <a class="button primary" download="epc-qr-code.svg" href="${data.dataUrl}">${svgIcon('download')} Herunterladen</a>
        </div>
      </section>
    </div>
  `;
}

function closeModal() {
  const root = document.querySelector('#modal-root');
  if (root) root.innerHTML = '';
}

function markDocumentForRemoval() {
  state.removeDocument = true;
  state.formFile = null;
  const label = document.querySelector('#document-label');
  if (label) label.textContent = 'Dokument wird beim Speichern entfernt';
  toast('Dokument zum Entfernen markiert. Bitte speichern.');
}

async function refreshCategoryOptions(tenantId) {
  try {
    const data = await api(`/api/categories?tenantId=${encodeURIComponent(tenantId)}`);
    const select = document.querySelector('#category-select');
    if (select) {
      select.innerHTML = `<option value="">Ohne Kategorie</option>${data.categories.map((category) => `<option value="${category.id}">${e(category.name)}</option>`).join('')}`;
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveUser(form) {
  try {
    const data = new FormData(form);
    const body = {
      name: data.get('name'),
      email: data.get('email'),
      password: data.get('password'),
      role: data.get('role'),
      isActive: data.get('isActive') === 'on',
      tenantIds: data.getAll('tenantIds')
    };
    setBusy(form, true);
    if (!body.password) delete body.password;
    const userId = form.dataset.userId;
    await api(userId ? `/api/admin/users/${userId}` : '/api/admin/users', { method: userId ? 'PUT' : 'POST', body });
    state.editingUserId = null;
    toast('Benutzer gespeichert.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
}

async function saveTenant(form) {
  try {
    const data = new FormData(form);
    const body = { name: data.get('name'), color: data.get('color'), isActive: data.get('isActive') === 'on' };
    setBusy(form, true);
    const tenantId = form.dataset.tenantId;
    await api(tenantId ? `/api/admin/tenants/${tenantId}` : '/api/admin/tenants', { method: tenantId ? 'PUT' : 'POST', body });
    state.editingTenantId = null;
    await loadSession();
    toast('Mandant gespeichert.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
}

async function deleteUser(userId) {
  if (!confirm('Benutzer wirklich löschen?')) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (state.editingUserId === userId) state.editingUserId = null;
    toast('Benutzer gelöscht.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteTenant(tenantId) {
  if (!confirm('Mandant wirklich löschen? Zugehörige Zahlungen, Kategorien und Dokumentverweise werden entfernt.')) return;
  try {
    await api(`/api/admin/tenants/${tenantId}`, { method: 'DELETE' });
    if (state.editingTenantId === tenantId) state.editingTenantId = null;
    await loadSession();
    toast('Mandant gelöscht.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addCategory(form) {
  try {
    const tenantId = form.dataset.tenantId;
    const name = new FormData(form).get('name');
    setBusy(form, true);
    await api(`/api/admin/tenants/${tenantId}/categories`, { method: 'POST', body: { name } });
    toast('Kategorie hinzugefügt.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
}

async function deleteCategory(categoryId) {
  try {
    await api(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
    toast('Kategorie entfernt.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function api(url, options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});
  const init = { method, credentials: 'include', headers };
  if (method !== 'GET') headers.set('X-CSRF-Token', state.csrfToken);
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  if (response.status === 401 && !options.allow401) {
    state.user = null;
    navigate('/login', true);
    throw new Error('Bitte erneut anmelden.');
  }
  if (response.status === 401 && options.allow401) return null;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  return data;
}

function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  closeSidebar();
  resetTransientFormState();
  render();
}

function selectTenant(tenantId) {
  state.selectedTenantId = tenantId;
  localStorage.setItem('selectedTenantId', tenantId);
  if (['/payments', '/archive', '/search'].includes(location.pathname)) {
    const params = new URLSearchParams(location.search);
    params.set('tenantId', tenantId);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }
  render();
}

function selectedTenant() {
  if (state.selectedTenantId === 'all' && state.tenants.length > 1) return 'all';
  if (state.tenants.some((tenant) => tenant.id === state.selectedTenantId)) return state.selectedTenantId;
  return selectedTenantFallback();
}

function selectedTenantFallback() {
  return state.tenants[0]?.id || 'all';
}

function resetTransientFormState(clear = true) {
  if (!clear) return;
  state.formFile = null;
  state.removeDocument = false;
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  render();
}

function closeSidebar() {
  state.sidebarOpen = false;
  render();
}

async function installPwa() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  render();
}

async function clearRuntimeCache() {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_RUNTIME_CACHE' });
  }
}

function setBusy(form, busy) {
  form.querySelectorAll('button, input, select, textarea').forEach((element) => {
    if (busy) element.setAttribute('data-was-disabled', element.disabled ? '1' : '0');
    if (!busy) {
      element.disabled = element.getAttribute('data-was-disabled') === '1';
      element.removeAttribute('data-was-disabled');
      return;
    }
    element.disabled = true;
  });
}

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  toastRoot.append(node);
  setTimeout(() => node.remove(), 4200);
}

function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.home}</svg>`;
}

function e(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(number);
}

function formatDate(value) {
  if (!value) return 'Ohne Datum';
  const dateText = String(value).slice(0, 10);
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(`${dateText}T00:00:00`));
}

function statusClass(status) {
  if (status === 'Bezahlt') return 'status-paid';
  if (status.includes('Mahn')) return 'status-danger';
  if (status.includes('Verzögert') || status === 'Teilbezahlt') return 'status-warning';
  return 'status-open';
}

function chartColor(index) {
  return ['#2dd4bf', '#f59e0b', '#38bdf8', '#fb7185', '#a78bfa', '#34d399'][index % 6];
}
