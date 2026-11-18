// Q7: toda respuesta de una dependencia incluye su contacto institucional (correo y teléfono).
// El contacto sale de la columna contacto_responsable de la tabla dependencia; nunca lo escribe el modelo.

const PATRON_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function correosDe(texto) {
  return (String(texto).match(PATRON_CORREO) || []).map((c) => c.toLowerCase());
}

// Agrega al final de la respuesta una línea con el contacto de la dependencia.
// No lo repite si la respuesta ya incluye alguno de los correos del contacto (por ejemplo, porque el texto
// institucional que la respalda ya lo menciona) ni agrega nada si la dependencia no tiene contacto cargado.
function conContacto(respuesta, dependencia) {
  const contacto = dependencia && typeof dependencia.contacto_responsable === 'string' ? dependencia.contacto_responsable.trim() : '';
  if (!contacto) return respuesta;
  const minuscula = String(respuesta).toLowerCase();
  if (correosDe(contacto).some((c) => minuscula.includes(c))) return respuesta;
  const cierre = /[.!?]$/.test(contacto) ? '' : '.';
  return `${respuesta}\n\nContacto de ${dependencia.nombre}: ${contacto}${cierre}`;
}



// ---------------------------------------------------------------------------------------------------------------
// Q8: formato estándar de respuesta de una dependencia en tres partes: mensaje, contacto y dependencia.
// El contacto (correo y teléfono) sale de las columnas estructuradas `correos` y `telefono` de la dependencia; si una
// base aún no tiene esos datos estructurados se usa el texto libre `contacto_responsable`. Nunca lo escribe el modelo.
// ---------------------------------------------------------------------------------------------------------------

const MIN_DIGITOS_TELEFONO = 7;

function digitos(texto) {
  return String(texto || '').replace(/\D/g, '');
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Obtiene correos y teléfono(s) de un texto libre de contacto (por ejemplo "a@x.co o b@x.co · Tel. 601 743 32 00").
// Se usa en la migración y al sincronizar; no inventa nada. Lo que no es correo y trae un número de teléfono se conserva
// completo como `telefono` (por ejemplo "601 743 32 00 · WhatsApp 301 333 79 56"), para no perder ningún número.
function extraerContacto(texto) {
  const original = String(texto || '');
  const vistos = new Set();
  const correos = [];
  for (const c of original.match(PATRON_CORREO) || []) {
    if (!vistos.has(c.toLowerCase())) { vistos.add(c.toLowerCase()); correos.push(c); }
  }
  const residuo = original.replace(PATRON_CORREO, ' ')
    .replace(/\s+o\s+(?=\s*(?:[·|;,]|$))/gi, ' ')
    .replace(/\s*[·|;]\s*/g, ' · ')
    .replace(/^[\s·|;,.-]+|[\s·|;,.-]+$/g, '')
    .replace(/(?:^|(?<= · ))(?:tel(?:[eé]fono)?|cel(?:ular)?)\.?\s*:?\s*(?=\+?\d)/gi, '')
    .replace(/(?: · ){2,}/g, ' · ')
    .replace(/\s+/g, ' ').trim();
  let telefono = null;
  if (digitos(residuo).length >= MIN_DIGITOS_TELEFONO && residuo.length <= 100) {
    telefono = residuo;
  } else {
    const m = residuo.match(/\+?\d[\d\s().-]{5,}\d/);
    if (m && digitos(m[0]).length >= MIN_DIGITOS_TELEFONO) telefono = m[0].replace(/\s+/g, ' ').trim();
  }
  return { correos, telefono };
}

// Texto de contacto con el estilo de la base actual: "correo (o correo) · Tel. número".
function componerTextoContacto(correos, telefono) {
  const partes = [];
  if (Array.isArray(correos) && correos.length > 0) partes.push(correos.join(' o '));
  if (telefono) partes.push(`Tel. ${telefono}`);
  return partes.join(' · ');
}

// Contacto de una dependencia para mostrar: { correos, telefono, texto } o null si no tiene contacto cargado.
function contactoDe(dependencia) {
  if (!dependencia) return null;
  const correos = Array.isArray(dependencia.correos) ? dependencia.correos.filter(Boolean) : [];
  const telefono = typeof dependencia.telefono === 'string' && dependencia.telefono.trim() ? dependencia.telefono.trim() : null;
  let texto = componerTextoContacto(correos, telefono);
  if (!texto && typeof dependencia.contacto_responsable === 'string') texto = dependencia.contacto_responsable.trim();
  if (!texto) return null;
  return { correos, telefono, texto };
}

// ¿El texto del mensaje ya trae el contacto (algún correo o el teléfono)? Entonces no se repite en su propio bloque.
function mensajeIncluyeContacto(mensaje, dependencia) {
  const contacto = contactoDe(dependencia);
  if (!contacto) return false;
  const minuscula = String(mensaje).toLowerCase();
  const correos = contacto.correos.length > 0 ? contacto.correos : correosDe(contacto.texto);
  if (correos.some((c) => minuscula.includes(c.toLowerCase()))) return true;
  const tel = digitos(contacto.telefono || extraerContacto(contacto.texto).telefono);
  return tel.length >= MIN_DIGITOS_TELEFONO && digitos(mensaje).includes(tel);
}

const FRASE_DEPENDENCIA_GENERICA = 'comunicarte directamente con la dependencia indicada';

// Mensajes guardados antes de Q8 traen el contacto y el nombre de la dependencia dentro del texto
// (línea final "Contacto de X: ..." o la frase del escalamiento). Se retiran solo al mostrar; no se modifican filas.
function limpiarMensaje(mensaje, dependencia) {
  let texto = String(mensaje);
  if (!dependencia || !dependencia.nombre) return texto;
  const nombre = escaparRegex(dependencia.nombre);
  texto = texto.replace(new RegExp(`\\s*Contacto de ${nombre}:[^\\n]*\\s*$`), '');
  texto = texto.replace(new RegExp(`comunicarte directamente con ${nombre}\\.(?: Contacto: [\\s\\S]*?\\.)?(?= Tu consulta quedó)`), `${FRASE_DEPENDENCIA_GENERICA}.`);
  return texto.trim();
}

// Arma las tres partes de la respuesta. Sin dependencia identificada (saludos, cortesía, consultas sin clasificar)
// `contacto` y `dependencia` son null. El contacto no se repite si el mensaje ya lo incluye.
function formatoRespuesta({ mensaje, dependencia }) {
  if (!dependencia) return { respuesta: String(mensaje), contacto: null, dependencia: null };
  const respuesta = limpiarMensaje(mensaje, dependencia);
  const contacto = mensajeIncluyeContacto(respuesta, dependencia) ? null : contactoDe(dependencia);
  return {
    respuesta,
    contacto,
    dependencia: { id_dependencia: dependencia.id_dependencia, nombre: dependencia.nombre },
  };
}

// SQL: dependencia de la consulta a la que responde el mensaje `alias` (la consulta de la pregunta del usuario
// inmediatamente anterior). Solo tiene valor para mensajes del asistente.
function sqlDependenciaDelMensaje(alias) {
  return `(CASE WHEN ${alias}.emisor = 'asistente' THEN
      (SELECT c.id_dependencia FROM consulta c
        WHERE c.id_conversacion = ${alias}.id_conversacion
          AND c.id_mensaje = (SELECT u.id_mensaje FROM mensaje u
                               WHERE u.id_conversacion = ${alias}.id_conversacion AND u.emisor = 'usuario' AND u.id_mensaje < ${alias}.id_mensaje
                               ORDER BY u.id_mensaje DESC LIMIT 1))
    END)`;
}

// Historial: a cada mensaje del asistente le agrega `contacto` y `dependencia` (mismo formato que el chat).
// Las filas deben traer `id_dependencia_respuesta` (ver sqlDependenciaDelMensaje). Los mensajes del usuario no cambian.
async function aplicarFormatoMensajes(pool, filas) {
  const ids = [...new Set(filas.map((f) => f.id_dependencia_respuesta).filter((x) => x != null))];
  const deps = new Map();
  if (ids.length > 0) {
    const { rows } = await pool.query(
      'SELECT id_dependencia, nombre, correos, telefono, contacto_responsable FROM dependencia WHERE id_dependencia = ANY($1::int[])', [ids]);
    for (const d of rows) deps.set(d.id_dependencia, d);
  }
  return filas.map(({ id_dependencia_respuesta: idDep, ...fila }) => {
    if (fila.emisor !== 'asistente') return fila;
    const f = formatoRespuesta({ mensaje: fila.contenido, dependencia: deps.get(idDep) || null });
    return { ...fila, contenido: f.respuesta, contacto: f.contacto, dependencia: f.dependencia };
  });
}

module.exports = {
  conContacto, extraerContacto, componerTextoContacto, contactoDe, mensajeIncluyeContacto, limpiarMensaje,
  formatoRespuesta, sqlDependenciaDelMensaje, aplicarFormatoMensajes, FRASE_DEPENDENCIA_GENERICA,
};
