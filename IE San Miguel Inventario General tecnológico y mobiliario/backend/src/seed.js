const fs = require('fs');
const path = require('path');
const { query, queryOne, createPool } = require('./db');
const { hashPassword } = require('./auth');

function readLogoDataUrl(fileName) {
  const filePath = path.join(__dirname, '../../../', fileName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}

async function ensureSeed() {
  await createPool();

  // Configurar institución con logos
  const institution = await queryOne('SELECT * FROM institution WHERE id = 1');
  if (!institution) {
    await query(
      `INSERT INTO institution (id, name, subtitle, logo_data, brand_logo_data)
       VALUES (1, ?, ?, ?, ?)`,
      [
        'Institución Educativa San Miguel Payande - San Luis',
        'Sistema de Control General de Inventario Tecnológico y Mobiliario',
        readLogoDataUrl('Logo IE San Miguel.png'),
        readLogoDataUrl('Logo Marca Jcho.jpeg'),
      ]
    );
  } else {
    const current = await queryOne('SELECT logo_data, brand_logo_data FROM institution WHERE id = 1');
    if (current && !current.logo_data) {
      await query('UPDATE institution SET logo_data = ? WHERE id = 1', [readLogoDataUrl('Logo IE San Miguel.png')]);
    }
    if (current && !current.brand_logo_data) {
      await query('UPDATE institution SET brand_logo_data = ? WHERE id = 1', [readLogoDataUrl('Logo Marca Jcho.jpeg')]);
    }
  }

  // Usuario admin por defecto (contraseña: admin123)
  const adminHash = hashPassword('admin123');
  const rectorHash = hashPassword('rector123');
  const almacenistaHash = hashPassword('almacen123');
  const docenteHash = hashPassword('123456');

  const ensureUser = async (username, passwordHash, fullName, role, sedeId, depId) => {
    const exists = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) {
      // Actualizar contraseña y datos si ya existe (por si venía del schema.sql)
      await query(
        `UPDATE users SET password_hash = ?, full_name = ?, role = ?, sede_id = ?, dependencia_id = ?, is_active = 1 WHERE id = ?`,
        [passwordHash, fullName, role, sedeId || null, depId || null, exists.id]
      );
    } else {
      await query(
        `INSERT INTO users (username, password_hash, full_name, role, sede_id, dependencia_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [username, passwordHash, fullName, role, sedeId || null, depId || null]
      );
    }
  };

  await ensureUser('admin', adminHash, 'Administrador Principal', 'ADMIN', null, null);
  await ensureUser('rector', rectorHash, 'Rectoría IE San Miguel', 'RECTOR', null, null);
  await ensureUser('almacenista', almacenistaHash, 'Almacenero General', 'ALMACENISTA', null, null);
  await ensureUser('miller', docenteHash, 'Docente Miller', 'DOCENTE',
    (await queryOne("SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1")).id,
    (await queryOne("SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Miller' LIMIT 1")).id);
  await ensureUser('alba', docenteHash, 'Docente Alba Rocío', 'DOCENTE',
    (await queryOne("SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1")).id,
    (await queryOne("SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Alba Rocío' LIMIT 1")).id);
  await ensureUser('sol', docenteHash, 'Coordinadora Sol', 'DOCENTE',
    (await queryOne("SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1")).id,
    (await queryOne("SELECT id FROM dependencias WHERE nombre = 'Coordinación' AND responsable = 'Coordinadora Sol' LIMIT 1")).id);
  await ensureUser('elkin', docenteHash, 'Docente Elkin', 'DOCENTE',
    (await queryOne("SELECT id FROM sedes WHERE tipo = 'porvenir' LIMIT 1")).id,
    (await queryOne("SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Elkin' LIMIT 1")).id);
  await ensureUser('marcos', docenteHash, 'Docente Marcos', 'DOCENTE',
    (await queryOne("SELECT id FROM sedes WHERE tipo = 'el_salitre' LIMIT 1")).id,
    (await queryOne("SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Marcos' LIMIT 1")).id);

  console.log('✓ Seed completado. Usuarios iniciales creados/actualizados.');
  console.log('  admin / admin123 (ADMIN)');
  console.log('  rector / rector123 (RECTOR)');
  console.log('  almacenista / almacen123 (ALMACENISTA)');
  console.log('  miller / 123456 (DOCENTE - Sala Sistemas Bachiller)');
  console.log('  alba / 123456 (DOCENTE - Sala Sistemas Bachiller)');
  console.log('  sol / 123456 (DOCENTE - Coordinación)');
  console.log('  elkin / 123456 (DOCENTE - Porvenir)');
  console.log('  marcos / 123456 (DOCENTE - El Salitre)');
}

ensureSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error en seed:', err.message);
    process.exit(1);
  });
