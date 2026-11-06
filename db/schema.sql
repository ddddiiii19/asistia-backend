-- AsistIA - Esquema de base de datos (PostgreSQL).
-- Q4: autenticación para los roles Usuario y Administrador, además del alcance administrativo interno.
-- Q6: consulta.tiempo_respuesta_ms para los reportes (ver también db/migracion-q6.sql).
-- ATENCIÓN: este script elimina y vuelve a crear las tablas (reinicia la base de datos).

DROP TABLE IF EXISTS token_recuperacion_contrasena, escalamiento, consulta, mensaje, conversacion,
                     cuenta_usuario, administrador, pregunta_frecuente, informacion_institucional,
                     dependencia CASCADE;

CREATE TABLE dependencia (
  id_dependencia       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre               VARCHAR(100) NOT NULL UNIQUE,
  descripcion          TEXT,
  contacto_responsable VARCHAR(150)
);

CREATE TABLE informacion_institucional (
  id_info             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_dependencia      INTEGER NOT NULL REFERENCES dependencia(id_dependencia) ON DELETE CASCADE,
  titulo              VARCHAR(150) NOT NULL,
  contenido           TEXT NOT NULL,
  fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pregunta_frecuente (
  id_faq         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_dependencia INTEGER NOT NULL REFERENCES dependencia(id_dependencia) ON DELETE CASCADE,
  pregunta       VARCHAR(255) NOT NULL,
  respuesta      TEXT NOT NULL,
  frecuencia     INTEGER NOT NULL DEFAULT 0
);

-- Los administradores conservan su alcance de permisos: global o por dependencia.
-- En la interfaz, ambos pertenecen al rol de aplicación "administrador".
CREATE TABLE administrador (
  id_administrador INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_usuario   VARCHAR(50) NOT NULL UNIQUE,
  correo           VARCHAR(254) NOT NULL UNIQUE,
  contrasena_hash  VARCHAR(255) NOT NULL,
  auth_version     INTEGER NOT NULL DEFAULT 0,
  rol              VARCHAR(30) NOT NULL CHECK (rol IN ('global', 'dependencia')),
  id_dependencia   INTEGER REFERENCES dependencia(id_dependencia) ON DELETE RESTRICT,
  CONSTRAINT chk_rol_dependencia CHECK (
    (rol = 'global' AND id_dependencia IS NULL) OR
    (rol = 'dependencia' AND id_dependencia IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_administrador_nombre_lower ON administrador (LOWER(nombre_usuario));
CREATE UNIQUE INDEX idx_administrador_correo_lower ON administrador (LOWER(correo));

-- Cuentas del rol Usuario. No hay autorregistro público: las cuentas se crean desde el panel
-- administrativo o mediante el procedimiento administrativo documentado.
CREATE TABLE cuenta_usuario (
  id_usuario      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_usuario  VARCHAR(50) NOT NULL UNIQUE,
  correo          VARCHAR(254) NOT NULL UNIQUE,
  contrasena_hash VARCHAR(255) NOT NULL,
  auth_version    INTEGER NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_cuenta_usuario_nombre_lower ON cuenta_usuario (LOWER(nombre_usuario));
CREATE UNIQUE INDEX idx_cuenta_usuario_correo_lower ON cuenta_usuario (LOWER(correo));

-- La conversación queda vinculada a la cuenta autenticada. id_sesion se conserva como dato técnico,
-- pero ya no es la única credencial para recuperar el historial del usuario.
CREATE TABLE conversacion (
  id_conversacion INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha_inicio    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_sesion       VARCHAR(64) NOT NULL,
  id_usuario      INTEGER NOT NULL REFERENCES cuenta_usuario(id_usuario) ON DELETE CASCADE
);
CREATE INDEX idx_conversacion_sesion ON conversacion(id_sesion);
CREATE INDEX idx_conversacion_usuario_fecha ON conversacion(id_usuario, fecha_inicio DESC);

CREATE TABLE mensaje (
  id_mensaje      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_conversacion INTEGER NOT NULL REFERENCES conversacion(id_conversacion) ON DELETE CASCADE,
  emisor          VARCHAR(10) NOT NULL CHECK (emisor IN ('usuario', 'asistente')),
  contenido       TEXT NOT NULL,
  fecha           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mensaje_conversacion ON mensaje(id_conversacion);

-- Relación Mensaje 1 : 0..1 Consulta (UNIQUE en id_mensaje).
CREATE TABLE consulta (
  id_consulta     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_conversacion INTEGER NOT NULL REFERENCES conversacion(id_conversacion) ON DELETE CASCADE,
  id_mensaje      INTEGER NOT NULL UNIQUE REFERENCES mensaje(id_mensaje) ON DELETE CASCADE,
  id_dependencia  INTEGER REFERENCES dependencia(id_dependencia) ON DELETE SET NULL,
  clasificacion   VARCHAR(100),
  -- Q6: tiempo que tardó el asistente en procesar la consulta (clasificar, generar y verificar).
  -- Es NULL en consultas anteriores a Q6, por lo que los promedios las ignoran.
  tiempo_respuesta_ms INTEGER CHECK (tiempo_respuesta_ms IS NULL OR tiempo_respuesta_ms >= 0),
  fecha           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_consulta_dependencia_fecha ON consulta(id_dependencia, fecha);

-- Relación Consulta 1 : 0..1 Escalamiento (UNIQUE en id_consulta).
CREATE TABLE escalamiento (
  id_escalamiento INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_consulta     INTEGER NOT NULL UNIQUE REFERENCES consulta(id_consulta) ON DELETE CASCADE,
  motivo          TEXT NOT NULL,
  fecha           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'atendido'))
);

-- Un mismo correo puede pertenecer a una cuenta de cada tabla únicamente si se manipula la BD
-- directamente. La API de creación comprueba que usuario/correo sean únicos entre ambas tablas.
-- El token almacena el hash del jti, no el JWT de recuperación en texto claro.
CREATE TABLE token_recuperacion_contrasena (
  id_token       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo_cuenta    VARCHAR(20) NOT NULL CHECK (tipo_cuenta IN ('usuario', 'administrador')),
  id_cuenta      INTEGER NOT NULL,
  jti_hash       CHAR(64) NOT NULL UNIQUE,
  expira_en      TIMESTAMPTZ NOT NULL,
  usado_en       TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_token_recuperacion_cuenta ON token_recuperacion_contrasena(tipo_cuenta, id_cuenta, expira_en);
