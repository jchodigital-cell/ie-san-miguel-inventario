const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Configuración de conexión MySQL (XAMPP)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ie_san_miguel_inventario',
  connectionLimit: 10,
};

let pool;

async function createPool() {
  pool = mysql.createPool(dbConfig);
  // Verificar conexión
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  return pool;
}

function getPool() {
  if (!pool) {
    throw new Error('Base de datos no inicializada. Llame a initDatabase() primero.');
  }
  return pool;
}

// Función para ejecutar consultas con parámetros
async function query(sql, params = []) {
  const p = getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// Función para ejecutar una consulta y devolver una sola fila
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Función para ejecutar dentro de una transacción
async function transaction(callback) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Cerrar pool
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Estado del material/inventario (análogo a computeStatus de SQLite)
function computeStatus(cantidad, stockMinimo) {
  if (cantidad === 0) return 'BAJA';
  if (cantidad <= stockMinimo) return 'REGULAR';
  return 'BUENO';
}

module.exports = {
  createPool,
  getPool,
  query,
  queryOne,
  transaction,
  closePool,
  computeStatus,
  dbConfig,
};
