const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, iniciarUsuario, chat } = require('./ayuda');
const { cargarInfoGeneral } = require('../scripts/cargar-info-general');
const { INFO_GENERAL } = require('../db/info-general-teinco');

// Conocimiento general de TEINCO (sedes, carreras, misión y contacto). La IA responde SOLO con la información cargada
// y escala lo que no puede sustentar: estas pruebas usan el simulador (no llaman a ningún servicio de IA real).
describe('información general de TEINCO para el asistente', () => {
  let ctx, global, admisiones, usuario;
  const cuenta = async (sql, p = []) => (await ctx.pool.query(sql, p)).rows;
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    usuario = await iniciarUsuario(ctx.api);
  });
  after(async () => { await ctx.pool.end(); });

  test('antes de cargarla, una pregunta sobre las sedes no tiene respaldo y se escala', async () => {
    const r = await chat(ctx.api, '¿Dónde están las sedes de TEINCO?');
    assert.equal(r.status, 200);
    assert.equal(r.body.escalada, true);
    assert.equal(r.body.dependencia, null);
  });

  test('la carga crea la dependencia, 7 textos y 3 preguntas frecuentes; los datos de las demás dependencias no cambian', async () => {
    const antes = await cuenta('SELECT id_info, titulo, contenido FROM informacion_institucional ORDER BY id_info');
    const r = await cargarInfoGeneral({ pool: ctx.pool });
    assert.equal(r.dependencia, 'creada');
    assert.deepEqual(r.informacion, { nuevas: 7, actualizadas: 0 });
    assert.deepEqual(r.faq, { nuevas: 3, actualizadas: 0 });
    const dep = (await cuenta("SELECT id_dependencia, contacto_responsable FROM dependencia WHERE nombre = 'Información general'"))[0];
    assert.ok(dep);
    assert.match(dep.contacto_responsable, /601 743 32 00/);
    const despues = await cuenta('SELECT id_info, titulo, contenido FROM informacion_institucional WHERE id_dependencia <> $1 ORDER BY id_info', [dep.id_dependencia]);
    assert.deepEqual(despues, antes, 'la información de Admisiones, Registro, Bienestar y Coordinación queda intacta');
    assert.equal((await ctx.api.get('/api/dependencias')).body.length, 5);
  });

  test('es idempotente: repetir la carga no duplica ni modifica nada', async () => {
    const r = await cargarInfoGeneral({ pool: ctx.pool });
    assert.equal(r.dependencia, 'actualizada');
    assert.deepEqual(r.informacion, { nuevas: 0, actualizadas: 0 });
    assert.deepEqual(r.faq, { nuevas: 0, actualizadas: 0 });
    assert.equal((await cuenta("SELECT count(*)::int AS n FROM dependencia WHERE nombre = 'Información general'"))[0].n, 1);
    assert.equal((await cuenta('SELECT count(*)::int AS n FROM informacion_institucional i JOIN dependencia d USING (id_dependencia) WHERE d.nombre = $1', ['Información general']))[0].n, 7);
  });

  test('responde dónde están las sedes, con las direcciones cargadas', async () => {
    const r = await chat(ctx.api, '¿Dónde están las sedes de TEINCO?');
    assert.equal(r.body.escalada, false);
    assert.equal(r.body.dependencia.nombre, 'Información general');
    assert.match(r.body.respuesta, /Avenida Caracas Nº 63-85/);
    assert.match(r.body.respuesta, /Mosquera/);
  });

  test('la respuesta no repite el mismo texto aunque esté cargado como información y como pregunta frecuente', async () => {
    const r = await chat(ctx.api, '¿Dónde están las sedes de TEINCO?');
    const veces = (r.body.respuesta.match(/Avenida Caracas Nº 63-85/g) || []).length;
    assert.equal(veces, 1, 'la dirección aparece una sola vez');
    // Caso general (cualquier dependencia): una FAQ con el mismo texto que una información de Admisiones.
    await ctx.pool.query(
      `INSERT INTO pregunta_frecuente (id_dependencia, pregunta, respuesta)
       SELECT id_dependencia, '¿Pregunta duplicada de prueba?', contenido FROM informacion_institucional
        WHERE id_dependencia = 1 ORDER BY id_info LIMIT 1`);
    const info = (await cuenta('SELECT contenido FROM informacion_institucional WHERE id_dependencia = 1 ORDER BY id_info LIMIT 1'))[0].contenido;
    const a = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    assert.equal(a.body.respuesta.split(info).length - 1, 1, 'el texto de Admisiones no se repite');
    await ctx.pool.query("DELETE FROM pregunta_frecuente WHERE pregunta = '¿Pregunta duplicada de prueba?'");
  });

  test('responde qué carreras se ofrecen', async () => {
    const r = await chat(ctx.api, '¿Qué carreras ofrece TEINCO?');
    assert.equal(r.body.escalada, false);
    assert.equal(r.body.dependencia.nombre, 'Información general');
    assert.match(r.body.respuesta, /Ingeniería Mecatrónica/);
    assert.match(r.body.respuesta, /Contaduría Pública/);
  });

  test('responde el contacto y la misión', async () => {
    const c = await chat(ctx.api, '¿Cuál es el teléfono de TEINCO?');
    assert.equal(c.body.escalada, false);
    assert.match(c.body.respuesta, /601 743 32 00/);
    const m = await chat(ctx.api, 'Quiero conocer la misión de TEINCO');
    assert.equal(m.body.escalada, false);
    assert.match(m.body.respuesta, /formación integral/);
  });

  test('lo que no está en la información se escala con el contacto institucional, sin inventar', async () => {
    const r = await chat(ctx.api, '¿Tienen sede en Medellín?');
    assert.equal(r.body.escalada, true);
    assert.equal(r.body.dependencia.nombre, 'Información general');
    assert.match(r.body.respuesta, /601 743 32 00/);
    assert.doesNotMatch(r.body.respuesta, /Medellín/, 'no afirma nada sobre una sede que no existe en la información');
  });

  test('las preguntas de cada dependencia siguen yendo a su dependencia (sin cambios para Q4)', async () => {
    const r = await chat(ctx.api, '¿Cómo solicito un certificado de notas?');
    assert.equal(r.body.dependencia.nombre, 'Registro y Control');
    const a = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    assert.equal(a.body.dependencia.nombre, 'Admisiones');
    const s = await chat(ctx.api, 'Hola');
    assert.match(s.body.respuesta, /Información general/, 'el saludo menciona la nueva dependencia');
  });

  test('las preguntas frecuentes aparecen en el chat con su dependencia y devuelven su respuesta; el contador se conserva al recargar', async () => {
    const lista = (await ctx.api.get('/api/faq').set('Authorization', usuario)).body;
    const sedes = lista.find((f) => f.pregunta === '¿Dónde están las sedes de TEINCO?');
    assert.equal(sedes.dependencia, 'Información general');
    const r = await ctx.api.post(`/api/faq/${sedes.id_faq}/consulta`).set('Authorization', usuario);
    assert.match(r.body.respuesta, /Avenida Calle 63 Nº 22-39/);
    await cargarInfoGeneral({ pool: ctx.pool });
    assert.equal((await cuenta('SELECT frecuencia FROM pregunta_frecuente WHERE id_faq = $1', [sedes.id_faq]))[0].frecuencia, 1);
  });

  test('recargar restaura un texto modificado y avisa cuántos actualizó (sin tocar lo demás)', async () => {
    await ctx.pool.query("UPDATE informacion_institucional SET contenido = 'texto desactualizado' WHERE titulo = 'Sedes de TEINCO'");
    const r = await cargarInfoGeneral({ pool: ctx.pool });
    assert.deepEqual(r.informacion, { nuevas: 0, actualizadas: 1 });
    const fila = (await cuenta("SELECT contenido FROM informacion_institucional WHERE titulo = 'Sedes de TEINCO'"))[0];
    assert.match(fila.contenido, /Avenida Calle 63/);
  });

  test('alcance de administración: el global gestiona la información general; el de Admisiones no la ve', async () => {
    const g = await ctx.api.get('/api/admin/informacion').set('Authorization', global);
    assert.ok(g.body.some((i) => i.dependencia === 'Información general'));
    const a = await ctx.api.get('/api/admin/informacion').set('Authorization', admisiones);
    assert.ok(a.body.every((i) => i.dependencia === 'Admisiones'));
  });

  test('la consulta general se cuenta como una dependencia más en los reportes', async () => {
    const r = await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', global);
    const dep = r.body.por_dependencia.find((d) => d.dependencia === 'Información general');
    assert.ok(dep && dep.total >= 4);
    assert.ok(dep.resueltas >= 3 && dep.escaladas >= 1);
  });

  test('los datos son reales y trazables: todo texto cita su fuente y no hay marcas de datos de prueba', () => {
    const textos = [...INFO_GENERAL.informacion.map((i) => i.contenido), ...INFO_GENERAL.faq.map((f) => f.respuesta)];
    for (const t of textos) {
      assert.match(t, /Fuente: sitio oficial de TEINCO \(teinco\.edu\.co\), consultado el 28\/10\/2026\./);
      assert.doesNotMatch(t, /DATO DE PRUEBA/);
    }
    assert.doesNotMatch(INFO_GENERAL.dependencia.contacto_responsable, /\.invalid|DATO DE PRUEBA/);
  });
});
