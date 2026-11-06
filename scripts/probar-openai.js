// PRUEBA DE CONEXION con el servicio de IA generativa (OpenAI).
// Hace una llamada real de clasificacion y una de generacion con datos ficticios y muestra el resultado.
// Uso:  npm run probar:openai   (requiere OPENAI_API_KEY y OPENAI_MODEL en .env)
// Nota: consume una cantidad minima de credito de la cuenta de API.
const { config } = require('../src/config');
const { crearProveedorIA } = require('../src/ia');

async function main() {
  if (!config.ia.openaiApiKey || !config.ia.openaiModelo) {
    console.error('Defina OPENAI_API_KEY y OPENAI_MODEL en el archivo .env');
    process.exit(1);
  }
  const ia = crearProveedorIA({ ...config, ia: { ...config.ia, proveedor: 'openai' } });
  const dependencias = [
    { id_dependencia: 1, nombre: 'Admisiones', descripcion: 'Procesos de inscripcion y admision.' },
    { id_dependencia: 2, nombre: 'Registro y Control', descripcion: 'Certificados, matricula y registro academico.' },
  ];
  const contexto = [{ ref: 'INFO-1', tipo: 'informacion', titulo: 'Certificados de notas',
    contenido: '[DATO DE PRUEBA] Los certificados de notas se solicitan a Registro y Control indicando el numero de documento.' }];

  console.log(`Modelo configurado: ${config.ia.openaiModelo}`);
  let t = Date.now();
  const clasif = await ia.clasificar({ mensaje: 'Necesito un certificado de notas', historial: [], dependencias });
  console.log(`1) Clasificacion (${Date.now() - t} ms):`, clasif);
  t = Date.now();
  const resp = await ia.generar({ mensaje: 'Necesito un certificado de notas', historial: [], dependencia: dependencias[1], contexto });
  console.log(`2) Generacion (${Date.now() - t} ms):`, resp);
  const ok = clasif.dependencia_id === 2 && resp.suficiente === true;
  console.log(ok ? '\nCONEXION OK: el servicio de IA responde con el formato esperado.' : '\nLa conexion funciona, pero el resultado no fue el esperado. Revise el modelo configurado.');
}

main().catch((e) => {
  console.error('\nFALLO LA CONEXION CON OPENAI:', e.status ? `HTTP ${e.status} - ` : '', e.message);
  if (e.status === 401) console.error('Pista: la clave de API es invalida o fue revocada.');
  if (e.status === 404) console.error('Pista: el modelo en OPENAI_MODEL no existe o su cuenta no tiene acceso a el.');
  if (e.status === 429) console.error('Pista: limite de uso alcanzado o credito agotado.');
  process.exit(1);
});
