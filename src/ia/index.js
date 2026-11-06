// Selecciona el proveedor de IA segun AI_PROVIDER. Para cambiar de proveedor solo se agrega
// otro modulo con la misma interfaz { nombre, clasificar(), generar() }.
const { crearProveedorOpenAI } = require('./openai');
const { crearSimulador } = require('./simulador');

function crearProveedorIA(config) {
  if (config.ia.proveedor === 'simulador') return crearSimulador();
  const OpenAI = require('openai');
  const cliente = new OpenAI({ apiKey: config.ia.openaiApiKey, timeout: config.ia.timeoutMs, maxRetries: 2 });
  return crearProveedorOpenAI({ cliente, modelo: config.ia.openaiModelo });
}

module.exports = { crearProveedorIA };
