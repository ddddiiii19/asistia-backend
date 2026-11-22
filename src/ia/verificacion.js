// Verificacion de respaldo de la respuesta (RF-06).
// NO usa un segundo modelo de IA: es una comprobacion determinista de que la respuesta generada
// esta sustentada por la informacion institucional registrada para la dependencia identificada.
//
// Parametros:
//   dependencia : dependencia identificada en la clasificacion (o null)
//   contexto    : fuentes institucionales entregadas al modelo [{ ref, tipo, titulo, contenido }]
//   salida      : salida estructurada del modelo { suficiente, respuesta, fuentes }
// Retorna { ok: true, respuesta, fuentes } o { ok: false, motivo }.

// Los modelos a veces citan la fuente con otro formato ("[INFO-3]", "info-3", "INFO 3", "FAQ_1"). Se unifica al
// formato del contexto ("INFO-3") antes de compararla, para no escalar una respuesta buena solo por la forma de la cita.
// Una cita que no corresponde a ninguna fuente entregada sigue sin ser válida.
function normalizarRef(ref) {
  const texto = String(ref).trim().replace(/^[[(<]+|[\])>.,;:]+$/g, '').trim();
  const m = /^(INFO|FAQ)[\s_:-]*(\d+)$/i.exec(texto);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : texto;
}

function verificarRespaldo({ dependencia, contexto, salida }) {
  if (!dependencia) return { ok: false, motivo: 'dependencia_no_identificada' };
  if (!Array.isArray(contexto) || contexto.length === 0) return { ok: false, motivo: 'sin_informacion_institucional' };
  if (!salida || salida.suficiente !== true) return { ok: false, motivo: 'informacion_insuficiente' };

  const respuesta = typeof salida.respuesta === 'string' ? salida.respuesta.trim() : '';
  const fuentes = [...new Set((Array.isArray(salida.fuentes) ? salida.fuentes : []).map(normalizarRef))];
  const refsValidas = new Set(contexto.map((c) => c.ref));

  // La respuesta debe citar al menos una fuente y todas las citadas deben existir en el contexto entregado.
  const citasValidas = fuentes.length > 0 && fuentes.every((f) => refsValidas.has(f));
  if (!respuesta || !citasValidas) return { ok: false, motivo: 'respaldo_no_verificable' };

  return { ok: true, respuesta, fuentes };
}

module.exports = { verificarRespaldo, normalizarRef };
