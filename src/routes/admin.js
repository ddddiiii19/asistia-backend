const express = require('express');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../errores');
const { soloGlobal } = require('../middleware/auth');
const { textoObligatorio, entero, enteroOpcional, fechaOpcional, validarCorreo, validarNuevaContrasena, validarContactoDependencia, normalizarNombre } = require('../validar');
const { componerTextoContacto, sqlDependenciaDelMensaje, aplicarFormatoMensajes } = require('../ia/contacto');

// Alcance de consulta segun el rol: el administrador global ve todo (o filtra por dependencia);
// el administrador de una dependencia solo consulta los datos de su propia dependencia.
function dependenciaEnAlcance(req) {
  const pedida = enteroOpcional(req.query.dependencia, 'dependencia');
  if (req.admin.rol === 'dependencia') {
    if (pedida && pedida !== req.admin.id_dependencia) {
      throw new HttpError(403, 'fuera_de_alcance', 'Solo puedes consultar información de tu dependencia.');
    }
    return req.admin.id_dependencia;
  }
  return pedida;
}

// Dependencia a la que está limitado el administrador (null para el global). A diferencia de dependenciaEnAlcance,
// ignora el filtro opcional ?dependencia=: aquí interesa lo que la persona está AUTORIZADA a ver, no lo que filtra.
function dependenciaAutorizada(req) {
  return req.admin.rol === 'dependencia' ? req.admin.id_dependencia : null;
}

// Condición SQL: el mensaje `alias` de la conversación `conversacion` es visible para el administrador cuya
// dependencia autorizada es `param` (null = global, ve todo). El de dependencia solo ve la pregunta de cada consulta
// dirigida a su dependencia y la respuesta que recibió (el primer mensaje del asistente posterior a esa pregunta),
// no las demás preguntas de la misma conversación, que pertenecen a otras dependencias.
function mensajeVisible(alias, conversacion, param) {
  return `(${param}::int IS NULL
    OR ${alias}.id_mensaje IN (SELECT c.id_mensaje FROM consulta c
                                WHERE c.id_conversacion = ${conversacion} AND c.id_dependencia = ${param}::int)
    OR ${alias}.id_mensaje IN (SELECT (SELECT a.id_mensaje FROM mensaje a
                                        WHERE a.id_conversacion = ${conversacion} AND a.emisor = 'asistente' AND a.id_mensaje > c.id_mensaje
                                        ORDER BY a.id_mensaje LIMIT 1)
                                 FROM consulta c WHERE c.id_conversacion = ${conversacion} AND c.id_dependencia = ${param}::int))`;
}

// Q8: el administrador global modifica contenido de cualquier dependencia; el de una dependencia, solo el de la suya.
function permitirEscritura(req, idDependencia) {
  if (req.admin.rol === 'global') return;
  if (req.admin.id_dependencia !== idDependencia) {
    throw new HttpError(403, 'fuera_de_alcance', 'Solo puedes modificar el contenido de tu dependencia.');
  }
}

// Dependencia destino de un registro nuevo: la indicada (global) o, si el administrador es de una dependencia y no la
// indica, la suya.
function dependenciaDestino(req, valor) {
  if (req.admin.rol === 'dependencia' && (valor === undefined || valor === null || valor === '')) return req.admin.id_dependencia;
  return entero(valor, 'id_dependencia');
}

// Dependencia a la que pertenece un registro existente (404 si no existe).
async function dependenciaDelRegistro(pool, tabla, columnaId, id) {
  const { rows } = await pool.query(`SELECT id_dependencia FROM ${tabla} WHERE ${columnaId} = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'no_encontrado', 'El registro no existe.');
  return rows[0].id_dependencia;
}

function periodo(req) {
  const desde = fechaOpcional(req.query.desde, 'desde');
  const hasta = fechaOpcional(req.query.hasta, 'hasta');
  if (desde && hasta && desde > hasta) throw new HttpError(400, 'fecha_invalida', "'desde' no puede ser posterior a 'hasta'.");
  return { desde, hasta };
}

function paginacion(req) {
  const limite = Math.min(enteroOpcional(req.query.limite, 'limite') || 100, 500);
  const desplazamiento = Number(req.query.desplazamiento) > 0 ? Math.floor(Number(req.query.desplazamiento)) : 0;
  return { limite, desplazamiento };
}

const FILTRO_CONSULTA = `($1::int IS NULL OR c.id_dependencia = $1)
  AND ($2::date IS NULL OR c.fecha >= $2::date)
  AND ($3::date IS NULL OR c.fecha < $3::date + 1)`;

function rutasAdmin({ pool }) {
  const router = express.Router();

  // ---------- RF-12 Informacion institucional (consultar y modificar: global, o la propia dependencia) ----------
  router.get('/informacion', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const { rows } = await pool.query(
      `SELECT i.id_info, i.id_dependencia, d.nombre AS dependencia, i.titulo, i.contenido, i.fecha_actualizacion
         FROM informacion_institucional i JOIN dependencia d ON d.id_dependencia = i.id_dependencia
        WHERE ($1::int IS NULL OR i.id_dependencia = $1) ORDER BY i.id_dependencia, i.id_info`, [dep]);
    res.json(rows);
  });

  router.post('/informacion', async (req, res) => {
    const b = req.body || {};
    const idDependencia = dependenciaDestino(req, b.id_dependencia);
    permitirEscritura(req, idDependencia);
    const { rows } = await pool.query(
      'INSERT INTO informacion_institucional (id_dependencia, titulo, contenido) VALUES ($1, $2, $3) RETURNING *',
      [idDependencia, textoObligatorio(b.titulo, 'titulo', 150), textoObligatorio(b.contenido, 'contenido')]);
    res.status(201).json(rows[0]);
  });

  router.put('/informacion/:id', async (req, res) => {
    const b = req.body || {};
    const id = entero(req.params.id, 'id');
    permitirEscritura(req, await dependenciaDelRegistro(pool, 'informacion_institucional', 'id_info', id));
    const nueva = enteroOpcional(b.id_dependencia, 'id_dependencia');
    if (nueva) permitirEscritura(req, nueva);
    const { rows } = await pool.query(
      `UPDATE informacion_institucional
          SET titulo = $2, contenido = $3, id_dependencia = COALESCE($4, id_dependencia), fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_info = $1 RETURNING *`,
      [id, textoObligatorio(b.titulo, 'titulo', 150), textoObligatorio(b.contenido, 'contenido'), nueva]);
    if (rows.length === 0) throw new HttpError(404, 'no_encontrado', 'El registro no existe.');
    res.json(rows[0]);
  });

  router.delete('/informacion/:id', async (req, res) => {
    const id = entero(req.params.id, 'id');
    permitirEscritura(req, await dependenciaDelRegistro(pool, 'informacion_institucional', 'id_info', id));
    const r = await pool.query('DELETE FROM informacion_institucional WHERE id_info = $1', [id]);
    if (r.rowCount === 0) throw new HttpError(404, 'no_encontrado', 'El registro no existe.');
    res.status(204).end();
  });

  // ---------- RF-14 Preguntas frecuentes (consultar y modificar: global, o la propia dependencia) ----------
  router.get('/faq', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const { rows } = await pool.query(
      `SELECT f.id_faq, f.id_dependencia, d.nombre AS dependencia, f.pregunta, f.respuesta, f.frecuencia
         FROM pregunta_frecuente f JOIN dependencia d ON d.id_dependencia = f.id_dependencia
        WHERE ($1::int IS NULL OR f.id_dependencia = $1) ORDER BY f.id_dependencia, f.id_faq`, [dep]);
    res.json(rows);
  });

  router.post('/faq', async (req, res) => {
    const b = req.body || {};
    const idDependencia = dependenciaDestino(req, b.id_dependencia);
    permitirEscritura(req, idDependencia);
    const { rows } = await pool.query(
      'INSERT INTO pregunta_frecuente (id_dependencia, pregunta, respuesta) VALUES ($1, $2, $3) RETURNING *',
      [idDependencia, textoObligatorio(b.pregunta, 'pregunta', 255), textoObligatorio(b.respuesta, 'respuesta')]);
    res.status(201).json(rows[0]);
  });

  router.put('/faq/:id', async (req, res) => {
    const b = req.body || {};
    const id = entero(req.params.id, 'id');
    permitirEscritura(req, await dependenciaDelRegistro(pool, 'pregunta_frecuente', 'id_faq', id));
    const nueva = enteroOpcional(b.id_dependencia, 'id_dependencia');
    if (nueva) permitirEscritura(req, nueva);
    const { rows } = await pool.query(
      `UPDATE pregunta_frecuente SET pregunta = $2, respuesta = $3, id_dependencia = COALESCE($4, id_dependencia)
        WHERE id_faq = $1 RETURNING *`,
      [id, textoObligatorio(b.pregunta, 'pregunta', 255), textoObligatorio(b.respuesta, 'respuesta'), nueva]);
    if (rows.length === 0) throw new HttpError(404, 'no_encontrado', 'El registro no existe.');
    res.json(rows[0]);
  });

  router.delete('/faq/:id', async (req, res) => {
    const id = entero(req.params.id, 'id');
    permitirEscritura(req, await dependenciaDelRegistro(pool, 'pregunta_frecuente', 'id_faq', id));
    const r = await pool.query('DELETE FROM pregunta_frecuente WHERE id_faq = $1', [id]);
    if (r.rowCount === 0) throw new HttpError(404, 'no_encontrado', 'El registro no existe.');
    res.status(204).end();
  });

  // ---------- RF-13 Historial de conversaciones de los usuarios ----------
  // No se expone id_sesion: funciona como credencial de acceso al historial de cada usuario.
  router.get('/conversaciones', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const { desde, hasta } = periodo(req);
    const { limite, desplazamiento } = paginacion(req);
    const aut = dependenciaAutorizada(req);
    const { rows } = await pool.query(
      `SELECT cv.id_conversacion, cv.fecha_inicio,
              (SELECT count(*)::int FROM mensaje m WHERE m.id_conversacion = cv.id_conversacion
                  AND ${mensajeVisible('m', 'cv.id_conversacion', '$6')}) AS mensajes,
              (SELECT m.contenido FROM mensaje m WHERE m.id_conversacion = cv.id_conversacion AND m.emisor = 'usuario'
                  AND ${mensajeVisible('m', 'cv.id_conversacion', '$6')}
                ORDER BY m.id_mensaje LIMIT 1) AS primera_consulta,
              EXISTS (SELECT 1 FROM consulta c JOIN escalamiento e ON e.id_consulta = c.id_consulta
                       WHERE c.id_conversacion = cv.id_conversacion AND ${FILTRO_CONSULTA}) AS escalada,
              (SELECT d.nombre FROM consulta c JOIN dependencia d ON d.id_dependencia = c.id_dependencia
                WHERE c.id_conversacion = cv.id_conversacion AND ${FILTRO_CONSULTA}
                ORDER BY c.id_consulta DESC LIMIT 1) AS dependencia
         FROM conversacion cv
        WHERE EXISTS (SELECT 1 FROM consulta c WHERE c.id_conversacion = cv.id_conversacion AND ${FILTRO_CONSULTA})
        ORDER BY cv.fecha_inicio DESC, cv.id_conversacion DESC LIMIT $4 OFFSET $5`,
      [dep, desde, hasta, limite, desplazamiento, aut]);
    res.json(rows);
  });

  router.get('/conversaciones/:id', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const id = entero(req.params.id, 'id');
    const conv = await pool.query(
      `SELECT cv.id_conversacion, cv.fecha_inicio FROM conversacion cv
        WHERE cv.id_conversacion = $2
          AND EXISTS (SELECT 1 FROM consulta c WHERE c.id_conversacion = cv.id_conversacion AND ($1::int IS NULL OR c.id_dependencia = $1))`,
      [dep, id]);
    if (conv.rowCount === 0) throw new HttpError(404, 'conversacion_no_encontrada', 'La conversación no existe o está fuera de tu alcance.');
    const aut = dependenciaAutorizada(req);
    const mensajes = await pool.query(
      `SELECT m.id_mensaje, m.emisor, m.contenido, m.fecha, ${sqlDependenciaDelMensaje('m')} AS id_dependencia_respuesta FROM mensaje m
        WHERE m.id_conversacion = $2 AND ${mensajeVisible('m', '$2::int', '$1')} ORDER BY m.id_mensaje`, [aut, id]);
    // Q6: ficha de cada consulta de la conversación (solo las de la dependencia en alcance), para el historial del panel.
    const consultas = await pool.query(
      `SELECT c.id_consulta, c.id_mensaje, c.fecha, d.nombre AS dependencia, c.clasificacion, c.tiempo_respuesta_ms,
              CASE WHEN e.id_escalamiento IS NULL THEN 'resuelta' ELSE 'escalada' END AS estado,
              e.motivo AS motivo_escalamiento
         FROM consulta c
         LEFT JOIN dependencia d ON d.id_dependencia = c.id_dependencia
         LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
        WHERE c.id_conversacion = $2 AND ($1::int IS NULL OR c.id_dependencia = $1)
        ORDER BY c.id_consulta`, [aut, id]);
    // Q8: las respuestas del asistente se muestran en el formato estándar (mensaje, contacto y dependencia).
    res.json({ ...conv.rows[0], mensajes: await aplicarFormatoMensajes(pool, mensajes.rows), consultas: consultas.rows });
  });

  // ---------- RF-15 Reportes de interacciones (con filtros de RF-17) ----------
  router.get('/reportes/interacciones', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const { desde, hasta } = periodo(req);
    const { limite, desplazamiento } = paginacion(req);
    const { rows } = await pool.query(
      `SELECT c.id_consulta, c.id_conversacion, c.fecha, m.contenido AS consulta,
              d.nombre AS dependencia, c.clasificacion, c.tiempo_respuesta_ms,
              CASE WHEN e.id_escalamiento IS NULL THEN 'resuelta' ELSE 'escalada' END AS estado,
              e.motivo AS motivo_escalamiento
         FROM consulta c
         JOIN mensaje m ON m.id_mensaje = c.id_mensaje
         LEFT JOIN dependencia d ON d.id_dependencia = c.id_dependencia
         LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
        WHERE ${FILTRO_CONSULTA}
        ORDER BY c.fecha DESC, c.id_consulta DESC LIMIT $4 OFFSET $5`,
      [dep, desde, hasta, limite, desplazamiento]);
    res.json(rows);
  });

  // ---------- RF-16 Estadisticas de uso (con filtros de RF-17) ----------
  router.get('/estadisticas', async (req, res) => {
    const p = [dependenciaEnAlcance(req), ...Object.values(periodo(req))];
    const totales = await pool.query(
      `SELECT count(*)::int AS total, count(e.id_escalamiento)::int AS escaladas
         FROM consulta c LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta WHERE ${FILTRO_CONSULTA}`, p);
    const porDependencia = await pool.query(
      `SELECT COALESCE(d.nombre, 'Sin identificar') AS dependencia, count(*)::int AS total, count(e.id_escalamiento)::int AS escaladas
         FROM consulta c
         LEFT JOIN dependencia d ON d.id_dependencia = c.id_dependencia
         LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
        WHERE ${FILTRO_CONSULTA} GROUP BY 1 ORDER BY total DESC, dependencia`, p);
    const temas = await pool.query(
      `SELECT COALESCE(c.clasificacion, 'sin clasificar') AS tema, count(*)::int AS total
         FROM consulta c WHERE ${FILTRO_CONSULTA} GROUP BY 1 ORDER BY total DESC, tema LIMIT 5`, p);
    res.json({ ...totales.rows[0], por_dependencia: porDependencia.rows, temas_mas_consultados: temas.rows });
  });

  // ---------- Q6: Resumen de reportes ----------
  // Indicadores para el panel: consultas realizadas, resueltas/escaladas, tiempo promedio de respuesta,
  // preguntas más frecuentes y dependencias a las que más se direccionan los usuarios.
  // Usa el mismo alcance por rol y los mismos filtros (dependencia, desde, hasta) que RF-15 a RF-17.
  // "Resuelta" = la consulta no generó un escalamiento (la respuesta tuvo respaldo institucional verificado).
  router.get('/reportes/resumen', async (req, res) => {
    const dep = dependenciaEnAlcance(req);
    const p = [dep, ...Object.values(periodo(req))];

    const totales = (await pool.query(
      `SELECT count(*)::int AS total, count(e.id_escalamiento)::int AS escaladas,
          round(avg(c.tiempo_respuesta_ms))::int AS tiempo_promedio_ms,
          round((percentile_cont(0.95) WITHIN GROUP (ORDER BY c.tiempo_respuesta_ms))::numeric)::int AS tiempo_p95_ms
     FROM consulta c LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
    WHERE ${FILTRO_CONSULTA}`, p)).rows[0];

    const porDependencia = (await pool.query(
      `SELECT d.id_dependencia, COALESCE(d.nombre, 'Sin identificar') AS dependencia,
              count(*)::int AS total, count(e.id_escalamiento)::int AS escaladas,
              round(avg(c.tiempo_respuesta_ms))::int AS tiempo_promedio_ms
         FROM consulta c
         LEFT JOIN dependencia d ON d.id_dependencia = c.id_dependencia
         LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
        WHERE ${FILTRO_CONSULTA}
        GROUP BY d.id_dependencia, d.nombre ORDER BY total DESC, dependencia`, p)).rows;

    const temas = (await pool.query(
      `SELECT COALESCE(c.clasificacion, 'sin clasificar') AS tema, count(*)::int AS total
         FROM consulta c WHERE ${FILTRO_CONSULTA} GROUP BY 1 ORDER BY total DESC, tema LIMIT 10`, p)).rows;

    // Preguntas más repetidas: se agrupa por el texto normalizado (minúsculas, sin signos ni espacios dobles)
    // y se muestra la redacción más reciente. Solo cuenta mensajes que generaron una consulta.
    const preguntas = (await pool.query(
      `SELECT (array_agg(m.contenido ORDER BY c.fecha DESC, c.id_consulta DESC))[1] AS pregunta,
              count(*)::int AS total,
              mode() WITHIN GROUP (ORDER BY COALESCE(d.nombre, 'Sin identificar')) AS dependencia
         FROM consulta c
         JOIN mensaje m ON m.id_mensaje = c.id_mensaje
         LEFT JOIN dependencia d ON d.id_dependencia = c.id_dependencia
        WHERE ${FILTRO_CONSULTA}
        GROUP BY btrim(regexp_replace(lower(m.contenido), '[¿?¡!.,;:\\s]+', ' ', 'g'))
        ORDER BY total DESC, pregunta LIMIT 10`, p)).rows;

    // Preguntas frecuentes del catálogo (RF-10): el contador es acumulado y no se filtra por fechas.
    const faq = (await pool.query(
      `SELECT f.id_faq, f.pregunta, d.nombre AS dependencia, f.frecuencia
         FROM pregunta_frecuente f JOIN dependencia d ON d.id_dependencia = f.id_dependencia
        WHERE f.frecuencia > 0 AND ($1::int IS NULL OR f.id_dependencia = $1)
        ORDER BY f.frecuencia DESC, f.id_faq LIMIT 5`, [dep])).rows;

    // Consultas por día (hasta los 90 días más recientes del periodo).
    const serie = (await pool.query(
      `SELECT to_char(c.fecha::date, 'YYYY-MM-DD') AS dia, count(*)::int AS total, count(e.id_escalamiento)::int AS escaladas
         FROM consulta c LEFT JOIN escalamiento e ON e.id_consulta = c.id_consulta
        WHERE ${FILTRO_CONSULTA} GROUP BY 1 ORDER BY 1 DESC LIMIT 90`, p)).rows.reverse();

    const resueltas = totales.total - totales.escaladas;
    res.json({
      total: totales.total,
      resueltas,
      escaladas: totales.escaladas,
      tasa_resolucion: totales.total > 0 ? Math.round((resueltas / totales.total) * 1000) / 10 : null,
      tiempo_promedio_ms: totales.tiempo_promedio_ms,
      tiempo_p95_ms: totales.tiempo_p95_ms,
      por_dependencia: porDependencia.map((d) => ({ ...d, resueltas: d.total - d.escaladas })),
      temas_mas_consultados: temas,
      preguntas_mas_frecuentes: preguntas,
      faq_mas_consultadas: faq,
      consultas_por_dia: serie,
    });
  });

  // Valida los datos comunes de una cuenta nueva y comprueba que el nombre de usuario y el correo no existan
  // (ni como Usuario ni como administrador).
  async function datosCuentaNueva(b) {
    const nombreUsuario = textoObligatorio(b.nombre_usuario, 'nombre_usuario', 50);
    const correo = validarCorreo(b.correo);
    const contrasena = validarNuevaContrasena(b.contrasena);
    const nombreNorm = nombreUsuario.toLowerCase();
    const existe = await pool.query(
      `SELECT 1 FROM cuenta_usuario WHERE LOWER(nombre_usuario) = $1 OR LOWER(correo) = $2
       UNION ALL
       SELECT 1 FROM administrador WHERE LOWER(nombre_usuario) = $1 OR LOWER(correo) = $2
       LIMIT 1`, [nombreNorm, correo]);
    if (existe.rowCount > 0) {
      throw new HttpError(409, 'cuenta_existente', 'Ya existe una cuenta con ese nombre de usuario o correo.');
    }
    return { nombreUsuario, correo, hash: await bcrypt.hash(contrasena, 12) };
  }

  // Crear cuentas del rol Usuario. Solo el administrador global puede hacerlo.
  // No se permite autorregistro público ni asignar roles desde el formulario.
  router.post('/cuentas/usuarios', soloGlobal, async (req, res) => {
    const { nombreUsuario, correo, hash } = await datosCuentaNueva(req.body || {});
    const { rows } = await pool.query(
      `INSERT INTO cuenta_usuario (nombre_usuario, correo, contrasena_hash)
       VALUES ($1, $2, $3) RETURNING id_usuario, nombre_usuario, correo, activo, fecha_creacion`,
      [nombreUsuario, correo, hash]);
    res.status(201).json({ cuenta: { tipo: 'usuario', rol: 'usuario', ...rows[0] } });
  });

  // ---------- Q8: dependencias (listar y editar descripción y contacto) ----------
  const COLUMNAS_DEPENDENCIA = `d.id_dependencia, d.nombre, d.descripcion, d.correos, d.telefono,
      (SELECT count(*)::int FROM informacion_institucional i WHERE i.id_dependencia = d.id_dependencia) AS total_informacion,
      (SELECT count(*)::int FROM pregunta_frecuente f WHERE f.id_dependencia = d.id_dependencia) AS total_faq`;

  // El global ve todas; el de una dependencia, solo la suya.
  router.get('/dependencias', async (req, res) => {
    const aut = dependenciaAutorizada(req);
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS_DEPENDENCIA} FROM dependencia d WHERE ($1::int IS NULL OR d.id_dependencia = $1) ORDER BY d.id_dependencia`, [aut]);
    res.json(rows);
  });

  // Solo se edita la descripción (la usa la IA para clasificar) y el contacto. El nombre no cambia y la dependencia no se elimina.
  router.put('/dependencias/:id', async (req, res) => {
    const b = req.body || {};
    const id = entero(req.params.id, 'id');
    permitirEscritura(req, id);
    const cambiaContacto = b.correos !== undefined || b.telefono !== undefined;
    if (b.descripcion === undefined && !cambiaContacto) {
      throw new HttpError(400, 'dato_invalido', "Indica 'descripcion' o el contacto ('correos' y 'telefono') que deseas actualizar.");
    }
    const actual = await pool.query('SELECT id_dependencia FROM dependencia WHERE id_dependencia = $1', [id]);
    if (actual.rowCount === 0) throw new HttpError(404, 'dependencia_no_encontrada', 'La dependencia indicada no existe.');
    const sets = [];
    const valores = [id];
    if (b.descripcion !== undefined) {
      valores.push(textoObligatorio(b.descripcion, 'descripcion', 500));
      sets.push(`descripcion = $${valores.length}`);
    }
    if (cambiaContacto) {
      const { correos, telefono } = validarContactoDependencia(b);
      valores.push(correos, telefono, componerTextoContacto(correos, telefono));
      sets.push(`correos = $${valores.length - 2}`, `telefono = $${valores.length - 1}`, `contacto_responsable = $${valores.length}`);
    }
    await pool.query(`UPDATE dependencia SET ${sets.join(', ')} WHERE id_dependencia = $1`, valores);
    const { rows } = await pool.query(`SELECT ${COLUMNAS_DEPENDENCIA} FROM dependencia d WHERE d.id_dependencia = $1`, [id]);
    res.json(rows[0]);
  });

  // Q7/Q8: crear la cuenta de una dependencia (administrador con alcance de dependencia). Solo el administrador global.
  // El rol siempre es 'dependencia': desde este endpoint no se puede crear otro administrador global.
  // Q8: el nombre de la dependencia se escribe libremente: si no existe se crea en la misma transacción con su descripción
  // y su contacto (correos y teléfono); sus apartados (información, preguntas frecuentes, historial y reportes) quedan
  // limitados a ella. Si llega `id_dependencia` (forma de Q7) la cuenta se asigna a una dependencia existente.
  router.post('/cuentas/administradores-dependencia', soloGlobal, async (req, res) => {
    const b = req.body || {};
    if (b.id_dependencia !== undefined && b.id_dependencia !== null && b.id_dependencia !== '') {
      const idDependencia = entero(b.id_dependencia, 'id_dependencia');
      const dep = await pool.query('SELECT id_dependencia, nombre FROM dependencia WHERE id_dependencia = $1', [idDependencia]);
      if (dep.rowCount === 0) throw new HttpError(404, 'dependencia_no_encontrada', 'La dependencia indicada no existe.');
      const { nombreUsuario, correo, hash } = await datosCuentaNueva(b);
      const { rows } = await pool.query(
        `INSERT INTO administrador (nombre_usuario, correo, contrasena_hash, rol, id_dependencia)
         VALUES ($1, $2, $3, 'dependencia', $4)
         RETURNING id_administrador, nombre_usuario, correo, id_dependencia`,
        [nombreUsuario, correo, hash, idDependencia]);
      return res.status(201).json({
        cuenta: { tipo: 'administrador', rol: 'administrador', alcance_admin: 'dependencia', ...rows[0], dependencia: dep.rows[0].nombre },
      });
    }

    const nombre = textoObligatorio(b.nombre_dependencia, 'nombre_dependencia', 100).replace(/\s+/g, ' ');
    if (nombre.length < 3 || !/\p{L}/u.test(nombre)) {
      throw new HttpError(400, 'dato_invalido', "El campo 'nombre_dependencia' debe tener al menos 3 caracteres e incluir letras.");
    }
    const descripcion = textoObligatorio(b.descripcion, 'descripcion', 500);
    const { correos, telefono } = validarContactoDependencia(b);
    const existentes = (await pool.query('SELECT nombre FROM dependencia')).rows;
    if (existentes.some((d) => normalizarNombre(d.nombre) === normalizarNombre(nombre))) {
      throw new HttpError(409, 'dependencia_existente', 'Ya existe una dependencia con ese nombre.');
    }
    const { nombreUsuario, correo, hash } = await datosCuentaNueva(b);

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const dep = (await cliente.query(
        `INSERT INTO dependencia (nombre, descripcion, contacto_responsable, correos, telefono)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_dependencia, nombre, descripcion, correos, telefono`,
        [nombre, descripcion, componerTextoContacto(correos, telefono), correos, telefono])).rows[0];
      const cuenta = (await cliente.query(
        `INSERT INTO administrador (nombre_usuario, correo, contrasena_hash, rol, id_dependencia)
         VALUES ($1, $2, $3, 'dependencia', $4)
         RETURNING id_administrador, nombre_usuario, correo, id_dependencia`,
        [nombreUsuario, correo, hash, dep.id_dependencia])).rows[0];
      await cliente.query('COMMIT');
      return res.status(201).json({
        cuenta: { tipo: 'administrador', rol: 'administrador', alcance_admin: 'dependencia', ...cuenta, dependencia: dep.nombre },
        dependencia: { ...dep, total_informacion: 0, total_faq: 0 },
      });
    } catch (err) {
      await cliente.query('ROLLBACK');
      // Carreras entre dos solicitudes simultáneas: la base de datos también impide duplicados.
      if (err && err.code === '23505') {
        if (/dependencia/.test(String(err.constraint || err.table || ''))) throw new HttpError(409, 'dependencia_existente', 'Ya existe una dependencia con ese nombre.');
        throw new HttpError(409, 'cuenta_existente', 'Ya existe una cuenta con ese nombre de usuario o correo.');
      }
      throw err;
    } finally {
      cliente.release();
    }
  });

  return router;
}

module.exports = { rutasAdmin };
