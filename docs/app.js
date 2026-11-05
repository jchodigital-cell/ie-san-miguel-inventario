// ============================================================
// Versión GitHub Pages + Firebase (sin backend Node)
// Los datos viven en Firebase Realtime Database y se sincronizan
// entre todos los dispositivos. Igual que JCHO-FINANZAS.
// ============================================================
const FIREBASE_URL = 'https://ie-san-miguel-inventario-default-rtdb.firebaseio.com';
const CLOUD_DOC = 'inventario';
let cloudData = null;
let localVersion = 0;
let lastCloudError = null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

async function defaultCloudData() {
  return {
    institution: {
      id: 1,
      name: 'Institución Educativa San Miguel',
      subtitle: 'Sistema de Control de Inventario de Materiales de Ferretería',
      logo_data: null,
      brand_logo_data: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    users: [
      { id: 1, username: 'admin', password_hash: await sha256('admin123'), full_name: 'Administrador Principal', role: 'ADMIN', is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 2, username: 'rector', password_hash: await sha256('rector123'), full_name: 'Rectoría IE San Miguel', role: 'RECTOR', is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 3, username: 'almacenista', password_hash: await sha256('almacen123'), full_name: 'Almacenero', role: 'ALMACENISTA', is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ],
    categories: [],
    materials: [],
    movements: [],
    tools: [],
    tool_movements: [],
    lastUpdated: Date.now(),
  };
}

function normalizeCloudData(data) {
  const base = {
    institution: cloudData && cloudData.institution ? cloudData.institution : undefined,
    users: [],
    categories: [],
    materials: [],
    movements: [],
    tools: [],
    tool_movements: [],
    lastUpdated: 0,
  };
  const normalized = Object.assign({}, base, data);
  // Los respaldos viven solo en la nube: no se guardan en la caché local
  delete normalized._respaldos;
  return normalized;
}

// ============================================================
// SINCRONIZACIÓN SEGURA (nunca se pierde información)
// ------------------------------------------------------------
// 1) FUSIÓN antes de escribir: se unen los datos de la nube y
//    del equipo; gana el registro más reciente. Ningún equipo
//    puede borrar lo que otro creó.
// 2) TUMBAS (tombstones): al eliminar un registro se marca con
//    la fecha de borrado; la fusión lo respeta y no lo resucita.
// 3) RESPALDO AUTOMÁTICO: antes de escribir se guarda una copia
//    del estado previo de la nube en /inventario/_respaldos
//    (se conservan las 5 copias más recientes).
// ============================================================
const SYNC_COLLECTIONS = ['users', 'categories', 'materials', 'movements', 'tools', 'tool_movements'];
const TOMBSTONE_TTL = 180 * 24 * 3600 * 1000; // las tumbas se limpian a los 180 días
const MAX_CLOUD_BACKUPS = 5;

function recordTime(rec) {
  return Date.parse((rec && (rec.updated_at || rec.created_at)) || '') || 0;
}

function tombKey(collection, id) {
  return collection + ':' + id;
}

function markDeleted(collection, id) {
  if (!cloudData._borrados) cloudData._borrados = {};
  cloudData._borrados[tombKey(collection, id)] = Date.now();
}

function markCreated(collection, id) {
  // Si se reutiliza un id borrado antes, se limpia su tumba
  if (cloudData._borrados) delete cloudData._borrados[tombKey(collection, id)];
}

function fillEmpty(doc) {
  const out = Object.assign({}, doc || {});
  SYNC_COLLECTIONS.forEach((c) => { if (!Array.isArray(out[c])) out[c] = []; });
  return out;
}

function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = recordTime(a);
  const tb = recordTime(b);
  if (tb > ta) return b;
  if (ta > tb) return a;
  // Empate: determinista para que todos los equipos decidan igual
  return JSON.stringify(b) > JSON.stringify(a) ? b : a;
}

function pickInstitution(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aLogo = !!(a.logo_data || a.brand_logo_data);
  const bLogo = !!(b.logo_data || b.brand_logo_data);
  if (aLogo !== bLogo) return aLogo ? a : b; // gana la que conserve el logo
  return pickNewer(a, b);
}

// Unión de las tumbas de ambos lados (la más reciente gana), sin pasarse de TTL
function mergeTombstones(remote, local) {
  const out = {};
  const now = Date.now();
  [remote, local].forEach((src) => {
    const t = (src && src._borrados) || {};
    Object.keys(t).forEach((k) => {
      const ts = Number(t[k]) || 0;
      if (now - ts <= TOMBSTONE_TTL && (!out[k] || ts > out[k])) out[k] = ts;
    });
  });
  return out;
}

// Fusión: unión por id, gana el updated_at más reciente, respeta tumbas.
function mergeCloudDocs(remote, local) {
  const rem = remote || {};
  const loc = local || {};
  const tombs = mergeTombstones(rem, loc);
  const out = {};
  SYNC_COLLECTIONS.forEach((coll) => {
    const map = new Map();
    const addAll = (arr) => {
      (Array.isArray(arr) ? arr : []).forEach((rec) => {
        if (!rec || rec.id === undefined || rec.id === null) return;
        const key = String(rec.id);
        const prev = map.get(key);
        map.set(key, prev ? pickNewer(prev, rec) : rec);
      });
    };
    addAll(rem[coll]);
    addAll(loc[coll]);
    out[coll] = [...map.values()].filter((rec) => {
      const ts = tombs[tombKey(coll, rec.id)];
      return !(ts && ts >= recordTime(rec));
    });
  });
  out.institution = pickInstitution(rem.institution, loc.institution);
  out._borrados = tombs;
  out.lastUpdated = Math.max(Number(rem.lastUpdated) || 0, Number(loc.lastUpdated) || 0);
  // Los respaldos de la nube se conservan tal cual (se agregan aparte al escribir)
  if (rem._respaldos) out._respaldos = rem._respaldos;
  else if (loc._respaldos) out._respaldos = loc._respaldos;
  return out;
}

// Comparación de contenido real (ignora lastUpdated y respaldos;
// solo importan los registros — vacio_confirmado sí se compara para
// que la marca desaparezca de la nube en la siguiente escritura)
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = {};
    Object.keys(x).sort().forEach((k) => {
      if (k !== '_respaldos' && k !== 'lastUpdated') o[k] = canon(x[k]);
    });
    return o;
  }
  return x;
}

function docsDataEqual(a, b) {
  return JSON.stringify(canon(fillEmpty(a))) === JSON.stringify(canon(fillEmpty(b)));
}

function countRecords(doc) {
  const d = fillEmpty(doc);
  return SYNC_COLLECTIONS.reduce((sum, c) => sum + d[c].length, 0);
}

// Respaldo solo si algo se perdería o si pasó más de 1 día desde el último
function shouldBackup(remote, merged) {
  if (!remote || !remote.institution) return false;
  if (countRecords(merged) < countRecords(remote)) return true;
  const last = Number(localStorage.getItem('ie-last-backup') || 0);
  return Date.now() - last > 24 * 3600 * 1000;
}

// Copia del estado previo de la nube, sin logos (pesan mucho) ni respaldos anidados
function addCloudBackup(currentBackups, remoteDoc) {
  const snap = JSON.parse(JSON.stringify(remoteDoc));
  delete snap._respaldos;
  if (snap.institution) {
    snap.institution.logo_data = null;
    snap.institution.brand_logo_data = null;
  }
  const all = Object.assign({}, currentBackups || {});
  all['resp-' + Date.now()] = snap;
  // Orden numérico por fecha (las claves son "resp-<milisegundos>")
  const keys = Object.keys(all).sort((a, b) => Number(a.slice(5) || 0) - Number(b.slice(5) || 0));
  while (keys.length > MAX_CLOUD_BACKUPS) delete all[keys.shift()];
  return all;
}

// Solo se conservan respaldos con formato "resp-<fecha>" (limpia claves de prueba)
function sanitizeBackups(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    if (k.startsWith('resp-') && obj[k] && typeof obj[k] === 'object') out[k] = obj[k];
  });
  return out;
}

// ===== TRABAJO SIN INTERNET (offline-first) =====
// Los cambios se guardan siempre en el equipo y se envían a la nube
// apenas vuelve la conexión. Nada se pierde si se cae el internet.
let pendingChanges = 0;
let isPushing = false;
// true = se conoce el estado real de la nube (lectura exitosa o caché previa).
// false = nunca se pudo leer la nube: NO se debe escribir encima a ciegas.
let cloudStateVerified = false;

function pendingKey() {
  return 'ie-sync-pending';
}

function loadPending() {
  pendingChanges = Number(localStorage.getItem(pendingKey()) || 0);
}

function markPending(delta) {
  pendingChanges = Math.max(0, pendingChanges + delta);
  if (pendingChanges === 0) localStorage.removeItem(pendingKey());
  else localStorage.setItem(pendingKey(), String(pendingChanges));
  updateSyncIndicator();
}

// Escribe en la nube SIEMPRE leyendo primero, fusionando y respaldando.
// Nunca se pisa la información: lo que exista en la nube se conserva.
async function pushToCloud() {
  // 1) Lectura del estado real de la nube (nunca se escribe a ciegas)
  const res = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
  const remote = await res.json();
  if (!res.ok || (remote && remote.error)) {
    throw new Error((remote && remote.error) || `HTTP ${res.status}`);
  }
  cloudStateVerified = true;
  const remoteHasData = Boolean(remote && remote.institution);

  // 2) Fusión: unión de nube + equipo, gana el registro más reciente,
  //    se respetan las tumbas (borrados). Nada se pierde de ningún lado.
  const merged = remoteHasData ? mergeCloudDocs(remote, cloudData) : fillEmpty(Object.assign({}, cloudData));

  const payload = Object.assign({}, merged);
  delete payload._respaldos; // se agrega aparte, solo desde la nube viva
  payload.lastUpdated = Date.now();

  // 3) Respaldo automático del estado previo antes de cualquier escritura
  let backups = sanitizeBackups(remote && remote._respaldos);
  if (remoteHasData && shouldBackup(remote, merged)) {
    backups = addCloudBackup(backups, remote);
    localStorage.setItem('ie-last-backup', String(Date.now()));
  }
  if (Object.keys(backups).length > 0) payload._respaldos = backups;

  // 4) Regla de las reglas de Firebase: si una colección queda vacía
  //    existiendo antes, se marca la confirmación explícita del usuario
  //    con fecha (las reglas solo aceptan marcas recientes: < 24 horas).
  const emptied = SYNC_COLLECTIONS.some((c) => Array.isArray(remote[c]) && remote[c].length > 0
    && Array.isArray(payload[c]) && payload[c].length === 0);
  if (emptied) payload.vacio_confirmado = Date.now();

  // 5) ¿Hay cambios reales? Si no, no se escribe (evita saturar la nube)
  if (remoteHasData && docsDataEqual(payload, remote)) {
    cloudData = merged;
    cloudData.lastUpdated = payload.lastUpdated;
    localVersion = Math.max(localVersion, Number(remote.lastUpdated) || 0);
    localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
    return;
  }

  // 6) Escritura del documento fusionado (incluye _respaldos para no borrarlos)
  const put = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!put.ok) throw new Error('Firebase respondió ' + put.status);

  // 7) Se adopta la fusión localmente
  cloudData = merged;
  cloudData.lastUpdated = payload.lastUpdated;
  localVersion = payload.lastUpdated;
  localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
}

async function cloudLoad() {
  loadPending();
  try {
    const response = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
    const data = await response.json();
    // Un error de permisos NO significa base vacía: no se pisa la información
    if (!response.ok || (data && data.error)) {
      throw new Error((data && data.error) || `HTTP ${response.status}`);
    }
    if (data && data.institution) {
      cloudStateVerified = true;
      // FUSIÓN en vez de reemplazo: lo local no se descarta nunca
      const merged = mergeCloudDocs(data, cloudData);
      const extras = !docsDataEqual(merged, data); // datos locales que la nube no tiene
      cloudData = merged;
      localVersion = Number(data.lastUpdated) || 0;
      localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
      if (pendingChanges > 0 || extras) {
        // Autocuración: lo que falte en la nube se sube de vuelta
        await pushToCloud().then(() => markPending(-pendingChanges)).catch(() => {});
      }
    } else {
      // Lectura exitosa y nube vacía: sí corresponde crear los datos por defecto
      cloudStateVerified = true;
      cloudData = await defaultCloudData();
      await cloudSave();
    }
  } catch (error) {
    lastCloudError = error;
    const cached = localStorage.getItem('ie-inventario-cache');
    // Solo se confía en el caché si viene de una lectura real anterior de la nube
    cloudStateVerified = Boolean(cached);
    cloudData = cached ? normalizeCloudData(JSON.parse(cached)) : await defaultCloudData();
  }
}

async function cloudSave() {
  cloudData.lastUpdated = Date.now();
  localVersion = cloudData.lastUpdated;
  localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
  lastLocalChangeAt = Date.now();
  try {
    // pushToCloud lee la nube, fusiona y respalda antes de escribir:
    // no hace falta (ni es seguro) un sondeo aparte.
    await pushToCloud();
    lastCloudError = null;
    if (pendingChanges > 0) markPending(-pendingChanges);
  } catch (error) {
    lastCloudError = error;
    markPending(1); // queda en cola hasta que vuelva el internet
  }
  updateSyncIndicator();
}

function computeStatus(stock, stockMinimo) {
  if (stock === 0) return 'AGOTADO';
  if (stock <= stockMinimo) return 'BAJO';
  return 'NORMAL';
}

function withCategory(material) {
  const category = cloudData.categories.find((c) => c.id === material.category_id);
  return { ...material, category_name: category ? category.name : '' };
}

function withUserAndMaterial(movement) {
  const material = cloudData.materials.find((m) => m.id === movement.material_id);
  const user = cloudData.users.find((u) => u.id === movement.user_id);
  return { ...movement, material_name: material ? material.name : '', user_name: user ? user.full_name : '' };
}

const api = {
  base: '',
  getToken() {
    return localStorage.getItem('token');
  },
  headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.getToken()}` };
  },
  async login(username, password) {
    const user = cloudData.users.find((u) => u.username === String(username).trim());
    if (!user || user.password_hash !== (await sha256(password))) {
      throw new Error('Credenciales inválidas');
    }
    if (user.is_active === 0) {
      throw new Error('Usuario inactivo');
    }
    return {
      token: 'firebase-session',
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    };
  },
  async request(path, method = 'GET', body = null) {
    const data = await localApi(path, method, body);
    if (method !== 'GET') {
      lastLocalChangeAt = Date.now();
    }
    return data;
  },
};

function localApiGet(path) {
  if (path === '/institution') return cloudData.institution;
  if (path === '/users') return [...cloudData.users].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (path === '/categories') return [...cloudData.categories].sort((a, b) => a.name.localeCompare(b.name));
  if (path.startsWith('/materials')) {
    const query = path.split('?')[1] || '';
    const params = new URLSearchParams(query);
    let items = cloudData.materials.map(withCategory);
    const q = params.get('q');
    if (q) items = items.filter((m) => normalizeSearchText(m.code + ' ' + m.name).includes(normalizeSearchText(q)));
    const category = params.get('category');
    if (category) items = items.filter((m) => m.category_name === category);
    const location = params.get('location');
    if (location) items = items.filter((m) => normalizeSearchText(m.location).includes(normalizeSearchText(location)));
    const status = params.get('status');
    if (status) items = items.filter((m) => m.status === status);
    if (params.get('low_stock') === 'true') items = items.filter((m) => m.stock <= m.stock_minimo || m.stock === 0);
    return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  if (path === '/movements') {
    return cloudData.movements.map(withUserAndMaterial).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  if (path === '/dashboard') {
    const materials = cloudData.materials;
    const movements = cloudData.movements;
    return {
      totalMaterials: materials.length,
      activeMaterials: materials.filter((m) => m.status !== 'AGOTADO').length,
      lowStock: materials.filter((m) => m.status === 'BAJO').length,
      agotados: materials.filter((m) => m.status === 'AGOTADO').length,
      totalEntradas: movements.filter((m) => m.type === 'ENTRADA').reduce((s, m) => s + m.quantity, 0),
      totalSalidas: movements.filter((m) => m.type === 'SALIDA').reduce((s, m) => s + m.quantity, 0),
      recentMovements: [...movements].map(withUserAndMaterial).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10),
      lowStockMaterials: materials.map(withCategory).filter((m) => m.status === 'BAJO' || m.status === 'AGOTADO').sort((a, b) => a.stock - b.stock).slice(0, 10),
      totalTools: cloudData.tools.length,
      toolsMantenimiento: cloudData.tools.filter((t) => t.state === 'MANTENIMIENTO' || t.state === 'MALA').length,
    };
  }
  if (path === '/reports/low-stock') {
    return cloudData.materials.map(withCategory).filter((m) => m.stock <= m.stock_minimo || m.stock === 0).sort((a, b) => a.stock - b.stock);
  }
  if (path.startsWith('/reports/kardex/')) {
    const id = Number(path.split('/').pop());
    const material = cloudData.materials.find((m) => m.id === id);
    if (!material) throw new Error('Material no encontrado');
    const rows = cloudData.movements.filter((m) => m.material_id === id)
      .map(withUserAndMaterial)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let saldo = 0;
    const kardex = rows.map((row) => {
      if (row.type === 'ENTRADA') saldo += row.quantity;
      else if (row.type === 'SALIDA') saldo -= row.quantity;
      else if (row.type === 'AJUSTE') saldo = row.quantity;
      return { ...row, saldo_resultante: saldo };
    });
    return { material: withCategory(material), kardex };
  }
  if (path === '/reports/summary') {
    const dash = localApiGet('/dashboard');
    return { totalMaterials: dash.totalMaterials, activeMaterials: dash.activeMaterials, lowStock: dash.lowStock, agotados: dash.agotados, totalEntradas: dash.totalEntradas, totalSalidas: dash.totalSalidas };
  }
  if (path === '/reports/tools-summary') {
    const tools = cloudData.tools;
    return {
      total: tools.length,
      buenas: tools.filter((t) => t.state === 'BUENA').length,
      regulares: tools.filter((t) => t.state === 'REGULAR').length,
      malas: tools.filter((t) => t.state === 'MALA').length,
      mantenimiento: tools.filter((t) => t.state === 'MANTENIMIENTO').length,
    };
  }
  if (path.startsWith('/tools')) {
    const [base, queryString] = path.split('?');
    if (base.endsWith('/movements')) {
      const toolId = Number(base.split('/')[2]);
      return cloudData.tool_movements.filter((m) => m.tool_id === toolId)
        .map((m) => ({ ...m, user_name: (cloudData.users.find((u) => u.id === m.user_id) || {}).full_name }))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    const params = new URLSearchParams(queryString || '');
    let items = [...cloudData.tools];
    const q = params.get('q');
    if (q) items = items.filter((t) => normalizeSearchText(t.code + ' ' + t.name + ' ' + (t.brand || '')).includes(normalizeSearchText(q)));
    const toolState = params.get('state');
    if (toolState) items = items.filter((t) => t.state === toolState);
    const location = params.get('location');
    if (location) items = items.filter((t) => normalizeSearchText(t.location).includes(normalizeSearchText(location)));
    return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  if (path === '/versioning') {
    return { enabled: false };
  }
  throw new Error('Ruta no soportada: ' + path);
}

async function localApi(path, method, body) {
  if (method === 'GET') {
    return localApiGet(path);
  }

  const saveAnd = async (data) => { await cloudSave(); return data; };

  // USERS
  if (path === '/users' && method === 'POST') {
    if (cloudData.users.some((u) => u.username === String(body.username).trim())) throw new Error('El nombre de usuario ya existe');
    const user = {
      id: nextId(cloudData.users),
      username: String(body.username).trim(),
      password_hash: await sha256(body.password),
      full_name: String(body.full_name).trim(),
      role: body.role === 'RECTOR' ? 'RECTOR' : body.role === 'ALMACENISTA' ? 'ALMACENISTA' : 'ADMIN',
      is_active: body.is_active === false ? 0 : 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    cloudData.users.push(user);
    markCreated('users', user.id);
    return saveAnd({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, is_active: user.is_active, created_at: user.created_at });
  }
  if (path.startsWith('/users/') && method === 'PUT') {
    const id = Number(path.split('/').pop());
    const user = cloudData.users.find((u) => u.id === id);
    if (!user) throw new Error('Usuario no encontrado');
    if (body.username && cloudData.users.some((u) => u.username === String(body.username).trim() && u.id !== id)) throw new Error('El nombre de usuario ya existe');
    user.username = body.username ? String(body.username).trim() : user.username;
    user.full_name = body.full_name ? String(body.full_name).trim() : user.full_name;
    user.role = ['ADMIN', 'ALMACENISTA', 'RECTOR'].includes(body.role) ? body.role : user.role;
    user.is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;
    if (body.password && String(body.password).trim()) user.password_hash = await sha256(body.password);
    user.updated_at = new Date().toISOString();
    return saveAnd({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, is_active: user.is_active, created_at: user.created_at });
  }
  if (path.startsWith('/users/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const user = cloudData.users.find((u) => u.id === id);
    if (!user) throw new Error('Usuario no encontrado');
    if (user.role === 'ADMIN' && user.is_active === 1 && cloudData.users.filter((u) => u.role === 'ADMIN' && u.is_active === 1).length <= 1) throw new Error('No se puede dejar sin administradores activos');
    if (cloudData.movements.some((m) => m.user_id === id)) throw new Error('No se puede eliminar un usuario con movimientos registrados');
    cloudData.users = cloudData.users.filter((u) => u.id !== id);
    markDeleted('users', id); // tumba: no resucita al sincronizar
    return saveAnd({ deleted: true });
  }

  // INSTITUTION
  if (path === '/institution' && method === 'PUT') {
    const inst = cloudData.institution;
    inst.name = body.name && String(body.name).trim() ? String(body.name).trim() : inst.name;
    inst.subtitle = body.subtitle && String(body.subtitle).trim() ? String(body.subtitle).trim() : inst.subtitle;
    inst.logo_data = body.logo_data && typeof body.logo_data === 'string' ? body.logo_data : inst.logo_data;
    inst.brand_logo_data = body.brand_logo_data && typeof body.brand_logo_data === 'string' ? body.brand_logo_data : inst.brand_logo_data;
    inst.updated_at = new Date().toISOString();
    return saveAnd(inst);
  }

  // CATEGORIES
  if (path === '/categories' && method === 'POST') {
    if (!body.name || !String(body.name).trim()) throw new Error('El nombre de la categoría es obligatorio');
    if (cloudData.categories.some((c) => c.name === String(body.name).trim())) throw new Error('La categoría ya existe');
    const category = { id: nextId(cloudData.categories), name: String(body.name).trim(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    cloudData.categories.push(category);
    markCreated('categories', category.id);
    return saveAnd(category);
  }
  if (path.startsWith('/categories/') && method === 'PUT') {
    const id = Number(path.split('/').pop());
    const category = cloudData.categories.find((c) => c.id === id);
    if (!category) throw new Error('Categoría no encontrada');
    if (!body.name || !String(body.name).trim()) throw new Error('El nombre de la categoría es obligatorio');
    const duplicate = cloudData.categories.find((c) => c.name === String(body.name).trim() && c.id !== id);
    if (duplicate) throw new Error('La categoría ya existe');
    category.name = String(body.name).trim();
    category.updated_at = new Date().toISOString(); // desempate de fusión: gana lo editado más reciente
    return saveAnd(category);
  }
  if (path.startsWith('/categories/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const inUse = cloudData.materials.some((m) => m.category_id === id);
    if (inUse) throw new Error('No se puede eliminar una categoría con materiales asociados');
    cloudData.categories = cloudData.categories.filter((c) => c.id !== id);
    markDeleted('categories', id);
    return saveAnd({ deleted: true });
  }

  // MATERIALS
  if (path === '/materials' && method === 'POST') {
    if (cloudData.materials.some((m) => m.code === String(body.code).trim())) throw new Error('El código del material ya existe');
    const category = cloudData.categories.find((c) => c.id === Number(body.category_id));
    if (!category) throw new Error('Categoría no encontrada');
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) throw new Error('El stock actual no puede ser negativo');
    const stockMinimo = Number(body.stock_minimo);
    const material = {
      id: nextId(cloudData.materials),
      code: String(body.code).trim(),
      name: String(body.name).trim(),
      category_id: category.id,
      unit: String(body.unit).trim(),
      stock,
      stock_minimo: stockMinimo,
      location: String(body.location).trim(),
      status: computeStatus(stock, stockMinimo),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    cloudData.materials.push(material);
    markCreated('materials', material.id);
    return saveAnd(withCategory(material));
  }
  if (path.startsWith('/materials/') && method === 'PUT') {
    const id = Number(path.split('/').pop());
    const material = cloudData.materials.find((m) => m.id === id);
    if (!material) throw new Error('Material no encontrado');
    const finalCode = body.code && String(body.code).trim() ? String(body.code).trim() : material.code;
    if (cloudData.materials.some((m) => m.code === finalCode && m.id !== id)) throw new Error('El código del material ya existe');
    material.code = finalCode;
    material.name = body.name && String(body.name).trim() ? String(body.name).trim() : material.name;
    material.category_id = body.category_id ? Number(body.category_id) : material.category_id;
    material.unit = body.unit && String(body.unit).trim() ? String(body.unit).trim() : material.unit;
    const stockMinimo = body.stock_minimo !== undefined && body.stock_minimo !== null ? Number(body.stock_minimo) : material.stock_minimo;
    if (stockMinimo < 0) throw new Error('El stock mínimo no puede ser negativo');
    material.stock_minimo = stockMinimo;
    material.location = body.location && String(body.location).trim() ? String(body.location).trim() : material.location;
    material.status = computeStatus(material.stock, material.stock_minimo);
    material.updated_at = new Date().toISOString();
    return saveAnd(withCategory(material));
  }
  if (path.startsWith('/materials/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    if (cloudData.movements.some((m) => m.material_id === id)) throw new Error('No se puede eliminar un material con movimientos registrados');
    cloudData.materials = cloudData.materials.filter((m) => m.id !== id);
    markDeleted('materials', id);
    return saveAnd({ deleted: true });
  }

  // MOVEMENTS
  if (path === '/movements' && method === 'POST') {
    const material = cloudData.materials.find((m) => m.id === Number(body.material_id));
    if (!material) throw new Error('Material no encontrado');
    if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(body.type)) throw new Error('Tipo de movimiento inválido');
    const qty = Number(body.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('La cantidad debe ser mayor que cero');
    let updatedStock = material.stock;
    if (body.type === 'ENTRADA') updatedStock = material.stock + qty;
    else if (body.type === 'SALIDA') {
      if (qty > material.stock) throw new Error('No hay suficiente stock para esta salida');
      updatedStock = material.stock - qty;
    } else if (body.type === 'AJUSTE') updatedStock = qty;
    const movement = {
      id: nextId(cloudData.movements),
      material_id: material.id,
      type: body.type,
      quantity: qty,
      unit_cost: Number(body.unit_cost || 0),
      reference: body.reference || null,
      responsible: body.responsible || null,
      observation: body.observation || null,
      user_id: state.user.id,
      created_at: new Date().toISOString(),
    };
    cloudData.movements.push(movement);
    markCreated('movements', movement.id);
    material.stock = updatedStock;
    material.status = computeStatus(updatedStock, material.stock_minimo);
    material.updated_at = new Date().toISOString();
    return saveAnd({ movementId: movement.id });
  }
  if (path.startsWith('/movements/') && method === 'PUT') {
    const id = Number(path.split('/').pop());
    const movement = cloudData.movements.find((m) => m.id === id);
    if (!movement) throw new Error('Movimiento no encontrado');
    if (movement.type === 'AJUSTE') throw new Error('No se puede editar un ajuste desde este módulo');
    const newMaterialId = Number(body.material_id);
    if (!Number.isInteger(newMaterialId) || newMaterialId <= 0) throw new Error('Movimiento o material inválido');
    if (movement.material_id === newMaterialId) return saveAnd({ updated: true });
    const newMaterial = cloudData.materials.find((m) => m.id === newMaterialId);
    if (!newMaterial) throw new Error('Material no encontrado');
    const oldMaterial = cloudData.materials.find((m) => m.id === movement.material_id);
    const oldStock = movement.type === 'ENTRADA' ? oldMaterial.stock - movement.quantity : oldMaterial.stock + movement.quantity;
    const newStock = movement.type === 'ENTRADA' ? newMaterial.stock + movement.quantity : newMaterial.stock - movement.quantity;
    if (oldStock < 0) throw new Error('No se puede cambiar el material porque dejaría un stock negativo');
    if (newStock < 0) throw new Error('No hay suficiente stock en el nuevo material para esta salida');
    oldMaterial.stock = oldStock;
    oldMaterial.status = computeStatus(oldStock, oldMaterial.stock_minimo);
    newMaterial.stock = newStock;
    newMaterial.status = computeStatus(newStock, newMaterial.stock_minimo);
    movement.material_id = newMaterialId;
    movement.updated_at = new Date().toISOString(); // desempate de fusión
    return saveAnd({ updated: true });
  }
  if (path.startsWith('/movements/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const movement = cloudData.movements.find((m) => m.id === id);
    if (!movement) throw new Error('Movimiento no encontrado');
    if (movement.type === 'AJUSTE') throw new Error('No se puede eliminar un ajuste desde este módulo');
    const material = cloudData.materials.find((m) => m.id === movement.material_id);
    if (material) {
      let updatedStock = material.stock;
      if (movement.type === 'ENTRADA') updatedStock = Math.max(0, material.stock - movement.quantity);
      if (movement.type === 'SALIDA') updatedStock = material.stock + movement.quantity;
      material.stock = updatedStock;
      material.status = computeStatus(updatedStock, material.stock_minimo);
    }
    cloudData.movements = cloudData.movements.filter((m) => m.id !== id);
    markDeleted('movements', id);
    return saveAnd({ deletedId: id });
  }

  // TOOLS
  if (path === '/tools' && method === 'POST') {
    if (cloudData.tools.some((t) => t.code === String(body.code).trim())) throw new Error('El código de la herramienta ya existe');
    const qty = body.quantity === undefined || body.quantity === null || body.quantity === '' ? 1 : Number(body.quantity);
    if (!Number.isFinite(qty) || qty < 0) throw new Error('La cantidad no puede ser negativa');
    const tool = {
      id: nextId(cloudData.tools),
      code: String(body.code).trim(),
      name: String(body.name).trim(),
      brand: body.brand ? String(body.brand).trim() : null,
      serial: body.serial ? String(body.serial).trim() : null,
      quantity: qty,
      location: String(body.location).trim(),
      state: ['BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO'].includes(body.state) ? body.state : 'BUENA',
      responsible: body.responsible ? String(body.responsible).trim() : null,
      acquisition_date: body.acquisition_date || null,
      cost: body.cost ? Number(body.cost) : 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    cloudData.tools.push(tool);
    markCreated('tools', tool.id);
    const entryId = nextId(cloudData.tool_movements);
    cloudData.tool_movements.push({ id: entryId, tool_id: tool.id, type: 'INGRESO', responsible: tool.responsible, observation: 'Herramienta registrada en el sistema', user_id: state.user.id, created_at: new Date().toISOString() });
    markCreated('tool_movements', entryId);
    return saveAnd(tool);
  }
  if (path.startsWith('/tools/') && method === 'PUT') {
    const parts = path.split('/');
    const id = Number(parts[2]);
    const tool = cloudData.tools.find((t) => t.id === id);
    if (!tool) throw new Error('Herramienta no encontrada');
    const finalCode = body.code && String(body.code).trim() ? String(body.code).trim() : tool.code;
    if (cloudData.tools.some((t) => t.code === finalCode && t.id !== id)) throw new Error('El código de la herramienta ya existe');
    tool.code = finalCode;
    tool.name = body.name && String(body.name).trim() ? String(body.name).trim() : tool.name;
    tool.brand = body.brand !== undefined ? (body.brand ? String(body.brand).trim() : null) : tool.brand;
    tool.serial = body.serial !== undefined ? (body.serial ? String(body.serial).trim() : null) : tool.serial;
    tool.quantity = body.quantity === undefined || body.quantity === null || body.quantity === '' ? tool.quantity : Number(body.quantity);
    if (!Number.isFinite(tool.quantity) || tool.quantity < 0) throw new Error('La cantidad no puede ser negativa');
    tool.location = body.location && String(body.location).trim() ? String(body.location).trim() : tool.location;
    tool.state = ['BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO'].includes(body.state) ? body.state : tool.state;
    tool.responsible = body.responsible !== undefined ? (body.responsible ? String(body.responsible).trim() : null) : tool.responsible;
    tool.acquisition_date = body.acquisition_date !== undefined ? body.acquisition_date || null : tool.acquisition_date;
    tool.cost = body.cost !== undefined && body.cost !== '' ? Number(body.cost) : tool.cost;
    tool.updated_at = new Date().toISOString();
    return saveAnd(tool);
  }
  if (path.startsWith('/tools/') && method === 'DELETE') {
    const id = Number(path.split('/')[2]);
    const removed = cloudData.tool_movements.filter((m) => m.tool_id === id);
    cloudData.tools = cloudData.tools.filter((t) => t.id !== id);
    cloudData.tool_movements = cloudData.tool_movements.filter((m) => m.tool_id !== id);
    markDeleted('tools', id);
    removed.forEach((m) => markDeleted('tool_movements', m.id));
    return saveAnd({ deleted: true });
  }
  if (path.endsWith('/movements') && method === 'POST') {
    const toolId = Number(path.split('/')[2]);
    const tool = cloudData.tools.find((t) => t.id === toolId);
    if (!tool) throw new Error('Herramienta no encontrada');
    if (!['INGRESO', 'PRESTAMO', 'DEVOLUCION', 'REVISION', 'BAJA'].includes(body.type)) throw new Error('Tipo de movimiento inválido');
    const tmId = nextId(cloudData.tool_movements);
    cloudData.tool_movements.push({ id: tmId, tool_id: toolId, type: body.type, responsible: body.responsible || null, observation: body.observation || null, user_id: state.user.id, created_at: new Date().toISOString() });
    markCreated('tool_movements', tmId);
    if (body.type === 'PRESTAMO') tool.responsible = body.responsible || tool.responsible;
    if (body.type === 'DEVOLUCION') tool.responsible = null;
    if (body.type === 'BAJA') tool.state = 'MALA';
    if (body.type === 'REVISION') tool.state = 'MANTENIMIENTO';
    tool.updated_at = new Date().toISOString();
    return saveAnd({ registered: true });
  }

  throw new Error('Operación no soportada: ' + method + ' ' + path);
}


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
  const tasks = [
    loadInstitution(),
    loadDashboard(),
    loadCategories(),
    loadMaterials(),
    loadMovements(),
    loadLowStock(),
    loadTools(),
    ...(state.user && state.user.role === 'ADMIN' ? [loadUsers()] : []),
  ];
  // El sistema debe funcionar aunque algún recurso falle o no haya datos
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) {
    console.warn(`Se cargaron los datos con ${failed} módulo(s) sin respuesta. Se muestran valores vacíos.`);
  }
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
  setSyncOnline(syncConnected);
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
          ${(state.user.role === 'ADMIN' || state.user.role === 'ALMACENISTA') ? '<button class="secondary-btn" id="manage-categories-btn" type="button">Categorías</button><button class="secondary-btn" id="new-category-btn" type="button">Nueva categoría</button>' : ''}
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

    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Material de Ferretería</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-material-btn">IMPRIMIR</button>
          <button class="secondary-btn" id="download-material-pdf-btn">DESCARGAR PDF</button>
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

    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Herramientas</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-tools-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-tools-btn">IMPRIMIR</button>
          <button class="secondary-btn" id="download-tools-pdf-btn">DESCARGAR PDF</button>
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

    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Reporte: Bajas</h3>
        <div class="toolbar">
          <button class="primary-btn" id="export-bajas-excel-btn">EXPORTAR EXCEL</button>
          <button class="secondary-btn" id="print-bajas-btn">IMPRIMIR</button>
          <button class="secondary-btn" id="download-bajas-pdf-btn">DESCARGAR PDF</button>
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

    <div class="panel" style="margin-top:16px;">
      <div class="section-header">
        <h3>Respaldo y recuperación de la información</h3>
      </div>
      <p style="margin-bottom:10px;">
        La sincronización es por <strong>fusión segura</strong>: cada equipo une su información con la nube
        y gana siempre el registro más reciente; <strong>ningún equipo puede borrar lo que otro creó</strong>.
        Antes de cada escritura se guarda una copia automática del estado previo de la nube
        (se conservan las 5 más recientes) y los borrados se marcan para no resucitar.
      </p>
      <div class="form-actions" style="display:flex; flex-wrap:wrap; gap:8px;">
        <button class="primary-btn" id="export-backup-btn" type="button">Descargar respaldo (.json)</button>
        <button class="secondary-btn" id="import-backup-btn" type="button">Importar respaldo (.json)</button>
        <input type="file" id="import-backup-input" accept="application/json,.json" style="display:none;" />
        <button class="secondary-btn" id="refresh-backups-btn" type="button">Actualizar respaldos de la nube</button>
      </div>
      <div id="backup-status" style="margin-top:10px; font-size:0.92em; color:var(--muted);"></div>
      <div id="cloud-backups" style="margin-top:8px;"></div>
    </div>
  `;
}

// ---- Respaldo: descarga / importación / restauración desde la nube ----

function downloadBackupFile() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const payload = JSON.stringify(cloudData, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo-ie-san-miguel-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast('Respaldo descargado correctamente');
}

async function importBackupFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    showToast('El archivo no es un respaldo válido (JSON inválido)');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    showToast('El archivo no tiene el formato de un respaldo');
    return;
  }
  const incoming = countRecords(parsed);
  if (incoming === 0 && !parsed.institution) {
    showToast('El respaldo no contiene información');
    return;
  }
  if (!confirm(`Se fusionarán ${incoming} registro(s) del respaldo con la información actual. Los datos actuales no se pierden. ¿Continuar?`)) return;
  // Fusión: nunca se pisa lo actual; lo del respaldo se suma (más reciente gana)
  cloudData = mergeCloudDocs(parsed, cloudData);
  await cloudSave();
  showToast(`Respaldo importado: ${incoming} registro(s) fusionados`);
  await loadAll();
  renderApp();
}

async function loadCloudBackups() {
  const box = document.getElementById('cloud-backups');
  const status = document.getElementById('backup-status');
  if (status) {
    const last = Number(localStorage.getItem('ie-last-backup') || 0);
    status.textContent = `Registros actuales: ${countRecords(cloudData)} · Último respaldo automático de este equipo: `
      + (last ? new Date(last).toLocaleString() : 'aún no se ha creado uno en este equipo');
  }
  if (!box) return;
  box.innerHTML = 'Cargando respaldos de la nube...';
  try {
    const res = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}/_respaldos.json`);
    const data = await res.json();
    if (!res.ok || (data && data.error)) throw new Error((data && data.error) || 'sin acceso');
    const clean = sanitizeBackups(data); // ignora claves de prueba o corruptas
    const keys = Object.keys(clean).sort().reverse();
    state.backupsCache = clean;
    if (keys.length === 0) {
      box.innerHTML = '<p style="color:var(--muted);">Todavía no hay respaldos automáticos en la nube. Se crean solos antes de escrituras con riesgo y cada 24 horas.</p>';
      return;
    }
    box.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha del respaldo</th><th>Registros</th><th>Acción</th></tr></thead>
          <tbody>
            ${keys.map((k) => {
              const snap = clean[k];
              const date = k.startsWith('resp-') && !isNaN(Number(k.slice(5))) ? new Date(Number(k.slice(5))) : new Date(k);
              const label = isNaN(date.getTime()) ? k : date.toLocaleString();
              return `<tr>
                <td>${escapeHtml(label)}</td>
                <td>${countRecords(snap)}</td>
                <td><button class="secondary-btn restore-backup-btn" data-key="${escapeHtml(k)}" type="button">Restaurar</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--muted); font-size:0.9em; margin-top:8px;">
        Restaurar = volver a poner los registros de esa copia sin borrar nada de lo actual.
      </p>`;
    box.querySelectorAll('.restore-backup-btn').forEach((btn) => {
      btn.addEventListener('click', () => restoreCloudBackup(btn.dataset.key));
    });
  } catch (error) {
    box.innerHTML = `<p style="color:var(--muted);">No se pudieron leer los respaldos de la nube: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

function restoreCloudBackup(key) {
  const backup = state.backupsCache && state.backupsCache[key];
  if (!backup) { showToast('Respaldo no disponible'); return; }
  const incoming = countRecords(backup);
  if (!confirm(`Restaurar ${incoming} registro(s) de este respaldo?\n\nNo se borra nada actual: solo vuelven los registros que ya no existen. Los datos más recientes se conservan.`)) return;
  // Restauración explícita: se limpian las tumbas de los registros que
  // aparecen en el respaldo (estaban vivos cuando se tomó la copia).
  const tombs = cloudData._borrados || {};
  SYNC_COLLECTIONS.forEach((coll) => {
    (Array.isArray(backup[coll]) ? backup[coll] : []).forEach((rec) => {
      if (rec && rec.id !== undefined) delete tombs[tombKey(coll, rec.id)];
    });
  });
  cloudData._borrados = tombs;
  cloudData = mergeCloudDocs(backup, cloudData);
  cloudSave().then(() => {
    showToast(`Respaldo restaurado: ${incoming} registro(s) recuperados`);
    loadCloudBackups();
    if (localStorage.getItem('token')) {
      loadAll().then(() => renderApp()).catch(() => {});
    }
  });
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
        <p>Proyecto conectado al repositorio de GitHub:</p>
        <table>
          <tbody>
            <tr><td><strong>Repositorio</strong></td><td><a href="https://github.com/jchodigital-cell/ie-san-miguel-inventario" target="_blank" style="color:var(--primary);">https://github.com/jchodigital-cell/ie-san-miguel-inventario</a></td></tr>
            <tr><td><strong>Rama</strong></td><td><code>main</code></td></tr>
            <tr><td><strong>Despliegue (Pages)</strong></td><td><a href="https://jchodigital-cell.github.io/ie-san-miguel-inventario/" target="_blank" style="color:var(--primary);">https://jchodigital-cell.github.io/ie-san-miguel-inventario/</a></td></tr>
          </tbody>
        </table>
        <p>Para ver los últimos commits y publicar cambios, usa:</p>
        <pre class="code-block">git add .
git commit -m "Descripción del cambio"
git push origin main</pre>
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
  document.getElementById('manage-categories-btn')?.addEventListener('click', openCategoriesModal);
  document.getElementById('new-user-btn')?.addEventListener('click', openUserModal);
  document.getElementById('new-movement-btn')?.addEventListener('click', (e) => openMovementModal(e.target.dataset.type));
  document.getElementById('export-excel-btn')?.addEventListener('click', exportExcel);
  document.getElementById('print-material-btn')?.addEventListener('click', printMaterialPdf);
  document.getElementById('download-material-pdf-btn')?.addEventListener('click', downloadMaterialPdf);
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
  document.getElementById('print-tools-btn')?.addEventListener('click', printToolsPdf);
  document.getElementById('download-tools-pdf-btn')?.addEventListener('click', downloadToolsPdf);
  document.getElementById('export-bajas-excel-btn')?.addEventListener('click', exportBajasExcel);
  document.getElementById('print-bajas-btn')?.addEventListener('click', printBajasPdf);
  document.getElementById('download-bajas-pdf-btn')?.addEventListener('click', downloadBajasPdf);
  document.getElementById('institution-form')?.addEventListener('submit', handleInstitutionSubmit);
  document.getElementById('logo-input')?.addEventListener('change', readLogoFile);
  document.getElementById('brand-logo-input')?.addEventListener('change', readBrandLogoFile);
  document.getElementById('export-backup-btn')?.addEventListener('click', downloadBackupFile);
  document.getElementById('import-backup-btn')?.addEventListener('click', () => document.getElementById('import-backup-input')?.click());
  document.getElementById('import-backup-input')?.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importBackupFile(file).catch((err) => showToast('Error al importar: ' + (err.message || err)));
    event.target.value = '';
  });
  document.getElementById('refresh-backups-btn')?.addEventListener('click', loadCloudBackups);
  if (document.getElementById('cloud-backups')) loadCloudBackups();
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
  try {
    if (typeof ExcelJS === 'undefined') {
      alert('No se pudo cargar la librería de Excel. Conéctate a internet una vez para instalarla y después el sistema funciona sin internet.');
      return;
    }
    const institution = state.institution;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventario');

    worksheet.mergeCells('A1:I1');
    worksheet.getCell('A1').value = institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:I2');
    worksheet.getCell('A2').value = institution.subtitle;
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    worksheet.getCell('A3').alignment = { horizontal: 'right' };

    const selectedMatIds = new Set(Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => Number(cb.value)));
    const rows = cloudData.materials.filter((m) => selectedMatIds.size === 0 || selectedMatIds.has(m.id)).map((m) => withCategory(m)).map((m) => ({
      code: m.code,
      material: m.name,
      category: m.category_name,
      unit: m.unit,
      stock: m.stock,
      stock_minimo: m.stock_minimo,
      status: m.status,
      location: m.location,
      total_entradas: cloudData.movements.filter((mv) => mv.material_id === m.id && mv.type === 'ENTRADA').reduce((s, mv) => s + mv.quantity, 0),
      total_salidas: cloudData.movements.filter((mv) => mv.material_id === m.id && mv.type === 'SALIDA').reduce((s, mv) => s + mv.quantity, 0),
    }));

    worksheet.columns = [
      { header: 'Código', key: 'code', width: 16 },
      { header: 'Material', key: 'material', width: 26 },
      { header: 'Categoría', key: 'category', width: 18 },
      { header: 'Unidad', key: 'unit', width: 12 },
      { header: 'Stock', key: 'stock', width: 12 },
      { header: 'Stock mínimo', key: 'stock_minimo', width: 16 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Ubicación', key: 'location', width: 18 },
      { header: 'Total entradas', key: 'total_entradas', width: 16 },
      { header: 'Total salidas', key: 'total_salidas', width: 16 },
    ];
    worksheet.addRows(rows);
    worksheet.getRow(4).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Inventario_San_Miguel.xlsx';
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    alert('Error al exportar Excel: ' + error.message);
  }
}

async function exportToolsExcel() {
  try {
    if (typeof ExcelJS === 'undefined') {
      alert('No se pudo cargar la librería de Excel. Conéctate a internet una vez para instalarla y después el sistema funciona sin internet.');
      return;
    }
    const ids = new Set(Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => Number(cb.value)));
    const items = cloudData.tools.filter((t) => ids.has(t.id));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Herramientas');

    worksheet.mergeCells('A1:J1');
    worksheet.getCell('A1').value = state.institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.mergeCells('A2:J2');
    worksheet.getCell('A2').value = 'Reporte de Herramientas';
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.columns = [
      { header: 'Código', key: 'code', width: 16 },
      { header: 'Nombre', key: 'name', width: 26 },
      { header: 'Marca', key: 'brand', width: 16 },
      { header: 'Serial', key: 'serial', width: 18 },
      { header: 'Cantidad', key: 'quantity', width: 12 },
      { header: 'Estado', key: 'state', width: 14 },
      { header: 'Ubicación', key: 'location', width: 18 },
      { header: 'Responsable', key: 'responsible', width: 24 },
      { header: 'Fecha compra', key: 'acquisition_date', width: 16 },
      { header: 'Costo', key: 'cost', width: 16 },
    ];
    items.forEach((t) => worksheet.addRow({ code: t.code, name: t.name, brand: t.brand, serial: t.serial, quantity: t.quantity, state: t.state, location: t.location, responsible: t.responsible, acquisition_date: t.acquisition_date, cost: t.cost }));
    worksheet.getRow(3).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Herramientas_San_Miguel.xlsx';
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    alert('Error al exportar Excel: ' + error.message);
  }
}

function buildPrintableHtml(title, headers, rows) {
  const inst = state.institution || {};
  return `
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
}

function printModule(title, headers, rows) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para exportar PDF.'); return; }
  w.document.open();
  w.document.write(buildPrintableHtml(title, headers, rows));
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 600);
}

// ===== Descarga de PDF (jsPDF) =====
function generatePdfReport(title, headers, rows, fileName) {
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    alert('No se pudo cargar la librería PDF. Verifica tu conexión a internet.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const inst = state.institution || {};
  if (inst.logo_data) {
    try {
      doc.addImage(inst.logo_data, inst.logo_data.startsWith('data:image/png') ? 'PNG' : 'JPEG', margin, y, 50, 50);
    } catch { /* ignorar */ }
  }
  doc.setFontSize(18);
  doc.setTextColor(8, 55, 100);
  doc.text(inst.name || 'Institución Educativa San Miguel', margin + 62, y + 20);
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(title, margin + 62, y + 38);
  y += 70;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Fecha: ${new Date().toLocaleString('es-CO')}`, margin, y);
  y += 18;

  // Encabezados
  doc.setFontSize(8);
  doc.setTextColor(8, 55, 100);
  const colWidth = (pageWidth - margin * 2) / headers.length;
  headers.forEach((h, i) => doc.text(String(h), margin + i * colWidth, y));
  doc.setDrawColor(180);
  doc.line(margin, y + 4, pageWidth - margin, y + 4);
  y += 16;

  doc.setTextColor(40, 40, 40);
  const maxChars = Math.max(10, Math.floor((colWidth - 6) / 4.4));
  rows.forEach((row) => {
    if (y > pageHeight - margin - 20) {
      doc.addPage();
      y = margin;
    }
    row.forEach((cell, i) => {
      let text = String(cell ?? '');
      if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…';
      doc.text(text, margin + i * colWidth, y, { maxWidth: colWidth - 6 });
    });
    y += 14;
  });

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text('Sistema de Inventario · IE San Miguel', margin, pageHeight - margin / 2);
  doc.save(fileName);
}

async function downloadMaterialPdf() {
  const ids = new Set(Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => Number(cb.value)));
  const items = cloudData.materials.map((m) => withCategory(m)).filter((m) => ids.size === 0 || ids.has(m.id));
  const rows = items.map((m) => [m.code, m.name, m.category_name, m.unit, m.stock, m.status, m.location]);
  generatePdfReport('Reporte: Material de Ferretería', ['Código', 'Nombre', 'Categoría', 'Unidad', 'Stock', 'Estado', 'Ubicación'], rows, 'Material_Ferreteria.pdf');
}

async function downloadToolsPdf() {
  const ids = new Set(Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => Number(cb.value)));
  const items = cloudData.tools.filter((t) => ids.size === 0 || ids.has(t.id));
  const rows = items.map((t) => [t.code, t.name, t.brand || '-', t.serial || '-', t.quantity, t.state, t.location, t.responsible || '-']);
  generatePdfReport('Reporte de Herramientas', ['Código', 'Nombre', 'Marca', 'Serial', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows, 'Herramientas.pdf');
}

async function downloadBajasPdf() {
  const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
  const matIds = new Set(checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => Number(cb.value)));
  const toolIds = new Set(checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => Number(cb.value)));
  const mats = cloudData.materials.filter((m) => m.status === 'AGOTADO' && (matIds.size === 0 || matIds.has(m.id)));
  const tools = cloudData.tools.filter((t) => t.state === 'MALA' && (toolIds.size === 0 || toolIds.has(t.id)));
  const rows = [
    ...mats.map((m) => ['MATERIAL', m.code, m.name, m.stock, m.status, m.location, '-']),
    ...tools.map((t) => ['HERRAMIENTA', t.code, t.name, t.quantity, t.state, t.location, t.responsible || '-']),
  ];
  generatePdfReport('Reporte de Bajas', ['Tipo', 'Código', 'Nombre', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows, 'Bajas.pdf');
}

async function exportBajasExcel() {
  try {
    if (typeof ExcelJS === 'undefined') {
      alert('No se pudo cargar la librería de Excel. Conéctate a internet una vez para instalarla y después el sistema funciona sin internet.');
      return;
    }
    const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
    const matIds = new Set(checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => Number(cb.value)));
    const toolIds = new Set(checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => Number(cb.value)));
    const mats = cloudData.materials.filter((m) => m.status === 'AGOTADO' && (matIds.size === 0 || matIds.has(m.id)));
    const tools = cloudData.tools.filter((t) => t.state === 'MALA' && (toolIds.size === 0 || toolIds.has(t.id)));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bajas');
    worksheet.mergeCells('A1:G1');
    worksheet.getCell('A1').value = state.institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.columns = [
      { header: 'Tipo', key: 'tipo', width: 16 },
      { header: 'Código', key: 'code', width: 16 },
      { header: 'Nombre', key: 'name', width: 30 },
      { header: 'Cantidad', key: 'quantity', width: 12 },
      { header: 'Estado', key: 'state', width: 14 },
      { header: 'Ubicación', key: 'location', width: 18 },
      { header: 'Responsable', key: 'responsible', width: 24 },
    ];
    mats.forEach((m) => worksheet.addRow({ tipo: 'MATERIAL', code: m.code, name: m.name, quantity: m.stock, state: m.status, location: m.location, responsible: '-' }));
    tools.forEach((t) => worksheet.addRow({ tipo: 'HERRAMIENTA', code: t.code, name: t.name, quantity: t.quantity, state: t.state, location: t.location, responsible: t.responsible || '-' }));
    worksheet.getRow(2).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Bajas_San_Miguel.xlsx';
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    alert('Error al exportar Excel de bajas: ' + error.message);
  }
}

async function printBajasPdf() {
  const checked = Array.from(document.querySelectorAll('.baja-export-check:checked'));
  const matIds = new Set(checked.filter((cb) => cb.dataset.kind === 'mat').map((cb) => Number(cb.value)));
  const toolIds = new Set(checked.filter((cb) => cb.dataset.kind === 'tool').map((cb) => Number(cb.value)));
  const mats = cloudData.materials.filter((m) => m.status === 'AGOTADO' && (matIds.size === 0 || matIds.has(m.id)));
  const tools = cloudData.tools.filter((t) => t.state === 'MALA' && (toolIds.size === 0 || toolIds.has(t.id)));
  const rows = [
    ...mats.map((m) => ['MATERIAL', m.code, m.name, m.stock, m.status, m.location, '-']),
    ...tools.map((t) => ['HERRAMIENTA', t.code, t.name, t.quantity, t.state, t.location, t.responsible || '-']),
  ];
  printModule('Reporte de Bajas', ['Tipo', 'Código', 'Nombre', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows);
}

async function printToolsPdf() {
  const ids = new Set(Array.from(document.querySelectorAll('.tool-export-check:checked')).map((cb) => Number(cb.value)));
  const items = cloudData.tools.filter((t) => ids.size === 0 || ids.has(t.id));
  const rows = items.map((t) => [t.code, t.name, t.brand || '-', t.serial || '-', t.quantity, t.state, t.location, t.responsible || '-']);
  printModule('Reporte de Herramientas', ['Código', 'Nombre', 'Marca', 'Serial', 'Cantidad', 'Estado', 'Ubicación', 'Responsable'], rows);
}

async function printMaterialPdf() {
  const ids = new Set(Array.from(document.querySelectorAll('.material-export-check:checked')).map((cb) => Number(cb.value)));
  const items = cloudData.materials.map((m) => withCategory(m)).filter((m) => ids.size === 0 || ids.has(m.id));
  const rows = items.map((m) => [m.code, m.name, m.category_name, m.unit, m.stock, m.status, m.location]);
  printModule('Reporte: Material de Ferretería', ['Código', 'Nombre', 'Categoría', 'Unidad', 'Stock', 'Estado', 'Ubicación'], rows);
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

let syncConnected = false;
let lastClients = 0;
let syncPollTimer = null;
let lastLocalChangeAt = 0;

// ===== Mantener el sistema despierto y resiliente =====
let wakeLock = null;
let pollFailures = 0;

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* el navegador no lo soporta: se ignora */ }
}

function handleVisibility() {
  if (document.visibilityState === 'visible') {
    keepAwake();
    refreshFromCloud(); // sincroniza inmediatamente al volver a la pestaña
  }
}

async function refreshFromCloud() {
  if (isPushing) return;
  try {
    // 1) Si hay cambios locales sin internet, primero se envían a la nube.
    //    pushToCloud lee + fusiona + respalda: nunca pisa datos existentes.
    if (pendingChanges > 0) {
      isPushing = true;
      try {
        await pushToCloud();
        markPending(-pendingChanges);
        showToast('Internet restablecido: cambios guardados y sincronizados');
      } catch {
        isPushing = false;
        setSyncOnline(false, ++pollFailures);
        return;
      }
      isPushing = false;
    }

    const response = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
    const data = await response.json();
    if (!response.ok || (data && data.error)) {
      throw new Error((data && data.error) || `HTTP ${response.status}`);
    }
    pollFailures = 0;
    cloudStateVerified = true;
    if (data && data.lastUpdated && data.lastUpdated > localVersion && pendingChanges === 0) {
      if (state.modal) return; // no interrumpir si hay una ventana abierta
      // FUSIÓN en vez de reemplazo: lo local no se descarta nunca
      const merged = mergeCloudDocs(data, cloudData);
      const heal = !docsDataEqual(merged, data); // la nube tiene menos que nosotros
      cloudData = merged;
      localVersion = data.lastUpdated;
      localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
      if (heal) {
        // Autocuración: si la nube perdió registros, se recuperan solos
        await pushToCloud().catch(() => {});
      }
      if (localStorage.getItem('token')) {
        await loadAll();
        renderApp();
        showToast('Sincronizado: cambios recibidos desde otro dispositivo');
      }
    }
    setSyncOnline(true);
  } catch {
    pollFailures += 1;
    setSyncOnline(false, pollFailures);
  }
}

function updateSyncIndicator() {
  if (!syncConnected) return; // se conserva el estado de reconexión
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  if (pendingChanges > 0) {
    el.textContent = `● Sin internet · ${pendingChanges} cambio(s) pendiente(s) de sincronizar`;
    el.className = 'sync-indicator offline';
  } else {
    el.textContent = '● En vivo · sincronizado con la nube';
    el.className = 'sync-indicator online';
  }
}

function setSyncOnline(online, failures = 0) {
  syncConnected = online;
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  if (online) {
    updateSyncIndicator();
    return;
  }
  const cache = (() => { try { return localStorage.getItem('ie-inventario-cache') ? ' · datos guardados en este equipo' : ''; } catch { return ''; } })();
  el.textContent = failures > 2 ? `● Reconectando (intento ${failures})${cache}` : `● Sin conexión a la nube${cache}`;
  el.className = 'sync-indicator offline';
}

function connectSync() {
  if (syncPollTimer) clearInterval(syncPollTimer);
  syncPollTimer = setInterval(refreshFromCloud, 5000); // nunca se duerme la sincronización
  refreshFromCloud();
  keepAwake();
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('focus', refreshFromCloud);
  window.addEventListener('online', refreshFromCloud);
  // Red de seguridad: si el navegador suspende los temporizadores, se reanuda solo
  setInterval(() => {
    if (Date.now() - localVersion > 0 && document.visibilityState === 'visible') {
      const last = Number(sessionStorage.getItem('last-sync-tick') || 0);
      if (Date.now() - last > 20000) sessionStorage.setItem('last-sync-tick', String(Date.now()));
    }
  }, 10000);
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
    await cloudLoad();
    connectSync();
    loadPending();
    if (pendingChanges > 0) {
      showToast('Trabajando sin conexión: los cambios se guardarán en este equipo');
    }
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
