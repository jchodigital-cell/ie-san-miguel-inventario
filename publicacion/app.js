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

async function cloudLoad() {
  try {
    const response = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
    const data = await response.json();
    if (data && data.institution) {
      cloudData = data;
      localVersion = data.lastUpdated || 0;
    } else {
      cloudData = await defaultCloudData();
      await cloudSave();
    }
  } catch (error) {
    lastCloudError = error;
    const cached = localStorage.getItem('ie-inventario-cache');
    cloudData = cached ? JSON.parse(cached) : await defaultCloudData();
  }
}

async function cloudSave() {
  cloudData.lastUpdated = Date.now();
  localVersion = cloudData.lastUpdated;
  localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
  lastLocalChangeAt = Date.now();
  try {
    await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloudData),
    });
    lastCloudError = null;
  } catch (error) {
    lastCloudError = error;
  }
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
    const category = { id: nextId(cloudData.categories), name: String(body.name).trim(), created_at: new Date().toISOString() };
    cloudData.categories.push(category);
    return saveAnd(category);
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
    cloudData.tool_movements.push({ id: nextId(cloudData.tool_movements), tool_id: tool.id, type: 'INGRESO', responsible: tool.responsible, observation: 'Herramienta registrada en el sistema', user_id: state.user.id, created_at: new Date().toISOString() });
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
    cloudData.tools = cloudData.tools.filter((t) => t.id !== id);
    cloudData.tool_movements = cloudData.tool_movements.filter((m) => m.tool_id !== id);
    return saveAnd({ deleted: true });
  }
  if (path.endsWith('/movements') && method === 'POST') {
    const toolId = Number(path.split('/')[2]);
    const tool = cloudData.tools.find((t) => t.id === toolId);
    if (!tool) throw new Error('Herramienta no encontrada');
    if (!['INGRESO', 'PRESTAMO', 'DEVOLUCION', 'REVISION', 'BAJA'].includes(body.type)) throw new Error('Tipo de movimiento inválido');
    cloudData.tool_movements.push({ id: nextId(cloudData.tool_movements), tool_id: toolId, type: body.type, responsible: body.responsible || null, observation: body.observation || null, user_id: state.user.id, created_at: new Date().toISOString() });
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
            <tr><th>Código</th><th>Nombre</th><th>Marca</th><th>Cantidad</th><th>Ubicación</th><th>Estado</th><th>Responsable</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${state.tools.map((tool) => `
              <tr>
                <td>${escapeHtml(tool.code)}</td>
                <td>${escapeHtml(tool.name)}</td>
                <td>${escapeHtml(tool.brand || '-')}</td>
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
            `).join('') || '<tr><td colspan="8">No hay herramientas registradas</td></tr>'}
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
  try {
    if (typeof ExcelJS === 'undefined') {
      alert('No se pudo cargar la librería de Excel. Verifica tu conexión a internet.');
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

    const rows = cloudData.materials.map((m) => withCategory(m)).map((m) => ({
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

async function exportPdf() {
  window.print();
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

async function refreshFromCloud() {
  try {
    const response = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
    const data = await response.json();
    if (data && data.lastUpdated && data.lastUpdated > localVersion) {
      if (state.modal) return; // no interrumpir si hay una ventana abierta
      cloudData = data;
      localVersion = data.lastUpdated;
      localStorage.setItem('ie-inventario-cache', JSON.stringify(cloudData));
      if (localStorage.getItem('token')) {
        await loadAll();
        renderApp();
        showToast('Sincronizado: cambios recibidos desde otro dispositivo');
      }
    }
    setSyncOnline(true);
  } catch {
    setSyncOnline(false);
  }
}

function setSyncOnline(online) {
  syncConnected = online;
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  if (online) {
    el.textContent = '● En vivo · sincronizado con la nube';
    el.className = 'sync-indicator online';
  } else {
    el.textContent = '● Sin conexión a la nube';
    el.className = 'sync-indicator offline';
  }
}

function connectSync() {
  if (syncPollTimer) clearInterval(syncPollTimer);
  syncPollTimer = setInterval(refreshFromCloud, 5000);
  refreshFromCloud();
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
