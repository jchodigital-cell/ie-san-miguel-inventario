-- ============================================================================
-- ESQUEMA DE BASE DE DATOS MySQL - IE San Miguel Inventario General
-- Compatible con XAMPP (MySQL/MariaDB)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ie_san_miguel_inventario
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ie_san_miguel_inventario;

-- -----------------------------------------------------
-- Tabla: institution (datos de la institución)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS institution (
  id INT PRIMARY KEY CHECK (id = 1),
  name VARCHAR(255) NOT NULL DEFAULT 'Institución Educativa San Miguel Payande - San Luis',
  subtitle VARCHAR(255) NOT NULL DEFAULT 'Sistema de Control General de Inventario Tecnológico y Mobiliario',
  logo_data LONGTEXT,
  brand_logo_data LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: roles
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: sedes
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS sedes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('principal', 'primaria', 'administrativa', 'porvenir', 'el_salitre') NOT NULL,
  responsable VARCHAR(100),
  descripcion TEXT,
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: dependencias
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS dependencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sede_id INT NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  responsable VARCHAR(100),
  tipo_dependencia ENUM('sala_sistemas', 'sala_audiovisuales', 'coordinacion', 'sala_multiple', 'area_administrativa', 'otra') NOT NULL,
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sede_id) REFERENCES sedes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: users (usuarios del sistema)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('ADMIN', 'ALMACENISTA', 'RECTOR', 'DOCENTE') NOT NULL DEFAULT 'DOCENTE',
  sede_id INT,
  dependencia_id INT,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sede_id) REFERENCES sedes(id) ON DELETE SET NULL,
  FOREIGN KEY (dependencia_id) REFERENCES dependencias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: categorias
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion VARCHAR(255),
  tipo ENUM('tecnologico', 'mobiliario', 'ambos') NOT NULL DEFAULT 'ambos',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: inventario (items tecnológicos y mobiliario)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(50) NOT NULL UNIQUE,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria_id INT NOT NULL,
  tipo ENUM('tecnologico', 'mobiliario') NOT NULL,
  marca VARCHAR(100),
  modelo VARCHAR(100),
  serial VARCHAR(100),
  cantidad INT NOT NULL DEFAULT 1,
  unidad_medida VARCHAR(50) DEFAULT 'unidad',
  estado ENUM('BUENO', 'REGULAR', 'MALO', 'MANTENIMIENTO', 'BAJA') NOT NULL DEFAULT 'BUENO',
  sede_id INT,
  dependencia_id INT,
  responsable VARCHAR(100),
  fecha_adquisicion DATE,
  costo DECIMAL(12,2) DEFAULT 0,
  stock_minimo INT DEFAULT 0,
  ubicacion VARCHAR(100),
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  FOREIGN KEY (sede_id) REFERENCES sedes(id) ON DELETE SET NULL,
  FOREIGN KEY (dependencia_id) REFERENCES dependencias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: movimientos (entradas, salidas, ajustes, traslados)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventario_id INT NOT NULL,
  tipo ENUM('ENTRADA', 'SALIDA', 'AJUSTE', 'TRASLADO', 'PRESTAMO', 'DEVOLUCION') NOT NULL,
  cantidad INT NOT NULL,
  unidad_costo DECIMAL(12,2) DEFAULT 0,
  referencia VARCHAR(100),
  responsable VARCHAR(100),
  observacion TEXT,
  sede_origen_id INT,
  sede_destino_id INT,
  dependencia_origen_id INT,
  dependencia_destino_id INT,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (sede_origen_id) REFERENCES sedes(id) ON DELETE SET NULL,
  FOREIGN KEY (sede_destino_id) REFERENCES sedes(id) ON DELETE SET NULL,
  FOREIGN KEY (dependencia_origen_id) REFERENCES dependencias(id) ON DELETE SET NULL,
  FOREIGN KEY (dependencia_destino_id) REFERENCES dependencias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Tabla: tool_movements (historial de préstamos y estados de items)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS item_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventario_id INT NOT NULL,
  tipo ENUM('INGRESO', 'PRESTAMO', 'DEVOLUCION', 'REVISION', 'BAJA', 'TRASLADO') NOT NULL,
  responsable VARCHAR(100),
  observacion TEXT,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- Índices para optimizar consultas
-- -----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventario_codigo ON inventario(codigo);
CREATE INDEX IF NOT EXISTS idx_inventario_estado ON inventario(estado);
CREATE INDEX IF NOT EXISTS idx_inventario_sede ON inventario(sede_id);
CREATE INDEX IF NOT EXISTS idx_inventario_dependencia ON inventario(dependencia_id);
CREATE INDEX IF NOT EXISTS idx_inventario_categoria ON inventario(categoria_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario ON movimientos(inventario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_users_sede ON users(sede_id);
CREATE INDEX IF NOT EXISTS idx_users_dependencia ON users(dependencia_id);
CREATE INDEX IF NOT EXISTS idx_item_movements_inventario ON item_movements(inventario_id, created_at DESC);

-- -----------------------------------------------------
-- Datos iniciales: institución
-- -----------------------------------------------------
INSERT IGNORE INTO institution (id, name, subtitle) VALUES
(1, 'Institución Educativa San Miguel Payande - San Luis', 'Sistema de Control General de Inventario Tecnológico y Mobiliario');

-- -----------------------------------------------------
-- Datos iniciales: roles
-- -----------------------------------------------------
INSERT IGNORE INTO roles (name, description) VALUES
('ADMIN', 'Administrador del sistema con acceso total'),
('ALMACENISTA', 'Encargado de inventario, entradas, salidas y reportes'),
('RECTOR', 'Solo consulta de dashboard, inventario y reportes'),
('DOCENTE', 'Acceso a su sede y dependencia asignada');

-- -----------------------------------------------------
-- Datos iniciales: sedes (estructura solicitada)
-- -----------------------------------------------------
INSERT IGNORE INTO sedes (nombre, tipo, responsable, descripcion) VALUES
('Sede Principal - Bachiller', 'principal', NULL, 'Sede principal del nivel bachillerato'),
('Sede Primaria', 'primaria', NULL, 'Sede del nivel primaria'),
('Área Administrativa', 'administrativa', NULL, 'Área administrativa central'),
('Sede Porvenir', 'porvenir', 'Docente Elkin', 'Sede Porvenir a cargo del docente Elkin'),
('Sede El Salitre', 'el_salitre', 'Docente Marcos', 'Sede El Salitre a cargo del docente Marcos');

-- -----------------------------------------------------
-- Datos iniciales: dependencias
-- -----------------------------------------------------
INSERT IGNORE INTO dependencias (sede_id, nombre, responsable, tipo_dependencia) VALUES
-- Sede Principal Bachiller
((SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1), 'Sala de Sistemas', 'Docente Miller', 'sala_sistemas'),
((SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1), 'Sala de Sistemas', 'Docente Alba Rocío', 'sala_sistemas'),
((SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1), 'Sala Audiovisuales', 'Docente que la solicite', 'sala_audiovisuales'),
((SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1), 'Coordinación', 'Coordinadora Sol', 'coordinacion'),
((SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1), 'Sala Múltiple', 'Docente que la solicite', 'sala_multiple'),
-- Sede Primaria
((SELECT id FROM sedes WHERE tipo = 'primaria' LIMIT 1), 'Sala de Sistemas', 'Docente que la solicite', 'sala_sistemas'),
-- Área Administrativa
((SELECT id FROM sedes WHERE tipo = 'administrativa' LIMIT 1), 'Área Administrativa', NULL, 'area_administrativa'),
-- Sede Porvenir
((SELECT id FROM sedes WHERE tipo = 'porvenir' LIMIT 1), 'Sala de Sistemas', 'Docente Elkin', 'sala_sistemas'),
-- Sede El Salitre
((SELECT id FROM sedes WHERE tipo = 'el_salitre' LIMIT 1), 'Sala de Sistemas', 'Docente Marcos', 'sala_sistemas');

-- -----------------------------------------------------
-- Datos iniciales: usuarios por defecto
-- -----------------------------------------------------
INSERT IGNORE INTO users (username, password_hash, full_name, role, sede_id, dependencia_id, is_active) VALUES
('admin', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Administrador Principal', 'ADMIN', NULL, NULL, 1),
('rector', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Rectoría IE San Miguel', 'RECTOR', NULL, NULL, 1),
('almacenista', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Almacenero General', 'ALMACENISTA', NULL, NULL, 1),
('miller', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Docente Miller', 'DOCENTE',
  (SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1),
  (SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Miller' LIMIT 1), 1),
('alba', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Docente Alba Rocío', 'DOCENTE',
  (SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1),
  (SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Alba Rocío' LIMIT 1), 1),
('sol', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Coordinadora Sol', 'DOCENTE',
  (SELECT id FROM sedes WHERE tipo = 'principal' LIMIT 1),
  (SELECT id FROM dependencias WHERE nombre = 'Coordinación' AND responsable = 'Coordinadora Sol' LIMIT 1), 1),
('elkin', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Docente Elkin', 'DOCENTE',
  (SELECT id FROM sedes WHERE tipo = 'porvenir' LIMIT 1),
  (SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Elkin' LIMIT 1), 1),
('marcos', '$2a$10$K7xL8mN2pQ4rS6tV8wX0yZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9s', 'Docente Marcos', 'DOCENTE',
  (SELECT id FROM sedes WHERE tipo = 'el_salitre' LIMIT 1),
  (SELECT id FROM dependencias WHERE nombre = 'Sala de Sistemas' AND responsable = 'Docente Marcos' LIMIT 1), 1);

-- -----------------------------------------------------
-- Datos iniciales: categorías
-- -----------------------------------------------------
INSERT IGNORE INTO categorias (nombre, descripcion, tipo) VALUES
('Computadoras', 'Equipos de cómputo y laptops', 'tecnologico'),
('Impresoras', 'Impresoras y escáneres', 'tecnologico'),
('Proyectores', 'Proyectores y pantallas', 'tecnologico'),
('Equipos de Audio', 'Sonido y micrófonos', 'tecnologico'),
('Muebles', 'Escritorios, sillas y archiveros', 'mobiliario'),
('Pizarras', 'Pizarras blancas y tradicionales', 'mobiliario'),
('Aire Acondicionado', 'Equipos de climatización', 'tecnologico'),
('Cámaras', 'Cámaras de seguridad y video', 'tecnologico'),
('Redes', 'Switches, routers y cableado', 'tecnologico'),
('Otros Mobiliario', 'Muebles diversos y enseres', 'mobiliario');

COMMIT;
