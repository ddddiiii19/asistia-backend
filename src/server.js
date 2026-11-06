const { Pool } = require('pg');
const { config, validarConfig } = require('./config');
const { crearProveedorIA } = require('./ia');
const { crearApp } = require('./app');

const problemas = validarConfig();
if (problemas.length > 0) {
  console.error('Configuración incompleta:\n- ' + problemas.join('\n- ') + '\nRevisa tu archivo .env (ver .env.example).');
  process.exit(1);
}

const pool = new Pool({ connectionString: config.databaseUrl });
const ia = crearProveedorIA(config);
const app = crearApp({ pool, ia, config });

const servidor = app.listen(config.puerto, () => {
  console.log(`AsistIA API escuchando en http://localhost:${config.puerto} (IA: ${ia.nombre})`);
});

function cerrar() {
  servidor.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
