const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../errores');
const { textoObligatorio, idSesion, entero, enteroOpcional } = require('../validar');
const { requiereUsuario } = require('../middleware/auth');
const { formatoRespuesta, sqlDependenciaDelMensaje, aplicarFormatoMensajes } = require('../ia/contacto');

function rutasPublicas({ pool, orquestador, authOpciones }) {
  const router = express.Router();
  const limitadorChat = rateLimit({
    windowMs: 60 * 1000, limit: Number(process.env.CHAT_LIMITE) || 20,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'demasiadas_solicitudes', mensaje: 'Has enviado demasiados mensajes. Espera un momento.' },
  });

  // RF-01 a RF-08 - Registrar consulta, interpretar, clasificar, direccionar, responder o escalar.
  router.post('/chat', requiereUsuario(authOpciones), limitadorChat, async (req, res) => {
    const cuerpo = req.body || {};
    const resultado = await orquestador.procesar({
      idSesion: idSesion(cuerpo.id_sesion),
      idUsuario: req.usuario.id,
      mensaje: textoObligatorio(cuerpo.mensaje, 'mensaje', 1000),
      idConversacion: enteroOpcional(cuerpo.id_conversacion, 'id_conversacion'),
    });
    res.json(resultado);
  });

  router.get('/dependencias', async (_req, res) => {
    const { rows } = await pool.query('SELECT id_dependencia, nombre, descripcion FROM dependencia ORDER BY id_dependencia');
    res.json(rows);
  });

  // RF-09 - Historial de conversaciones del usuario autenticado, asociado a id_usuario.
  router.get('/conversaciones', requiereUsuario(authOpciones), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT cv.id_conversacion, cv.fecha_inicio,
              (SELECT m.contenido FROM mensaje m WHERE m.id_conversacion = cv.id_conversacion AND m.emisor = 'usuario'
                ORDER BY m.id_mensaje LIMIT 1) AS primera_consulta,
              (SELECT d.nombre FROM consulta c JOIN dependencia d ON d.id_dependencia = c.id_dependencia
                WHERE c.id_conversacion = cv.id_conversacion ORDER BY c.id_consulta DESC LIMIT 1) AS dependencia
         FROM conversacion cv WHERE cv.id_usuario = $1
        ORDER BY cv.fecha_inicio DESC, cv.id_conversacion DESC LIMIT 50`, [req.usuario.id]);
    res.json(rows);
  });

  router.get('/conversaciones/:id', requiereUsuario(authOpciones), async (req, res) => {
    const id = entero(req.params.id, 'id');
    const conv = await pool.query('SELECT id_conversacion, fecha_inicio FROM conversacion WHERE id_conversacion = $1 AND id_usuario = $2', [id, req.usuario.id]);
    if (conv.rowCount === 0) throw new HttpError(404, 'conversacion_no_encontrada', 'La conversación no existe para esta cuenta.');
    // Q8: cada respuesta del asistente se muestra en el formato estándar (mensaje, contacto y dependencia).
    const mensajes = await pool.query(
      `SELECT m.id_mensaje, m.emisor, m.contenido, m.fecha, ${sqlDependenciaDelMensaje('m')} AS id_dependencia_respuesta
         FROM mensaje m WHERE m.id_conversacion = $1 ORDER BY m.id_mensaje`, [id]);
    res.json({ ...conv.rows[0], mensajes: await aplicarFormatoMensajes(pool, mensajes.rows) });
  });

  // RF-10 - Consultar preguntas frecuentes.
  router.get('/faq', requiereUsuario(authOpciones), async (req, res) => {
    const dep = enteroOpcional(req.query.dependencia, 'dependencia');
    const { rows } = await pool.query(
      `SELECT f.id_faq, f.pregunta, d.nombre AS dependencia
         FROM pregunta_frecuente f JOIN dependencia d ON d.id_dependencia = f.id_dependencia
        WHERE ($1::int IS NULL OR f.id_dependencia = $1) ORDER BY f.frecuencia DESC, f.id_faq`, [dep]);
    res.json(rows);
  });

  // Seleccionar una pregunta frecuente: devuelve su respuesta y suma una consulta a 'frecuencia'.
  router.post('/faq/:id/consulta', requiereUsuario(authOpciones), async (req, res) => {
    const id = entero(req.params.id, 'id');
    const { rows } = await pool.query(
      `WITH f AS (
         UPDATE pregunta_frecuente SET frecuencia = frecuencia + 1 WHERE id_faq = $1
         RETURNING id_faq, id_dependencia, pregunta, respuesta
       )
       SELECT f.id_faq, f.pregunta, f.respuesta, d.id_dependencia, d.nombre, d.contacto_responsable, d.correos, d.telefono
         FROM f JOIN dependencia d ON d.id_dependencia = f.id_dependencia`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'faq_no_encontrada', 'La pregunta frecuente no existe.');
    const fila = rows[0];
    // Q8: misma estructura que el chat: respuesta (mensaje), contacto y dependencia.
    res.json({ id_faq: fila.id_faq, pregunta: fila.pregunta, ...formatoRespuesta({ mensaje: fila.respuesta, dependencia: fila }) });
  });

  return router;
}

module.exports = { rutasPublicas };
