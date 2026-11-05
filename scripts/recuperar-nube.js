// ============================================================
// RECUPERACIÓN DE DATOS - IE San Miguel
// Fusiona las 3 fuentes recuperadas y restaura Firebase:
//   1. Base local SQLite (herramientas frescas, importadas hoy)
//   2. Caché del navegador Chrome (categorías, logo, usuario Jcho)
//   3. Exportaciones Excel de materiales (11/09/2026)
// Además guarda un respaldo del estado actual de la nube ANTES
// de escribir, dentro de /inventario/_respaldos.
// Uso: node scripts/recuperar-nube.js [--simular]
// ============================================================
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { db } = require('../backend/src/db');

const FIREBASE_URL = 'https://ie-san-miguel-inventario-default-rtdb.firebaseio.com';
const CLOUD_DOC = 'inventario';
const SIMULAR = process.argv.includes('--simular');

const ROOT = path.join(__dirname, '..');
const CHROME_CACHE = path.join(ROOT, 'data', 'respaldo-navegador-2026-11-04.json');
const EXCEL_DIR = 'C:/Users/jchod/Downloads';

function computeStatus(stock, min) {
  if (stock === 0) return 'AGOTADO';
  if (stock <= min) return 'BAJO';
  return 'NORMAL';
}

function stripLarge(obj) {
  // Quita logos de los respaldos para no inflar la nube
  const copy = JSON.parse(JSON.stringify(obj));
  if (copy.institution) {
    copy.institution.logo_data = null;
    copy.institution.brand_logo_data = null;
  }
  delete copy._respaldos;
  return copy;
}

async function leerNube() {
  const r = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
  if (!r.ok) throw new Error('Nube responde ' + r.status);
  return r.json();
}

// ---------- FUENTE 1: base local SQLite ----------
function fuenteLocal() {
  const institution = db.prepare('SELECT * FROM institution').get();
  const users = db.prepare('SELECT * FROM users').all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const materials = db.prepare('SELECT * FROM materials').all();
  const movements = db.prepare('SELECT * FROM movements').all();
  const tools = db.prepare('SELECT * FROM tools').all();
  const toolMovements = db.prepare('SELECT * FROM tool_movements').all();
  return { institution, users, categories, materials, movements, tools, tool_movements: toolMovements };
}

// ---------- FUENTE 2: caché del navegador ----------
function fuenteNavegador() {
  if (!fs.existsSync(CHROME_CACHE)) return null;
  return JSON.parse(fs.readFileSync(CHROME_CACHE, 'utf8'));
}

// ---------- FUENTE 3: Excel de materiales ----------
async function fuenteExcel() {
  const archivo = path.join(EXCEL_DIR, 'Inventario_San_Miguel (1).xlsx');
  if (!fs.existsSync(archivo)) return { materiales: [], categorias: [] };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(archivo);
  const ws = wb.worksheets[0];
  const materiales = [];
  const categorias = new Set();
  ws.eachRow((row, i) => {
    if (i < 4) return; // encabezados decorativos
    const v = row.values.slice(1); // [code,name,cat,unit,stock,min,status,loc,...]
    const code = String(v[0] || '').trim();
    if (!code || code.toLowerCase() === 'total') return;
    const stock = Number(v[4] || 0);
    const min = Number(v[5] || 0);
    const catName = String(v[2] || 'SIN CATEGORIA').trim();
    categorias.add(catName);
    materiales.push({
      code,
      name: String(v[1] || '').trim(),
      category_name: catName,
      unit: String(v[3] || 'unidad').trim(),
      stock,
      stock_minimo: min,
      status: computeStatus(stock, min),
      location: String(v[7] || 'Sin ubicación').trim(),
    });
  });
  return { materiales, categorias: [...categorias] };
}

function normCat(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function main() {
  console.log('== RECUPERACIÓN IE San Miguel ==');
  const nubeActual = await leerNube();
  console.log('Nube actual:', nubeActual ? Object.keys(nubeActual).join(',') : 'vacía');

  const local = fuenteLocal();
  const nav = fuenteNavegador();
  const excel = await fuenteExcel();
  console.log(`Fuentes: local=${local.tools.length} herramientas, navegador=${nav ? nav.tools.length + ' herramientas' : 'NO'}, excel=${excel.materiales.length} materiales`);

  // ---- Categorías (unión por nombre) ----
  const cats = [];
  const catIndex = new Map(); // nombre normalizado -> id
  const addCat = (name) => {
    const key = normCat(name);
    if (!key) return 0;
    if (catIndex.has(key)) return catIndex.get(key);
    const id = cats.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    cats.push({ id, name: String(name).trim(), created_at: new Date().toISOString() });
    catIndex.set(key, id);
    return id;
  };
  (nav ? nav.categories : []).forEach((c) => addCat(c.name));
  local.categories.forEach((c) => addCat(c.name));
  excel.categorias.forEach((n) => addCat(n));

  // ---- Materiales (unión por código, gana el más reciente) ----
  // Mapa id -> nombre de categoría por fuente, para resolver category_id numérico
  const catNameById = (sourceCats, id) => {
    const found = (sourceCats || []).find((c) => Number(c.id) === Number(id));
    return found ? found.name : null;
  };
  const mats = new Map();
  const putMat = (m, sourceCats) => {
    const key = normCode(m.code);
    if (!key) return;
    const cat = m.category_name || catNameById(sourceCats, m.category_id) || 'SIN CATEGORIA';
    const record = { ...m, category_id: addCat(cat) };
    delete record.category_name;
    const existing = mats.get(key);
    if (!existing) {
      mats.set(key, record);
      return;
    }
    const tNew = Date.parse(m.updated_at || m.created_at || '') || 0;
    const tOld = Date.parse(existing.updated_at || existing.created_at || '') || 0;
    if (tNew >= tOld) mats.set(key, record);
  };
  // Excel primero (Sept 11), luego navegador (09 Oct), luego local (lo más fresco)
  excel.materiales.forEach((m, i) => putMat({
    id: i + 1, code: m.code, name: m.name, unit: m.unit, stock: m.stock,
    stock_minimo: m.stock_minimo, status: m.status, location: m.location,
    category_name: m.category_name,
    created_at: '2026-09-11T16:00:00.000Z', updated_at: '2026-09-11T16:00:00.000Z',
  }, excel.categorias));
  (nav ? nav.materials : []).forEach((m) => putMat(m, nav ? nav.categories : null));
  local.materials.forEach((m) => putMat(m, local.categories));
  // reasignar ids secuenciales
  let mid = 0;
  const materials = [...mats.values()].map((m) => ({ ...m, id: ++mid, status: computeStatus(Number(m.stock || 0), Number(m.stock_minimo || 0)) }));

  // ---- Herramientas y movimientos: local es lo más fresco ----
  const tools = local.tools.map((t) => ({ ...t }));
  const tool_movements = local.tool_movements.map((m) => ({ ...m }));
  const movements = local.movements.map((m) => ({ ...m }));

  // ---- Usuarios: nube actual (los que funcionan) + Jcho/wili del navegador ----
  const users = (nubeActual && Array.isArray(nubeActual.users) ? nubeActual.users : local.users).map((u) => ({ ...u }));
  const userIndex = new Set(users.map((u) => String(u.username).toLowerCase()));
  let uid = users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  (nav ? nav.users : []).forEach((u) => {
    if (!userIndex.has(String(u.username).toLowerCase())) {
      users.push({ ...u, id: ++uid });
      userIndex.add(String(u.username).toLowerCase());
    }
  });

  // ---- Institución: la del navegador si tiene logo, completando con la local ----
  const instNav = nav ? nav.institution : null;
  const instLocal = local.institution;
  let institution;
  if (instNav && instNav.logo_data) {
    institution = { ...instNav };
    if (!institution.brand_logo_data && instLocal && instLocal.brand_logo_data) {
      institution.brand_logo_data = instLocal.brand_logo_data;
    }
  } else {
    institution = {
      id: 1, name: instLocal.name, subtitle: instLocal.subtitle,
      logo_data: instLocal.logo_data || null, brand_logo_data: instLocal.brand_logo_data || null,
      created_at: instLocal.created_at || new Date().toISOString(),
      updated_at: instLocal.updated_at || new Date().toISOString(),
    };
  }

  // ---- Respaldos: conservar los existentes + snapshot del estado actual ----
  const respaldos = (nubeActual && nubeActual._respaldos) ? { ...nubeActual._respaldos } : {};
  const marca = 'pre-recuperacion-' + new Date().toISOString().replace(/[:.]/g, '-');
  respaldos[marca] = stripLarge(nubeActual || {});
  // conservar solo los 5 respaldos más recientes
  const claves = Object.keys(respaldos).sort();
  while (claves.length > 5) delete respaldos[claves.shift()];

  const doc = {
    _respaldos: respaldos,
    institution,
    users,
    categories: cats,
    materials,
    movements,
    tools,
    tool_movements,
    lastUpdated: Date.now(),
  };

  console.log('\n== RESULTADO DE LA FUSIÓN ==');
  console.log('Categorías:', cats.length, '| Materiales:', materials.length, '| Movimientos:', movements.length);
  console.log('Herramientas:', tools.length, '| Mov. herramientas:', tool_movements.length, '| Usuarios:', users.length);
  console.log('Institución:', institution.name, '| logo:', institution.logo_data ? 'SI' : 'NO', '| marca:', institution.brand_logo_data ? 'SI' : 'NO');
  console.log('Respaldos guardados:', Object.keys(respaldos).length);

  const salida = path.join(ROOT, 'data', `respaldo-recuperacion-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(salida, JSON.stringify(doc, null, 2));
  console.log('Copia local del resultado:', salida);

  if (SIMULAR) {
    console.log('\n[simulación] No se escribió en la nube.');
    return;
  }

  const put = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  const txt = await put.text();
  if (!put.ok) throw new Error('Firebase ' + put.status + ': ' + txt);
  console.log('\n✅ Nube restaurada correctamente (' + put.status + ')');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
