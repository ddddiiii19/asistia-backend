// Q8 — Migración aditiva e idempotente del contacto estructurado (npm run db:migrar-q8) y revisión de contactos
// dentro de los textos (npm run db:revisar-contactos). Se prueba sobre una base con el estado de Q7: sin las columnas
// nuevas, con contactos en texto libre, información general cargada, reportes de prueba y conversaciones.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, chat } = require('./ayuda');
const { migrarQ8 } = require('../scripts/migrar-q8');
const { revisarContactos } = require('../scripts/revisar-contactos');
const { cargarInfoGeneral } = require('../scripts/cargar-info-general');
const { generarDatosReportes } = require('../scripts/seed-reportes');

describe('migración Q8 sobre una copia con el estado de Q7', () => {
  let ctx;
  const filas = async (sql) => (await ctx.pool.query(sql)).rows;
  before(async () => {
    ctx = await prepararEntorno();
    // Estado de Q7: contactos reales en texto libre y sin las columnas de Q8.
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = 'admisiones@teinco.edu.co · Tel. 601 743 32 00' WHERE nombre = 'Admisiones'");
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = 'registro@teinco.edu.co o registro2@teinco.edu.co · Tel. 601 743 32 01' WHERE nombre = 'Registro y Control'");
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = 'Oficina 203 del bloque B' WHERE nombre = 'Bienestar'");
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = NULL WHERE nombre = 'Coordinación académica'");
    await ctx.pool.query('ALTER TABLE dependencia DROP COLUMN correos, DROP COLUMN telefono');
    await cargarInfoGeneral({ pool: ctx.pool }); // sin columnas nuevas: no debe fallar
    await generarDatosReportes({ pool: ctx.pool, total: 30, dias: 10 });
    await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
  });
  after(async () => { await ctx.pool.end(); });

  test('agrega las columnas, llena correos y teléfono desde el texto actual y no pierde nada', async () => {
    const antes = {
      contactos: await filas('SELECT id_dependencia, nombre, descripcion, contacto_responsable FROM dependencia ORDER BY 1'),
      info: await filas('SELECT * FROM informacion_institucional ORDER BY 1'),
      faq: await filas('SELECT * FROM pregunta_frecuente ORDER BY 1'),
      consultas: Number((await filas('SELECT count(*) FROM consulta'))[0].count),
      mensajes: Number((await filas('SELECT count(*) FROM mensaje'))[0].count),
      admins: await filas('SELECT id_administrador, nombre_usuario, id_dependencia FROM administrador ORDER BY 1'),
    };
    const llenadas = await migrarQ8(ctx.pool);
    assert.equal(llenadas.length, 4, 'Admisiones, Registro, Bienestar e Información general (Coordinación no tiene contacto)');
    const d = Object.fromEntries((await filas('SELECT nombre, correos, telefono, contacto_responsable FROM dependencia')).map((x) => [x.nombre, x]));
    assert.deepEqual(d['Admisiones'].correos, ['admisiones@teinco.edu.co']);
    assert.equal(d['Admisiones'].telefono, '601 743 32 00');
    assert.deepEqual(d['Registro y Control'].correos, ['registro@teinco.edu.co', 'registro2@teinco.edu.co']);
    assert.equal(d['Registro y Control'].telefono, '601 743 32 01');
    assert.deepEqual(d['Bienestar'].correos, []);
    assert.equal(d['Bienestar'].telefono, null, 'un texto sin correo ni teléfono reconocible no inventa datos');
    assert.deepEqual(d['Coordinación académica'].correos, []);
    assert.deepEqual(d['Información general'].correos, ['coordregistroycontrol@teinco.edu.co']);
    assert.equal(d['Información general'].telefono, '601 743 32 00 · WhatsApp 301 333 79 56', 'conserva los dos números');
    // Nada de lo anterior cambió.
    assert.deepEqual(await filas('SELECT id_dependencia, nombre, descripcion, contacto_responsable FROM dependencia ORDER BY 1'), antes.contactos);
    assert.deepEqual(await filas('SELECT * FROM informacion_institucional ORDER BY 1'), antes.info);
    assert.deepEqual(await filas('SELECT * FROM pregunta_frecuente ORDER BY 1'), antes.faq);
    assert.equal(Number((await filas('SELECT count(*) FROM consulta'))[0].count), antes.consultas);
    assert.equal(Number((await filas('SELECT count(*) FROM mensaje'))[0].count), antes.mensajes);
    assert.deepEqual(await filas('SELECT id_administrador, nombre_usuario, id_dependencia FROM administrador ORDER BY 1'), antes.admins);
  });

  test('es idempotente: ejecutarla otra vez no cambia nada', async () => {
    const antes = await filas('SELECT * FROM dependencia ORDER BY 1');
    const segunda = await migrarQ8(ctx.pool);
    assert.equal(segunda.length, 1, 'solo reintenta la dependencia cuyo texto no tiene datos reconocibles (Bienestar), sin cambiarla');
    assert.equal(segunda[0].nombre, 'Bienestar');
    assert.deepEqual(await filas('SELECT * FROM dependencia ORDER BY 1'), antes);
    await migrarQ8(ctx.pool);
    assert.deepEqual(await filas('SELECT * FROM dependencia ORDER BY 1'), antes);
  });

  test('no pisa el contacto estructurado que alguien ya editó desde el panel', async () => {
    await ctx.pool.query("UPDATE dependencia SET correos = ARRAY['editado@teinco.test'], telefono = NULL WHERE nombre = 'Admisiones'");
    await migrarQ8(ctx.pool);
    const a = (await filas("SELECT correos, telefono FROM dependencia WHERE nombre = 'Admisiones'"))[0];
    assert.deepEqual(a.correos, ['editado@teinco.test']);
  });

  test('con la base migrada, el asistente responde en el formato nuevo con los reportes y datos anteriores intactos', async () => {
    await ctx.pool.query("UPDATE dependencia SET correos = ARRAY['admisiones@teinco.edu.co'], telefono = '601 743 32 00' WHERE nombre = 'Admisiones'");
    const r = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?', { id_sesion: 'sesion-de-prueba-0002' });
    assert.equal(r.body.contacto.texto, 'admisiones@teinco.edu.co · Tel. 601 743 32 00');
    assert.equal(r.body.dependencia.nombre, 'Admisiones');
  });
});

describe('revisión de contactos dentro de los textos cargados (solo lectura)', () => {
  let ctx;
  before(async () => { ctx = await prepararEntorno(); });
  after(async () => { await ctx.pool.end(); });

  test('lista la información y las preguntas frecuentes que traen el contacto, sin modificar la base', async () => {
    await cargarInfoGeneral({ pool: ctx.pool });
    await ctx.pool.query("UPDATE informacion_institucional SET contenido = contenido || ' Escribe a contacto.bienestar@ejemplo.invalid.' WHERE id_dependencia = 3");
    const antes = (await ctx.pool.query('SELECT * FROM informacion_institucional ORDER BY 1')).rows;
    const hallazgos = await revisarContactos(ctx.pool);
    assert.ok(hallazgos.some((h) => h.dependencia === 'Bienestar' && h.tipo === 'Información institucional'));
    assert.ok(hallazgos.some((h) => h.dependencia === 'Información general'), 'los textos de Información general traen su teléfono');
    assert.equal(hallazgos.some((h) => h.dependencia === 'Admisiones'), false);
    assert.deepEqual((await ctx.pool.query('SELECT * FROM informacion_institucional ORDER BY 1')).rows, antes);
  });
});
