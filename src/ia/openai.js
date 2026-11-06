// Proveedor de IA generativa: OpenAI (Responses API con salida estructurada).
// El cliente del SDK se inyecta para poder probar este modulo sin llamar a la red.
const { ESQUEMA_CLASIFICACION, ESQUEMA_RESPUESTA, promptClasificar, promptResponder } = require('./prompts');

const INTENCIONES = ['consulta', 'saludo', 'agradecimiento', 'despedida'];

function crearProveedorOpenAI({ cliente, modelo }) {
  async function pedirJSON({ system, user, nombre, esquema }) {
    const respuesta = await cliente.responses.create({
      model: modelo,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      text: { format: { type: 'json_schema', name: nombre, schema: esquema, strict: true } },
      store: false, // no conservar las consultas de los usuarios en el servicio de OpenAI
    });
    const texto = respuesta && respuesta.output_text;
    if (typeof texto !== 'string' || texto.trim() === '') {
      throw new Error('El servicio de IA no devolvio contenido (posible rechazo o respuesta vacia).');
    }
    try {
      return JSON.parse(texto);
    } catch {
      throw new Error('El servicio de IA no devolvio un JSON valido.');
    }
  }

  return {
    nombre: 'openai',
    async clasificar(datos) {
      const { system, user } = promptClasificar(datos);
      const r = await pedirJSON({ system, user, nombre: 'clasificacion_consulta', esquema: ESQUEMA_CLASIFICACION });
      return {
        dependencia_id: Number.isInteger(r.dependencia_id) ? r.dependencia_id : null,
        tema: typeof r.tema === 'string' ? r.tema : '',
        intencion: INTENCIONES.includes(r.intencion) ? r.intencion : 'consulta',
      };
    },
    async generar(datos) {
      const { system, user } = promptResponder(datos);
      const r = await pedirJSON({ system, user, nombre: 'respuesta_institucional', esquema: ESQUEMA_RESPUESTA });
      return {
        suficiente: r.suficiente === true,
        respuesta: typeof r.respuesta === 'string' ? r.respuesta : '',
        fuentes: Array.isArray(r.fuentes) ? r.fuentes.filter((f) => typeof f === 'string') : [],
      };
    },
  };
}

module.exports = { crearProveedorOpenAI };
