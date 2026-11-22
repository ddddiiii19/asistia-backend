// Modulo de orquestacion de IA (Q2, seccion 2.2).
// Flujo: interpretar y clasificar -> recuperar informacion institucional -> generar respuesta
//        -> verificar respaldo -> responder o escalar -> registrar en base de datos.
// El escalamiento termina en una persona o contacto de la dependencia; no interviene otra IA.
const { HttpError } = require('../errores');
const { verificarRespaldo } = require('./verificacion');
const { formatoRespuesta, FRASE_DEPENDENCIA_GENERICA } = require('./contacto');

const MAX_HISTORIAL = 6;

// Q8: el mensaje de escalamiento no nombra la dependencia ni incluye su contacto: ambos se muestran en sus propios
// bloques (contacto y dependencia) del formato estándar de respuesta.
function mensajeEscalamiento(dependencia) {
  if (!dependencia) {
    return 'No logré identificar con certeza la dependencia relacionada con tu consulta. Te recomiendo comunicarte con la dependencia correspondiente a través de los canales institucionales de TEINCO. Tu consulta quedó registrada como caso de escalamiento.';
  }
  return `No cuento con información suficiente para responder tu consulta con certeza. Te recomiendo ${FRASE_DEPENDENCIA_GENERICA}. Tu consulta quedó registrada como caso de escalamiento.`;
}

// Respuestas fijas y breves para la cortesia (saludo, agradecimiento, despedida).
// Son texto fijo a proposito: no se le pide a la IA que "converse", asi no puede salirse de los limites.
function mensajeCortesia(intencion, dependencias) {
  if (intencion === 'agradecimiento') return '¡Con gusto! Si tienes otra consulta, aquí estoy para ayudarte.';
  if (intencion === 'despedida') return '¡Hasta pronto! Cuando necesites orientación de TEINCO, aquí estaré.';
  const lista = dependencias.map((d) => d.nombre).join(', ');
  return `¡Hola! Soy AsistIA, el asistente de orientación de TEINCO. Puedo ayudarte con consultas de ${lista}. ¿En qué te puedo ayudar?`;
}

function crearOrquestador({ ia, pool }) {
  async function llamarIA(fn, datos) {
    try {
      return await fn.call(ia, datos);
    } catch (err) {
      console.error(`[ia:${ia.nombre}] fallo al consultar el servicio:`, err && err.message ? err.message : err);
      throw new HttpError(503, 'servicio_ia_no_disponible', 'El servicio de IA no está disponible en este momento. Intenta nuevamente más tarde.');
    }
  }

  async function procesar({ idSesion, idUsuario, mensaje, idConversacion }) {
    // Q6: se mide el tiempo de procesamiento del asistente para el reporte de tiempo promedio de respuesta.
    const inicio = process.hrtime.bigint();
    // 1. Lectura previa (sin escribir): conversacion, historial y dependencias.
    let historial = [];
    if (idConversacion) {
      const conv = await pool.query('SELECT 1 FROM conversacion WHERE id_conversacion = $1 AND id_usuario = $2', [idConversacion, idUsuario]);
      if (conv.rowCount === 0) throw new HttpError(404, 'conversacion_no_encontrada', 'La conversación no existe para esta sesión.');
      const h = await pool.query('SELECT emisor, contenido FROM mensaje WHERE id_conversacion = $1 ORDER BY id_mensaje DESC LIMIT $2', [idConversacion, MAX_HISTORIAL]);
      historial = h.rows.reverse();
    }
    const dependencias = (await pool.query('SELECT id_dependencia, nombre, descripcion, contacto_responsable, correos, telefono FROM dependencia ORDER BY id_dependencia')).rows;

    // 2. Interpretar y clasificar (servicio de IA generativa).
    const clasif = await llamarIA(ia.clasificar, { mensaje, historial, dependencias });
    const dependencia = dependencias.find((d) => d.id_dependencia === clasif.dependencia_id) || null;
    const clasificacion = (clasif.tema || '').trim().toLowerCase().slice(0, 100) || 'sin clasificar';

    // 2b. Cortesia (saludo, agradecimiento, despedida): respuesta breve fija, sin escalar.
    //     Se guardan los mensajes en la conversacion, pero no se registra consulta ni escalamiento.
    if (['saludo', 'agradecimiento', 'despedida'].includes(clasif.intencion)) {
      const respuesta = mensajeCortesia(clasif.intencion, dependencias);
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        let idConv = idConversacion;
        if (!idConv) {
          idConv = (await cliente.query('INSERT INTO conversacion (id_sesion, id_usuario) VALUES ($1, $2) RETURNING id_conversacion', [idSesion, idUsuario])).rows[0].id_conversacion;
        }
        await cliente.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'usuario', $2)", [idConv, mensaje]);
        await cliente.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'asistente', $2)", [idConv, respuesta]);
        await cliente.query('COMMIT');
        return { id_conversacion: idConv, ...formatoRespuesta({ mensaje: respuesta, dependencia: null }), escalada: false };
      } catch (err) {
        await cliente.query('ROLLBACK');
        throw err;
      } finally {
        cliente.release();
      }
    }

    // 3. Recuperar la informacion institucional de la dependencia y generar la respuesta.
    let contexto = [];
    let salida = null;
    if (dependencia) {
      contexto = (await pool.query(
        `SELECT 'INFO-' || id_info::text AS ref, 'informacion' AS tipo, titulo, contenido
           FROM informacion_institucional WHERE id_dependencia = $1
         UNION ALL
         SELECT 'FAQ-' || id_faq::text, 'faq', pregunta, respuesta
           FROM pregunta_frecuente WHERE id_dependencia = $1`, [dependencia.id_dependencia])).rows;
      // Un mismo texto puede estar cargado como información y como pregunta frecuente: se envía una sola vez
      // (evita respuestas repetidas y contexto redundante). Se conserva la primera aparición (la información).
      const vistos = new Set();
      contexto = contexto.filter((c) => {
        const clave = c.contenido.trim();
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      });
      if (contexto.length > 0) {
        salida = await llamarIA(ia.generar, { mensaje, historial, dependencia, contexto });
      }
    }

    // 4. Verificar que la respuesta tenga respaldo en la informacion institucional.
    const verificacion = verificarRespaldo({ dependencia, contexto, salida });
    const escalada = !verificacion.ok;
    // Registro técnico (visible en los logs del servidor) del motivo del escalamiento, para diagnosticar por qué
    // el asistente no pudo responder. No incluye el texto de la consulta ni datos del usuario.
    // Se omite al correr las pruebas automáticas (el ejecutor de pruebas de Node define NODE_TEST_CONTEXT).
    if (escalada && !process.env.NODE_TEST_CONTEXT) {
      console.warn(`[escalamiento] motivo=${verificacion.motivo} dependencia=${dependencia ? dependencia.nombre : 'ninguna'} fuentes_disponibles=${contexto.length} ia=${ia.nombre}`);
    }
    // Q8: se guarda solo el mensaje; el contacto (correo y teléfono) y la dependencia se componen aparte al responder y al mostrar el historial.
    const textoRespuesta = escalada ? mensajeEscalamiento(dependencia) : verificacion.respuesta;

    // 5. Registrar todo en una sola transaccion (si la IA fallo antes, no se escribio nada).
    //    El tiempo cubre clasificar, recuperar, generar y verificar; no incluye la escritura en base de datos.
    const tiempoRespuestaMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      let idConv = idConversacion;
      if (!idConv) {
        idConv = (await cliente.query('INSERT INTO conversacion (id_sesion, id_usuario) VALUES ($1, $2) RETURNING id_conversacion', [idSesion, idUsuario])).rows[0].id_conversacion;
      }
      const idMensaje = (await cliente.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'usuario', $2) RETURNING id_mensaje", [idConv, mensaje])).rows[0].id_mensaje;
      const idConsulta = (await cliente.query(
        'INSERT INTO consulta (id_conversacion, id_mensaje, id_dependencia, clasificacion, tiempo_respuesta_ms) VALUES ($1, $2, $3, $4, $5) RETURNING id_consulta',
        [idConv, idMensaje, dependencia ? dependencia.id_dependencia : null, clasificacion, tiempoRespuestaMs])).rows[0].id_consulta;
      await cliente.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'asistente', $2)", [idConv, textoRespuesta]);
      if (escalada) {
        await cliente.query('INSERT INTO escalamiento (id_consulta, motivo) VALUES ($1, $2)', [idConsulta, verificacion.motivo]);
      }
      await cliente.query('COMMIT');
      return {
        id_conversacion: idConv,
        ...formatoRespuesta({ mensaje: textoRespuesta, dependencia }),
        escalada,
      };
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    } finally {
      cliente.release();
    }
  }

  return { procesar };
}

module.exports = { crearOrquestador, mensajeEscalamiento, mensajeCortesia };
