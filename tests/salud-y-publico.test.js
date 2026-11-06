const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, tokenUsuario } = require('./ayuda');

describe('Salud y endpoints publicos', () => {
  let ctx, usuario;
  before(async () => { ctx = await prepararEntorno(); usuario = await tokenUsuario(ctx.api); });
  after(async () => { await ctx.pool.end(); });

  test('GET /api/health confirma la conexion con la base de datos', async () => {
    const r = await ctx.api.get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { estado: 'ok', base_de_datos: 'ok', ia: { proveedor: 'simulador' } });
  });

  test('GET /api/dependencias devuelve las 4 dependencias de prueba', async () => {
    const r = await ctx.api.get('/api/dependencias');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 4);
    assert.ok(r.body.some((d) => d.nombre === 'Registro y Control'));
    assert.ok(!('contacto_responsable' in r.body[0]), 'el contacto solo se entrega al escalar');
  });

  test('RF-10: GET /api/faq lista preguntas y permite filtrar por dependencia', async () => {
    const todas = await ctx.api.get('/api/faq').set('Authorization', usuario);
    assert.equal(todas.body.length, 4);
    const filtradas = await ctx.api.get('/api/faq?dependencia=3').set('Authorization', usuario);
    assert.equal(filtradas.body.length, 1);
    assert.equal(filtradas.body[0].dependencia, 'Bienestar');
  });

  test('RF-10: seleccionar una FAQ devuelve su respuesta y aumenta la frecuencia', async () => {
    const r = await ctx.api.post('/api/faq/1/consulta').set('Authorization', usuario);
    assert.equal(r.status, 200);
    assert.match(r.body.respuesta, /Admisiones/);
    await ctx.api.post('/api/faq/1/consulta').set('Authorization', usuario);
    const { rows } = await ctx.pool.query('SELECT frecuencia FROM pregunta_frecuente WHERE id_faq = 1');
    assert.equal(rows[0].frecuencia, 2);
  });

  test('FAQ inexistente responde 404 y parametros invalidos responden 400', async () => {
    assert.equal((await ctx.api.post('/api/faq/9999/consulta').set('Authorization', usuario)).status, 404);
    assert.equal((await ctx.api.post('/api/faq/abc/consulta').set('Authorization', usuario)).status, 400);
    assert.equal((await ctx.api.get('/api/faq?dependencia=x').set('Authorization', usuario)).status, 400);
  });

  test('Rutas inexistentes responden 404 en JSON', async () => {
    const r = await ctx.api.get('/api/no-existe');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'ruta_no_encontrada');
  });

  test('El historial requiere una cuenta de usuario y no expone el identificador de sesión', async () => {
    assert.equal((await ctx.api.get('/api/conversaciones')).status, 401);
    const ok = await ctx.api.get('/api/conversaciones').set('Authorization', usuario);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, []);
  });
});
