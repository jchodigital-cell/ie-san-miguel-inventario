const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

async function initDatabase() {
  console.log('🔧 Inicializando base de datos MySQL (XAMPP)...');

  // Crear pool sin base de datos primero para crearla
  const adminPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: 5,
    multipleStatements: true,
  });

  const dbName = process.env.DB_NAME || 'ie_san_miguel_inventario';

  try {
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✓ Base de datos '${dbName}' lista`);
  } finally {
    await adminPool.end();
  }

  // Conectar a la base de datos con multipleStatements para ejecutar todo el esquema
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    connectionLimit: 10,
    multipleStatements: true,
  });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    // Ejecutar todo el esquema como un bloque (multiple statements)
    await pool.query(schemaSql);
    console.log('✓ Esquema de base de datos aplicado');
    console.log('✓ Datos iniciales insertados');
    console.log('🎉 Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error ejecutando esquema:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

initDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error inicializando base de datos:', err.message);
    process.exit(1);
  });
