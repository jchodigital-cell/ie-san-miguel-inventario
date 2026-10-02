const fs = require('fs');
const path = require('path');
const { db, computeStatus } = require('./db');
const { hashPassword } = require('./auth');

function readLogoDataUrl(fileName) {
  const filePath = path.join(__dirname, '../../', fileName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}

function ensureSeed() {
  const institution = db.prepare('SELECT * FROM institution WHERE id = 1').get();
  if (!institution) {
    db.prepare(`
      INSERT INTO institution (id, name, subtitle, logo_data)
      VALUES (1, ?, ?, ?)
    `).run(
      'Institución Educativa San Miguel',
      'Sistema de Control de Inventario de Materiales de Ferretería',
      readLogoDataUrl('Logo IE San Miguel.png')
    );
  }

  // Si la institución aún no tiene logo configurado, usar el logo institucional por defecto
  const current = db.prepare('SELECT logo_data, brand_logo_data FROM institution WHERE id = 1').get();
  if (current && !current.logo_data) {
    db.prepare('UPDATE institution SET logo_data = ? WHERE id = 1').run(readLogoDataUrl('Logo IE San Miguel.png'));
  }
  if (current && !current.brand_logo_data) {
    db.prepare('UPDATE institution SET brand_logo_data = ? WHERE id = 1').run(readLogoDataUrl('Logo Marca Jcho.jpeg'));
  }

  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run('admin', hashPassword('admin123'), 'Administrador Principal', 'ADMIN');
  }

  const almacenistaExists = db.prepare('SELECT id FROM users WHERE username = ?').get('almacenista');
  if (!almacenistaExists) {
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run('almacenista', hashPassword('almacen123'), 'Almacenero', 'ALMACENISTA');
  }

  console.log('Seed completado correctamente. Sistema limpio y listo para registrar datos propios.');
}

ensureSeed();
