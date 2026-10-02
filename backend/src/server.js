const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { db, computeStatus } = require('./db');
const { authMiddleware, requireRole, signToken, comparePasswords, hashPassword } = require('./auth');
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  return next();
});

app.use(express.static(PUBLIC_DIR));

function successResponse(data) {
  return { success: true, data };
}

function errorResponse(message, status = 400) {
  return { success: false, message };
}

function getInstitution() {
  return db.prepare('SELECT * FROM institution WHERE id = 1').get();
}

function ensureValidPositiveNumber(value, field) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${field} debe ser mayor que cero`);
  }
  return num;
}

function sanitizeMaterialPayload(payload) {
  const missing = [];
  if (!payload.code || !String(payload.code).trim()) missing.push('Código');
  if (!payload.name || !String(payload.name).trim()) missing.push('Nombre');
  if (!payload.category_id && payload.category_id !== 0) missing.push('Categoría');
  if (!payload.unit || !String(payload.unit).trim()) missing.push('Unidad');
  if (!payload.location || !String(payload.location).trim()) missing.push('Ubicación');
  if (payload.stock_minimo === undefined || payload.stock_minimo === null || Number(payload.stock_minimo) < 0) missing.push('Stock mínimo');

  if (missing.length) {
    throw new Error(`Faltan campos obligatorios: ${missing.join(', ')}`);
  }
}

app.get('/api/health', (req, res) => {
  res.json(successResponse({ status: 'ok' }));
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json(errorResponse('Usuario y contraseña son obligatorios'));
    }

    const user = db
      .prepare(
        `SELECT id, username, full_name, password_hash, role, is_active
         FROM users
         WHERE username = ?`
      )
      .get(String(username).trim());

    if (!user || !comparePasswords(String(password), user.password_hash)) {
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
      },
    }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al iniciar sesión'));
  }
});

app.get('/api/institution', (req, res) => {
  try {
    const institution = getInstitution();
    return res.json(successResponse(institution));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar la institución'));
  }
});

app.put('/api/institution', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const { name, subtitle, logo_data, brand_logo_data } = req.body || {};
    const current = getInstitution();

    const newName = name && String(name).trim() ? String(name).trim() : current.name;
    const newSubtitle = subtitle && String(subtitle).trim() ? String(subtitle).trim() : current.subtitle;
    const logoValue = logo_data && typeof logo_data === 'string' ? logo_data : current.logo_data;
    const brandLogoValue = brand_logo_data && typeof brand_logo_data === 'string'
      ? brand_logo_data
      : current.brand_logo_data;

    db.prepare(`
      UPDATE institution
      SET name = ?, subtitle = ?, logo_data = ?, brand_logo_data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(newName, newSubtitle, logoValue, brandLogoValue);

    notifyDataChanged('institution');
    return res.json(successResponse(getInstitution()));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al actualizar la institución'));
  }
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  try {
    const totalMaterials = db.prepare('SELECT COUNT(*) AS total FROM materials').get().total;
    const activeMaterials = db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status <> ?').get('AGOTADO').total;
    const lowStock = db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status = ?').get('BAJO').total;
    const agotados = db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status = ?').get('AGOTADO').total;
    const totalEntradas = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM movements WHERE type = ?').get('ENTRADA').total;
    const totalSalidas = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM movements WHERE type = ?').get('SALIDA').total;

    const recentMovements = db.prepare(`
      SELECT m.*, mat.name AS material_name, u.full_name AS user_name
      FROM movements m
      JOIN materials mat ON mat.id = m.material_id
      LEFT JOIN users u ON u.id = m.user_id
      ORDER BY m.created_at DESC
      LIMIT 10
    `).all();

    const lowStockMaterials = db.prepare(`
      SELECT m.*, c.name AS category_name
      FROM materials m
      JOIN categories c ON c.id = m.category_id
      WHERE m.status = 'BAJO' OR m.status = 'AGOTADO'
      ORDER BY m.stock ASC
      LIMIT 10
    `).all();

    return res.json(successResponse({
      totalMaterials,
      activeMaterials,
      lowStock,
      agotados,
      totalEntradas,
      totalSalidas,
      recentMovements,
      lowStockMaterials,
    }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al obtener el dashboard'));
  }
});

app.get('/api/users', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, full_name, role, is_active, created_at
      FROM users
      ORDER BY created_at DESC
    `).all();
    return res.json(successResponse(users));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar usuarios'));
  }
});

app.post('/api/users', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const { username, password, full_name, role, is_active } = req.body || {};
    if (!username || !password || !full_name || !role) {
      return res.status(400).json(errorResponse('Nombre completo, usuario, contraseña y rol son obligatorios'));
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
    if (existing) {
      return res.status(409).json(errorResponse('El nombre de usuario ya existe'));
    }

    const finalRole = role === 'ALMACENISTA' ? 'ALMACENISTA' : role === 'RECTOR' ? 'RECTOR' : 'ADMIN';
    const passwordHash = hashPassword(String(password));
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(username).trim(), passwordHash, String(full_name).trim(), finalRole, is_active === false ? 0 : 1);

    const user = db.prepare('SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    notifyDataChanged('users');
    return res.status(201).json(successResponse(user));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear usuario'));
  }
});

app.delete('/api/users/:id', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const userId = Number(req.params.id);
    const existing = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json(errorResponse('Usuario no encontrado'));
    }

    if (existing.id === req.user.id) {
      return res.status(400).json(errorResponse('No puede eliminar el usuario con el que inició sesión'));
    }

    const movementCount = db.prepare('SELECT COUNT(*) AS count FROM movements WHERE user_id = ?').get(userId).count;
    if (movementCount > 0) {
      return res.status(400).json(errorResponse('No se puede eliminar un usuario con movimientos registrados'));
    }

    if (existing.role === 'ADMIN' && existing.is_active) {
      const adminCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND is_active = 1').get('ADMIN').count;
      if (adminCount <= 1) {
        return res.status(400).json(errorResponse('No se puede dejar sin administradores activos'));
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    notifyDataChanged('users');
    return res.json(successResponse({ deleted: true }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al eliminar usuario'));
  }
});

app.put('/api/users/:id', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const { id } = req.params;
    const { username, full_name, role, is_active, password } = req.body || {};
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    if (!existing) {
      return res.status(404).json(errorResponse('Usuario no encontrado'));
    }

    const adminCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND is_active = 1').get('ADMIN').count;
    if (existing.role === 'ADMIN' && adminCount <= 1 && role !== 'ADMIN') {
      return res.status(400).json(errorResponse('No se puede dejar sin administradores activos'));
    }

    const finalUsername = username && String(username).trim() ? String(username).trim() : existing.username;
    const finalFullName = full_name && String(full_name).trim() ? String(full_name).trim() : existing.full_name;
    const finalRole = role === 'ALMACENISTA' || role === 'ADMIN' || role === 'RECTOR' ? role : existing.role;
    const finalActive = is_active === false || is_active === 0 ? 0 : 1;

    if (existing.username !== finalUsername) {
      const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(finalUsername, Number(id));
      if (duplicate) {
        return res.status(409).json(errorResponse('El nombre de usuario ya existe'));
      }
    }

    if (password && String(password).trim()) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), Number(id));
    }

    db.prepare(`
      UPDATE users
      SET username = ?, full_name = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalUsername, finalFullName, finalRole, finalActive, Number(id));

    const updated = db.prepare('SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = ?').get(Number(id));
    notifyDataChanged('users');
    return res.json(successResponse(updated));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al actualizar usuario'));
  }
});

app.get('/api/categories', authMiddleware, (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    return res.json(successResponse(categories));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar categorías'));
  }
});

app.post('/api/categories', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json(errorResponse('El nombre de la categoría es obligatorio'));
    }

    const duplicate = db.prepare('SELECT id FROM categories WHERE name = ?').get(String(name).trim());
    if (duplicate) {
      return res.status(409).json(errorResponse('La categoría ya existe'));
    }

    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(String(name).trim());
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    notifyDataChanged('categories');
    return res.status(201).json(successResponse(category));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al crear categoría'));
  }
});

app.get('/api/materials', authMiddleware, (req, res) => {
  try {
    const { q, category, location, status, low_stock } = req.query;
    let sql = `
      SELECT m.*, c.name as category_name
      FROM materials m
      JOIN categories c ON c.id = m.category_id
    `;
    const conditions = [];
    const params = [];

    if (q) {
      conditions.push('(LOWER(m.code) LIKE ? OR LOWER(m.name) LIKE ?)');
      const term = `%${String(q).toLowerCase()}%`;
      params.push(term, term);
    }
    if (category) {
      conditions.push('c.name = ?');
      params.push(String(category));
    }
    if (location) {
      conditions.push('LOWER(m.location) LIKE ?');
      params.push(`%${String(location).toLowerCase()}%`);
    }
    if (status) {
      conditions.push('m.status = ?');
      params.push(String(status));
    }
    if (low_stock === 'true') {
      conditions.push('(m.stock <= m.stock_minimo OR m.stock = 0)');
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY m.created_at DESC';

    const items = db.prepare(sql).all(...params);
    return res.json(successResponse(items));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar materiales'));
  }
});

app.post('/api/materials', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const { category_id, code, name, unit, stock, stock_minimo, location } = req.body || {};
    sanitizeMaterialPayload({ category_id, code, name, unit, stock, stock_minimo, location });

    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(category_id));
    if (!category) {
      return res.status(404).json(errorResponse('Categoría no encontrada'));
    }

    const existing = db.prepare('SELECT id FROM materials WHERE code = ?').get(String(code).trim());
    if (existing) {
      return res.status(409).json(errorResponse('El código del material ya existe'));
    }

    const parsedStock = Number(stock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      return res.status(400).json(errorResponse('El stock actual no puede ser negativo'));
    }

    const stockMinimo = Number(stock_minimo);
    const status = computeStatus(parsedStock, stockMinimo);

    const result = db.prepare(`
      INSERT INTO materials (code, name, category_id, unit, stock, stock_minimo, location, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(code).trim(),
      String(name).trim(),
      Number(category_id),
      String(unit).trim(),
      parsedStock,
      stockMinimo,
      String(location).trim(),
      status
    );

    const material = db.prepare(`
      SELECT m.*, c.name as category_name
      FROM materials m
      JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    notifyDataChanged('materials');
    return res.status(201).json(successResponse(material));
  } catch (error) {
    return res.status(400).json(errorResponse(error.message || 'Error al crear material'));
  }
});

app.put('/api/materials/:id', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const { id } = req.params;
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(id));
    if (!material) {
      return res.status(404).json(errorResponse('Material no encontrado'));
    }

    const { category_id, code, name, unit, stock_minimo, location } = req.body || {};
    const finalCategoryId = category_id ? Number(category_id) : material.category_id;
    const finalCode = code && String(code).trim() ? String(code).trim() : material.code;
    const finalName = name && String(name).trim() ? String(name).trim() : material.name;
    const finalUnit = unit && String(unit).trim() ? String(unit).trim() : material.unit;
    const finalStockMinimo = stock_minimo !== undefined && stock_minimo !== null ? Number(stock_minimo) : material.stock_minimo;
    const finalLocation = location && String(location).trim() ? String(location).trim() : material.location;

    if (finalStockMinimo < 0) {
      return res.status(400).json(errorResponse('El stock mínimo no puede ser negativo'));
    }

    const duplicate = db.prepare('SELECT id FROM materials WHERE code = ? AND id != ?').get(finalCode, Number(id));
    if (duplicate) {
      return res.status(409).json(errorResponse('El código del material ya existe'));
    }

    const updatedStatus = computeStatus(material.stock, finalStockMinimo);

    db.prepare(`
      UPDATE materials
      SET code = ?, name = ?, category_id = ?, unit = ?, stock_minimo = ?, location = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalCode, finalName, finalCategoryId, finalUnit, finalStockMinimo, finalLocation, updatedStatus, Number(id));

    const updated = db.prepare(`
      SELECT m.*, c.name as category_name
      FROM materials m
      JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
    `).get(Number(id));

    notifyDataChanged('materials');
    return res.json(successResponse(updated));
  } catch (error) {
    return res.status(400).json(errorResponse(error.message || 'Error al actualizar material'));
  }
});

app.delete('/api/materials/:id', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const materialId = Number(req.params.id);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      return res.status(400).json(errorResponse('Identificador de material inválido'));
    }

    const material = db.prepare('SELECT id FROM materials WHERE id = ?').get(materialId);
    if (!material) {
      return res.status(404).json(errorResponse('Material no encontrado'));
    }

    const movementCount = db.prepare('SELECT COUNT(*) AS count FROM movements WHERE material_id = ?').get(materialId).count;
    if (movementCount > 0) {
      return res.status(400).json(errorResponse('No se puede eliminar un material con movimientos registrados'));
    }

    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    notifyDataChanged('materials');
    return res.json(successResponse({ deleted: true }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al eliminar material'));
  }
});

app.post('/api/movements', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const { material_id, type, quantity, unit_cost, reference, responsible, observation } = req.body || {};

    if (!material_id || !type || !quantity) {
      return res.status(400).json(errorResponse('Material, tipo y cantidad son obligatorios'));
    }

    if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(type)) {
      return res.status(400).json(errorResponse('Tipo de movimiento inválido'));
    }

    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(material_id));
    if (!material) {
      return res.status(404).json(errorResponse('Material no encontrado'));
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json(errorResponse('La cantidad debe ser mayor que cero'));
    }

    const unitCost = Number(unit_cost || 0);
    const transaction = db.transaction(() => {
      let updatedStock = material.stock;
      if (type === 'ENTRADA') {
        updatedStock = material.stock + qty;
      } else if (type === 'SALIDA') {
        if (qty > material.stock) {
          throw new Error('No hay suficiente stock para esta salida');
        }
        updatedStock = material.stock - qty;
      } else if (type === 'AJUSTE') {
        updatedStock = qty;
      }

      const result = db.prepare(`
        INSERT INTO movements (material_id, type, quantity, unit_cost, reference, responsible, observation, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(Number(material_id), type, qty, unitCost, reference || null, responsible || null, observation || null, req.user.id);

      db.prepare(`
        UPDATE materials
        SET stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updatedStock, computeStatus(updatedStock, material.stock_minimo), Number(material_id));

      return result;
    });

    const movement = transaction();
    notifyDataChanged('movements');
    return res.status(201).json(successResponse({ movementId: movement.lastInsertRowid }));
  } catch (error) {
    return res.status(400).json(errorResponse(error.message || 'Error al registrar movimiento'));
  }
});

app.get('/api/movements', authMiddleware, (req, res) => {
  try {
    const movements = db.prepare(`
      SELECT m.*, mat.name AS material_name, u.full_name AS user_name
      FROM movements m
      JOIN materials mat ON mat.id = m.material_id
      LEFT JOIN users u ON u.id = m.user_id
      ORDER BY m.created_at DESC
    `).all();
    return res.json(successResponse(movements));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar movimientos'));
  }
});

app.put('/api/movements/:id', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const movementId = Number(req.params.id);
    const newMaterialId = Number(req.body?.material_id);
    if (!Number.isInteger(movementId) || movementId <= 0 || !Number.isInteger(newMaterialId) || newMaterialId <= 0) {
      return res.status(400).json(errorResponse('Movimiento o material inválido'));
    }

    const movement = db.prepare('SELECT * FROM movements WHERE id = ?').get(movementId);
    if (!movement) {
      return res.status(404).json(errorResponse('Movimiento no encontrado'));
    }
    if (movement.type === 'AJUSTE') {
      return res.status(400).json(errorResponse('No se puede editar un ajuste desde este módulo'));
    }
    if (movement.material_id === newMaterialId) {
      return res.json(successResponse({ updated: true }));
    }

    const newMaterial = db.prepare('SELECT * FROM materials WHERE id = ?').get(newMaterialId);
    if (!newMaterial) {
      return res.status(404).json(errorResponse('Material no encontrado'));
    }

    const transaction = db.transaction(() => {
      const oldMaterial = db.prepare('SELECT * FROM materials WHERE id = ?').get(movement.material_id);
      const oldStock = movement.type === 'ENTRADA'
        ? oldMaterial.stock - movement.quantity
        : oldMaterial.stock + movement.quantity;
      const newStock = movement.type === 'ENTRADA'
        ? newMaterial.stock + movement.quantity
        : newMaterial.stock - movement.quantity;

      if (oldStock < 0) {
        throw new Error('No se puede cambiar el material porque dejaría un stock negativo');
      }
      if (newStock < 0) {
        throw new Error('No hay suficiente stock en el nuevo material para esta salida');
      }

      db.prepare('UPDATE materials SET stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(oldStock, computeStatus(oldStock, oldMaterial.stock_minimo), oldMaterial.id);
      db.prepare('UPDATE materials SET stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newStock, computeStatus(newStock, newMaterial.stock_minimo), newMaterial.id);
      db.prepare('UPDATE movements SET material_id = ? WHERE id = ?').run(newMaterialId, movementId);
    });

    transaction();
    notifyDataChanged('movements');
    return res.json(successResponse({ updated: true }));
  } catch (error) {
    return res.status(400).json(errorResponse(error.message || 'Error al editar movimiento'));
  }
});

app.delete('/api/movements/:id', authMiddleware, requireRole('ADMIN', 'ALMACENISTA'), (req, res) => {
  try {
    const movementId = Number(req.params.id);
    if (!Number.isInteger(movementId) || movementId <= 0) {
      return res.status(400).json(errorResponse('Identificador de movimiento inválido'));
    }
    const movement = db.prepare(`
      SELECT m.*, mat.stock AS material_stock, mat.stock_minimo, mat.name AS material_name
      FROM movements m
      JOIN materials mat ON mat.id = m.material_id
      WHERE m.id = ?
    `).get(movementId);

    if (!movement) {
      return res.status(404).json(errorResponse('Movimiento no encontrado'));
    }

    if (movement.type === 'AJUSTE') {
      return res.status(400).json(errorResponse('No se puede eliminar un ajuste desde este módulo'));
    }

    const transaction = db.transaction(() => {
      const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(movement.material_id);
      let updatedStock = material.stock;

      if (movement.type === 'ENTRADA') {
        updatedStock = Math.max(0, material.stock - movement.quantity);
      }

      if (movement.type === 'SALIDA') {
        updatedStock = material.stock + movement.quantity;
      }

      db.prepare(`
        UPDATE materials
        SET stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updatedStock, computeStatus(updatedStock, material.stock_minimo), movement.material_id);

      db.prepare('DELETE FROM movements WHERE id = ?').run(movementId);
    });

    transaction();
    notifyDataChanged('movements');
    return res.json(successResponse({ deletedId: movementId }));
  } catch (error) {
    return res.status(400).json(errorResponse(error.message || 'Error al eliminar movimiento'));
  }
});

app.get('/api/reports/low-stock', authMiddleware, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT m.*, c.name AS category_name
      FROM materials m
      JOIN categories c ON c.id = m.category_id
      WHERE m.stock <= m.stock_minimo OR m.stock = 0
      ORDER BY m.stock ASC
    `).all();
    return res.json(successResponse(items));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar stock bajo'));
  }
});

app.get('/api/reports/kardex/:id', authMiddleware, (req, res) => {
  try {
    const materialId = Number(req.params.id);
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
    if (!material) {
      return res.status(404).json(errorResponse('Material no encontrado'));
    }

    const rows = db.prepare(`
      SELECT m.*, u.full_name AS user_name, mat.name AS material_name, mat.code AS material_code
      FROM movements m
      JOIN materials mat ON mat.id = m.material_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.material_id = ?
      ORDER BY m.created_at ASC
    `).all(materialId);

    let saldo = 0;
    const kardex = rows.map((row) => {
      if (row.type === 'ENTRADA') {
        saldo += row.quantity;
      } else if (row.type === 'SALIDA') {
        saldo -= row.quantity;
      } else if (row.type === 'AJUSTE') {
        saldo = row.quantity;
      }
      return { ...row, saldo_resultante: saldo };
    });

    return res.json(successResponse({ material, kardex }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al generar Kardex'));
  }
});

app.get('/api/reports/summary', authMiddleware, (req, res) => {
  try {
    const summary = {
      totalMaterials: db.prepare('SELECT COUNT(*) AS total FROM materials').get().total,
      activeMaterials: db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status = ?').get('NORMAL').total,
      lowStock: db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status = ?').get('BAJO').total,
      agotados: db.prepare('SELECT COUNT(*) AS total FROM materials WHERE status = ?').get('AGOTADO').total,
      totalEntradas: db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM movements WHERE type = ?').get('ENTRADA').total,
      totalSalidas: db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM movements WHERE type = ?').get('SALIDA').total,
    };
    return res.json(successResponse(summary));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al generar resumen'));
  }
});

app.get('/api/reports/export/excel', authMiddleware, (req, res) => {
  try {
    const institution = getInstitution();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventario');

    worksheet.mergeCells('A1:I1');
    worksheet.getCell('A1').value = institution.name;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:I2');
    worksheet.getCell('A2').value = institution.subtitle;
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    worksheet.getCell('A3').alignment = { horizontal: 'right' };

    const rows = db.prepare(`
      SELECT m.code, m.name AS material, c.name AS category, m.unit, m.stock, m.stock_minimo, m.status, m.location,
        COALESCE((SELECT SUM(quantity) FROM movements WHERE material_id = m.id AND type = 'ENTRADA'), 0) AS total_entradas,
        COALESCE((SELECT SUM(quantity) FROM movements WHERE material_id = m.id AND type = 'SALIDA'), 0) AS total_salidas
      FROM materials m
      JOIN categories c ON c.id = m.category_id
      ORDER BY m.name ASC
    `).all();

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
    worksheet.getRow(5).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 4 }];

    worksheet.eachRow((row) => {
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const fileName = 'Inventario_San_Miguel.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    workbook.xlsx.write(res).then(() => res.end());
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar Excel'));
  }
});

app.get('/api/reports/export/pdf', authMiddleware, (req, res) => {
  try {
    const institution = getInstitution();
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const fileName = 'Inventario_San_Miguel.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    if (institution.logo_data) {
      try {
        const buffer = Buffer.from(institution.logo_data.split(',')[1], 'base64');
        doc.image(buffer, 30, 30, { width: 60, height: 60 });
      } catch (error) {
        // Ignorar si el logo no es válido
      }
    }

    doc.fontSize(18).text(institution.name, 110, 35);
    doc.fontSize(10).text(institution.subtitle, 110, 60);
    doc.fontSize(9).text(`Fecha de generación: ${new Date().toLocaleString('es-ES')}`, 30, 110);

    const rows = db.prepare(`
      SELECT m.code, m.name AS material, m.unit, m.stock, m.stock_minimo, m.status, m.location,
        COALESCE((SELECT SUM(quantity) FROM movements WHERE material_id = m.id AND type = 'ENTRADA'), 0) AS entradas,
        COALESCE((SELECT SUM(quantity) FROM movements WHERE material_id = m.id AND type = 'SALIDA'), 0) AS salidas
      FROM materials m
      ORDER BY m.name ASC
    `).all();

    const tableTop = 150;
    const columnPositions = [30, 95, 175, 230, 275, 325, 385, 440, 490];
    const headers = ['Código', 'Material', 'Unidad', 'Stock', 'Mínimo', 'Estado', 'Entradas', 'Salidas', 'Ubicación'];

    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((header, index) => {
      doc.text(header, columnPositions[index], tableTop, { width: 55, align: 'left' });
    });

    doc.moveTo(30, tableTop + 12).lineTo(560, tableTop + 12).stroke();
    doc.font('Helvetica');

    rows.forEach((row, index) => {
      const y = tableTop + 25 + index * 18;
      if (y > 720) {
        doc.addPage();
      }

      const values = [
        row.code,
        row.material,
        row.unit,
        String(row.stock),
        String(row.stock_minimo),
        row.status,
        String(row.entradas),
        String(row.salidas),
        row.location,
      ];

      values.forEach((value, idx) => {
        doc.text(String(value || ''), columnPositions[idx], y, { width: idx === 1 ? 70 : 55, ellipsis: true });
      });
    });

    doc.text('Sistema de Inventario', 30, 760);
    doc.text('Institución Educativa San Miguel', 430, 760);
    doc.end();
  } catch (error) {
    return res.status(500).json(errorResponse('Error al exportar PDF'));
  }
});

app.get('/api/versioning', authMiddleware, requireRole('ADMIN'), (req, res) => {
  try {
    const root = path.join(__dirname, '../..');
    const run = (cmd) => {
      try {
        return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    };

    const isRepo = run('git rev-parse --is-inside-work-tree') === 'true';
    if (!isRepo) {
      return res.json(successResponse({ enabled: false }));
    }

    const branch = run('git rev-parse --abbrev-ref HEAD') || 'desconocida';
    const remotes = (run('git remote -v') || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, url, type] = line.split(/\s+/);
        return { name, url, type: type || '' };
      });
    const statusShort = run('git status --short') || '';
    const commits = (run('git log --pretty=format:"%h|%s|%an|%ad" --date=short -15') || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });

    return res.json(successResponse({
      enabled: true,
      branch,
      remotes,
      pendingChanges: statusShort ? statusShort.split('\n').length : 0,
      status: statusShort || 'Sin cambios pendientes',
      commits,
    }));
  } catch (error) {
    return res.status(500).json(errorResponse('Error al consultar el versionamiento'));
  }
});

app.get('*', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).json({ success: false, message: 'No encontrado' });
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log('Para usar desde otro dispositivo en la misma red, abre: http://<IP-DE-ESTA-PC>:' + PORT);
});
