const express = require('express');
const cors = require('cors');
const { manejadorErrores, HttpError } = require('./errores');
const { requiereAuth } = require('./middleware/auth');
const { crearOrquestador } = require('./ia/orquestador');
const { rutasPublicas } = require('./routes/publico');
const { rutasAuth } = require('./routes/auth');
const { rutasAdmin } = require('./routes/admin');

// Construye la aplicacion Express. Las dependencias (pool, ia, config) se inyectan para poder probarla.
function crearApp({ pool, ia, config, enviarCorreoRecuperacion }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigen }));
  app.use(express.json({ limit: '10kb' }));

  // Prueba de conexion con la base de datos.
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ estado: 'ok', base_de_datos: 'ok', ia: { proveedor: ia.nombre } });
    } catch {
      res.status(503).json({ estado: 'error', base_de_datos: 'error', ia: { proveedor: ia.nombre } });
    }
  });

  const orquestador = crearOrquestador({ ia, pool });
  const authOpciones = { secreto: config.jwtSecret, pool };
  app.use('/api/auth', rutasAuth({ pool, config, enviarCorreoRecuperacion }));
  app.use('/api/admin', requiereAuth(authOpciones), rutasAdmin({ pool }));
  app.use('/api', rutasPublicas({ pool, orquestador, authOpciones }));

  app.use((_req, _res, next) => next(new HttpError(404, 'ruta_no_encontrada', 'La ruta solicitada no existe.')));
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };
