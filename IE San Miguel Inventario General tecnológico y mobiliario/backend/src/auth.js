const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { queryOne } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'jcho-inventario-secret-2024';
const JWT_EXPIRES_IN = '8h';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePasswords(candidate, hash) {
  return bcrypt.compareSync(candidate, hash);
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      sede_id: user.sede_id,
      dependencia_id: user.dependencia_id,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const tokenFromHeader = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;
  const tokenFromQuery = req.query && req.query.token ? String(req.query.token) : null;
  const token = tokenFromHeader || tokenFromQuery;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne(
      `SELECT id, username, full_name, role, sede_id, dependencia_id, is_active
       FROM users
       WHERE id = ?`,
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ success: false, message: 'Usuario inactivo' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para realizar esta acción' });
    }
    return next();
  };
}

// Middleware que permite acceso si el usuario es ADMIN o pertenece a la sede/dependencia del recurso
function requireSedeAccess() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    // ADMIN y ALMACENISTA tienen acceso total
    if (req.user.role === 'ADMIN' || req.user.role === 'ALMACENISTA' || req.user.role === 'RECTOR') {
      return next();
    }
    // DOCENTE solo puede acceder a su propia sede/dependencia
    const sedeId = req.body?.sede_id || req.query?.sede_id || req.params?.sede_id;
    const depId = req.body?.dependencia_id || req.query?.dependencia_id || req.params?.dependencia_id;
    if (sedeId && Number(sedeId) !== Number(req.user.sede_id)) {
      return res.status(403).json({ success: false, message: 'No tiene acceso a esta sede' });
    }
    if (depId && Number(depId) !== Number(req.user.dependencia_id)) {
      return res.status(403).json({ success: false, message: 'No tiene acceso a esta dependencia' });
    }
    return next();
  };
}

module.exports = {
  hashPassword,
  comparePasswords,
  signToken,
  authMiddleware,
  requireRole,
  requireSedeAccess,
  JWT_SECRET,
  JWT_EXPIRES_IN,
};
