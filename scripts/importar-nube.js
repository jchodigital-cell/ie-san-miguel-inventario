// Importa los datos de Firebase (versión web) a la base local SQLite.
// Úsalo para que el PC y el celular tengan la misma información.
// Uso: node scripts/importar-nube.js [herramientas|todo]
const { db, computeStatus } = require('../backend/src/db');

const FIREBASE_URL = 'https://ie-san-miguel-inventario-default-rtdb.firebaseio.com';
const CLOUD_DOC = 'inventario';
const alcance = (process.argv[2] || 'herramientas').toLowerCase();

async function leerNube() {
  const r = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
  const data = await r.json();
  if (!data) throw new Error('No hay datos en Firebase');
  return data;
}

function normalizarHerramientas(tools) {
  return tools.map((t, index) => ({
    id: Number(t.id ?? index + 1),
    code: String(t.code || `HERR-${index + 1}`),
    name: String(t.name || 'Sin nombre'),
    brand: t.brand || null,
    serial: t.serial || null,
    quantity: Number(t.quantity ?? 1),
    location: String(t.location || 'Sin ubicación'),
    state: ['BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO'].includes(t.state) ? t.state : 'BUENA',
    responsible: t.responsible || null,
    acquisition_date: t.acquisition_date || null,
    cost: Number(t.cost || 0),
    created_at: t.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

async function main() {
  const nube = await leerNube();
  const herramientas = normalizarHerramientas(Array.isArray(nube.tools) ? nube.tools : []);
  const movimientosHerramienta = (Array.isArray(nube.tool_movements) ? nube.tool_movements : []).map((m, index) => ({
    id: Number(m.id ?? index + 1),
    tool_id: Number(m.tool_id),
    type: m.type,
    responsible: m.responsible || null,
    observation: m.observation || null,
    user_id: Number(m.user_id) || 1,
    created_at: m.created_at || new Date().toISOString(),
  }));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tool_movements').run();
    db.prepare('DELETE FROM tools').run();
    for (const t of herramientas) {
      db.prepare(`
        INSERT INTO tools (id, code, name, brand, serial, quantity, location, state, responsible, acquisition_date, cost, created_at, updated_at)
        VALUES (@id, @code, @name, @brand, @serial, @quantity, @location, @state, @responsible, @acquisition_date, @cost, @created_at, @updated_at)
      `).run(t);
    }
    for (const m of movimientosHerramienta) {
      const existe = db.prepare('SELECT id FROM tools WHERE id = ?').get(m.tool_id);
      if (!existe) continue;
      db.prepare(`
        INSERT INTO tool_movements (id, tool_id, type, responsible, observation, user_id, created_at)
        VALUES (@id, @tool_id, @type, @responsible, @observation, @user_id, @created_at)
      `).run(m);
    }
  });
  tx();

  if (alcance === 'todo') {
    const categorias = (Array.isArray(nube.categories) ? nube.categories : []).map((c, i) => ({
      id: Number(c.id ?? i + 1), name: c.name, created_at: c.created_at || new Date().toISOString(),
    }));
    const materiales = (Array.isArray(nube.materials) ? nube.materials : []).map((m, i) => ({
      id: Number(m.id ?? i + 1),
      code: m.code, name: m.name,
      category_id: Number(m.category_id) || categorias[0]?.id || 0,
      unit: m.unit || 'unidad',
      stock: Number(m.stock ?? 0),
      stock_minimo: Number(m.stock_minimo ?? 0),
      location: m.location || 'Sin ubicación',
      status: computeStatus(Number(m.stock ?? 0), Number(m.stock_minimo ?? 0)),
      created_at: m.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const movs = (Array.isArray(nube.movements) ? nube.movements : []).map((m, i) => ({
      id: Number(m.id ?? i + 1), material_id: Number(m.material_id), type: m.type,
      quantity: Number(m.quantity ?? 0), unit_cost: Number(m.unit_cost || 0),
      reference: m.reference || null, responsible: m.responsible || null,
      observation: m.observation || null, user_id: Number(m.user_id) || 1,
      created_at: m.created_at || new Date().toISOString(),
    }));
    const tx2 = db.transaction(() => {
      db.prepare('DELETE FROM movements').run();
      db.prepare('DELETE FROM materials').run();
      db.prepare('DELETE FROM categories').run();
      for (const c of categorias) db.prepare('INSERT INTO categories (id, name, created_at) VALUES (@id, @name, @created_at)').run(c);
      for (const m of materiales) {
        db.prepare(`
          INSERT INTO materials (id, code, name, category_id, unit, stock, stock_minimo, location, status, created_at, updated_at)
          VALUES (@id, @code, @name, @category_id, @unit, @stock, @stock_minimo, @location, @status, @created_at, @updated_at)
        `).run(m);
      }
      for (const m of movs) {
        const existe = db.prepare('SELECT id FROM materials WHERE id = ?').get(m.material_id);
        if (!existe) continue;
        db.prepare(`
          INSERT INTO movements (id, material_id, type, quantity, unit_cost, reference, responsible, observation, user_id, created_at)
          VALUES (@id, @material_id, @type, @quantity, @unit_cost, @reference, @responsible, @observation, @user_id, @created_at)
        `).run(m);
      }
    });
    tx2();
    console.log(`Importado: ${categorias.length} categorías, ${materiales.length} materiales, ${movs.length} movimientos.`);
  }

  console.log(`Importado desde Firebase: ${herramientas.length} herramientas y ${movimientosHerramienta.length} movimientos de herramienta.`);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });