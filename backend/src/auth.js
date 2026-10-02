const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'jcho-inventario-secret';
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
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const tokenFromHeader = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  const tokenFromQuery = req.query && req.query.token ? String(req.query.token) : null;
  const token = tokenFromHeader || tokenFromQuery;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare(
        `SELECT id, username, full_name, role, is_active, created_at
         FROM users
         WHERE id = ?`
      )
      .get(decoded.id);

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

module.exports = {
  hashPassword,
  comparePasswords,
  signToken,
  authMiddleware,
  requireRole,
  JWT_SECRET,
};
