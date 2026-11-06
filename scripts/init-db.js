// Inicializa la base de datos con información y cuentas de demostración ficticias.
// Uso: npm run db:init (requiere DATABASE_URL, ADMIN_SEED_PASSWORD y USER_SEED_PASSWORD).
// ATENCIÓN: reinicia la base de datos y borra los datos existentes.
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

function slug(nombre) {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/)[0];
}

async function inicializar({ pool, passwordAdmin, passwordUsuario = passwordAdmin, correoAdminGlobal = 'admin@ejemplo.invalid', correoUsuarioDemo = 'usuario.demo@ejemplo.invalid', correosAdministradores = {} }) {
  const leer = (f) => fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8');
  await pool.query(leer('schema.sql'));
  await pool.query(leer('seed.sql'));

  const hashAdmin = await bcrypt.hash(passwordAdmin, 12);
  const hashUsuario = await bcrypt.hash(passwordUsuario, 12);
  await pool.query(
    "INSERT INTO administrador (nombre_usuario, correo, contrasena_hash, rol, id_dependencia) VALUES ('admin', $1, $2, 'global', NULL)",
    [correoAdminGlobal.toLowerCase(), hashAdmin]);
  const administradores = ['admin'];
  const deps = (await pool.query('SELECT id_dependencia, nombre FROM dependencia ORDER BY id_dependencia')).rows;
  for (const d of deps) {
    const usuario = `admin_${slug(d.nombre)}`;
    const correo = String(correosAdministradores[usuario] || `${usuario}@ejemplo.invalid`).toLowerCase();
    await pool.query(
      "INSERT INTO administrador (nombre_usuario, correo, contrasena_hash, rol, id_dependencia) VALUES ($1, $2, $3, 'dependencia', $4)",
      [usuario, correo, hashAdmin, d.id_dependencia]);
    administradores.push(usuario);
  }
  await pool.query(
    "INSERT INTO cuenta_usuario (nombre_usuario, correo, contrasena_hash) VALUES ('usuario_demo', $1, $2)",
    [String(correoUsuarioDemo).toLowerCase(), hashUsuario]);
  return { administradores, usuario: 'usuario_demo' };
}

module.exports = { inicializar };

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  const { DATABASE_URL, ADMIN_SEED_PASSWORD, USER_SEED_PASSWORD } = process.env;
  if (!DATABASE_URL || !ADMIN_SEED_PASSWORD || ADMIN_SEED_PASSWORD.length < 10 ||
      !USER_SEED_PASSWORD || USER_SEED_PASSWORD.length < 10) {
    console.error('Defina DATABASE_URL y contraseñas iniciales ADMIN_SEED_PASSWORD y USER_SEED_PASSWORD (mínimo 10 caracteres) en .env.');
    process.exit(1);
  }
  if (ADMIN_SEED_PASSWORD === USER_SEED_PASSWORD) {
    console.error('Use contraseñas diferentes para la cuenta de usuario y la cuenta administrativa.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  const correosAdministradores = {};
  for (const nombre of ['admin_admisiones', 'admin_registro', 'admin_bienestar', 'admin_coordinacion']) {
    const variable = `${nombre.toUpperCase()}_EMAIL`;
    if (process.env[variable]) correosAdministradores[nombre] = process.env[variable];
  }
  inicializar({
    pool, passwordAdmin: ADMIN_SEED_PASSWORD, passwordUsuario: USER_SEED_PASSWORD,
    correoAdminGlobal: process.env.ADMIN_GLOBAL_EMAIL || 'admin@ejemplo.invalid',
    correoUsuarioDemo: process.env.USER_DEMO_EMAIL || 'usuario.demo@ejemplo.invalid', correosAdministradores,
  })
    .then(({ administradores, usuario }) => console.log('Base de datos inicializada. Administradores:', administradores.join(', '), '| Usuario de demostración:', usuario))
    .catch((e) => { console.error('Error al inicializar la base de datos:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
