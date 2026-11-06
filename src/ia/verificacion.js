// Verificacion de respaldo de la respuesta (RF-06).
// NO usa un segundo modelo de IA: es una comprobacion determinista de que la respuesta generada
// esta sustentada por la informacion institucional registrada para la dependencia identificada.
//
// Parametros:
//   dependencia : dependencia identificada en la clasificacion (o null)
//   contexto    : fuentes institucionales entregadas al modelo [{ ref, tipo, titulo, contenido }]
//   salida      : salida estructurada del modelo { suficiente, respuesta, fuentes }
// Retorna { ok: true, respuesta, fuentes } o { ok: false, motivo }.

function verificarRespaldo({ dependencia, contexto, salida }) {
  if (!dependencia) return { ok: false, motivo: 'dependencia_no_identificada' };
  if (!Array.isArray(contexto) || contexto.length === 0) return { ok: false, motivo: 'sin_informacion_institucional' };
  if (!salida || salida.suficiente !== true) return { ok: false, motivo: 'informacion_insuficiente' };

  const respuesta = typeof salida.respuesta === 'string' ? salida.respuesta.trim() : '';
  const fuentes = Array.isArray(salida.fuentes) ? salida.fuentes : [];
  const refsValidas = new Set(contexto.map((c) => c.ref));

  // La respuesta debe citar al menos una fuente y todas las citadas deben existir en el contexto entregado.
  const citasValidas = fuentes.length > 0 && fuentes.every((f) => refsValidas.has(f));
  if (!respuesta || !citasValidas) return { ok: false, motivo: 'respaldo_no_verificable' };

  return { ok: true, respuesta, fuentes };
}

module.exports = { verificarRespaldo };
