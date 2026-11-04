/* ============================================================================
   IE San Miguel - Inventario General Tecnológico y Mobiliario
   Frontend principal (vanilla JavaScript)
   Compatible PC y celular, offline-first, sincronización en tiempo real
   ============================================================================ */

const API_BASE = '/api';
const STORAGE_TOKEN = 'ie_san_miguel_token';
const STORAGE_USER = 'ie_san_miguel_user';

// Estado global
const state = {
  page: 'login',
  token: null,
  user: null,
  institution: null,
  roles: [],
  sedes: [],
  dependencias: [],
  users: [],
  categorias: [],
  inventario: [],
  movimientos: [],
  dashboard: null,
  lowStock: [],
  activeItemId: null,
  modal: null,
  offline: !navigator.onLine,
  syncStatus: 'offline',
  filter: {
    q: '',
    categoria: '',
    tipo: '',
    estado: '',
    sede_id: '',
    dependencia_id: '',
  },
  pagination: { page: 1, limit: 20, total: 0 },
};

const appEl = document.getElementById('app');
const socket = io();

// ============================================================================
// Utilidades
// ============================================================================

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
}

function showToast(type, text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = `toast ${type}`;
  el.innerHTML = esc(text);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token || ''}`,
  };
}

async function apiRequest(path, method = 'GET', body = null) {
  const options = { method, headers: apiHeaders() };
  if (body && method !== 'GET') options.body = JSON.stringify(body);
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || 'Error de solicitud');
  }
  return payload.data || payload;
}

async function apiLogin(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Credenciales inválidas');
  return payload.data;
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
}

function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}

function isAuthenticated() {
  return !!state.token;
}

function ensureAuth() {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const user = JSON.parse(localStorage.getItem(STORAGE_USER) || 'null');
  if (!token || !user) return false;
  state.token = token;
  state.user = user;
  return true;
}

function canAccess(role) {
  if (!state.user) return false;
  if (state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA' || state.user.role === 'RECTOR') return true;
  return state.user.role === role;
}

function isDocente() {
  return state.user && state.user.role === 'DOCENTE';
}

// ============================================================================
// Sincronización y estado online/offline
// ============================================================================

function setSyncStatus(status) {
  state.syncStatus = status;
  const el = document.getElementById('sync-status');
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!el) return;
  el.className = 'sync-status';
  if (dot) dot.className = 'sync-dot';
  if (txt) txt.textContent = status === 'online' ? 'En línea' : 'Sin conexión';
  if (status === 'online') {
    el.classList.add('online');
    if (dot) dot.classList.add('online');
  } else {
    el.classList.add('offline');
    if (dot) dot.classList.add('offline');
  }
}

const offlineBanner = document.createElement('div');
offlineBanner.className = 'offline-banner';
offlineBanner.innerHTML = '📱 Sin conexión - Modo offline (los cambios se guardan localmente y se sincronizan al volver)';
document.body.insertAdjacentElement('afterbegin', offlineBanner);

window.addEventListener('online', () => {
  state.offline = false;
  offlineBanner.classList.remove('show');
  setSyncStatus('online');
  showToast('success', 'Conexión restablecida - sincronizando...');
});

window.addEventListener('offline', () => {
  state.offline = true;
  offlineBanner.classList.add('show');
  setSyncStatus('offline');
});

// Socket.io eventos
socket.on('connect', () => setSyncStatus('online'));
socket.on('disconnect', () => setSyncStatus('offline'));
socket.on('data:changed', () => {
  if (state.page === 'dashboard') loadDashboard();
  if (state.page === 'inventario') loadInventario();
});

// ============================================================================
// Navegación y renderizado
// ============================================================================

function navigate(page, params = {}) {
  state.page = page;
  if (page === 'login') {
    renderLogin();
    return;
  }
  updateSidebar();
  render();
}

function updateSidebar() {
  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('content');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const closeSidebar = document.getElementById('close-sidebar');

  if (window.innerWidth <= 768) {
    sidebar.style.left = '-280px';
    content.style.marginLeft = '0';
    if (mobileToggle) mobileToggle.style.display = 'flex';
  } else {
    sidebar.style.left = '0';
    content.style.marginLeft = '260px';
    if (mobileToggle) mobileToggle.style.display = 'none';
  }

  // Resaltar activo en menú
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === state.page);
  });
}

function openMobileMenu() {
  document.getElementById('sidebar').style.left = '0';
}

function closeMobileMenu() {
  document.getElementById('sidebar').style.left = '-280px';
}

window.addEventListener('resize', updateSidebar);

// ============================================================================
// Login
// ============================================================================

function renderLogin() {
  const institutionName = state.institution ? state.institution.name : 'Institución Educativa San Miguel Payande - San Luis';
  const institutionLogo = state.institution && state.institution.logo_data ? state.institution.logo_data : 'assets/logo-ie-san-miguel.png';

  appEl.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="logo-box">
          <img src="${esc(institutionLogo)}" alt="Logo IE San Miguel" onerror="this.src='assets/logo-ie-san-miguel.png'">
        </div>
        <h1 class="login-title">${esc(institutionName)}</h1>
        <p class="login-subtitle">Sistema de Control General de Inventario Tecnológico y Mobiliario</p>
        <div class="form-grid">
          <div class="field">
            <label for="login-user">Usuario</label>
            <input type="text" id="login-user" placeholder="Ingrese su usuario" autocomplete="username">
          </div>
          <div class="field">
            <label for="login-pass">Contraseña</label>
            <input type="password" id="login-pass" placeholder="Ingrese su contraseña" autocomplete="current-password">
          </div>
        </div>
        <button class="primary-btn btn-full" id="btn-login">Iniciar sesión</button>
        <div class="brand-footer">
          <div class="footer-brand">
            <img src="assets/logo-jcho.jpeg" alt="Marca JCHO" onerror="this.style.display='none'">
            <span>Marca JCHO · Sistema profesional de inventario</span>
          </div>
          <div class="footer-divider"></div>
          <span>IE San Miguel Payande - San Luis</span>
        </div>
      </div>
      <div id="toast" class="toast hidden"></div>
    </div>
  `;

  document.getElementById('btn-login').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    if (!u || !p) {
      showToast('error', 'Usuario y contraseña son obligatorios');
      return;
    }
    try {
      const data = await apiLogin(u, p);
      setAuth(data.token, data.user);
      await loadInstitution();
      navigate('dashboard');
    } catch (err) {
      showToast('error', err.message);
    }
  });

  document.getElementById('login-pass').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });
}

// ============================================================================
// Shell de la aplicación (sidebar + topbar)
// ============================================================================

function renderShell(innerContent) {
  const logo = state.institution && state.institution.logo_data ? state.institution.logo_data : 'assets/logo-ie-san-miguel.png';
  const brandLogo = state.institution && state.institution.brand_logo_data ? state.institution.brand_logo_data : 'assets/logo-jcho.jpeg';
  const userInitials = state.user
    ? state.user.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return `
    <div id="toast" class="toast hidden"></div>
    <div class="app-shell">
      <!-- Sidebar -->
      <aside id="sidebar" class="sidebar">
        <div class="brand">
          <img src="${esc(logo)}" alt="Logo" onerror="this.src='assets/logo-ie-san-miguel.png'">
          <div>
            <h3>IE San Miguel</h3>
            <small>Inventario General</small>
          </div>
        </div>
        <nav class="nav-menu">
          <button class="nav-item" data-page="dashboard"><span class="nav-icon">📊</span><span>Dashboard</span></button>
          <button class="nav-item" data-page="inventario"><span class="nav-icon">📦</span><span>Inventario</span></button>
          <button class="nav-item" data-page="movimientos"><span class="nav-icon">🔄</span><span>Movimientos</span></button>
          ${canAccess('ADMIN') || canAccess('ALMACENISTA') ? `
            <button class="nav-item" data-page="categorias"><span class="nav-icon">🏷️</span><span>Categorías</span></button>
            <button class="nav-item" data-page="sedes"><span class="nav-icon">🏫</span><span>Sedes</span></button>
            <button class="nav-item" data-page="dependencias"><span class="nav-icon">🚪</span><span>Dependencias</span></button>
            <button class="nav-item" data-page="usuarios"><span class="nav-icon">👥</span><span>Usuarios</span></button>
          ` : ''}
          <button class="nav-item" data-page="bajas"><span class="nav-icon">⚠️</span><span>Bajas</span></button>
          <button class="nav-item" data-page="bajas"><span class="nav-icon">⚠️</span><span>Bajas</span></button>
          <button class="nav-item" data-page="reportes"><span class="nav-icon">📄</span><span>Reportes</span></button>
          ${canAccess('ADMIN') ? `<button class="nav-item" data-page="configuracion"><span class="nav-icon">⚙️</span><span>Configuración</span></button>` : ''}
          <button class="nav-item" data-page="perfil"><span class="nav-icon">👤</span><span>Perfil</span></button>
          <button class="nav-item danger-btn" id="btn-logout"><span class="nav-icon">🚪</span><span>Cerrar sesión</span></button>
        </nav>
        <div class="user-box">
          <div class="user-avatar">${esc(userInitials)}</div>
          <span class="user-name">${esc(state.user ? state.user.full_name : '')}</span>
          <span class="user-role">${esc(state.user ? state.user.role : '')}</span>
          ${state.user && state.user.sede_id ? `<span class="user-sede">Sede asignada</span>` : ''}
        </div>
      </aside>

      <!-- Botón menú móvil -->
      <button id="mobile-menu-toggle" class="menu-toggle" style="display:none;">
        <span>☰</span> Menú
      </button>

      <!-- Contenido principal -->
      <main id="content" class="content">
        <header class="topbar">
          <h2>${getPageTitle()}</h2>
          <div class="topbar-actions">
            <div class="sync-status" id="sync-status">
              <span class="sync-dot" id="sync-dot"></span>
              <span id="sync-text">Conectando...</span>
            </div>
            <div class="btn-group">
              <button class="ghost-btn" id="btn-refresh">🔄 Actualizar</button>
            </div>
          </div>
        </header>
        ${innerContent}
        <div class="brand-footer">
          <div class="footer-brand">
            <img src="${esc(brandLogo)}" alt="Marca JCHO" onerror="this.style.display='none'">
            <span>Marca JCHO · Soluciones profesionales</span>
          </div>
          <div class="footer-divider"></div>
          <span>© ${new Date().getFullYear()} IE San Miguel Payande - San Luis</span>
        </div>
      </main>
    </div>
  `;
}

function getPageTitle() {
  const titles = {
    dashboard: 'Dashboard',
    inventario: 'Inventario General',
    movimientos: 'Movimientos',
    categorias: 'Categorías',
    sedes: 'Sedes',
    dependencias: 'Dependencias',
    usuarios: 'Usuarios',
    reportes: 'Reportes',
    configuracion: 'Configuración',
    perfil: 'Perfil',
  };
  return titles[state.page] || 'Sistema';
}

function render() {
  appEl.innerHTML = renderShell(renderPageContent());
  bindShellEvents();
  renderPageContentInit();
}

function bindShellEvents() {
  document.querySelectorAll('.nav-item:not(#btn-logout)').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    clearAuth();
    navigate('login');
  });

  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const closeBtn = document.getElementById('close-sidebar');
  if (mobileToggle) mobileToggle.addEventListener('click', openMobileMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMobileMenu);

  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      try {
        if (state.page === 'dashboard') await loadDashboard();
        if (state.page === 'inventario') await loadInventario();
        if (state.page === 'movimientos') await loadMovimientos();
        showToast('success', 'Datos actualizados');
      } catch (e) {
        showToast('error', 'Error al actualizar');
      }
    });
  }
}

// ============================================================================
// Contenido de páginas
// ============================================================================

function renderPageContent() {
  const pages = {
    login: renderLoginPage(),
    dashboard: renderDashboard(),
    inventario: renderInventario(),
    movimientos: renderMovimientos(),
    categorias: renderCategorias(),
    sedes: renderSedes(),
    dependencias: renderDependencias(),
    usuarios: renderUsuarios(),
    bajas: renderBajas(),
    reportes: renderReportes(),
    configuracion: renderConfiguracion(),
    perfil: renderPerfil(),
  };
  return pages[state.page] || renderDashboard();
}

function renderPageContentInit() {
  const inits = {
    dashboard: initDashboard,
    inventario: initInventario,
    movimientos: initMovimientos,
    categorias: initCategorias,
    sedes: initSedes,
    dependencias: initDependencias,
    usuarios: initUsuarios,
    bajas: initBajas,
    reportes: initReportes,
    configuracion: initConfiguracion,
    perfil: initPerfil,
  };
  if (inits[state.page]) inits[state.page]();
}

// ============================================================================
// Login (se usa renderLogin directo, esta página es fallback)
// ============================================================================
function renderLoginPage() { return ''; }

// ============================================================================
// DASHBOARD
// ============================================================================

async function loadDashboard() {
  try {
    state.dashboard = await apiRequest('/dashboard');
    state.lowStock = await apiRequest('/reports/low-stock');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar dashboard');
  }
}

function renderDashboard() {
  const d = state.dashboard || {};
  return `
    <div class="stats-grid">
      <div class="stat-card primary">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${d.totalItems ?? 0}</div>
        <div class="stat-label">Total artículos</div>
      </div>
      <div class="stat-card success">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${d.itemsBueno ?? 0}</div>
        <div class="stat-label">En buen estado</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon">⚠️</div>
        <div class="stat-value">${d.itemsRegular ?? 0}</div>
        <div class="stat-label">Stock regular / bajo</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-icon">❌</div>
        <div class="stat-value">${d.itemsMalo ?? 0}</div>
        <div class="stat-label">En mal estado / baja</div>
      </div>
      <div class="stat-card info">
        <div class="stat-icon">💻</div>
        <div class="stat-value">${d.totalTecnologico ?? 0}</div>
        <div class="stat-label">Tecnológico</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🪑</div>
        <div class="stat-value">${d.totalMobiliario ?? 0}</div>
        <div class="stat-label">Mobiliario</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;">
      <div class="card">
        <div class="card-header"><h3 class="card-title">🚨 Stock bajo o agotado</h3></div>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead>
              <tr><th>Artículo</th><th>Categoría</th><th>Cant.</th><th>Sede</th><th>Dependencia</th></tr>
            </thead>
            <tbody>
              ${(d.lowStock || []).map((it) => `
                <tr>
                  <td>${esc(it.nombre)}</td>
                  <td>${esc(it.categoria_nombre)}</td>
                  <td><span class="badge badge-regular">${it.cantidad}</span></td>
                  <td>${esc(it.sede_nombre || '-')}</td>
                  <td>${esc(it.dependencia_nombre || '-')}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="table-empty">Sin alertas de stock bajo</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">📋 Movimientos recientes</h3></div>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead>
              <tr><th>Artículo</th><th>Tipo</th><th>Cant.</th><th>Usuario</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              ${(d.recentMovements || []).map((m) => `
                <tr>
                  <td>${esc(m.articulo_nombre)}</td>
                  <td><span class="badge badge-${m.tipo === 'ENTRADA' ? 'success' : m.tipo === 'SALIDA' ? 'danger' : 'info'}">${m.tipo}</span></td>
                  <td>${m.cantidad}</td>
                  <td>${esc(m.user_name || '-')}</td>
                  <td>${new Date(m.created_at).toLocaleDateString('es-CO')}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="table-empty">Sin movimientos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3 class="card-title">🏫 Artículos por sede</h3></div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead>
            <tr><th>Sede</th><th>Total artículos</th></tr>
          </thead>
          <tbody>
            ${(d.porSede || []).map((s) => `
              <tr>
                <td>${esc(s.sede)}</td>
                <td><span class="badge badge-info">${s.total}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="2" class="table-empty">Sin datos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initDashboard() {
  await loadDashboard();
}

// ============================================================================
// INVENTARIO
// ============================================================================

async function loadInventario() {
  try {
    const params = new URLSearchParams();
    if (state.filter.q) params.append('q', state.filter.q);
    if (state.filter.categoria) params.append('categoria', state.filter.categoria);
    if (state.filter.tipo) params.append('tipo', state.filter.tipo);
    if (state.filter.estado) params.append('estado', state.filter.estado);
    if (state.filter.sede_id) params.append('sede_id', state.filter.sede_id);
    if (state.filter.dependencia_id) params.append('dependencia_id', state.filter.dependencia_id);
    state.inventario = await apiRequest(`/inventario?${params}`);
    render();
  } catch (e) {
    showToast('error', 'Error al cargar inventario');
  }
}

function renderInventario() {
  const puedeEditar = canAccess('ADMIN') || canAccess('ALMACENISTA');
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">📦 Inventario General - Tecnológico y Mobiliario</h3>
        ${puedeEditar ? `<button class="primary-btn" onclick="openItemModal()">+ Nuevo artículo</button>` : ''}
      </div>
      <div class="filters-bar" style="margin-top:16px;">
        <div class="field" style="min-width:200px;">
          <input type="text" id="filtro-q" placeholder="Buscar código, nombre, marca, serial..." value="${esc(state.filter.q)}">
        </div>
        <div class="field" style="min-width:160px;">
          <select id="filtro-tipo">
            <option value="">Todos los tipos</option>
            <option value="tecnologico" ${state.filter.tipo === 'tecnologico' ? 'selected' : ''}>Tecnológico</option>
            <option value="mobiliario" ${state.filter.tipo === 'mobiliario' ? 'selected' : ''}>Mobiliario</option>
          </select>
        </div>
        <div class="field" style="min-width:160px;">
          <select id="filtro-estado">
            <option value="">Todos los estados</option>
            <option value="BUENO" ${state.filter.estado === 'BUENO' ? 'selected' : ''}>Bueno</option>
            <option value="REGULAR" ${state.filter.estado === 'REGULAR' ? 'selected' : ''}>Regular</option>
            <option value="MALO" ${state.filter.estado === 'MALO' ? 'selected' : ''}>Malo</option>
            <option value="MANTENIMIENTO" ${state.filter.estado === 'MANTENIMIENTO' ? 'selected' : ''}>Mantenimiento</option>
            <option value="BAJA" ${state.filter.estado === 'BAJA' ? 'selected' : ''}>Baja</option>
          </select>
        </div>
        <div class="field" style="min-width:160px;">
          <select id="filtro-sede">
            <option value="">Todas las sedes</option>
            ${state.sedes.map((s) => `<option value="${s.id}" ${state.filter.sede_id == s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="min-width:160px;">
          <select id="filtro-dependencia">
            <option value="">Todas las dependencias</option>
            ${state.dependencias.map((d) => `<option value="${d.id}" ${state.filter.dependencia_id == d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}
          </select>
        </div>
        <button class="secondary-btn" onclick="aplicarFiltros()">Aplicar</button>
        <button class="ghost-btn" onclick="limpiarFiltros()">Limpiar</button>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Artículo</th><th>Tipo</th><th>Estado</th>
              <th>Cant.</th><th>Sede</th><th>Dependencia</th><th>Responsable</th>
              ${puedeEditar ? '<th>Acciones</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${state.inventario.map((it) => `
              <tr>
                <td><code>${esc(it.codigo)}</code></td>
                <td>${esc(it.nombre)}</td>
                <td><span class="tipo-${it.tipo}">${it.tipo === 'tecnologico' ? '💻 Tecnológico' : '🪑 Mobiliario'}</span></td>
                <td><span class="badge badge-${it.estado.toLowerCase()}">${it.estado}</span></td>
                <td>${it.cantidad}</td>
                <td>${esc(it.sede_nombre || '-')}</td>
                <td>${esc(it.dependencia_nombre || '-')}</td>
                <td>${esc(it.responsable || '-')}</td>
                ${puedeEditar ? `
                  <td>
                    <button class="small-btn" onclick="editItem(${it.id})">Editar</button>
                    <button class="small-btn ghost-btn" onclick="verHistorial(${it.id})">Historial</button>
                  </td>
                ` : ''}
              </tr>
            `).join('') || '<tr><td colspan="9" class="table-empty">No se encontraron artículos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function initInventario() {
  document.getElementById('filtro-q').addEventListener('input', (e) => {
    state.filter.q = e.target.value;
  });
  document.getElementById('filtro-tipo').addEventListener('change', (e) => {
    state.filter.tipo = e.target.value;
  });
  document.getElementById('filtro-estado').addEventListener('change', (e) => {
    state.filter.estado = e.target.value;
  });
  document.getElementById('filtro-sede').addEventListener('change', (e) => {
    state.filter.sede_id = e.target.value;
    if (e.target.value) {
      cargarDependenciasPorSede(e.target.value, 'filtro-dependencia');
    } else {
      document.getElementById('filtro-dependencia').innerHTML = '<option value="">Todas las dependencias</option>';
      state.filter.dependencia_id = '';
    }
  });
  document.getElementById('filtro-dependencia').addEventListener('change', (e) => {
    state.filter.dependencia_id = e.target.value;
  });
}

window.aplicarFiltros = function() {
  state.filter.q = document.getElementById('filtro-q').value;
  state.filter.tipo = document.getElementById('filtro-tipo').value;
  state.filter.estado = document.getElementById('filtro-estado').value;
  state.filter.sede_id = document.getElementById('filtro-sede').value;
  state.filter.dependencia_id = document.getElementById('filtro-dependencia').value;
  loadInventario();
};

window.limpiarFiltros = function() {
  state.filter = { q: '', categoria: '', tipo: '', estado: '', sede_id: '', dependencia_id: '' };
  document.getElementById('filtro-q').value = '';
  document.getElementById('filtro-tipo').value = '';
  document.getElementById('filtro-estado').value = '';
  document.getElementById('filtro-sede').value = '';
  document.getElementById('filtro-dependencia').innerHTML = '<option value="">Todas las dependencias</option>';
  loadInventario();
};

// Modal de artículo
function openItemModal(item = null) {
  state.activeItemId = item ? item.id : null;
  const categoriasHtml = state.categorias.map((c) => `<option value="${c.id}" ${item && item.categoria_id == c.id ? 'selected' : ''}>${esc(c.nombre)} (${c.tipo})</option>`).join('');
  const sedesHtml = state.sedes.map((s) => `<option value="${s.id}" ${item && item.sede_id == s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');

  document.getElementById('modal-overlay').innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${item ? '✏️ Editar artículo' : '+ Nuevo artículo'}</div>
        <button class="modal-close" onclick="closeItemModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-item">
          <div class="form-row">
            <div class="field">
              <label>Código *</label>
              <input type="text" name="codigo" value="${esc(item ? item.codigo : '')}" required>
            </div>
            <div class="field">
              <label>Nombre *</label>
              <input type="text" name="nombre" value="${esc(item ? item.nombre : '')}" required>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Descripción</label>
              <textarea name="descripcion" rows="2">${esc(item ? item.descripcion : '')}</textarea>
            </div>
            <div class="field">
              <label>Categoría *</label>
              <select name="categoria_id" required>${categoriasHtml}</select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Tipo *</label>
              <select name="tipo" onchange="toggleTipo(this.value)">
                <option value="tecnologico" ${(item && item.tipo === 'tecnologico') || (!item) ? 'selected' : ''}>Tecnológico</option>
                <option value="mobiliario" ${item && item.tipo === 'mobiliario' ? 'selected' : ''}>Mobiliario</option>
              </select>
            </div>
            <div class="field">
              <label>Marca</label>
              <input type="text" name="marca" value="${esc(item ? item.marca : '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Modelo</label>
              <input type="text" name="modelo" value="${esc(item ? item.modelo : '')}">
            </div>
            <div class="field">
              <label>Serial</label>
              <input type="text" name="serial" value="${esc(item ? item.serial : '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Cantidad</label>
              <input type="number" name="cantidad" value="${item ? item.cantidad : 1}" min="0">
            </div>
            <div class="field">
              <label>Unidad</label>
              <input type="text" name="unidad_medida" value="${esc(item ? item.unidad_medida : 'unidad')}">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Estado</label>
              <select name="estado">
                <option value="BUENO" ${(item && item.estado === 'BUENO') || (!item) ? 'selected' : ''}>Bueno</option>
                <option value="REGULAR" ${item && item.estado === 'REGULAR' ? 'selected' : ''}>Regular</option>
                <option value="MALO" ${item && item.estado === 'MALO' ? 'selected' : ''}>Malo</option>
                <option value="MANTENIMIENTO" ${item && item.estado === 'MANTENIMIENTO' ? 'selected' : ''}>Mantenimiento</option>
                <option value="BAJA" ${item && item.estado === 'BAJA' ? 'selected' : ''}>Baja</option>
              </select>
            </div>
            <div class="field">
              <label>Stock mínimo</label>
              <input type="number" name="stock_minimo" value="${item ? item.stock_minimo : 0}" min="0">
            </div>
          </div>
          <div class="form-row" id="sede-dep-row">
            <div class="field">
              <label>Sede</label>
              <select name="sede_id" onchange="cargarDependenciasPorSede(this.value, 'item-dependencia')">
                <option value="">Seleccione sede</option>
                ${sedesHtml}
              </select>
            </div>
            <div class="field">
              <label>Dependencia</label>
              <select name="dependencia_id" id="item-dependencia">
                <option value="">Seleccione dependencia</option>
                ${item ? estadoDependenciasHtml(item) : ''}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Responsable</label>
              <input type="text" name="responsable" value="${esc(item ? item.responsable : '')}">
            </div>
            <div class="field">
              <label>Fecha adquisición</label>
              <input type="date" name="fecha_adquisicion" value="${item ? item.fecha_adquisicion : ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Costo</label>
              <input type="number" name="costo" step="0.01" min="0" value="${item ? item.costo : 0}">
            </div>
            <div class="field">
              <label>Ubicación</label>
              <input type="text" name="ubicacion" value="${esc(item ? item.ubicacion : '')}">
            </div>
          </div>
          <div class="field">
            <label>Observaciones</label>
            <textarea name="observaciones" rows="2">${esc(item ? item.observaciones : '')}</textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="closeItemModal()">Cancelar</button>
        <button class="primary-btn" onclick="guardarItem()">Guardar</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function estadoDependenciasHtml(item) {
  return state.dependencias
    .filter((d) => item.sede_id ? d.sede_id == item.sede_id : true)
    .map((d) => `<option value="${d.id}" ${item.dependencia_id == d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`)
    .join('');
}

window.cargarDependenciasPorSede = function(sedeId, selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const deps = state.dependencias.filter((d) => d.sede_id == sedeId);
  select.innerHTML = '<option value="">Seleccione dependencia</option>' +
    deps.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');
};

window.toggleTipo = function(tipo) {
  // Podría ajustar campos según tipo
};

window.closeItemModal = function() {
  document.getElementById('modal-overlay').innerHTML = '';
  document.getElementById('modal-overlay').classList.add('hidden');
  state.activeItemId = null;
};

window.guardarItem = async function() {
  const form = document.getElementById('form-item');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  body.cantidad = Number(body.cantidad) || 0;
  body.stock_minimo = Number(body.stock_minimo) || 0;
  body.costo = Number(body.costo) || 0;

  try {
    if (state.activeItemId) {
      await apiRequest(`/inventario/${state.activeItemId}`, 'PUT', body);
      showToast('success', 'Artículo actualizado');
    } else {
      await apiRequest('/inventario', 'POST', body);
      showToast('success', 'Artículo registrado');
    }
    closeItemModal();
    loadInventario();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.editItem = async function(id) {
  try {
    const item = await apiRequest(`/inventario/${id}`);
    openItemModal(item);
  } catch (e) {
    showToast('error', 'Error al cargar artículo');
  }
};

window.verHistorial = async function(id) {
  try {
    const rows = await apiRequest(`/inventario/${id}/movements`);
    const html = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">📜 Historial del artículo</div>
          <button class="modal-close" onclick="closeItemModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:400px;overflow-y:auto;">
          <table style="width:100%;font-size:0.85rem;">
            <thead>
              <tr><th>Tipo</th><th>Responsable</th><th>Observación</th><th>Fecha</th><th>Usuario</th></tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><span class="badge badge-info">${r.tipo}</span></td>
                  <td>${esc(r.responsable || '-')}</td>
                  <td>${esc(r.observacion || '-')}</td>
                  <td>${new Date(r.created_at).toLocaleString('es-CO')}</td>
                  <td>${esc(r.user_name || '-')}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="table-empty">Sin historial</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="ghost-btn" onclick="closeItemModal()">Cerrar</button>
        </div>
      </div>
    `;
    document.getElementById('modal-overlay').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  } catch (e) {
    showToast('error', 'Error al cargar historial');
  }
};

// ============================================================================
// MOVIMIENTOS
// ============================================================================

async function loadMovimientos() {
  try {
    state.movimientos = await apiRequest('/movimientos');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar movimientos');
  }
}

function renderMovimientos() {
  const puedeEditar = canAccess('ADMIN') || canAccess('ALMACENISTA');
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🔄 Movimientos de inventario</h3>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead>
            <tr><th>Artículo</th><th>Tipo</th><th>Cant.</th><th>Sede origen</th><th>Sede destino</th><th>Usuario</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            ${state.movimientos.map((m) => `
              <tr>
                <td>${esc(m.articulo_nombre)}</td>
                <td><span class="badge badge-${m.tipo === 'ENTRADA' ? 'success' : m.tipo === 'SALIDA' ? 'danger' : 'info'}">${m.tipo}</span></td>
                <td>${m.cantidad}</td>
                <td>${esc(m.sede_origen_nombre || '-')}</td>
                <td>${esc(m.sede_destino_nombre || '-')}</td>
                <td>${esc(m.user_name || '-')}</td>
                <td>${new Date(m.created_at).toLocaleString('es-CO')}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="table-empty">Sin movimientos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initMovimientos() {
  await loadMovimientos();
}

// ============================================================================
// CATEGORÍAS
// ============================================================================

async function loadCategorias() {
  try {
    state.categorias = await apiRequest('/categorias');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar categorías');
  }
}

function renderCategorias() {
  const puedeEditar = canAccess('ADMIN') || canAccess('ALMACENISTA');
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🏷️ Categorías</h3>
        ${puedeEditar ? `<button class="primary-btn" onclick="openCategoriaModal()">+ Nueva categoría</button>` : ''}
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Fecha</th>${puedeEditar ? '<th>Acciones</th>' : ''}</tr>
          </thead>
          <tbody>
            ${state.categorias.map((c) => `
              <tr>
                <td>${esc(c.nombre)}</td>
                <td><span class="tipo-${c.tipo}">${c.tipo}</span></td>
                <td>${new Date(c.created_at).toLocaleDateString('es-CO')}</td>
                ${puedeEditar ? `
                  <td>
                    <button class="small-btn ghost-btn" onclick="editCategoria(${esc(c.id)}, '${esc(c.nombre)}', '${esc(c.tipo)}', '${esc(c.descripcion || '')}')">Editar</button>
                    <button class="small-btn danger-btn" onclick="deleteCategoria(${c.id})">Eliminar</button>
                  </td>
                ` : ''}
              </tr>
            `).join('') || '<tr><td colspan="5" class="table-empty">Sin categorías</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initCategorias() {
  await loadCategorias();
}

window.openCategoriaModal = function(c = null) {
  document.getElementById('modal-overlay').innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${c ? '✏️ Editar categoría' : '+ Nueva categoría'}</div>
        <button class="modal-close" onclick="closeItemModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-categoria">
          <div class="field">
            <label>Nombre *</label>
            <input type="text" name="nombre" value="${esc(c ? c.nombre : '')}" required>
          </div>
          <div class="field">
            <label>Descripción</label>
            <input type="text" name="descripcion" value="${esc(c ? c.descripcion : '')}">
          </div>
          <div class="field">
            <label>Tipo</label>
            <select name="tipo">
              <option value="ambos" ${(!c || c.tipo === 'ambos') ? 'selected' : ''}>Ambos</option>
              <option value="tecnologico" ${c && c.tipo === 'tecnologico' ? 'selected' : ''}>Tecnológico</option>
              <option value="mobiliario" ${c && c.tipo === 'mobiliario' ? 'selected' : ''}>Mobiliario</option>
            </select>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="closeItemModal()">Cancelar</button>
        <button class="primary-btn" onclick="guardarCategoria(${c ? c.id : 0})">Guardar</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
};

window.guardarCategoria = async function(id) {
  const form = document.getElementById('form-categoria');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  try {
    if (id) {
      await apiRequest(`/categorias/${id}`, 'PUT', body);
    } else {
      await apiRequest('/categorias', 'POST', body);
    }
    closeItemModal();
    loadCategorias();
    loadInventario();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.editCategoria = function(id, nombre, tipo, descripcion) {
  openCategoriaModal({ id, nombre, tipo, descripcion });
};

window.deleteCategoria = async function(id) {
  if (!confirm('¿Está seguro de eliminar esta categoría?')) return;
  try {
    await apiRequest(`/categorias/${id}`, 'DELETE');
    showToast('success', 'Categoría eliminada');
    loadCategorias();
    loadInventario();
  } catch (e) {
    showToast('error', e.message);
  }
};

// ============================================================================
// SEDES
// ============================================================================

async function loadSedes() {
  try {
    state.sedes = await apiRequest('/sedes');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar sedes');
  }
}

function renderSedes() {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🏫 Sedes</h3>
        <button class="primary-btn" onclick="openSedeModal()">+ Nueva sede</button>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Responsable</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${state.sedes.map((s) => `
              <tr>
                <td>${esc(s.nombre)}</td>
                <td>${esc(s.tipo)}</td>
                <td>${esc(s.responsable || '-')}</td>
                <td><span class="badge badge-${s.activo ? 'success' : 'danger'}">${s.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <button class="small-btn ghost-btn" onclick="editSede(${esc(s.id)}, '${esc(s.nombre)}', '${esc(s.tipo)}', '${esc(s.responsable || '')}', '${esc(s.descripcion || '')}', ${s.activo})">Editar</button>
                  <button class="small-btn danger-btn" onclick="deleteSede(${s.id})">Eliminar</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="table-empty">Sin sedes</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initSedes() {
  await loadSedes();
}

window.openSedeModal = function(s = null) {
  document.getElementById('modal-overlay').innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${s ? '✏️ Editar sede' : '+ Nueva sede'}</div>
        <button class="modal-close" onclick="closeItemModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-sede">
          <div class="field">
            <label>Nombre *</label>
            <input type="text" name="nombre" value="${esc(s ? s.nombre : '')}" required>
          </div>
          <div class="field">
            <label>Tipo *</label>
            <select name="tipo" required>
              <option value="principal" ${s && s.tipo === 'principal' ? 'selected' : ''}>Principal - Bachiller</option>
              <option value="primaria" ${s && s.tipo === 'primaria' ? 'selected' : ''}>Primaria</option>
              <option value="administrativa" ${s && s.tipo === 'administrativa' ? 'selected' : ''}>Área Administrativa</option>
              <option value="porvenir" ${s && s.tipo === 'porvenir' ? 'selected' : ''}>Porvenir</option>
              <option value="el_salitre" ${s && s.tipo === 'el_salitre' ? 'selected' : ''}>El Salitre</option>
            </select>
          </div>
          <div class="field">
            <label>Responsable</label>
            <input type="text" name="responsable" value="${esc(s ? s.responsable : '')}">
          </div>
          <div class="field">
            <label>Descripción</label>
            <input type="text" name="descripcion" value="${esc(s ? s.descripcion : '')}">
          </div>
          <div class="field">
            <label>Estado</label>
            <select name="activo">
              <option value="1" ${(!s || s.activo) ? 'selected' : ''}>Activo</option>
              <option value="0" ${s && !s.activo ? 'selected' : ''}>Inactivo</option>
            </select>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="closeItemModal()">Cancelar</button>
        <button class="primary-btn" onclick="guardarSede(${s ? s.id : 0})">Guardar</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
};

window.guardarSede = async function(id) {
  const form = document.getElementById('form-sede');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  body.activo = body.activo === '1';
  try {
    if (id) await apiRequest(`/sedes/${id}`, 'PUT', body);
    else await apiRequest('/sedes', 'POST', body);
    closeItemModal();
    loadSedes();
    loadInventario();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.editSede = function(id, nombre, tipo, responsable, descripcion, activo) {
  openSedeModal({ id, nombre, tipo, responsable, descripcion, activo });
};

window.deleteSede = async function(id) {
  if (!confirm('¿Eliminar esta sede?')) return;
  try {
    await apiRequest(`/sedes/${id}`, 'DELETE');
    showToast('success', 'Sede eliminada');
    loadSedes();
  } catch (e) {
    showToast('error', e.message);
  }
};

// ============================================================================
// DEPENDENCIAS
// ============================================================================

async function loadDependencias() {
  try {
    state.dependencias = await apiRequest('/dependencias');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar dependencias');
  }
}

function renderDependencias() {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🚪 Dependencias por sede</h3>
        <button class="primary-btn" onclick="openDependenciaModal()">+ Nueva dependencia</button>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>Sede</th><th>Dependencia</th><th>Tipo</th><th>Responsable</th><th>Acciones</th></tr></thead>
          <tbody>
            ${state.dependencias.map((d) => `
              <tr>
                <td>${esc(d.sede_nombre)}</td>
                <td>${esc(d.nombre)}</td>
                <td>${esc(d.tipo_dependencia)}</td>
                <td>${esc(d.responsable || '-')}</td>
                <td>
                  <button class="small-btn ghost-btn" onclick="editDependencia(${esc(d.id)}, ${esc(d.sede_id)}, '${esc(d.nombre)}', '${esc(d.responsable || '')}', '${esc(d.tipo_dependencia)}')">Editar</button>
                  <button class="small-btn danger-btn" onclick="deleteDependencia(${d.id})">Eliminar</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="table-empty">Sin dependencias</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initDependencias() {
  await loadDependencias();
}

window.openDependenciaModal = function(d = null) {
  const sedesHtml = state.sedes.map((s) => `<option value="${s.id}" ${d && d.sede_id == s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
  document.getElementById('modal-overlay').innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${d ? '✏️ Editar dependencia' : '+ Nueva dependencia'}</div>
        <button class="modal-close" onclick="closeItemModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-dependencia">
          <div class="field">
            <label>Sede *</label>
            <select name="sede_id" required>${sedesHtml}</select>
          </div>
          <div class="field">
            <label>Nombre *</label>
            <input type="text" name="nombre" value="${esc(d ? d.nombre : '')}" required>
          </div>
          <div class="field">
            <label>Tipo de dependencia *</label>
            <select name="tipo_dependencia" required>
              <option value="sala_sistemas" ${d && d.tipo_dependencia === 'sala_sistemas' ? 'selected' : ''}>Sala de sistemas</option>
              <option value="sala_audiovisuales" ${d && d.tipo_dependencia === 'sala_audiovisuales' ? 'selected' : ''}>Sala audiovisuales</option>
              <option value="coordinacion" ${d && d.tipo_dependencia === 'coordinacion' ? 'selected' : ''}>Coordinación</option>
              <option value="sala_multiple" ${d && d.tipo_dependencia === 'sala_multiple' ? 'selected' : ''}>Sala múltiple</option>
              <option value="area_administrativa" ${d && d.tipo_dependencia === 'area_administrativa' ? 'selected' : ''}>Área administrativa</option>
              <option value="otra" ${d && d.tipo_dependencia === 'otra' ? 'selected' : ''}>Otra</option>
            </select>
          </div>
          <div class="field">
            <label>Responsable</label>
            <input type="text" name="responsable" value="${esc(d ? d.responsable : '')}">
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="closeItemModal()">Cancelar</button>
        <button class="primary-btn" onclick="guardarDependencia(${d ? d.id : 0})">Guardar</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
};

window.guardarDependencia = async function(id) {
  const form = document.getElementById('form-dependencia');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  try {
    if (id) await apiRequest(`/dependencias/${id}`, 'PUT', body);
    else await apiRequest('/dependencias', 'POST', body);
    closeItemModal();
    loadDependencias();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.editDependencia = function(id, sedeId, nombre, responsable, tipo) {
  openDependenciaModal({ id, sede_id: sedeId, nombre, responsable, tipo_dependencia: tipo });
};

window.deleteDependencia = async function(id) {
  if (!confirm('¿Eliminar dependencia?')) return;
  try {
    await apiRequest(`/dependencias/${id}`, 'DELETE');
    showToast('success', 'Dependencia eliminada');
    loadDependencias();
  } catch (e) {
    showToast('error', e.message);
  }
};

// ============================================================================
// USUARIOS
// ============================================================================

async function loadUsuarios() {
  try {
    state.users = await apiRequest('/users');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar usuarios');
  }
}

function renderUsuarios() {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">👥 Usuarios</h3>
        <button class="primary-btn" onclick="openUsuarioModal()">+ Nuevo usuario</button>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Sede</th><th>Dependencia</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${state.users.map((u) => `
              <tr>
                <td>${esc(u.username)}</td>
                <td>${esc(u.full_name)}</td>
                <td><span class="badge badge-info">${u.role}</span></td>
                <td>${esc(u.sede_nombre || '-')}</td>
                <td>${esc(u.dependencia_nombre || '-')}</td>
                <td><span class="badge badge-${u.is_active ? 'success' : 'danger'}">${u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <button class="small-btn ghost-btn" onclick="editUsuario(${esc(u.id)}, '${esc(u.username)}', '${esc(u.full_name)}', '${esc(u.role)}', ${u.sede_id}, ${u.dependencia_id}, ${u.is_active})">Editar</button>
                  ${u.username !== 'admin' ? `<button class="small-btn danger-btn" onclick="deleteUsuario(${u.id})">Eliminar</button>` : ''}
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="table-empty">Sin usuarios</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function initUsuarios() {
  await loadUsuarios();
}

window.openUsuarioModal = function(u = null) {
  const rolesHtml = ['ADMIN', 'ALMACENISTA', 'RECTOR', 'DOCENTE'].map((r) => `<option value="${r}" ${u && u.role === r ? 'selected' : ''}>${r}</option>`).join('');
  const sedesHtml = state.sedes.map((s) => `<option value="${s.id}" ${u && u.sede_id == s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
  const depsHtml = state.dependencias.map((d) => `<option value="${d.id}" ${u && u.dependencia_id == d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('');
  document.getElementById('modal-overlay').innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${u ? '✏️ Editar usuario' : '+ Nuevo usuario'}</div>
        <button class="modal-close" onclick="closeItemModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-usuario">
          <div class="field">
            <label>Usuario *</label>
            <input type="text" name="username" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''} required>
          </div>
          ${!u ? `<div class="field"><label>Contraseña *</label><input type="password" name="password" required></div>` : ''}
          <div class="field">
            <label>Nombre completo *</label>
            <input type="text" name="full_name" value="${esc(u ? u.full_name : '')}" required>
          </div>
          <div class="field">
            <label>Rol *</label>
            <select name="role" required>${rolesHtml}</select>
          </div>
          <div class="field">
            <label>Sede</label>
            <select name="sede_id" onchange="cargarDependenciasPorSede(this.value, 'usuario-dependencia')">
              <option value="">Ninguna</option>${sedesHtml}</select>
          </div>
          <div class="field">
            <label>Dependencia</label>
            <select name="dependencia_id" id="usuario-dependencia">${depsHtml}</select>
          </div>
          <div class="field">
            <label>Estado</label>
            <select name="is_active"><option value="1" ${(!u || u.is_active) ? 'selected' : ''}>Activo</option><option value="0" ${u && !u.is_active ? 'selected' : ''}>Inactivo</option></select>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="closeItemModal()">Cancelar</button>
        <button class="primary-btn" onclick="guardarUsuario(${u ? u.id : 0})">Guardar</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
};

window.guardarUsuario = async function(id) {
  const form = document.getElementById('form-usuario');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  body.sede_id = body.sede_id || null;
  body.dependencia_id = body.dependencia_id || null;
  body.is_active = body.is_active === '1';
  try {
    if (id) {
      if (!body.password) delete body.password;
      await apiRequest(`/users/${id}`, 'PUT', body);
    } else {
      await apiRequest('/users', 'POST', body);
    }
    closeItemModal();
    loadUsuarios();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.editUsuario = function(id, username, full_name, role, sedeId, depId, isActive) {
  openUsuarioModal({ id, username, full_name, role, sede_id: sedeId, dependencia_id: depId, is_active: isActive });
};

window.deleteUsuario = async function(id) {
  if (!confirm('¿Eliminar usuario?')) return;
  try {
    await apiRequest(`/users/${id}`, 'DELETE');
    showToast('success', 'Usuario eliminado');
    loadUsuarios();
  } catch (e) {
    showToast('error', e.message);
  }
};

// ============================================================================
// REPORTES
// ============================================================================

function renderReportes() {
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title">📄 Reportes y exportación</h3></div>
      <div style="display:grid;grid-template:repeat(2,1fr)/repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:16px;">
        <button class="primary-btn" onclick="exportarExcel()">📊 Exportar a Excel</button>
        <button class="primary-btn" onclick="exportarPDF()">📄 Descargar PDF</button>
        <button class="primary-btn" onclick="verResumen()">📈 Ver resumen</button>
        <button class="primary-btn" onclick="navigate('bajas')">⚠️ Módulo de Bajas</button>
      </div>
      <div style="margin-top:20px;">
        <h4 style="color:var(--primary-dark);margin-bottom:10px;">📥 Exportar por Sede</h4>
        <div class="filters-bar">
          <div class="field" style="min-width:240px;">
            <select id="reporte-sede-select">
              <option value="">Seleccione una sede</option>
              ${state.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="primary-btn" onclick="exportarExcelPorSede()">📊 Excel por Sede</button>
          <button class="primary-btn" onclick="exportarPDFPorSede()">📄 PDF por Sede</button>
        </div>
      </div>
      <div id="reporte-resultado" style="margin-top:20px;"></div>
    </div>
  `;
}

async function initReportes() {}

window.exportarExcelPorSede = function() {
  const sedeId = document.getElementById('reporte-sede-select')?.value;
  if (!sedeId) {
    showToast('error', 'Seleccione una sede primero');
    return;
  }
  window.location = `${API_BASE}/reports/export/excel-by-sede?sede_id=${sedeId}`;
};

window.exportarPDFPorSede = function() {
  const sedeId = document.getElementById('reporte-sede-select')?.value;
  if (!sedeId) {
    showToast('error', 'Seleccione una sede primero');
    return;
  }
  window.location = `${API_BASE}/reports/export/pdf-by-sede?sede_id=${sedeId}`;
};

// ============================================================================
// BAJAS (artículos en estado MALO o BAJA)
// ============================================================================

async function loadBajas() {
  try {
    state.bajas = await apiRequest('/reports/bajas');
    render();
  } catch (e) {
    showToast('error', 'Error al cargar bajas');
  }
}

function renderBajas() {
  const datos = state.bajas || { items: [], resumen: { total: 0, malos: 0, bajas: 0, tecnologicos: 0, mobiliario: 0 } };
  const puedeEditar = canAccess('ADMIN') || canAccess('ALMACENISTA');

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">⚠️ Módulo de Bajas y Deterioro</h3>
        ${puedeEditar ? `<button class="primary-btn" onclick="cambiarEstadoBaja()">📝 Cambiar estado seleccionado</button>` : ''}
      </div>

      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card danger">
          <div class="stat-icon">❌</div>
          <div class="stat-value">${datos.resumen.total}</div>
          <div class="stat-label">Total en Baja / Malo</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-icon">⚠️</div>
          <div class="stat-value">${datos.resumen.malos}</div>
          <div class="stat-label">En estado MALO</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🗑️</div>
          <div class="stat-value">${datos.resumen.bajas}</div>
          <div class="stat-label">Dados de BAJA</div>
        </div>
        <div class="stat-card info">
          <div class="stat-icon">💻</div>
          <div class="stat-value">${datos.resumen.tecnologicos}</div>
          <div class="stat-label">Tecnológico</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🪑</div>
          <div class="stat-value">${datos.resumen.mobiliario}</div>
          <div class="stat-label">Mobiliario</div>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Artículo</th><th>Tipo</th><th>Estado</th>
              <th>Categoría</th><th>Sede</th><th>Dependencia</th><th>Responsable</th>
              ${puedeEditar ? '<th>Acciones</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${datos.items.map((it) => `
              <tr>
                <td><code>${esc(it.codigo)}</code></td>
                <td>${esc(it.nombre)}</td>
                <td><span class="tipo-${it.tipo}">${it.tipo === 'tecnologico' ? '💻 Tecnológico' : '🪑 Mobiliario'}</span></td>
                <td><span class="badge badge-${it.estado === 'MALO' ? 'warning' : 'danger'}">${it.estado}</span></td>
                <td>${esc(it.categoria_nombre)}</td>
                <td>${esc(it.sede_nombre || '-')}</td>
                <td>${esc(it.dependencia_nombre || '-')}</td>
                <td>${esc(it.responsable || '-')}</td>
                ${puedeEditar ? `
                  <td>
                    <button class="small-btn" onclick="cambiarEstadoArticulo(${it.id}, '${it.estado}')">
                      ${it.estado === 'MALO' ? 'Dar de Baja' : 'Restaurar a Malo'}
                    </button>
                  </td>
                ` : ''}
              </tr>
            `).join('') || '<tr><td colspan="9" class="table-empty">Sin artículos en estado de baja o malo</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3 class="card-title">📋 Exportar Reporte de Bajas</h3></div>
        <div class="btn-group">
          <button class="primary-btn" onclick="exportarBajasExcel()">📊 Exportar a Excel</button>
          <button class="primary-btn" onclick="exportarBajasPDF()">📄 Descargar PDF</button>
        </div>
      </div>
    </div>
  `;
}

async function initBajas() {
  await loadBajas();
}

window.cambiarEstadoBaja = function() {
  showToast('info', 'Haga clic en "Dar de Baja" o "Restaurar a Malo" en la fila del artículo');
};

window.cambiarEstadoArticulo = async function(id, estadoActual) {
  const nuevoEstado = estadoActual === 'MALO' ? 'BAJA' : 'MALO';
  if (!confirm(`¿Está seguro de cambiar el estado del artículo a "${nuevoEstado}"?`)) return;
  try {
    await apiRequest(`/inventario/${id}`, 'PUT', { estado: nuevoEstado });
    showToast('success', `Estado cambiado a ${nuevoEstado}`);
    loadBajas();
    loadInventario();
  } catch (e) {
    showToast('error', e.message);
  }
};

window.exportarBajasExcel = function() {
  window.location = `${API_BASE}/reports/export/excel-bajas`;
};

window.exportarBajasPDF = function() {
  window.location = `${API_BASE}/reports/export/pdf-bajas`;
};

// ============================================================================
// CONFIGURACIÓN

window.exportarExcel = function() {
  const params = new URLSearchParams();
  if (state.filter.tipo) params.append('tipo', state.filter.tipo);
  if (state.filter.estado) params.append('estado', state.filter.estado);
  if (state.filter.sede_id) params.append('sede_id', state.filter.sede_id);
  window.location = `${API_BASE}/reports/export/excel?${params}`;
};

window.exportarPDF = function() {
  const params = new URLSearchParams();
  if (state.filter.tipo) params.append('tipo', state.filter.tipo);
  if (state.filter.estado) params.append('estado', state.filter.estado);
  if (state.filter.sede_id) params.append('sede_id', state.filter.sede_id);
  window.location = `${API_BASE}/reports/export/pdf?${params}`;
};

window.verResumen = async function() {
  try {
    const s = await apiRequest('/reports/summary');
    document.getElementById('reporte-resultado').innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3 class="card-title">📈 Resumen general</h3>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value">${s.totalItems}</div><div class="stat-label">Total artículos</div></div>
          <div class="stat-card success"><div class="stat-value">${s.itemsBueno}</div><div class="stat-label">Bueno</div></div>
          <div class="stat-card warning"><div class="stat-value">${s.itemsRegular}</div><div class="stat-label">Regular</div></div>
          <div class="stat-card danger"><div class="stat-value">${s.itemsMalo}</div><div class="stat-label">Malo / Baja</div></div>
          <div class="stat-card info"><div class="stat-value">${s.totalTecnologico}</div><div class="stat-label">Tecnológico</div></div>
          <div class="stat-card"><div class="stat-value">${s.totalMobiliario}</div><div class="stat-label">Mobiliario</div></div>
        </div>
      </div>`;
  } catch (e) {
    showToast('error', 'Error al cargar resumen');
  }
};

window.exportarBajas = function() {
  showToast('info', 'Función de bajas disponible en el módulo de inventario (estado BAJA/MALO)');
};

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

async function loadInstitution() {
  try {
    state.institution = await apiRequest('/institution');
  } catch (e) {
    console.warn('No se pudo cargar institución');
  }
}

function renderConfiguracion() {
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title">⚙️ Configuración de la institución</h3></div>
      <div class="form-section">
        <div class="form-section-title">Datos de la institución</div>
        <form id="form-institution">
          <div class="form-row">
            <div class="field"><label>Nombre *</label><input type="text" name="name" value="${esc(state.institution ? state.institution.name : '')}" required></div>
            <div class="field"><label>Subtítulo</label><input type="text" name="subtitle" value="${esc(state.institution ? state.institution.subtitle : '')}"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Logo institucional (base64 o URL)</label><textarea name="logo_data" rows="3">${esc(state.institution ? state.institution.logo_data : '')}</textarea></div>
            <div class="field"><label>Logo marca JCHO (base64 o URL)</label><textarea name="brand_logo_data" rows="3">${esc(state.institution ? state.institution.brand_logo_data : '')}</textarea></div>
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="button" onclick="guardarInstitucion()">Guardar configuración</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function initConfiguracion() {
  await loadInstitution();
}

window.guardarInstitucion = async function() {
  const form = document.getElementById('form-institution');
  const fd = new FormData(form);
  const body = {};
  for (let [k, v] of fd.entries()) body[k] = v;
  try {
    await apiRequest('/institution', 'PUT', body);
    await loadInstitution();
    render();
    showToast('success', 'Configuración guardada');
  } catch (e) {
    showToast('error', e.message);
  }
};

// ============================================================================
// PERFIL
// ============================================================================

function renderPerfil() {
  const u = state.user;
  return `
    <div class="card">
      <div class="card-header"><h3 class="card-title">👤 Mi perfil</h3></div>
      <div class="form-section">
        <div class="form-section-title">Información del usuario</div>
        <div class="form-row">
          <div class="field"><label>Usuario</label><input type="text" value="${esc(u ? u.username : '')}" disabled></div>
          <div class="field"><label>Rol</label><input type="text" value="${esc(u ? u.role : '')}" disabled></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Nombre completo</label><input type="text" value="${esc(u ? u.full_name : '')}" disabled></div>
          <div class="field"><label>Sede asignada</label><input type="text" value="${esc(state.sedes.find((s) => s.id == u.sede_id)?.nombre || 'Ninguna')}" disabled></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Dependencia asignada</label><input type="text" value="${esc(state.dependencias.find((d) => d.id == u.dependencia_id)?.nombre || 'Ninguna')}" disabled></div>
        </div>
      </div>
    </div>
  `;
}

async function initPerfil() {}

// ============================================================================
// Inicialización
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Cargar datos maestros
  try {
    await loadInstitution();
    state.sedes = await apiRequest('/sedes').catch(() => []);
    state.dependencias = await apiRequest('/dependencias').catch(() => []);
    state.categorias = await apiRequest('/categorias').catch(() => []);
  } catch (e) {
    console.warn('Error cargando datos maestros:', e);
  }

  if (ensureAuth()) {
    navigate('dashboard');
    await loadDashboard();
  } else {
    navigate('login');
  }
});
