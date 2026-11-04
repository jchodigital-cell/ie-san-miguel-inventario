const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { query, queryOne, transaction, computeStatus, closePool } = require('./db');
const {
  authMiddleware,
  requireRole,
  signToken,
  comparePasswords,
  hashPassword,
  requireSedeAccess,
} = require('./auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '../../frontend');
const DATA_DIR = path.join(__dirname, '../../data');

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));


// --- Socket.io: sincronización en tiempo real ---
function notifyDataChanged(scope) {
  io.emit('data:changed', { scope, at: new Date().toISOString() });
}

io.on('connection', (socket) => {
  socket.emit('sync:hello', { clients: io.engine.clientsCount });
  io.emit('sync:clients', { clients: io.engine.clientsCount });
  socket.on('disconnect', () => {
    io.emit('sync:clients', { clients: io.engine.clientsCount });
  });
});

// --- Respuestas helper ---
function successResponse(data) {
  return { success: true, data };
}

function errorResponse(message, status = 400) {
  return { success: false, message };
}

// --- Helpers ---
async function getInstitution() {
  return await queryOne('SELECT * FROM institution WHERE id = 1');
}

function ensureValidPositiveNumber(value, field) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${field} debe ser mayor que cero`);
  }
  return num;
}

// ============================================================================
// RUTAS PÚBLICAS / SALUD
// ============================================================================

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1 AS ok');
    res.json(successResponse({ status: 'ok', database: 'mysql' }));
  } catch (error) {
    res.status(500).json(successResponse({ status: 'error', database: 'mysql', error: error.message }));
  }
});

// ============================================================================
// AUTENTICACIÓN
// ============================================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json(errorResponse('Usuario y contraseña son obligatorios'));
    }

    const user = await queryOne(
      `SELECT id, username, full_name, password_hash, role, sede_id, dependencia_id, is_active
       FROM users
       WHERE username = ?`,
      [String(username).trim()]
    );

    if (!user || !(await comparePasswords(String(password), user.password_hash))) {
      return res.status(401).json(errorResponse('Credenciales inválidas'));
    }

    if (user.is_active === 0) {
      return res.status(403).json(errorResponse('Usuario inactivo'));
    }

    const token = signToken(user);
    return res.json(successResponse({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        sede_id: user.sede_id,
        dependencia_id: user.dependencia_id,
      },
    }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al iniciar sesión'));
  }
});

app.post('/api/auth/verify', authMiddleware, (req, res) => {
  return res.json(successResponse({ valid: true, user: req.user }));
});

// ============================================================================
// INSTITUCIÓN
// ============================================================================

app.get('/api/institution', async (req, res) => {
  try {
    const institution = await getInstitution();
    return res.json(successResponse(institution));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar la institución'));
  }
});

app.put('/api/institution', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, subtitle, logo_data, brand_logo_data } = req.body || {};
    const current = await getInstitution();

    const newName = name && String(name).trim() ? String(name).trim() : current.name;
    const newSubtitle = subtitle && String(subtitle).trim() ? String(subtitle).trim() : current.subtitle;
    const logoValue = logo_data && typeof logo_data === 'string' ? logo_data : current.logo_data;
    const brandLogoValue = brand_logo_data && typeof brand_logo_data === 'string' ? brand_logo_data : current.brand_logo_data;

    await query(
      `UPDATE institution SET name = ?, subtitle = ?, logo_data = ?, brand_logo_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [newName, newSubtitle, logoValue, brandLogoValue]
    );

    notifyDataChanged('institution');
    return res.json(successResponse(await getInstitution()));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al actualizar la institución'));
  }
});

// ============================================================================
// SEDES
// ============================================================================

app.get('/api/sedes', authMiddleware, async (req, res) => {
  try {
    const sedes = await query('SELECT * FROM sedes ORDER BY nombre ASC');
    return res.json(successResponse(sedes));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar sedes'));
  }
});

app.post('/api/sedes', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { nombre, tipo, responsable, descripcion } = req.body || {};
    if (!nombre || !tipo) {
      return res.status(400).json(errorResponse('Nombre y tipo son obligatorios'));
    }
    const result = await query(
      'INSERT INTO sedes (nombre, tipo, responsable, descripcion) VALUES (?, ?, ?, ?)',
      [nombre, tipo, responsable || null, descripcion || null]
    );
    const sede = await queryOne('SELECT * FROM sedes WHERE id = ?', [result.insertId]);
    notifyDataChanged('sedes');
    return res.status(201).json(successResponse(sede));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear sede'));
  }
});

app.put('/api/sedes/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, responsable, descripcion, activo } = req.body || {};
    await query(
      `UPDATE sedes SET nombre = ?, tipo = ?, responsable = ?, descripcion = ?, activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nombre, tipo, responsable, descripcion, activo !== undefined ? activo : 1, Number(id)]
    );
    notifyDataChanged('sedes');
    return res.json(successResponse(await queryOne('SELECT * FROM sedes WHERE id = ?', [Number(id)])));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al actualizar sede'));
  }
});

// ============================================================================
// DEPENDENCIAS
// ============================================================================

app.get('/api/dependencias', authMiddleware, async (req, res) => {
  try {
    const { sede_id } = req.query;
    let sql = `SELECT d.*, s.nombre AS sede_nombre FROM dependencias d JOIN sedes s ON s.id = d.sede_id`;
    const params = [];
    if (sede_id) {
      sql += ' WHERE d.sede_id = ?';
      params.push(sede_id);
    }
    sql += ' ORDER BY d.nombre ASC';
    const dependencias = await query(sql, params);
    return res.json(successResponse(dependencias));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar dependencias'));
  }
});

app.post('/api/dependencias', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { sede_id, nombre, responsable, tipo_dependencia } = req.body || {};
    if (!sede_id || !nombre || !tipo_dependencia) {
      return res.status(400).json(errorResponse('Sede, nombre y tipo de dependencia son obligatorios'));
    }
    const result = await query(
      'INSERT INTO dependencias (sede_id, nombre, responsable, tipo_dependencia) VALUES (?, ?, ?, ?)',
      [sede_id, nombre, responsable || null, tipo_dependencia]
    );
    const dep = await queryOne('SELECT * FROM dependencias WHERE id = ?', [result.insertId]);
    notifyDataChanged('dependencias');
    return res.status(201).json(successResponse(dep));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear dependencia'));
  }
});

// ============================================================================
// ROLES
// ============================================================================

app.get('/api/roles', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const roles = await query('SELECT * FROM roles ORDER BY name ASC');
    return res.json(successResponse(roles));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar roles'));
  }
});

// ============================================================================
// USUARIOS
// ============================================================================

app.get('/api/users', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await query(`
      SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.sede_id, u.dependencia_id,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre, u.created_at
      FROM users u
      LEFT JOIN sedes s ON s.id = u.sede_id
      LEFT JOIN dependencias d ON d.id = u.dependencia_id
      ORDER BY u.created_at DESC
    `);
    return res.json(successResponse(users));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar usuarios'));
  }
});

app.post('/api/users', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { username, password, full_name, role, sede_id, dependencia_id, is_active } = req.body || {};
    if (!username || !password || !full_name || !role) {
      return res.status(400).json(errorResponse('Usuario, contraseña, nombre completo y rol son obligatorios'));
    }

    const existing = await queryOne('SELECT id FROM users WHERE username = ?', [String(username).trim()]);
    if (existing) {
      return res.status(409).json(errorResponse('El nombre de usuario ya existe'));
    }

    const passwordHash = hashPassword(String(password));
    const result = await query(
      `INSERT INTO users (username, password_hash, full_name, role, sede_id, dependencia_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(username).trim(), passwordHash, String(full_name).trim(), role, sede_id || null, dependencia_id || null, is_active === false ? 0 : 1]
    );

    const user = await queryOne(
      `SELECT id, username, full_name, role, sede_id, dependencia_id, is_active, created_at FROM users WHERE id = ?`,
      [result.insertId]
    );
    notifyDataChanged('users');
    return res.status(201).json(successResponse(user));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear usuario'));
  }
});

app.put('/api/users/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, full_name, role, sede_id, dependencia_id, is_active, password } = req.body || {};
    const existing = await queryOne('SELECT * FROM users WHERE id = ?', [Number(id)]);
    if (!existing) {
      return res.status(404).json(errorResponse('Usuario no encontrado'));
    }

    const finalUsername = username && String(username).trim() ? String(username).trim() : existing.username;
    if (existing.username !== finalUsername) {
      const duplicate = await queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [finalUsername, Number(id)]);
      if (duplicate) {
        return res.status(409).json(errorResponse('El nombre de usuario ya existe'));
      }
    }

    if (password && String(password).trim()) {
      await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(String(password)), Number(id)]);
    }

    await query(
      `UPDATE users SET username = ?, full_name = ?, role = ?, sede_id = ?, dependencia_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [finalUsername, String(full_name).trim() || existing.full_name, role || existing.role, sede_id || null, dependencia_id || null, is_active === false ? 0 : 1, Number(id)]
    );

    const updated = await queryOne('SELECT id, username, full_name, role, sede_id, dependencia_id, is_active, created_at FROM users WHERE id = ?', [Number(id)]);
    notifyDataChanged('users');
    return res.json(successResponse(updated));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al actualizar usuario'));
  }
});

app.delete('/api/users/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const existing = await queryOne('SELECT id, role, is_active FROM users WHERE id = ?', [userId]);
    if (!existing) {
      return res.status(404).json(errorResponse('Usuario no encontrado'));
    }
    if (existing.id === req.user.id) {
      return res.status(400).json(errorResponse('No puede eliminar el usuario con el que inició sesión'));
    }

    const movementCount = await queryOne('SELECT COUNT(*) AS count FROM movimientos WHERE user_id = ?', [userId]);
    if (movementCount.count > 0) {
      return res.status(400).json(errorResponse('No se puede eliminar un usuario con movimientos registrados'));
    }

    if (existing.role === 'ADMIN' && existing.is_active) {
      const adminCount = await queryOne("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1");
      if (adminCount.count <= 1) {
        return res.status(400).json(errorResponse('No se puede dejar sin administradores activos'));
      }
    }

    await query('DELETE FROM users WHERE id = ?', [userId]);
    notifyDataChanged('users');
    return res.json(successResponse({ deleted: true }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al eliminar usuario'));
  }
});

// ============================================================================
// CATEGORÍAS
// ============================================================================

app.get('/api/categorias', authMiddleware, async (req, res) => {
  try {
    const { tipo } = req.query;
    let sql = 'SELECT * FROM categorias';
    const params = [];
    if (tipo) {
      sql += ' WHERE tipo = ?';
      params.push(tipo);
    }
    sql += ' ORDER BY nombre ASC';
    const categorias = await query(sql, params);
    return res.json(successResponse(categorias));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar categorías'));
  }
});

app.post('/api/categorias', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), async (req, res) => {
  try {
    const { nombre, descripcion, tipo } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json(errorResponse('El nombre de la categoría es obligatorio'));
    }
    const duplicate = await queryOne('SELECT id FROM categorias WHERE nombre = ?', [String(nombre).trim()]);
    if (duplicate) {
      return res.status(409).json(errorResponse('La categoría ya existe'));
    }
    const result = await query(
      'INSERT INTO categorias (nombre, descripcion, tipo) VALUES (?, ?, ?)',
      [String(nombre).trim(), descripcion || null, tipo || 'ambos']
    );
    const categoria = await queryOne('SELECT * FROM categorias WHERE id = ?', [result.insertId]);
    notifyDataChanged('categorias');
    return res.status(201).json(successResponse(categoria));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear categoría'));
  }
});

// ============================================================================
// INVENTARIO (Tecnológico y Mobiliario)
// ============================================================================

app.get('/api/inventario', authMiddleware, async (req, res) => {
  try {
    const { q, categoria, tipo, estado, sede_id, dependencia_id, stock_min } = req.query;
    let sql = `
      SELECT i.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
    `;
    const conditions = [];
    const params = [];

    // Filtro por sede/dependencia según rol del usuario
    if (req.user.role === 'DOCENTE') {
      conditions.push('(i.sede_id = ? OR ? IS NULL)');
      params.push(req.user.sede_id, req.user.sede_id);
      if (req.user.dependencia_id) {
        conditions.push('i.dependencia_id = ?');
        params.push(req.user.dependencia_id);
      }
    }

    if (q) {
      conditions.push('(LOWER(i.codigo) LIKE ? OR LOWER(i.nombre) LIKE ? OR LOWER(i.marca) LIKE ? OR LOWER(i.serial) LIKE ?)');
      const term = `%${String(q).toLowerCase()}%`;
      params.push(term, term, term, term);
    }
    if (categoria) {
      conditions.push('i.categoria_id = ?');
      params.push(Number(categoria));
    }
    if (tipo) {
      conditions.push('i.tipo = ?');
      params.push(String(tipo));
    }
    if (estado) {
      conditions.push('i.estado = ?');
      params.push(String(estado));
    }
    if (sede_id) {
      conditions.push('i.sede_id = ?');
      params.push(Number(sede_id));
    }
    if (dependencia_id) {
      conditions.push('i.dependencia_id = ?');
      params.push(Number(dependencia_id));
    }
    if (stock_min === 'true') {
      conditions.push('(i.cantidad <= i.stock_minimo OR i.cantidad = 0)');
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY i.created_at DESC';

    const items = await query(sql, params);
    return res.json(successResponse(items));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar inventario'));
  }
});

app.post('/api/inventario', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), async (req, res) => {
  try {
    const {
      codigo, nombre, descripcion, categoria_id, tipo, marca, modelo, serial,
      cantidad, unidad_medida, estado, sede_id, dependencia_id, responsable,
      fecha_adquisicion, costo, stock_minimo, ubicacion, observaciones
    } = req.body || {};

    if (!codigo || !nombre || !categoria_id || !tipo) {
      return res.status(400).json(errorResponse('Código, nombre, categoría y tipo son obligatorios'));
    }

    const existing = await queryOne('SELECT id FROM inventario WHERE codigo = ?', [String(codigo).trim()]);
    if (existing) {
      return res.status(409).json(errorResponse('El código del artículo ya existe'));
    }

    const cant = Number(cantidad) || 0;
    if (cant < 0) {
      return res.status(400).json(errorResponse('La cantidad no puede ser negativa'));
    }

    const finalEstado = estado || computeStatus(cant, Number(stock_minimo) || 0);

    const result = await query(
      `INSERT INTO inventario (codigo, nombre, descripcion, categoria_id, tipo, marca, modelo, serial, cantidad,
        unidad_medida, estado, sede_id, dependencia_id, responsable, fecha_adquisicion, costo,
        stock_minimo, ubicacion, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(codigo).trim(), String(nombre).trim(), descripcion || null, Number(categoria_id), String(tipo),
        marca || null, modelo || null, serial || null, cant, unidad_medida || 'unidad', finalEstado,
        sede_id || null, dependencia_id || null, responsable || null, fecha_adquisicion || null,
        costo ? Number(costo) : 0, stock_minimo !== undefined ? Number(stock_minimo) : 0,
        ubicacion || null, observaciones || null
      ]
    );

    // Registrar movimiento de ingreso
    await query(
      `INSERT INTO item_movements (inventario_id, tipo, responsable, observacion, user_id)
       VALUES (?, 'INGRESO', ?, ?, ?)`,
      [result.insertId, responsable || null, 'Artículo registrado en el inventario', req.user.id]
    );

    const item = await queryOne(
      `SELECT i.*, c.nombre AS categoria_nombre, s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
       FROM inventario i
       JOIN categorias c ON c.id = i.categoria_id
       LEFT JOIN sedes s ON s.id = i.sede_id
       LEFT JOIN dependencias d ON d.id = i.dependencia_id
       WHERE i.id = ?`,
      [result.insertId]
    );

    notifyDataChanged('inventario');
    return res.status(201).json(successResponse(item));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Error al registrar artículo'));
  }
});

app.put('/api/inventario/:id', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), async (req, res) => {
  try {
    const { id } = req.params;
    const item = await queryOne('SELECT * FROM inventario WHERE id = ?', [Number(id)]);
    if (!item) {
      return res.status(404).json(errorResponse('Artículo no encontrado'));
    }

    const {
      codigo, nombre, descripcion, categoria_id, tipo, marca, modelo, serial,
      cantidad, unidad_medida, estado, sede_id, dependencia_id, responsable,
      fecha_adquisicion, costo, stock_minimo, ubicacion, observaciones
    } = req.body || {};

    const finalCode = codigo && String(codigo).trim() ? String(codigo).trim() : item.codigo;
    if (finalCode !== item.codigo) {
      const duplicate = await queryOne('SELECT id FROM inventario WHERE codigo = ? AND id != ?', [finalCode, Number(id)]);
      if (duplicate) {
        return res.status(409).json(errorResponse('El código del artículo ya existe'));
      }
    }

    const cant = cantidad !== undefined ? Number(cantidad) : item.cantidad;
    if (cant < 0) {
      return res.status(400).json(errorResponse('La cantidad no puede ser negativa'));
    }

    const finalEstado = estado || computeStatus(cant, stock_minimo !== undefined ? Number(stock_minimo) : item.stock_minimo);

    await query(
      `UPDATE inventario SET codigo = ?, nombre = ?, descripcion = ?, categoria_id = ?, tipo = ?, marca = ?,
        modelo = ?, serial = ?, cantidad = ?, unidad_medida = ?, estado = ?, sede_id = ?, dependencia_id = ?,
        responsable = ?, fecha_adquisicion = ?, costo = ?, stock_minimo = ?, ubicacion = ?, observaciones = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        finalCode, String(nombre).trim() || item.nombre, descripcion !== undefined ? descripcion : item.descripcion,
        categoria_id || item.categoria_id, tipo || item.tipo, marca !== undefined ? marca : item.marca,
        modelo !== undefined ? modelo : item.modelo, serial !== undefined ? serial : item.serial, cant,
        unidad_medida || item.unidad_medida, finalEstado,
        sede_id !== undefined ? sede_id : item.sede_id,
        dependencia_id !== undefined ? dependencia_id : item.dependencia_id,
        responsable !== undefined ? responsable : item.responsable,
        fecha_adquisicion !== undefined ? fecha_adquisicion : item.fecha_adquisicion,
        costo !== undefined ? Number(costo) : item.costo,
        stock_minimo !== undefined ? Number(stock_minimo) : item.stock_minimo,
        ubicacion !== undefined ? ubicacion : item.ubicacion,
        observaciones !== undefined ? observaciones : item.observaciones,
        Number(id)
      ]
    );

    const updated = await queryOne(
      `SELECT i.*, c.nombre AS categoria_nombre, s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
       FROM inventario i
       JOIN categorias c ON c.id = i.categoria_id
       LEFT JOIN sedes s ON s.id = i.sede_id
       LEFT JOIN dependencias d ON d.id = i.dependencia_id
       WHERE i.id = ?`,
      [Number(id)]
    );

    notifyDataChanged('inventario');
    return res.json(successResponse(updated));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Error al actualizar artículo'));
  }
});

app.delete('/api/inventario/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const item = await queryOne('SELECT id FROM inventario WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json(errorResponse('Artículo no encontrado'));
    }

    const movementCount = await queryOne('SELECT COUNT(*) AS count FROM movimientos WHERE inventario_id = ?', [itemId]);
    if (movementCount.count > 0) {
      return res.status(400).json(errorResponse('No se puede eliminar un artículo con movimientos registrados'));
    }

    await query('DELETE FROM item_movements WHERE inventario_id = ?', [itemId]);
    await query('DELETE FROM inventario WHERE id = ?', [itemId]);
    notifyDataChanged('inventario');
    return res.json(successResponse({ deleted: true }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al eliminar artículo'));
  }
});

// ============================================================================
// MOVIMIENTOS
// ============================================================================

app.post('/api/movimientos', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), async (req, res) => {
  try {
    const {
      inventario_id, tipo, cantidad, unidad_costo, referencia, responsable, observacion,
      sede_origen_id, sede_destino_id, dependencia_origen_id, dependencia_destino_id
    } = req.body || {};

    if (!inventario_id || !tipo || !cantidad) {
      return res.status(400).json(errorResponse('Artículo, tipo y cantidad son obligatorios'));
    }

    if (!['ENTRADA', 'SALIDA', 'AJUSTE', 'TRASLADO', 'PRESTAMO', 'DEVOLUCION'].includes(tipo)) {
      return res.status(400).json(errorResponse('Tipo de movimiento inválido'));
    }

    const qty = Number(cantidad);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json(errorResponse('La cantidad debe ser mayor que cero'));
    }

    const item = await queryOne('SELECT * FROM inventario WHERE id = ?', [Number(inventario_id)]);
    if (!item) {
      return res.status(404).json(errorResponse('Artículo no encontrado'));
    }

    await transaction(async (conn) => {
      let newStock = item.cantidad;

      if (tipo === 'ENTRADA') {
        newStock = item.cantidad + qty;
      } else if (tipo === 'SALIDA') {
        if (qty > item.cantidad) {
          throw new Error('No hay suficiente stock para esta salida');
        }
        newStock = item.cantidad - qty;
      } else if (tipo === 'AJUSTE') {
        newStock = qty;
      } else if (tipo === 'TRASLADO') {
        newStock = item.cantidad - qty;
      }

      const finalEstado = computeStatus(newStock, item.stock_minimo);

      await conn.execute(
        `UPDATE inventario SET cantidad = ?, estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStock, finalEstado, Number(inventario_id)]
      );

      await conn.execute(
        `INSERT INTO movimientos (inventario_id, tipo, cantidad, unidad_costo, referencia, responsable,
          observacion, sede_origen_id, sede_destino_id, dependencia_origen_id, dependencia_destino_id, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(inventario_id), tipo, qty, Number(unidad_costo || 0), referencia || null,
          responsable || null, observacion || null,
          sede_origen_id || null, sede_destino_id || null,
          dependencia_origen_id || null, dependencia_destino_id || null,
          req.user.id
        ]
      );

      await conn.execute(
        `INSERT INTO item_movements (inventario_id, tipo, responsable, observacion, user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [Number(inventario_id), tipo, responsable || null, observacion || null, req.user.id]
      );
    });

    notifyDataChanged('movimientos');
    notifyDataChanged('inventario');
    return res.status(201).json(successResponse({ registered: true }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Error al registrar movimiento'));
  }
});

app.get('/api/movimientos', authMiddleware, async (req, res) => {
  try {
    const { inventario_id, tipo, sede_id } = req.query;
    let sql = `
      SELECT m.*, i.codigo, i.nombre AS articulo_nombre, i.tipo AS articulo_tipo,
             u.full_name AS user_name,
             so.nombre AS sede_origen_nombre, sd.nombre AS sede_destino_nombre,
             do_nombre AS dependencia_origen_nombre, dd_nombre AS dependencia_destino_nombre
      FROM movimientos m
      JOIN inventario i ON i.id = m.inventario_id
      JOIN users u ON u.id = m.user_id
      LEFT JOIN sedes so ON so.id = m.sede_origen_id
      LEFT JOIN sedes sd ON sd.id = m.sede_destino_id
      LEFT JOIN dependencias do ON do.id = m.dependencia_origen_id
      LEFT JOIN dependencias dd ON dd.id = m.dependencia_destino_id
    `;
    const conditions = [];
    const params = [];

    if (inventario_id) {
      conditions.push('m.inventario_id = ?');
      params.push(Number(inventario_id));
    }
    if (tipo) {
      conditions.push('m.tipo = ?');
      params.push(String(tipo));
    }
    if (sede_id) {
      conditions.push('(m.sede_origen_id = ? OR m.sede_destino_id = ?)');
      params.push(Number(sede_id), Number(sede_id));
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY m.created_at DESC';

    const movimientos = await query(sql, params);
    return res.json(successResponse(movimientos));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar movimientos'));
  }
});

// ============================================================================
// ITEM MOVEMENTS (historial por artículo)
// ============================================================================

app.get('/api/inventario/:id/movements', authMiddleware, async (req, res) => {
  try {
    const rows = await query(`
      SELECT im.*, u.full_name AS user_name
      FROM item_movements im
      LEFT JOIN users u ON u.id = im.user_id
      WHERE im.inventario_id = ?
      ORDER BY im.created_at DESC
    `, [Number(req.params.id)]);
    return res.json(successResponse(rows));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar historial del artículo'));
  }
});

// ============================================================================
// DASHBOARD
// ============================================================================

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const totalItems = await queryOne('SELECT COUNT(*) AS total FROM inventario');
    const itemsBueno = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'BUENO'");
    const itemsRegular = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'REGULAR'");
    const itemsMalo = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'MALO'");
    const itemsBaja = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'BAJA'");
    const itemsMantenimiento = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'MANTENIMIENTO'");
    const totalTecnologico = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE tipo = 'tecnologico'");
    const totalMobiliario = await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE tipo = 'mobiliario'");

    const totalEntradas = await queryOne("SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos WHERE tipo = 'ENTRADA'");
    const totalSalidas = await queryOne("SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos WHERE tipo = 'SALIDA'");

    const lowStock = await query(`
      SELECT i.*, c.nombre AS categoria_nombre, s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.cantidad <= i.stock_minimo OR i.cantidad = 0
      ORDER BY i.cantidad ASC
      LIMIT 10
    `);

    const recentMovements = await query(`
      SELECT m.*, i.codigo, i.nombre AS articulo_nombre, u.full_name AS user_name
      FROM movimientos m
      JOIN inventario i ON i.id = m.inventario_id
      JOIN users u ON u.id = m.user_id
      ORDER BY m.created_at DESC
      LIMIT 10
    `);

    // Por sede
    const porSede = await query(`
      SELECT s.nombre AS sede, COUNT(i.id) AS total
      FROM sedes s
      LEFT JOIN inventario i ON i.sede_id = s.id
      GROUP BY s.id
      ORDER BY total DESC
    `);

    return res.json(successResponse({
      totalItems: totalItems.total,
      itemsBueno: itemsBueno.total,
      itemsRegular: itemsRegular.total,
      itemsMalo: itemsMalo.total,
      itemsBaja: itemsBaja.total,
      itemsMantenimiento: itemsMantenimiento.total,
      totalTecnologico: totalTecnologico.total,
      totalMobiliario: totalMobiliario.total,
      totalEntradas: totalEntradas.total,
      totalSalidas: totalSalidas.total,
      lowStock,
      recentMovements,
      porSede,
    }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al obtener el dashboard'));
  }
});

// ============================================================================
// REPORTES
// ============================================================================

app.get('/api/reports/summary', authMiddleware, async (req, res) => {
  try {
    const summary = {
      totalItems: (await queryOne('SELECT COUNT(*) AS total FROM inventario')).total,
      itemsBueno: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'BUENO'")).total,
      itemsRegular: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'REGULAR'")).total,
      itemsMalo: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'MALO'")).total,
      itemsBaja: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE estado = 'BAJA'")).total,
      totalTecnologico: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE tipo = 'tecnologico'")).total,
      totalMobiliario: (await queryOne("SELECT COUNT(*) AS total FROM inventario WHERE tipo = 'mobiliario'")).total,
      totalEntradas: (await queryOne("SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos WHERE tipo = 'ENTRADA'")).total,
      totalSalidas: (await queryOne("SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos WHERE tipo = 'SALIDA'")).total,
    };
    return res.json(successResponse(summary));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al generar resumen'));
  }
});

app.get('/api/reports/export/excel', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { ids, tipo, estado, sede_id } = req.query;

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.descripcion, c.nombre AS categoria, i.tipo,
             i.marca, i.modelo, i.serial, i.cantidad, i.unidad_medida, i.estado,
             i.sede_id, i.dependencia_id, i.responsable, i.fecha_adquisicion, i.costo,
             i.stock_minimo, i.ubicacion, i.observaciones,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
    `;
    const conditions = [];
    const params = [];

    if (tipo) { conditions.push('i.tipo = ?'); params.push(tipo); }
    if (estado) { conditions.push('i.estado = ?'); params.push(estado); }
    if (sede_id) { conditions.push('i.sede_id = ?'); params.push(Number(sede_id)); }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY i.nombre ASC';

    const rows = await query(sql, params);
    const filtered = ids
      ? rows.filter((r) => String(ids).split(',').map(Number).includes(r.id))
      : rows;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventario General');

    worksheet.mergeCells('A1:R1');
    worksheet.getCell('A1').value = institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:R2');
    worksheet.getCell('A2').value = institution.subtitle;
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:R3');
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    worksheet.getCell('A3').alignment = { horizontal: 'right' };

    worksheet.columns = [
      { header: 'Código', key: 'codigo', width: 16 },
      { header: 'Artículo', key: 'articulo', width: 26 },
      { header: 'Descripción', key: 'descripcion', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Modelo', key: 'modelo', width: 16 },
      { header: 'Serial', key: 'serial', width: 18 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Unidad', key: 'unidad_medida', width: 12 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Sede', key: 'sede_nombre', width: 20 },
      { header: 'Dependencia', key: 'dependencia_nombre', width: 22 },
      { header: 'Responsable', key: 'responsable', width: 20 },
      { header: 'Fecha Adq.', key: 'fecha_adquisicion', width: 16 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Stock Mín.', key: 'stock_minimo', width: 12 },
      { header: 'Ubicación', key: 'ubicacion', width: 18 },
    ];

    worksheet.addRows(filtered);
    worksheet.getRow(5).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 4 }];
    worksheet.eachRow((row) => {
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const fileName = 'Inventario_General_IE_San_Miguel.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar Excel'));
  }
});

app.get('/api/reports/export/pdf', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { tipo, estado, sede_id } = req.query;

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.tipo, i.estado, i.cantidad,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre, i.responsable
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
    `;
    const conditions = [];
    const params = [];
    if (tipo) { conditions.push('i.tipo = ?'); params.push(tipo); }
    if (estado) { conditions.push('i.estado = ?'); params.push(estado); }
    if (sede_id) { conditions.push('i.sede_id = ?'); params.push(Number(sede_id)); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY i.nombre ASC';

    const items = await query(sql, params);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Inventario_General_IE_San_Miguel.pdf"');
    doc.pipe(res);

    if (institution.logo_data) {
      try {
        const buffer = Buffer.from(institution.logo_data.split(',')[1], 'base64');
        doc.image(buffer, 40, 40, { width: 50, height: 50 });
      } catch {}
    }

    doc.fontSize(18).font('Helvetica-Bold').text(institution.name, 100, 45);
    doc.fontSize(11).font('Helvetica').text(institution.subtitle, 100, 70);
    doc.fontSize(9).text(`Fecha: ${new Date().toLocaleString('es-ES')}`, 40, 100);

    let y = 130;
    doc.fontSize(12).font('Helvetica-Bold').text('Reporte de Inventario General - Tecnológico y Mobiliario', 40, y);
    y += 20;

    const headers = ['Código', 'Artículo', 'Tipo', 'Estado', 'Cant.', 'Sede', 'Dependencia', 'Responsable'];
    const colX = [40, 100, 220, 280, 330, 360, 440, 540];

    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, colX[i], y, { width: 70, align: 'left' }));
    doc.moveTo(40, y + 10).lineTo(560, y + 10).stroke();
    y += 18;

    doc.font('Helvetica').fontSize(8);
    items.forEach((row) => {
      if (y > 740) { doc.addPage(); y = 50; }
      const values = [
        row.codigo, row.articulo, row.tipo, row.estado, String(row.cantidad),
        row.sede_nombre || '-', row.dependencia_nombre || '-', row.responsable || '-'
      ];
      values.forEach((v, i) => doc.text(String(v || ''), colX[i], y, { width: 70, ellipsis: true }));
      y += 14;
    });

    doc.text('Sistema de Inventario General - IE San Miguel Payande - San Luis', 40, y + 10);
    doc.text('Marca JCHO - Sistema Profesional de Inventario', 400, y + 10);
    doc.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar PDF'));
  }
});

// ============================================================================
// EXPORTAR BAJAS - EXCEL
// ============================================================================

app.get('/api/reports/export/excel-bajas', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { sede_id } = req.query;

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.descripcion, c.nombre AS categoria, i.tipo,
             i.marca, i.modelo, i.serial, i.cantidad, i.unidad_medida, i.estado,
             i.responsable, i.fecha_adquisicion, i.costo,
             i.stock_minimo, i.ubicacion, i.observaciones,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.estado IN ('MALO', 'BAJA')
    `;
    const params = [];

    if (req.user.role === 'DOCENTE') {
      sql += ' AND (i.sede_id = ? OR ? IS NULL)';
      params.push(req.user.sede_id, req.user.sede_id);
      if (req.user.dependencia_id) {
        sql += ' AND i.dependencia_id = ?';
        params.push(req.user.dependencia_id);
      }
    }

    if (sede_id) {
      sql += ' AND i.sede_id = ?';
      params.push(Number(sede_id));
    }

    sql += ' ORDER BY i.estado ASC, i.nombre ASC';

    const rows = await query(sql, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bajas');

    worksheet.mergeCells('A1:R1');
    worksheet.getCell('A1').value = institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:R2');
    worksheet.getCell('A2').value = 'Reporte de Artículos en Baja / Malo';
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:R3');
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    worksheet.getCell('A3').alignment = { horizontal: 'right' };

    worksheet.columns = [
      { header: 'Código', key: 'codigo', width: 16 },
      { header: 'Artículo', key: 'articulo', width: 26 },
      { header: 'Descripción', key: 'descripcion', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Modelo', key: 'modelo', width: 16 },
      { header: 'Serial', key: 'serial', width: 18 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Unidad', key: 'unidad_medida', width: 12 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Sede', key: 'sede_nombre', width: 20 },
      { header: 'Dependencia', key: 'dependencia_nombre', width: 22 },
      { header: 'Responsable', key: 'responsable', width: 20 },
      { header: 'Fecha Adq.', key: 'fecha_adquisicion', width: 16 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Stock Mín.', key: 'stock_minimo', width: 12 },
      { header: 'Ubicación', key: 'ubicacion', width: 18 },
    ];

    worksheet.addRows(rows);
    worksheet.getRow(5).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 4 }];
    worksheet.eachRow((row) => {
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const fileName = 'Bajas_IE_San_Miguel.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar Excel de bajas'));
  }
});

// ============================================================================
// EXPORTAR BAJAS - PDF
// ============================================================================

app.get('/api/reports/export/pdf-bajas', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { sede_id } = req.query;

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.tipo, i.estado, i.cantidad,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre, i.responsable
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.estado IN ('MALO', 'BAJA')
    `;
    const params = [];

    if (req.user.role === 'DOCENTE') {
      sql += ' AND (i.sede_id = ? OR ? IS NULL)';
      params.push(req.user.sede_id, req.user.sede_id);
      if (req.user.dependencia_id) {
        sql += ' AND i.dependencia_id = ?';
        params.push(req.user.dependencia_id);
      }
    }

    if (sede_id) {
      sql += ' AND i.sede_id = ?';
      params.push(Number(sede_id));
    }

    sql += ' ORDER BY i.estado ASC, i.nombre ASC';

    const items = await query(sql, params);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Bajas_IE_San_Miguel.pdf"');
    doc.pipe(res);

    if (institution.logo_data) {
      try {
        const buffer = Buffer.from(institution.logo_data.split(',')[1], 'base64');
        doc.image(buffer, 40, 40, { width: 50, height: 50 });
      } catch {}
    }

    doc.fontSize(18).font('Helvetica-Bold').text(institution.name, 100, 45);
    doc.fontSize(11).font('Helvetica').text(institution.subtitle, 100, 70);
    doc.fontSize(11).font('Helvetica-Bold').text('Reporte de Artículos en Baja / Malo', 100, 90);
    doc.fontSize(9).text(`Fecha: ${new Date().toLocaleString('es-ES')}`, 40, 110);

    let y = 140;
    doc.fontSize(12).font('Helvetica-Bold').text('Reporte de Bajas y Deterioro', 40, y);
    y += 20;

    const headers = ['Código', 'Artículo', 'Tipo', 'Estado', 'Cant.', 'Sede', 'Dependencia', 'Responsable'];
    const colX = [40, 100, 220, 280, 330, 390, 470, 560];

    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, colX[i], y, { width: 70, align: 'left' }));
    doc.moveTo(40, y + 10).lineTo(560, y + 10).stroke();
    y += 18;

    doc.font('Helvetica').fontSize(8);
    items.forEach((row) => {
      if (y > 740) { doc.addPage(); y = 50; }
      const values = [
        row.codigo, row.articulo, row.tipo, row.estado, String(row.cantidad),
        row.sede_nombre || '-', row.dependencia_nombre || '-', row.responsable || '-'
      ];
      values.forEach((v, i) => doc.text(String(v || ''), colX[i], y, { width: 70, ellipsis: true }));
      y += 14;
    });

    doc.text('Sistema de Inventario General - IE San Miguel Payande - San Luis', 40, y + 10);
    doc.text('Marca JCHO - Sistema Profesional de Inventario', 400, y + 10);
    doc.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar PDF de bajas'));
  }
});

// ============================================================================
// ============================================================================
// REPORTE DE BAJAS (artículos en estado MALO o BAJA)
// ============================================================================

app.get('/api/reports/bajas', authMiddleware, async (req, res) => {
  try {
    const { sede_id, tipo } = req.query;
    let sql = `
      SELECT i.*, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
             s.nombre AS sede_nombre, d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN sedes s ON s.id = i.sede_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.estado IN ('MALO', 'BAJA')
    `;
    const params = [];

    if (req.user.role === 'DOCENTE') {
      sql += ' AND (i.sede_id = ? OR ? IS NULL)';
      params.push(req.user.sede_id, req.user.sede_id);
      if (req.user.dependencia_id) {
        sql += ' AND i.dependencia_id = ?';
        params.push(req.user.dependencia_id);
      }
    }

    if (sede_id) {
      sql += ' AND i.sede_id = ?';
      params.push(Number(sede_id));
    }
    if (tipo) {
      sql += ' AND i.tipo = ?';
      params.push(String(tipo));
    }

    sql += ' ORDER BY i.estado ASC, i.nombre ASC';

    const items = await query(sql, params);

    // Resumen por estado
    const resumen = {
      total: items.length,
      malos: items.filter((i) => i.estado === 'MALO').length,
      bajas: items.filter((i) => i.estado === 'BAJA').length,
      tecnologicos: items.filter((i) => i.tipo === 'tecnologico').length,
      mobiliario: items.filter((i) => i.tipo === 'mobiliario').length,
    };

    return res.json(successResponse({ items, resumen }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar bajas'));
  }
});

// ============================================================================
// EXPORTAR INVENTARIO POR SEDE - EXCEL
// ============================================================================

app.get('/api/reports/export/excel-by-sede', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { sede_id } = req.query;

    if (!sede_id) {
      return res.status(400).json(errorResponse('El parámetro sede_id es obligatorio'));
    }

    const sede = await queryOne('SELECT * FROM sedes WHERE id = ?', [Number(sede_id)]);
    if (!sede) {
      return res.status(404).json(errorResponse('Sede no encontrada'));
    }

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.descripcion, c.nombre AS categoria, i.tipo,
             i.marca, i.modelo, i.serial, i.cantidad, i.unidad_medida, i.estado,
             i.responsable, i.fecha_adquisicion, i.costo,
             i.stock_minimo, i.ubicacion, i.observaciones,
             d.nombre AS dependencia_nombre
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.sede_id = ?
    `;
    const params = [Number(sede_id)];

    if (req.user.role === 'DOCENTE') {
      sql += ' AND i.sede_id = ?';
      params.push(req.user.sede_id);
      if (req.user.dependencia_id) {
        sql += ' AND i.dependencia_id = ?';
        params.push(req.user.dependencia_id);
      }
    }

    sql += ' ORDER BY i.nombre ASC';

    const rows = await query(sql, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Inventario ${sede.nombre}`);

    worksheet.mergeCells('A1:Q1');
    worksheet.getCell('A1').value = institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:Q2');
    worksheet.getCell('A2').value = `Sede: ${sede.nombre}`;
    worksheet.getCell('A2').font = { bold: true, size: 12 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:Q3');
    worksheet.getCell('A3').value = institution.subtitle;
    worksheet.getCell('A3').font = { italic: true, size: 10 };
    worksheet.getCell('A3').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A4:Q4');
    worksheet.getCell('A4').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    worksheet.getCell('A4').alignment = { horizontal: 'right' };

    worksheet.columns = [
      { header: 'Código', key: 'codigo', width: 16 },
      { header: 'Artículo', key: 'articulo', width: 26 },
      { header: 'Descripción', key: 'descripcion', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Modelo', key: 'modelo', width: 16 },
      { header: 'Serial', key: 'serial', width: 18 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Unidad', key: 'unidad_medida', width: 12 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Dependencia', key: 'dependencia_nombre', width: 22 },
      { header: 'Responsable', key: 'responsable', width: 20 },
      { header: 'Fecha Adq.', key: 'fecha_adquisicion', width: 16 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Stock Mín.', key: 'stock_minimo', width: 12 },
      { header: 'Ubicación', key: 'ubicacion', width: 18 },
    ];

    worksheet.addRows(rows);
    worksheet.getRow(5).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 4 }];
    worksheet.eachRow((row) => {
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const fileName = `Inventario_Sede_${sede.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar Excel por sede'));
  }
});

// ============================================================================
// EXPORTAR INVENTARIO POR SEDE - PDF
// ============================================================================

app.get('/api/reports/export/pdf-by-sede', authMiddleware, async (req, res) => {
  try {
    const institution = await getInstitution();
    const { sede_id } = req.query;

    if (!sede_id) {
      return res.status(400).json(errorResponse('El parámetro sede_id es obligatorio'));
    }

    const sede = await queryOne('SELECT * FROM sedes WHERE id = ?', [Number(sede_id)]);
    if (!sede) {
      return res.status(404).json(errorResponse('Sede no encontrada'));
    }

    let sql = `
      SELECT i.codigo, i.nombre AS articulo, i.tipo, i.estado, i.cantidad,
             d.nombre AS dependencia_nombre, i.responsable
      FROM inventario i
      JOIN categorias c ON c.id = i.categoria_id
      LEFT JOIN dependencias d ON d.id = i.dependencia_id
      WHERE i.sede_id = ?
    `;
    const params = [Number(sede_id)];

    if (req.user.role === 'DOCENTE') {
      sql += ' AND i.sede_id = ?';
      params.push(req.user.sede_id);
      if (req.user.dependencia_id) {
        sql += ' AND i.dependencia_id = ?';
        params.push(req.user.dependencia_id);
      }
    }

    sql += ' ORDER BY i.nombre ASC';

    const items = await query(sql, params);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Inventario_Sede_${sede.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    doc.pipe(res);

    if (institution.logo_data) {
      try {
        const buffer = Buffer.from(institution.logo_data.split(',')[1], 'base64');
        doc.image(buffer, 40, 40, { width: 50, height: 50 });
      } catch {}
    }

    doc.fontSize(18).font('Helvetica-Bold').text(institution.name, 100, 45);
    doc.fontSize(11).font('Helvetica').text(institution.subtitle, 100, 70);
    doc.fontSize(11).font('Helvetica-Bold').text(`Sede: ${sede.nombre}`, 100, 90);
    doc.fontSize(9).text(`Fecha: ${new Date().toLocaleString('es-ES')}`, 40, 110);

    let y = 140;
    doc.fontSize(12).font('Helvetica-Bold').text('Reporte de Inventario por Sede', 40, y);
    y += 20;

    const headers = ['Código', 'Artículo', 'Tipo', 'Estado', 'Cant.', 'Dependencia', 'Responsable'];
    const colX = [40, 100, 220, 280, 330, 400, 500];

    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, colX[i], y, { width: 70, align: 'left' }));
    doc.moveTo(40, y + 10).lineTo(560, y + 10).stroke();
    y += 18;

    doc.font('Helvetica').fontSize(8);
    items.forEach((row) => {
      if (y > 740) { doc.addPage(); y = 50; }
      const values = [
        row.codigo, row.articulo, row.tipo, row.estado, String(row.cantidad),
        row.dependencia_nombre || '-', row.responsable || '-'
      ];
      values.forEach((v, i) => doc.text(String(v || ''), colX[i], y, { width: 70, ellipsis: true }));
      y += 14;
    });

    doc.text('Sistema de Inventario General - IE San Miguel Payande - San Luis', 40, y + 10);
    doc.text('Marca JCHO - Sistema Profesional de Inventario', 400, y + 10);
    doc.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar PDF por sede'));
  }
});

// VERSIONES / GITHUB (informativo)
// ============================================================================

app.get('/api/versions', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const exec = require('child_process').execSync;
    let branch = 'main';
    let lastCommit = 'No disponible';
    try {
      branch = exec('git branch --show-current', { cwd: path.resolve(__dirname, '../../../') }).toString().trim();
      lastCommit = exec('git log -1 --format="%h %s"', { cwd: path.resolve(__dirname, '../../../') }).toString().trim();
    } catch {}
    return res.json(successResponse({ branch, lastCommit }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar versiones'));
  }
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

async function start() {
  try {
    await require('./db').createPool();
    console.log('✓ Conectado a MySQL (XAMPP)');
  } catch (error) {
    console.warn('⚠️  No se pudo conectar a MySQL:', error.message);
    console.warn('   Asegúrese de que XAMPP y MySQL estén iniciados.');
    console.warn('   Ejecute: node backend/src/init-db.js');
  }

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor iniciado en http://${HOST}:${PORT}`);
    console.log(`📊 Frontend: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
  });
}

process.on('SIGINT', async () => {
  await closePool();
  process.exit(0);
});

start();

module.exports = { app, server, io };
