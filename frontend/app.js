const api = {
  base: '/api',
  getToken() {
    return localStorage.getItem('token');
  },
  headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.getToken()}`
    };
  },
  async request(path, method = 'GET', body = null) {
    const options = {
      method,
      headers: this.headers(),
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.base}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Error de la solicitud');
    }
    if (method !== 'GET') {
      lastLocalChangeAt = Date.now();
    }
    return payload.data;
  },
  async login(username, password) {
    const response = await fetch(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Error de autenticación');
    return payload.data;
  }
};

const state = {
  page: 'dashboard',
  token: null,
  user: null,
  institution: null,
  categories: [],
  materials: [],
  dashboard: null,
  users: [],
  movements: [],
  lowStock: [],
  kardex: [],
  activeMaterialId: null,
  modal: null,
  pendingLogo: null,
  pendingBrandLogo: null,
};

const app = document.getElementById('app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function showMessage(el, type, text) {
  el.innerHTML = `<div class="message ${type}">${escapeHtml(text)}</div>`;
}

function ensureAuth() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!token || !user) {
    renderLogin();
    return false;
  }
  state.token = token;
  state.user = user;
  return true;
}

async function loadInstitution() {
  const institution = await api.request('/institution');
  state.institution = institution;
}

async function loadDashboard() {
  state.dashboard = await api.request('/dashboard');
}

async function loadCategories() {
  state.categories = await api.request('/categories');
}

async function loadMaterials() {
  const params = new URLSearchParams();
  if (state.filter) {
    if (state.filter.q) params.set('q', state.filter.q);
    if (state.filter.category) params.set('category', state.filter.category);
    if (state.filter.location) params.set('location', state.filter.location);
    if (state.filter.status) params.set('status', state.filter.status);
    if (state.filter.low_stock) params.set('low_stock', 'true');
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  state.materials = await api.request(`/materials${query}`);
}

async function loadUsers() {
  state.users = await api.request('/users');
}

async function loadMovements() {
  state.movements = await api.request('/movements');
}

async function loadLowStock() {
  state.lowStock = await api.request('/reports/low-stock');
}

async function loadKardex(id) {
  state.kardex = (await api.request(`/reports/kardex/${id}`)).kardex || [];
}

async function loadAll() {
  await Promise.all([
    loadInstitution(),
    loadDashboard(),
    loadCategories(),
    loadMaterials(),
    loadMovements(),
    loadLowStock(),
    ...(state.user && state.user.role === 'ADMIN' ? [loadUsers()] : []),
  ]);
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  state.user = null;
  renderLogin();
}

async function handleLogin(form) {
  const username = form.username.value.trim();
  const password = form.password.value;
  const messageBox = form.querySelector('.login-message');
  try {
    const data = await api.login(username, password);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    state.user = data.user;
    state.token = data.token;
    showMessage(messageBox, 'success', 'Inicio de sesión correcto');
    await loadAll();
    renderApp();
  } catch (error) {
    showMessage(messageBox, 'error', error.message);
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="logo-box">
          <img src="${state.institution && state.institution.logo_data ? state.institution.logo_data : 'https://placehold.co/120x120?text=Logo'}" alt="Logo institucional" />
        </div>
        <h1 class="login-title">${state.institution ? escapeHtml(state.institution.name) : 'Institución Educativa San Miguel'}</h1>
        <p class="login-subtitle">${state.institution ? escapeHtml(state.institution.subtitle) : 'Sistema de Control de Inventario de Materiales de Ferretería'}</p>
        <form id="login-form">
          <div class="form-grid">
            <div class="field">
              <label for="login-user">Usuario</label>
              <input id="login-user" name="username" type="text" required placeholder="usuario" />
            </div>
            <div class="field">
              <label for="login-pass">Contraseña</label>
              <input id="login-pass" name="password" type="password" required placeholder="********" />
            </div>
            <div class="login-message"></div>
            <button class="primary-btn" type="submit">Ingresar</button>
          </div>
        </form>
        ${renderBrandFooter()}
      </div>
    </div>
  `;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleLogin(form);
  });
}

function renderApp() {
  if (!ensureAuth()) return;
  const allowedRoles = state.user.role === 'ADMIN' ? ['dashboard', 'inventario', 'entradas', 'salidas', 'kardex', 'reportes', 'usuarios', 'configuracion'] : ['dashboard', 'inventario', 'entradas', 'salidas', 'kardex', 'reportes'];
  if (!allowedRoles.includes(state.page)) {
    state.page = 'dashboard';
  }

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="${state.institution && state.institution.logo_data ? state.institution.logo_data : 'https://placehold.co/80x80?text=Logo'}" alt="Logo" />
          <div>
            <h3>${escapeHtml(state.institution ? state.institution.name : 'Institución Educativa San Miguel')}</h3>
          </div>
        </div>
        <nav class="nav-menu">
          ${menuItemsHtml()}
        </nav>
        <div class="user-box">
          <strong>${escapeHtml(state.user.full_name || state.user.username)}</strong><br />
          <span>${escapeHtml(state.user.role)}</span><br />
          <button class="secondary-btn" style="margin-top:10px; width:100%;" id="logout-btn">Cerrar sesión</button>
        </div>
      </aside>
      <main class="content">
        <div class="topbar">
          <h2>${pageTitle()}</h2>
          <span id="sync-indicator" class="sync-indicator">● Conectando...</span>
          <span>Usuario conectado: ${escapeHtml(state.user.username)}</span>
        </div>
        ${renderPage()}
        ${renderBrandFooter()}
      </main>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.page = button.dataset.page;
      if (state.page === 'versiones' && !state.versioning) {
        renderApp();
        try {
          state.versioning = await api.request('/versioning');
        } catch (error) {
          state.versioning = { enabled: false };
        }
      }
      renderApp();
    });
  });
  bindCommonActions();
}

function renderBrandFooter() {
  const institutionLogo = state.institution?.logo_data || 'icon.svg';
  const brandLogo = state.institution?.brand_logo_data || 'jcho-logo.svg';
  const institutionName = state.institution?.name || 'Institución Educativa San Miguel';
  return `
    <footer class="brand-footer">
      <div class="footer-brand">
        <img src="${escapeHtml(institutionLogo)}" alt="Logo de ${escapeHtml(institutionName)}" />
        <span>${escapeHtml(institutionName)}</span>
      </div>
      <span class="footer-divider" aria-hidden="true"></span>
      <div class="footer-brand">
        <img src="${escapeHtml(brandLogo)}" alt="Logo JCHO" />
        <span>JCHO</span>
      </div>
    </footer>
  `;
}

function menuItemsHtml() {
  const items = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'inventario', label: 'Inventario' },
    { key: 'entradas', label: 'Entradas' },
    { key: 'salidas', label: 'Salidas' },
    { key: 'kardex', label: 'Kardex' },
    { key: 'reportes', label: 'Reportes' },
  ];
  if (state.user.role === 'ADMIN') {
    items.push({ key: 'usuarios', label: 'Usuarios' }, { key: 'configuracion', label: 'Configuración' }, { key: 'versiones', label: 'Versiones (GitHub)' });
  }
  return items.map((item) => `
    <button class="nav-item ${state.page === item.key ? 'active' : ''}" data-page="${item.key}">${item.label}</button>
  `).join('');
}

function pageTitle() {
  const map = {
    dashboard: 'Dashboard',
    inventario: 'Inventario',
    entradas: 'Entradas',
    salidas: 'Salidas',
    kardex: 'Kardex',
    reportes: 'Reportes',
    usuarios: 'Administración de Usuarios',
    configuracion: 'Configuración',
    versiones: 'Control de Versiones (GitHub)',
  };
  return map[state.page] || 'Dashboard';
}

function renderPage() {
  switch (state.page) {
    case 'dashboard': return renderDashboard();
    case 'inventario': return renderInventory();
    case 'entradas': return renderMovements('ENTRADA');
    case 'salidas': return renderMovements('SALIDA');
    case 'kardex': return renderKardex();
    case 'reportes': return renderReports();
    case 'usuarios': return renderUsers();
    case 'configuracion': return renderConfiguration();
    case 'versiones': return renderVersiones();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const summary = state.dashboard || {};
  const cards = [
    { label: 'Total de materiales', value: summary.totalMaterials ?? 0 },
    { label: 'Materiales activos', value: summary.activeMaterials ?? 0 },
    { label: 'Materiales con stock bajo', value: summary.lowStock ?? 0 },
    { label: 'Materiales agotados', value: summary.agotados ?? 0 },
    { label: 'Total de entradas', value: summary.totalEntradas ?? 0 },
    { label: 'Total de salidas', value: summary.totalSalidas ?? 0 },
  ];

  return `
    <div class="cards-grid">
      ${cards.map((card) => `
        <div class="stat-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value">${escapeHtml(card.value)}</div>
        </div>
      `).join('')}
    </div>
    <div class="form-row" style="margin-bottom:18px;">
      <div class="panel">
        <div class="section-header">
          <h3>Últimos movimientos</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Material</th><th>Tipo</th><th>Cantidad</th><th>Usuario</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              ${(summary.recentMovements || []).map((item) => `
                <tr>
                  <td>${escapeHtml(item.material_name)}</td>
                  <td>${escapeHtml(item.type)}</td>
                  <td>${escapeHtml(item.quantity)}</td>
                  <td>${escapeHtml(item.user_name || '-')}</td>
                  <td>${escapeHtml(new Date(item.created_at).toLocaleString('es-ES'))}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">Sin movimientos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="section-header">
          <h3>Materiales con stock bajo</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Material</th><th>Stock</th><th>Estado</th></tr>
            </thead>
            <tbody>
              ${(summary.lowStockMaterials || []).map((item) => `
                <tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.stock)}</td>
                  <td><span class="badge ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
                </tr>
              `).join('') || '<tr><td colspan="3">Sin materiales críticos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderInventory() {
  if (!state.materials.length) {
    const canCreate = state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA';
    return `
      <div class="panel empty-state">
        <h3>Inventario listo para comenzar</h3>
        <p>No hay materiales registrados. Agregue el primer material para comenzar a controlar sus existencias.</p>
        ${state.user.role === 'ADMIN' ? '<button class="secondary-btn" id="new-category-btn" type="button">Crear categoría</button>' : ''}
        ${canCreate ? '<button class="primary-btn" id="new-material-btn" type="button">Agregar primer material</button>' : ''}
      </div>
    `;
  }

  return `
    <div class="panel">
      <div class="section-header">
        <h3>Inventario</h3>
        <div class="toolbar">
          <input id="search-material" type="text" placeholder="Buscar por código o nombre" value="${escapeHtml(state.filter?.q || '')}" />
          <select id="filter-category">
            <option value="">Todas las categorías</option>
            ${state.categories.map((cat) => `<option value="${escapeHtml(cat.name)}" ${state.filter?.category === cat.name ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('')}
          </select>
          <select id="filter-status">
            <option value="">Todos los estados</option>
            <option value="NORMAL" ${state.filter?.status === 'NORMAL' ? 'selected' : ''}>NORMAL</option>
            <option value="BAJO" ${state.filter?.status === 'BAJO' ? 'selected' : ''}>BAJO</option>
            <option value="AGOTADO" ${state.filter?.status === 'AGOTADO' ? 'selected' : ''}>AGOTADO</option>
          </select>
          <button class="secondary-btn" id="apply-filter-btn">Filtrar</button>
          ${state.user.role === 'ADMIN' ? '<button class="secondary-btn" id="new-category-btn" type="button">Nueva categoría</button>' : ''}
          ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? '<button class="primary-btn" id="new-material-btn">Nuevo material</button>' : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>Unidad</th><th>Stock</th><th>Mínimo</th><th>Estado</th><th>Ubicación</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${state.materials.map((item) => `
              <tr>
                <td>${escapeHtml(item.code)}</td>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.category_name)}</td>
                <td>${escapeHtml(item.unit)}</td>
                <td>${escapeHtml(item.stock)}</td>
                <td>${escapeHtml(item.stock_minimo)}</td>
                <td><span class="badge ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
                <td>${escapeHtml(item.location)}</td>
                <td>
                  ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? `<button class="small-btn" data-material-edit="${item.id}">Editar</button>` : ''}
                  ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? `<button class="danger-btn" data-material-delete="${item.id}" type="button">Eliminar</button>` : ''}
                  <button class="small-btn" data-kardex-id="${item.id}">Kardex</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMovements(type) {
  const filtered = (state.movements || []).filter((move) => move.type === type);
  return `
    <div class="panel">
      <div class="section-header">
        <h3>${type === 'ENTRADA' ? 'Entradas' : 'Salidas'}</h3>
        <button class="primary-btn" id="new-movement-btn" data-type="${type}">Registrar ${type === 'ENTRADA' ? 'entrada' : 'salida'}</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Material</th><th>Cantidad</th><th>Referencia</th><th>Responsable</th><th>Fecha</th><th>Acción</th></tr>
          </thead>
          <tbody>
            ${filtered.map((item) => `
              <tr>
                <td>${escapeHtml(item.material_name)}</td>
                <td>${escapeHtml(item.quantity)}</td>
                <td>${escapeHtml(item.reference || '-')}</td>
                <td>${escapeHtml(item.responsible || '-')}</td>
                <td>${escapeHtml(new Date(item.created_at).toLocaleString('es-ES'))}</td>
                <td>
                  <button class="small-btn" data-movement-edit="${item.id}" type="button">Editar</button>
                  <button class="danger-btn" data-movement-delete="${item.id}" type="button">Eliminar</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="6">Sin movimientos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderKardex() {
  const materialOptions = state.materials.map((m) => `<option value="${m.id}">${escapeHtml(m.code)} - ${escapeHtml(m.name)}</option>`).join('');
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Kardex</h3>
        <select id="kardex-material-select">
          <option value="">Seleccione un material</option>
          ${materialOptions}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Responsable</th><th>Usuario</th><th>Observación</th><th>Saldo</th></tr>
          </thead>
          <tbody>
            ${(state.kardex || []).map((item) => `
              <tr>
                <td>${escapeHtml(new Date(item.created_at).toLocaleString('es-ES'))}</td>
                <td>${escapeHtml(item.type)}</td>
                <td>${escapeHtml(item.quantity)}</td>
                <td>${escapeHtml(item.reference || '-')}</td>
                <td>${escapeHtml(item.responsible || '-')}</td>
                <td>${escapeHtml(item.user_name || '-')}</td>
                <td>${escapeHtml(item.observation || '-')}</td>
                <td>${escapeHtml(item.saldo_resultante)}</td>
              </tr>
            `).join('') || '<tr><td colspan="9">Seleccione un material para ver el Kardex</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReports() {
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Reportes</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="export-pdf-btn">EXPORTAR PDF</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Tipo</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            <tr><td>Stock bajo</td><td>${state.lowStock.length}</td></tr>
            <tr><td>Movimientos</td><td>${state.movements.length}</td></tr>
            <tr><td>Inventario</td><td>${state.materials.length}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderUsers() {
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Administración de usuarios</h3>
        <button class="primary-btn" id="new-user-btn">Crear usuario</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${state.users.map((user) => `
              <tr>
                <td>${escapeHtml(user.full_name)}</td>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${user.is_active ? 'Activo' : 'Inactivo'}</td>
                <td>${escapeHtml(new Date(user.created_at).toLocaleString('es-ES'))}</td>
                <td>
                  <button class="small-btn" data-user-edit="${user.id}" type="button">Editar</button>
                  <button class="danger-btn" data-user-delete="${user.id}" type="button">Eliminar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderConfiguration() {
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Configuración institucional</h3>
      </div>
      <form id="institution-form">
        <div class="form-row">
          <div class="field">
            <label>Nombre de la institución</label>
            <input name="name" value="${escapeHtml(state.institution?.name || '')}" />
          </div>
          <div class="field">
            <label>Subtítulo</label>
            <input name="subtitle" value="${escapeHtml(state.institution?.subtitle || '')}" />
          </div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Logo de la institución</label>
          <input type="file" id="logo-input" accept="image/png,image/jpeg,image/jpg,image/webp" />
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Logo de la marca JCHO</label>
          <input type="file" id="brand-logo-input" accept="image/png,image/jpeg,image/jpg,image/webp" />
        </div>
        <div class="form-actions">
          <button class="primary-btn" type="submit">Guardar</button>
        </div>
      </form>
    </div>
  `;
}

function renderVersiones() {
  const v = state.versioning;
  if (!v) {
    return `<div class="panel"><div class="section-header"><h3>Control de Versiones</h3><button class="primary-btn" id="reload-versioning-btn">Actualizar</button></div><p>Cargando información de versionamiento...</p></div>`;
  }
  if (!v.enabled) {
    return `
      <div class="panel">
        <div class="section-header"><h3>Control de Versiones (GitHub)</h3></div>
        <p>El proyecto aún no tiene GitHub configurado. Ejecuta estos comandos en la raíz del proyecto:</p>
        <pre class="code-block">git init
git add .
git commit -m "Versión inicial JCHO Inventario Ferretería"
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git branch -M main
git push -u origin main</pre>
      </div>`;
  }
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Control de Versiones (GitHub)</h3>
        <button class="primary-btn" id="reload-versioning-btn">Actualizar</button>
      </div>
      <table>
        <tbody>
          <tr><td><strong>Rama actual</strong></td><td>${escapeHtml(v.branch)}</td></tr>
          <tr><td><strong>Cambios pendientes</strong></td><td>${v.pendingChanges}</td></tr>
          <tr><td><strong>Repositorio remoto</strong></td><td>${escapeHtml((v.remotes.find((r) => r.type === "(fetch)") || v.remotes[0] || {}).url || 'No configurado')}</td></tr>
        </tbody>
      </table>
      <h4 style="margin-top:16px;">Últimos commits</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hash</th><th>Mensaje</th><th>Autor</th><th>Fecha</th></tr></thead>
          <tbody>
            ${v.commits.map((c) => `<tr><td>${escapeHtml(c.hash)}</td><td>${escapeHtml(c.message)}</td><td>${escapeHtml(c.author)}</td><td>${escapeHtml(c.date)}</td></tr>`).join('') || '<tr><td colspan="4">Sin commits</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderModal() {
  if (!state.modal) {
    return '';
  }
  return `
    <div class="modal">
      <div class="modal-card">
        ${state.modal}
      </div>
    </div>
  `;
}

function bindCommonActions() {
  const appRoot = document.getElementById('app');
  appRoot.insertAdjacentHTML('beforeend', renderModal());

  document.getElementById('apply-filter-btn')?.addEventListener('click', async () => {
    const q = document.getElementById('search-material')?.value.trim() || '';
    const category = document.getElementById('filter-category')?.value || '';
    const status = document.getElementById('filter-status')?.value || '';
    state.filter = { q, category, status, low_stock: false };
    await loadMaterials();
    renderApp();
  });

  document.getElementById('reload-versioning-btn')?.addEventListener('click', async () => {
    state.versioning = null;
    try {
      state.versioning = await api.request('/versioning');
    } catch {
      state.versioning = { enabled: false };
    }
    renderApp();
  });

  document.getElementById('new-material-btn')?.addEventListener('click', openMaterialModal);
  document.getElementById('new-category-btn')?.addEventListener('click', openCategoryModal);
  document.getElementById('new-user-btn')?.addEventListener('click', openUserModal);
  document.getElementById('new-movement-btn')?.addEventListener('click', (e) => openMovementModal(e.target.dataset.type));
  document.getElementById('export-excel-btn')?.addEventListener('click', exportExcel);
  document.getElementById('export-pdf-btn')?.addEventListener('click', exportPdf);
  document.getElementById('institution-form')?.addEventListener('submit', handleInstitutionSubmit);
  document.getElementById('logo-input')?.addEventListener('change', readLogoFile);
  document.getElementById('brand-logo-input')?.addEventListener('change', readBrandLogoFile);
  document.querySelectorAll('[data-kardex-id]').forEach((btn) => btn.addEventListener('click', () => loadKardexAndRender(btn.dataset.kardexId)));
  document.querySelectorAll('[data-material-edit]').forEach((btn) => btn.addEventListener('click', () => openMaterialModal(Number(btn.dataset.materialEdit))));
  document.querySelectorAll('[data-material-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = window.confirm('¿Desea eliminar este material?');
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api.request(`/materials/${btn.dataset.materialDelete}`, 'DELETE');
        await Promise.all([loadMaterials(), loadDashboard(), loadLowStock()]);
        renderApp();
      } catch (error) {
        btn.disabled = false;
        alert(error.message);
      }
    });
  });
  document.querySelectorAll('[data-user-edit]').forEach((btn) => btn.addEventListener('click', () => openUserModal(Number(btn.dataset.userEdit))));
  document.querySelectorAll('[data-movement-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const movement = state.movements.find((item) => item.id === Number(btn.dataset.movementEdit));
      if (movement) openMovementModal(movement.type, movement);
    });
  });
  document.querySelectorAll('[data-user-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = window.confirm('¿Desea eliminar este usuario?');
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api.request(`/users/${btn.dataset.userDelete}`, 'DELETE');
        await loadUsers();
        renderApp();
      } catch (error) {
        btn.disabled = false;
        alert(error.message);
      }
    });
  });
  document.querySelectorAll('[data-movement-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = window.confirm('¿Desea eliminar este movimiento?');
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api.request(`/movements/${btn.dataset.movementDelete}`, 'DELETE');
        await Promise.all([loadDashboard(), loadMaterials(), loadMovements(), loadLowStock()]);
        renderApp();
      } catch (error) {
        btn.disabled = false;
        alert(error.message);
      }
    });
  });
  document.getElementById('kardex-material-select')?.addEventListener('change', async (event) => {
    const id = event.target.value;
    if (id) {
      await loadKardex(id);
      renderApp();
    }
  });
}

function readLogoFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingLogo = reader.result;
  };
  reader.readAsDataURL(file);
}

function readBrandLogoFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingBrandLogo = reader.result;
  };
  reader.readAsDataURL(file);
}

async function handleInstitutionSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    name: form.name.value.trim(),
    subtitle: form.subtitle.value.trim(),
    logo_data: state.pendingLogo || state.institution?.logo_data || null,
    brand_logo_data: state.pendingBrandLogo || state.institution?.brand_logo_data || null
  };
  try {
    const updated = await api.request('/institution', 'PUT', payload);
    state.institution = updated;
    state.pendingLogo = null;
    state.pendingBrandLogo = null;
    await loadInstitution();
    renderApp();
  } catch (error) {
    alert(error.message);
  }
}

async function exportExcel() {
  const token = api.getToken();
  window.open(`/api/reports/export/excel?token=${encodeURIComponent(token)}`, '_blank');
}

async function exportPdf() {
  const token = api.getToken();
  window.open(`/api/reports/export/pdf?token=${encodeURIComponent(token)}`, '_blank');
}

function openMaterialModal(materialId = null) {
  const material = materialId ? state.materials.find((item) => item.id === materialId) : null;
  state.modal = `
    <h3>${material ? 'Editar material' : 'Nuevo material'}</h3>
    <form id="material-form">
      <div class="form-row">
        <div class="field"><label>Código</label><input name="code" value="${escapeHtml(material?.code || '')}" placeholder="Ej: TOR-001" required /></div>
        <div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(material?.name || '')}" placeholder="Ej: Tornillo 3/8" required /></div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Categoría</label>
          <select name="category_id" required>
            ${state.categories.map((cat) => `<option value="${cat.id}" ${material?.category_id === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Unidad</label><select name="unit">${['unidad', 'metro', 'kilogramo', 'litro', 'caja', 'paquete', 'galón', 'bolsa', 'par', 'juego', 'plancha', 'metro cúbico'].map((unit) => `<option ${material?.unit === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Stock actual</label><input name="stock" type="number" min="0" value="${escapeHtml(material?.stock ?? 0)}" placeholder="Ej: 25" ${material ? 'readonly' : ''} /></div>
        <div class="field"><label>Stock mínimo</label><input name="stock_minimo" type="number" min="0" value="${escapeHtml(material?.stock_minimo ?? 0)}" placeholder="Ej: 5" /></div>
      </div>
      <div class="field"><label>Ubicación</label><input name="location" value="${escapeHtml(material?.location || '')}" placeholder="Ej: Bodega A" required /></div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('material-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const payload = {
        code: form.code.value,
        name: form.name.value,
        category_id: Number(form.category_id.value),
        unit: form.unit.value,
        stock_minimo: Number(form.stock_minimo.value),
        location: form.location.value,
      };
      if (!material) {
        payload.stock = Number(form.stock.value);
      }
      await api.request(material ? `/materials/${material.id}` : '/materials', material ? 'PUT' : 'POST', payload);
      state.modal = null;
      await loadMaterials();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

function openCategoryModal() {
  state.modal = `
    <h3>Nueva categoría</h3>
    <form id="category-form">
      <div class="field">
        <label for="category-name">Nombre de la categoría</label>
        <input id="category-name" name="name" placeholder="Ej: Herramientas de construcción" required />
      </div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar categoría</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('category-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      await api.request('/categories', 'POST', { name: form.name.value.trim() });
      state.modal = null;
      await loadCategories();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

function openMovementModal(type, movement = null) {
  state.modal = `
    <h3>${movement ? 'Editar material del movimiento' : `Registrar ${type === 'ENTRADA' ? 'entrada' : 'salida'}`}</h3>
    <form id="movement-form">
      <div class="field">
        <label>Material</label>
        <input name="material_name" list="movement-material-options" value="${escapeHtml(movement ? (movement.material_code ? `${movement.material_code} - ${movement.material_name}` : movement.material_name) : '')}" placeholder="Escriba código o nombre del material" required />
        <datalist id="movement-material-options">
          ${state.materials.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}</option>`).join('')}
        </datalist>
      </div>
      ${movement ? '<p class="form-hint">Solo se puede cambiar el material de este movimiento.</p>' : '<div class="field"><label>Cantidad</label><input name="quantity" type="number" min="1" placeholder="Ej: 10" required /></div>'}
      <div class="form-row">
        <div class="field"><label>Referencia/Factura</label><input name="reference" placeholder="Ej: FAC-001" /></div>
        <div class="field"><label>Responsable</label><input name="responsible" placeholder="Ej: Juan Pérez" /></div>
      </div>
      <div class="field"><label>Observación</label><textarea name="observation" placeholder="Ej: Compra de materiales para mantenimiento"></textarea></div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('movement-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const materialText = normalizeSearchText(form.material_name.value);
      const selectedMaterial = state.materials.find((item) =>
        normalizeSearchText(`${item.code} - ${item.name}`) === materialText
        || normalizeSearchText(item.code) === materialText
        || normalizeSearchText(item.name) === materialText
      );
      if (!selectedMaterial) {
        const availableMaterials = state.materials.map((item) => `${item.code} - ${item.name}`).join(', ');
        throw new Error(`Material no encontrado. Regístrelo primero en Inventario. Disponibles: ${availableMaterials || 'ninguno'}`);
      }
      if (movement) {
        await api.request(`/movements/${movement.id}`, 'PUT', {
          material_id: selectedMaterial.id,
        });
      } else {
        await api.request('/movements', 'POST', {
          material_id: selectedMaterial.id,
          type,
          quantity: Number(form.quantity.value),
          reference: form.reference.value,
          responsible: form.responsible.value,
          observation: form.observation.value,
        });
      }
      state.modal = null;
      await loadDashboard();
      await loadMaterials();
      await loadMovements();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

function openUserModal(userId = null) {
  const user = userId ? state.users.find((u) => u.id === userId) : null;
  state.modal = `
    <h3>${user ? 'Editar usuario' : 'Crear usuario'}</h3>
    <form id="user-form">
      <div class="form-row">
        <div class="field"><label>Nombre completo</label><input name="full_name" value="${escapeHtml(user?.full_name || '')}" placeholder="Ej: Juan Pérez" required /></div>
        <div class="field"><label>Usuario</label><input name="username" value="${escapeHtml(user?.username || '')}" placeholder="Ej: jperez" required /></div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Rol</label>
          <select name="role">
            <option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
            <option value="ALMACENISTA" ${user?.role === 'ALMACENISTA' ? 'selected' : ''}>ALMACENISTA</option>
          </select>
        </div>
        <div class="field"><label>Contraseña ${user ? '(opcional)' : ''}</label><input name="password" type="password" placeholder="Ej: min 6 caracteres" ${user ? '' : 'required'} /></div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const payload = {
      full_name: form.full_name.value,
      username: form.username.value,
      role: form.role.value,
      password: form.password.value,
      is_active: true,
    };
    try {
      if (user) {
        await api.request(`/users/${user.id}`, 'PUT', payload);
      } else {
        await api.request('/users', 'POST', payload);
      }
      state.modal = null;
      await loadUsers();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

async function loadKardexAndRender(id) {
  await loadKardex(id);
  state.page = 'kardex';
  renderApp();
}

let syncSocket = null;
let lastLocalChangeAt = 0;

function connectSync() {
  if (typeof io === 'undefined') return;
  try {
    syncSocket = io();
    syncSocket.on('sync:clients', ({ clients }) => updateSyncIndicator(clients));
    syncSocket.on('connect', () => updateSyncIndicator(1, true));
    syncSocket.on('disconnect', () => updateSyncIndicator(0, false));
    syncSocket.on('data:changed', async (payload) => {
      if (Date.now() - lastLocalChangeAt < 1500) return; // evitar recargar lo que cambió el propio dispositivo
      if (!localStorage.getItem('token')) return;
      try {
        const tasks = [loadDashboard(), loadMaterials(), loadMovements(), loadLowStock(), loadCategories()];
        if (state.user && state.user.role === 'ADMIN') tasks.push(loadUsers());
        await Promise.all(tasks);
        renderApp();
        showToast(`Sincronizado: cambios recibidos desde otro dispositivo`);
      } catch (error) {
        console.warn('Sync refresh error', error);
      }
    });
  } catch (error) {
    console.warn('No se pudo iniciar la sincronización en vivo', error);
  }
}

function updateSyncIndicator(clients, connected) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  if (connected === false || clients === 0) {
    el.textContent = '● Sin conexión en vivo';
    el.className = 'sync-indicator offline';
    return;
  }
  el.textContent = `● En vivo · ${clients} dispositivo(s) conectado(s)`;
  el.className = 'sync-indicator online';
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'sync-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

(async function init() {
  try {
    connectSync();
    if (!localStorage.getItem('token')) {
      await loadInstitution();
      renderLogin();
      return;
    }
    state.user = JSON.parse(localStorage.getItem('user') || 'null');
    state.token = localStorage.getItem('token');
    await loadAll();
    renderApp();
  } catch (error) {
    console.error(error);
    logout();
  }
})();
