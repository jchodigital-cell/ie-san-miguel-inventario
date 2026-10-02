const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'inventory.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function computeStatus(stock, stockMinimo) {
  if (stock === 0) return 'AGOTADO';
  if (stock <= stockMinimo) return 'BAJO';
  return 'NORMAL';
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS institution (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      logo_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'ALMACENISTA', 'RECTOR')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      unit TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NORMAL',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
      quantity INTEGER NOT NULL,
      unit_cost REAL DEFAULT 0,
      reference TEXT,
      responsible TEXT,
      observation TEXT,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES materials(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      brand TEXT,
      serial TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      location TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'BUENA' CHECK (state IN ('BUENA', 'REGULAR', 'MALA', 'MANTENIMIENTO')),
      responsible TEXT,
      acquisition_date TEXT,
      cost REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tool_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('INGRESO', 'PRESTAMO', 'DEVOLUCION', 'REVISION', 'BAJA')),
      responsible TEXT,
      observation TEXT,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tool_id) REFERENCES tools(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tools_code ON tools(code);
    CREATE INDEX IF NOT EXISTS idx_tool_movements_tool_id ON tool_movements(tool_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_materials_code ON materials(code);
    CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(status);
    CREATE INDEX IF NOT EXISTS idx_movements_material_id ON movements(material_id, created_at DESC);
  `);

  const institutionColumns = db.prepare('PRAGMA table_info(institution)').all();
  if (!institutionColumns.some((column) => column.name === 'brand_logo_data')) {
    db.prepare('ALTER TABLE institution ADD COLUMN brand_logo_data TEXT').run();
  }

  const institution = db.prepare('SELECT * FROM institution WHERE id = 1').get();
  if (!institution) {
    db.prepare(`
      INSERT INTO institution (id, name, subtitle, logo_data)
      VALUES (1, ?, ?, ?)
    `).run(
      'Institución Educativa San Miguel',
      'Sistema de Control de Inventario de Materiales de Ferretería',
      null
    );
  }
}

initializeDatabase();

module.exports = { db, computeStatus, initializeDatabase };
