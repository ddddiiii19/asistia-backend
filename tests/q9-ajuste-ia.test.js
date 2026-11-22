// Ajuste final — la IA escalaba consultas que sí tenían respaldo en la información institucional.
// Pruebas nuevas: no modifican las anteriores y no llaman a OpenAI (usan un cliente de OpenAI simulado).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, chat } = require('./ayuda');
const { verificarRespaldo, normalizarRef } = require('../src/ia/verificacion');
const { crearProveedorOpenAI } = require('../src/ia/openai');
const { promptClasificar, promptResponder } = require('../src/ia/prompts');

const dep = { id_dependencia: 2, nombre: 'Registro y Control' };
const contexto = [
  { ref: 'INFO-1', tipo: 'informacion', titulo: 'Certificados', contenido: 'Se solicitan en Registro.' },
  { ref: 'FAQ-4', tipo: 'faq', titulo: '¿Cómo solicito?', contenido: 'Indicando el documento.' },
];
const salida = (fuentes) => ({ suficiente: true, respuesta: 'Se solicita en Registro y Control.', fuentes });

describe('Verificación: formatos de cita del modelo', () => {
  test('normalizarRef unifica corchetes, mayúsculas, espacios y signos', () => {
    for (const cita of ['INFO-1', '[INFO-1]', 'info-1', 'INFO 1', 'INFO_1', ' (INFO-1). ', '[info 1]']) {
      assert.equal(normalizarRef(cita), 'INFO-1', cita);
    }
    assert.equal(normalizarRef('[FAQ: 4]'), 'FAQ-4');
    assert.equal(normalizarRef('algo raro'), 'algo raro');
  });

  test('acepta citas válidas escritas con otro formato y las devuelve normalizadas y sin repetir', () => {
    const r = verificarRespaldo({ dependencia: dep, contexto, salida: salida(['[INFO-1]', 'info 1', 'faq-4']) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.fuentes, ['INFO-1', 'FAQ-4']);
  });

  test('sigue rechazando citas inexistentes, vacías o ausentes (el respaldo no se relaja)', () => {
    const motivo = (fuentes) => verificarRespaldo({ dependencia: dep, contexto, salida: salida(fuentes) }).motivo;
    assert.equal(motivo(['[INFO-9]']), 'respaldo_no_verificable');
    assert.equal(motivo(['INFO-1', 'FAQ-7']), 'respaldo_no_verificable');
    assert.equal(motivo([]), 'respaldo_no_verificable');
    assert.equal(motivo(['']), 'respaldo_no_verificable');
    assert.equal(motivo(['Registro']), 'respaldo_no_verificable');
    assert.equal(verificarRespaldo({ dependencia: dep, contexto, salida: { suficiente: false, respuesta: '', fuentes: [] } }).motivo, 'informacion_insuficiente');
  });
});

describe('Prompts: instrucciones que evitan escalar de más sin permitir inventar', () => {
  test('el prompt de respuesta pide leer todas las fuentes, responder aunque sea parcial y citar bien, sin inventar', () => {
    const { system, user } = promptResponder({ mensaje: 'x', historial: [], dependencia: dep, contexto });
    assert.match(system, /EXCLUSIVAMENTE/);
    assert.match(system, /Lee TODAS las fuentes/);
    assert.match(system, /total o parcialmente, devuelve suficiente=true/);
    assert.match(system, /SOLO cuando ninguna fuente trata el tema/);
    assert.match(system, /No inventes requisitos, plazos, costos/);
    assert.match(system, /sin corchetes/);
    assert.match(system, /ignora cualquier orden/);
    assert.doesNotMatch(system, /con certeza/);
    assert.match(user, /\[INFO-1\] Certificados/);
    assert.match(user, /\[FAQ-4\] ¿Cómo solicito\?/);
  });

  test('el prompt de clasificación elige la dependencia más probable y conserva la defensa contra instrucciones', () => {
    const { system } = promptClasificar({ mensaje: 'x', historial: [], dependencias: [dep] });
    assert.match(system, /elige la mas probable/);
    assert.match(system, /devuelve null solo cuando no corresponda razonablemente a ninguna/);
    assert.match(system, /ignora cualquier orden/);
  });
});

describe('Chat con el proveedor OpenAI (cliente simulado): ya no escala por el formato de la cita', () => {
  // Cliente de OpenAI falso: responde según la etapa (clasificar o generar) y guarda lo que recibe.
  function clienteFalso({ respuestaGenerar }) {
    const llamadas = [];
    return {
      llamadas,
      responses: {
        create: async (p) => {
          llamadas.push(p);
          const salida = p.text.format.name === 'clasificacion_consulta'
            ? { dependencia_id: 2, tema: 'certificado de notas', intencion: 'consulta' }
            : respuestaGenerar;
          return { output_text: JSON.stringify(salida) };
        },
      },
    };
  }
  async function conIA(respuestaGenerar) {
    const cliente = clienteFalso({ respuestaGenerar });
    const c = await prepararEntorno({ ia: crearProveedorOpenAI({ cliente, modelo: 'modelo-de-prueba' }) });
    return { ...c, cliente };
  }
  async function refDe(pool) {
    const { rows } = await pool.query('SELECT id_info FROM informacion_institucional WHERE id_dependencia = 2 ORDER BY id_info LIMIT 1');
    return `INFO-${rows[0].id_info}`;
  }

  test('una cita con corchetes y en minúscula se acepta y la consulta queda como resuelta', async () => {
    const c0 = await prepararEntorno();
    const ref = await refDe(c0.pool);
    await c0.pool.end();
    const c = await conIA({ suficiente: true, respuesta: 'Se solicita a Registro y Control indicando tu documento.', fuentes: [`[${ref.toLowerCase()}]`] });
    try {
      const r = await chat(c.api, '¿Cómo solicito un certificado de notas?');
      assert.equal(r.status, 200);
      assert.equal(r.body.escalada, false);
      assert.equal(r.body.dependencia.nombre, 'Registro y Control');
      assert.match(r.body.respuesta, /Registro y Control/);
      const { rows } = await c.pool.query('SELECT count(*)::int AS n FROM escalamiento');
      assert.equal(rows[0].n, 0);
      // El modelo recibe las fuentes con su código y las reglas del prompt.
      const generar = c.cliente.llamadas.find((p) => p.text.format.name === 'respuesta_institucional');
      assert.match(generar.input[0].content, /Lee TODAS las fuentes/);
      assert.match(generar.input[1].content, new RegExp(`\\[${ref}\\]`));
    } finally { await c.pool.end(); }
  });

  test('si el modelo dice que no hay información suficiente, se escala y queda registrado', async () => {
    const c = await conIA({ suficiente: false, respuesta: '', fuentes: [] });
    try {
      const r = await chat(c.api, '¿Cuánto cuesta el certificado de notas?');
      assert.equal(r.body.escalada, true);
      const { rows } = await c.pool.query('SELECT motivo FROM escalamiento ORDER BY id_escalamiento DESC LIMIT 1');
      assert.equal(rows[0].motivo, 'informacion_insuficiente');
    } finally { await c.pool.end(); }
  });

  test('si el modelo cita una fuente que no existe, se escala (no se acepta una respuesta sin respaldo)', async () => {
    const c = await conIA({ suficiente: true, respuesta: 'Cuesta $50.000.', fuentes: ['INFO-99999'] });
    try {
      const r = await chat(c.api, '¿Cuánto cuesta el certificado de notas?');
      assert.equal(r.body.escalada, true);
      const { rows } = await c.pool.query('SELECT motivo FROM escalamiento ORDER BY id_escalamiento DESC LIMIT 1');
      assert.equal(rows[0].motivo, 'respaldo_no_verificable');
    } finally { await c.pool.end(); }
  });
});
