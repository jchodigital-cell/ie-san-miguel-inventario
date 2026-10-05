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
  tools: [],
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

async function loadTools() {
  const params = new URLSearchParams();
  if (state.toolFilter) {
    if (state.toolFilter.q) params.set('q', state.toolFilter.q);
    if (state.toolFilter.state) params.set('state', state.toolFilter.state);
    if (state.toolFilter.location) params.set('location', state.toolFilter.location);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  state.tools = await api.request(`/tools${query}`);
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
    loadTools(),
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
  const allowedRoles = state.user.role === 'ADMIN'
    ? ['dashboard', 'inventario', 'entradas', 'salidas', 'kardex', 'reportes', 'usuarios', 'configuracion', 'versiones', 'herramientas']
    : state.user.role === 'RECTOR'
      ? ['dashboard', 'inventario', 'kardex', 'reportes', 'herramientas']
      : ['dashboard', 'inventario', 'entradas', 'salidas', 'kardex', 'reportes', 'herramientas'];
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
  updateSyncIndicator(lastClients, syncConnected);
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
    { key: 'herramientas', label: 'Herramientas' },
    { key: 'entradas', label: 'Entradas' },
    { key: 'salidas', label: 'Salidas' },
    { key: 'kardex', label: 'Kardex' },
    { key: 'reportes', label: 'Reportes' },
  ];
  if (state.user.role === 'RECTOR') {
    return items.filter((item) => ['dashboard', 'inventario', 'kardex', 'reportes', 'herramientas'].includes(item.key)).map((item) => `
    <button class="nav-item ${state.page === item.key ? 'active' : ''}" data-page="${item.key}">${item.label}</button>
  `).join('');
  }
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
    herramientas: 'Control de Herramientas',
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
    case 'herramientas': return renderTools();
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
    { label: 'Total de herramientas', value: summary.totalTools ?? 0 },
    { label: 'Herramientas con novedades', value: summary.toolsMantenimiento ?? 0 },
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
        ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? '<button class="secondary-btn" id="new-category-btn" type="button">Crear categoría</button>' : ''}
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
          ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? `<button class="secondary-btn" id="manage-categories-btn" type="button">Categorías</button><button class="secondary-btn" id="new-category-btn" type="button">Nueva categoría</button>` : ''}
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

function toolStateBadge(stateValue) {
  const cls = stateValue === 'BUENA' ? 'normal' : stateValue === 'REGULAR' ? 'bajo' : stateValue === 'MANTENIMIENTO' ? 'mantenimiento' : 'agotado';
  return `<span class="badge ${cls}">${escapeHtml(stateValue)}</span>`;
}

function renderTools() {
  const canManage = state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA';
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Herramientas</h3>
        <div class="toolbar">
          <input id="search-tool" placeholder="Buscar por código, nombre o marca" value="${escapeHtml(state.toolFilter?.q || '')}" />
          <select id="filter-tool-state">
            <option value="">Todos los estados</option>
            ${['BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO'].map((s) => `<option value="${s}" ${state.toolFilter?.state === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="secondary-btn" id="apply-tool-filter-btn" type="button">Filtrar</button>
          ${canManage ? '<button class="primary-btn" id="new-tool-btn" type="button">Nueva herramienta</button>' : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Marca</th><th>Serial</th><th>Cantidad</th><th>Ubicación</th><th>Estado</th><th>Responsable</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${state.tools.map((tool) => `
              <tr>
                <td>${escapeHtml(tool.code)}</td>
                <td>${escapeHtml(tool.name)}</td>
                <td>${escapeHtml(tool.brand || '-')}</td>
                <td>${escapeHtml(tool.serial || '-')}</td>
                <td>${tool.quantity}</td>
                <td>${escapeHtml(tool.location)}</td>
                <td>${toolStateBadge(tool.state)}</td>
                <td>${escapeHtml(tool.responsible || '-')}</td>
                <td>
                  <button class="small-btn" data-tool-history="${tool.id}" type="button">Historial</button>
                  ${canManage ? `<button class="small-btn" data-tool-edit="${tool.id}" type="button">Editar</button>` : ''}
                  ${state.user.role === 'ADMIN' ? `<button class="danger-btn" data-tool-delete="${tool.id}" type="button">Eliminar</button>` : ''}
                </td>
              </tr>
            `).join('') || '<tr><td colspan="9">No hay herramientas registradas</td></tr>'}
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
  const bajasMat = state.materials.filter((m) => m.status === 'AGOTADO');
  const bajasTools = state.tools.filter((t) => t.state === 'MALA');
  return `
    <div class="panel">
      <div class="section-header">
        <h3>Reportes</h3>
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
            <tr><td>Herramientas</td><td>${state.tools.length}</td></tr>
            <tr><td>Bajas</td><td>${bajasMat.length + bajasTools.length}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- MÓDULO MATERIAL FERRETERÍA -->
    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Material de Ferretería</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-material-btn">IMPRIMIR</button><button class="secondary-btn" id="export-pdf-btn">DESCARGAR PDF</button>
        </div>
      </div>
      <p style="color:var(--muted); font-size:0.85rem;">Seleccione los materiales que desea exportar:</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th><input type="checkbox" id="select-all-materials" checked /></th><th>Código</th><th>Nombre</th><th>Categoría</th><th>Stock</th><th>Estado</th><th>Ubicación</th></tr>
          </thead>
          <tbody>
            ${state.materials.map((m) => `
              <tr>
                <td><input type="checkbox" class="material-export-check" value="${m.id}" checked /></td>
                <td>${escapeHtml(m.code)}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.category_name)}</td>
                <td>${m.stock}</td>
                <td>${escapeHtml(m.status)}</td>
                <td>${escapeHtml(m.location)}</td>
              </tr>`).join('') || '<tr><td colspan="7">No hay materiales</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- MÓDULO HERRAMIENTAS -->
    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Herramientas</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-tools-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-tools-btn">IMPRIMIR</button><button class="secondary-btn" id="export-tools-pdf-btn">DESCARGAR PDF</button>
        </div>
      </div>
      <p style="color:var(--muted); font-size:0.85rem;">Seleccione las herramientas que desea exportar:</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th><input type="checkbox" id="select-all-tools" checked /></th><th>Código</th><th>Nombre</th><th>Marca</th><th>Serial</th><th>Estado</th><th>Ubicación</th></tr>
          </thead>
          <tbody>
            ${state.tools.map((t) => `
              <tr>
                <td><input type="checkbox" class="tool-export-check" value="${t.id}" checked /></td>
                <td>${escapeHtml(t.code)}</td>
                <td>${escapeHtml(t.name)}</td>
                <td>${escapeHtml(t.brand || '-')}</td>
                <td>${escapeHtml(t.serial || '-')}</td>
                <td>${toolStateBadge(t.state)}</td>
                <td>${escapeHtml(t.location)}</td>
              </tr>`).join('') || '<tr><td colspan="7">No hay herramientas</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- MÓDULO BAJAS -->
    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Bajas</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-bajas-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-bajas-btn">IMPRIMIR</button><button class="secondary-btn" id="export-bajas-pdf-btn">DESCARGAR PDF</button>
        </div>
      </div>
      <p style="color:var(--muted); font-size:0.85rem;">Materiales agotados y herramientas dadas de baja. Seleccione cuáles exportar:</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th><input type="checkbox" id="select-all-bajas" checked /></th><th>Tipo</th><th>Código</th><th>Nombre</th><th>Cantidad</th><th>Estado</th><th>Ubicación</th></tr>
          </thead>
          <tbody>
            ${bajasMat.map((m) => `
              <tr>
                <td><input type="checkbox" class="baja-export-check" data-kind="mat" value="${m.id}" checked /></td>
                <td>MATERIAL</td>
                <td>${escapeHtml(m.code)}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${m.stock}</td>
                <td>${escapeHtml(m.status)}</td>
                <td>${escapeHtml(m.location)}</td>
              </tr>`).join('')}
            ${bajasTools.map((t) => `
              <tr>
                <td><input type="checkbox" class="baja-export-check" data-kind="tool" value="${t.id}" checked /></td>
                <td>HERRAMIENTA</td>
                <td>${escapeHtml(t.code)}</td>
                <td>${escapeHtml(t.name)}</td>
                <td>${t.quantity}</td>
                <td>${toolStateBadge(t.state)}</td>
                <td>${escapeHtml(t.location)}</td>
              </tr>`).join('')}
            ${bajasMat.length + bajasTools.length === 0 ? '<tr><td colspan="7">No hay bajas registradas</td></tr>' : ''}
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
  document.getElementById('manage-categories-btn')?.addEventListener('click', openCategoriesModal);
  document.getElementById('new-tool-btn')?.addEventListener('click', () => openToolModal());
  document.getElementById('apply-tool-filter-btn')?.addEventListener('click', async () => {
    state.toolFilter = {
      q: document.getElementById('search-tool')?.value.trim() || '',
      state: document.getElementById('filter-tool-state')?.value || '',
    };
    await loadTools();
    renderApp();
  });
  document.querySelectorAll('[data-tool-edit]').forEach((btn) => btn.addEventListener('click', () => openToolModal(btn.dataset.toolEdit)));
  document.querySelectorAll('[data-tool-history]').forEach((btn) => btn.addEventListener('click', () => openToolHistoryModal(btn.dataset.toolHistory)));
  document.querySelectorAll('[data-tool-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta herramienta?')) return;
    try {
      await api.request(`/tools/${btn.dataset.toolDelete}`, 'DELETE');
      await loadTools();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.getElementById('new-category-btn')?.addEventListener('click', openCategoryModal);
  document.getElementById('new-user-btn')?.addEventListener('click', openUserModal);
  document.getElementById('new-movement-btn')?.addEventListener('click', (e) => openMovementModal(e.target.dataset.type));
  document.getElementById('export-excel-btn')?.addEventListener('click', exportExcel);
  document.getElementById('print-material-btn')?.addEventListener('click', printMaterialView);
  document.getElementById('export-pdf-btn')?.addEventListener('click', exportPdf);
  document.getElementById('select-all-materials')?.addEventListener('change', (e) => {
    document.querySelectorAll('.material-export-check').forEach((cb) => { cb.checked = e.target.checked; });
  });
  document.getElementById('select-all-tools')?.addEventListener('change', (e) => {
    document.querySelectorAll('.tool-export-check').forEach((cb) => { cb.checked = e.target.checked; });
  });
  document.getElementById('select-all-bajas')?.addEventListener('change', (e) => {
    document.querySelectorAll('.baja-export-check').forEach((cb) => { cb.checked = e.target.checked; });
  });
  document.getElementById('export-tools-excel-btn')?.addEventListener('click', exportToolsExcel);
  document.getElementById('print-tools-btn')?.addEventListener('click', printToolsView);
  document.getElementById('export-tools-pdf-btn')?.addEventListener('click', exportToolsPdf);
  document.getElementById('export-bajas-excel-btn')?.addEventListener('click', exportBajasExcel);
  document.getElementById('print-bajas-btn')?.addEventListener('click', printBajasView);
  document.getElementById('export-bajas-pdf-btn')?.addEventListener('click', exportBajasPdf);
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
  const ids = Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/excel?token=${encodeURIComponent(token)}&ids=${ids}`, '_blank');
}

async function exportPdf() {
  const ids = Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/pdf?token=${encodeURIComponent(token)}&ids=${ids}`, '_blank');
}

async function exportBajasExcel() {
  const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
  const matIds = checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => cb.value).join(',');
  const toolIds = checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/bajas-excel?token=${encodeURIComponent(token)}&matIds=${matIds}&toolIds=${toolIds}`, '_blank');
}

async function exportBajasPdf() {
  const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
  const matIds = checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => cb.value).join(',');
  const toolIds = checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/bajas-pdf?token=${encodeURIComponent(token)}&matIds=${matIds}&toolIds=${toolIds}`, '_blank');
}

function printModulePage(title, headers, rows) {
  const inst = state.institution || {};
  const html = `
  <!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #222; }
    .header { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
    .header img { width: 64px; height: 64px; object-fit: contain; }
    h1 { color: #083764; font-size: 20px; margin: 0; }
    h2 { color: #444; font-size: 13px; margin: 2px 0 0; }
    p.fecha { font-size: 11px; color: #666; margin: 8px 0 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 11px; }
    th, td { border: 1px solid #cfd6e4; padding: 6px 8px; text-align: left; }
    th { background: #eef3fb; }
    footer { margin-top: 22px; font-size: 10px; color: #777; display: flex; justify-content: space-between; }
  </style></head><body>
    <div class="header">
      ${inst.logo_data ? `<img src="${inst.logo_data}" />` : ''}
      <div>
        <h1>${inst.name || 'Institución Educativa San Miguel'}</h1>
        <h2>${title}</h2>
      </div>
    </div>
    <p class="fecha">Fecha: ${new Date().toLocaleString('es-CO')}</p>
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Sin registros</td></tr>`}</tbody>
    </table>
    <footer><span>Sistema de Inventario</span><span>Institución Educativa San Miguel</span></footer>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para imprimir.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 600);
}

function printMaterialView() {
  const ids = new Set(Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => Number(cb.value)));
  const items = state.materials.filter((m) => ids.size === 0 || ids.has(m.id));
  const rows = items.map((m) => [m.code, m.name, m.category_name, m.unit, m.stock, m.status, m.location]);
  printModulePage('Reporte: Material de Ferretería', ['Código', 'Nombre', 'Categoría', 'Unidad', 'Stock', 'Estado', 'Ubicación'], rows);
}

function printToolsView() {
  const ids = new Set(Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => Number(cb.value)));
  const items = state.tools.filter((t) => ids.size === 0 || ids.has(t.id));
  const rows = items.map((t) => [t.code, t.name, t.brand || '-', t.serial || '-', t.quantity, t.state, t.location, t.responsible || '-']);
  printModulePage('Reporte de Herramientas', ['Código', 'Nombre', 'Marca', 'Serial', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows);
}

function printBajasView() {
  const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
  const matIds = new Set(checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => Number(cb.value)));
  const toolIds = new Set(checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => Number(cb.value)));
  const mats = state.materials.filter((m) => m.status === 'AGOTADO' && (matIds.size === 0 || matIds.has(m.id)));
  const tools = state.tools.filter((t) => t.state === 'MALA' && (toolIds.size === 0 || toolIds.has(t.id)));
  const rows = [
    ...mats.map((m) => ['MATERIAL', m.code, m.name, m.stock, m.status, m.location, '-']),
    ...tools.map((t) => ['HERRAMIENTA', t.code, t.name, t.quantity, t.state, t.location, t.responsible || '-']),
  ];
  printModulePage('Reporte de Bajas', ['Tipo', 'Código', 'Nombre', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows);
}

async function exportToolsExcel() {
  const ids = Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/tools-excel?token=${encodeURIComponent(token)}&ids=${ids}`, '_blank');
}

async function exportToolsPdf() {
  const ids = Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => cb.value).join(',');
  const token = api.getToken();
  window.open(`/api/reports/export/tools-pdf?token=${encodeURIComponent(token)}&ids=${ids}`, '_blank');
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

function openToolModal(toolId = null) {
  const tool = toolId ? state.tools.find((t) => t.id === Number(toolId)) : null;
  state.modal = `
    <h3>${tool ? 'Editar herramienta' : 'Nueva herramienta'}</h3>
    <form id="tool-form">
      <div class="form-row">
        <div class="field"><label>Código</label><input name="code" value="${escapeHtml(tool?.code || '')}" placeholder="Ej: HERR-001" required /></div>
        <div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(tool?.name || '')}" placeholder="Ej: Taladro percutor" required /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Marca</label><input name="brand" value="${escapeHtml(tool?.brand || '')}" placeholder="Ej: Bosch" /></div>
        <div class="field"><label>Serial</label><input name="serial" value="${escapeHtml(tool?.serial || '')}" placeholder="Ej: SN-2026-001" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Cantidad</label><input name="quantity" type="number" min="0" value="${escapeHtml(tool?.quantity ?? 1)}" /></div>
        <div class="field"><label>Estado</label>
          <select name="state">
            ${['BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO'].map((s) => `<option value="${s}" ${tool?.state === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>Ubicación</label><input name="location" value="${escapeHtml(tool?.location || '')}" placeholder="Ej: Bodega A" required /></div>
        <div class="field"><label>Responsable</label><input name="responsible" value="${escapeHtml(tool?.responsible || '')}" placeholder="Ej: Coordinación de taller" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Fecha de compra</label><input name="acquisition_date" type="date" value="${escapeHtml(tool?.acquisition_date || '')}" /></div>
        <div class="field"><label>Costo</label><input name="cost" type="number" min="0" step="0.01" value="${escapeHtml(tool?.cost ?? 0)}" /></div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('tool-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const payload = {
        code: form.code.value,
        name: form.name.value,
        brand: form.brand.value,
        serial: form.serial.value,
        quantity: Number(form.quantity.value),
        state: form.state.value,
        location: form.location.value,
        responsible: form.responsible.value,
        acquisition_date: form.acquisition_date.value || null,
        cost: Number(form.cost.value || 0),
      };
      await api.request(tool ? `/tools/${tool.id}` : '/tools', tool ? 'PUT' : 'POST', payload);
      state.modal = null;
      await loadTools();
      renderApp();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

async function openToolHistoryModal(toolId) {
  const tool = state.tools.find((t) => t.id === Number(toolId));
  let history = [];
  try {
    history = await api.request(`/tools/${toolId}/movements`);
  } catch (error) {
    alert(error.message);
    return;
  }
  const canManage = state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA';
  state.modal = `
    <h3>Historial de ${escapeHtml(tool?.name || 'herramienta')}</h3>
    ${canManage ? `
    <form id="tool-movement-form" style="margin-bottom:14px;">
      <div class="form-row">
        <div class="field"><label>Tipo</label>
          <select name="type">
            ${['INGRESO', 'PRESTAMO', 'DEVOLUCION', 'REVISION', 'BAJA'].map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Responsable</label><input name="responsible" placeholder="Ej: Prof. Juan Pérez" /></div>
      </div>
      <div class="field"><label>Observación</label><input name="observation" placeholder="Ej: Préstamo para clase de electricidad" /></div>
      <div class="form-actions"><button class="primary-btn" type="submit">Registrar movimiento</button></div>
    </form>` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Tipo</th><th>Responsable</th><th>Observación</th><th>Usuario</th><th>Fecha</th></tr></thead>
        <tbody>
          ${history.map((h) => `
            <tr>
              <td>${escapeHtml(h.type)}</td>
              <td>${escapeHtml(h.responsible || '-')}</td>
              <td>${escapeHtml(h.observation || '-')}</td>
              <td>${escapeHtml(h.user_name || '-')}</td>
              <td>${escapeHtml(h.created_at)}</td>
            </tr>`).join('') || '<tr><td colspan="5">Sin movimientos</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="form-actions"><button class="secondary-btn" id="close-modal" type="button">Cerrar</button></div>
  `;
  renderApp();
  if (canManage) {
    document.getElementById('tool-movement-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      try {
        await api.request(`/tools/${toolId}/movements`, 'POST', {
          type: form.type.value,
          responsible: form.responsible.value,
          observation: form.observation.value,
        });
        await loadTools();
        await openToolHistoryModal(toolId);
      } catch (error) {
        alert(error.message);
      }
    });
  }
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

function openCategoriesModal() {
  state.modal = `
    <h3>Categorías</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Acciones</th></tr></thead>
        <tbody>
          ${state.categories.map((cat) => `
            <tr>
              <td>${escapeHtml(cat.name)}</td>
              <td>
                <button class="small-btn" data-category-edit="${cat.id}" type="button">Editar</button>
                ${state.user.role === 'ADMIN' ? `<button class="danger-btn" data-category-delete="${cat.id}" type="button">Eliminar</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="2">No hay categorías</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="form-actions"><button class="secondary-btn" id="close-modal" type="button">Cerrar</button></div>
  `;
  renderApp();
  document.querySelectorAll('[data-category-edit]').forEach((btn) => btn.addEventListener('click', () => openCategoryEditModal(Number(btn.dataset.categoryEdit))));
  document.querySelectorAll('[data-category-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta categoría?')) return;
    try {
      await api.request(`/categories/${btn.dataset.categoryDelete}`, 'DELETE');
      await loadCategories();
      openCategoriesModal();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.getElementById('close-modal')?.addEventListener('click', () => { state.modal = null; renderApp(); });
}

function openCategoryEditModal(categoryId) {
  const category = state.categories.find((c) => c.id === Number(categoryId));
  if (!category) return;
  state.modal = `
    <h3>Editar categoría</h3>
    <form id="category-edit-form">
      <div class="field">
        <label for="category-edit-name">Nombre</label>
        <input id="category-edit-name" name="name" value="${escapeHtml(category.name)}" required />
      </div>
      <div class="form-actions">
        <button class="secondary-btn" type="button" id="close-modal">Cancelar</button>
        <button class="primary-btn" type="submit">Guardar</button>
      </div>
    </form>
  `;
  renderApp();
  document.getElementById('category-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.request(`/categories/${categoryId}`, 'PUT', { name: event.target.name.value });
      state.modal = null;
      await loadCategories();
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
            <option value="RECTOR" ${user?.role === 'RECTOR' ? 'selected' : ''}>RECTOR</option>
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
let syncConnected = false;
let lastClients = 0;

function connectSync() {
  if (typeof io === 'undefined') return;
  try {
    syncSocket = io();
    syncSocket.on('sync:clients', ({ clients }) => { lastClients = clients; syncConnected = true; updateSyncIndicator(clients); });
    syncSocket.on('connect', () => { syncConnected = true; updateSyncIndicator(1, true); });
    syncSocket.on('disconnect', () => { syncConnected = false; updateSyncIndicator(0, false); });
    syncSocket.on('data:changed', async (payload) => {
      if (Date.now() - lastLocalChangeAt < 1500) return; // evitar recargar lo que cambió el propio dispositivo
      if (!localStorage.getItem('token')) return;
      try {
        const tasks = [loadDashboard(), loadMaterials(), loadMovements(), loadLowStock(), loadCategories(), loadTools()];
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
