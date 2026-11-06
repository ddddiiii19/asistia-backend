const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, chat, PASSWORD } = require('./ayuda');

describe('Autenticacion y roles administrativos', () => {
  let ctx, global, bienestar, admisiones, registro;
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    bienestar = await iniciarSesion(ctx.api, 'admin_bienestar');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
  });
  after(async () => { await ctx.pool.end(); });

  test('RF-11: credenciales incorrectas o inexistentes responden 401 con el mismo mensaje', async () => {
    const mala = await ctx.api.post('/api/auth/login').send({ nombre_usuario: 'admin', contrasena: 'incorrecta' });
    const inexistente = await ctx.api.post('/api/auth/login').send({ nombre_usuario: 'nadie', contrasena: PASSWORD });
    assert.equal(mala.status, 401);
    assert.equal(inexistente.status, 401);
    assert.equal(mala.body.mensaje, inexistente.body.mensaje);
    assert.equal((await ctx.api.post('/api/auth/login').send({ nombre_usuario: 'admin' })).status, 400);
  });

  test('RF-11: el login devuelve el rol y la dependencia; la contrasena se guarda cifrada', async () => {
    const r = await ctx.api.post('/api/auth/login').send({ nombre_usuario: 'admin_bienestar', contrasena: PASSWORD });
    assert.equal(r.body.administrador.rol, 'dependencia');
    assert.equal(r.body.administrador.id_dependencia, 3);
    const { rows } = await ctx.pool.query("SELECT contrasena_hash FROM administrador WHERE nombre_usuario = 'admin'");
    assert.notEqual(rows[0].contrasena_hash, PASSWORD);
    assert.match(rows[0].contrasena_hash, /^\$2[aby]\$/);
  });

  test('Las rutas administrativas exigen un token valido', async () => {
    assert.equal((await ctx.api.get('/api/admin/informacion')).status, 401);
    assert.equal((await ctx.api.get('/api/admin/informacion').set('Authorization', 'Bearer basura')).status, 401);
  });

  test('La base de datos impide un administrador de dependencia sin dependencia', async () => {
    await assert.rejects(ctx.pool.query("INSERT INTO administrador (nombre_usuario, correo, contrasena_hash, rol) VALUES ('x', 'x@example.test', 'h', 'dependencia')"), /chk_rol_dependencia/);
  });

  test('RF-12: el administrador global consulta toda la informacion; el de dependencia solo la suya', async () => {
    const g = await ctx.api.get('/api/admin/informacion').set('Authorization', global);
    assert.equal(g.body.length, 5);
    const b = await ctx.api.get('/api/admin/informacion').set('Authorization', bienestar);
    assert.equal(b.body.length, 1);
    assert.equal(b.body[0].dependencia, 'Bienestar');
    const otra = await ctx.api.get('/api/admin/informacion?dependencia=1').set('Authorization', bienestar);
    assert.equal(otra.status, 403);
    assert.equal(otra.body.error, 'fuera_de_alcance');
  });

  test('RF-12: solo el administrador global crea, modifica y elimina informacion', async () => {
    const nuevo = { id_dependencia: 3, titulo: 'Horario de atención', contenido: '[DATO DE PRUEBA] Atención por cita.' };
    const prohibido = await ctx.api.post('/api/admin/informacion').set('Authorization', bienestar).send(nuevo);
    assert.equal(prohibido.status, 403);

    const creado = await ctx.api.post('/api/admin/informacion').set('Authorization', global).send(nuevo);
    assert.equal(creado.status, 201);
    const id = creado.body.id_info;
    const edit = await ctx.api.put(`/api/admin/informacion/${id}`).set('Authorization', global).send({ titulo: 'Horario', contenido: 'Nuevo contenido' });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.titulo, 'Horario');
    assert.equal((await ctx.api.put(`/api/admin/informacion/${id}`).set('Authorization', bienestar).send({ titulo: 'x', contenido: 'y' })).status, 403);
    assert.equal((await ctx.api.delete(`/api/admin/informacion/${id}`).set('Authorization', bienestar)).status, 403);
    assert.equal((await ctx.api.delete(`/api/admin/informacion/${id}`).set('Authorization', global)).status, 204);
    assert.equal((await ctx.api.delete(`/api/admin/informacion/${id}`).set('Authorization', global)).status, 404);
  });

  test('RF-12: validaciones al crear informacion', async () => {
    const sinTitulo = await ctx.api.post('/api/admin/informacion').set('Authorization', global).send({ id_dependencia: 1, contenido: 'x' });
    assert.equal(sinTitulo.status, 400);
    const depInexistente = await ctx.api.post('/api/admin/informacion').set('Authorization', global).send({ id_dependencia: 999, titulo: 't', contenido: 'c' });
    assert.equal(depInexistente.status, 400);
    assert.equal(depInexistente.body.error, 'referencia_invalida');
  });

  test('RF-14: gestion de preguntas frecuentes con los mismos permisos', async () => {
    const lista = await ctx.api.get('/api/admin/faq').set('Authorization', registro);
    assert.equal(lista.body.length, 1);
    assert.ok('frecuencia' in lista.body[0]);
    const nueva = { id_dependencia: 2, pregunta: '¿Cuánto tarda un certificado?', respuesta: '[DATO DE PRUEBA] Depende de la dependencia.' };
    assert.equal((await ctx.api.post('/api/admin/faq').set('Authorization', registro).send(nueva)).status, 403);
    const creada = await ctx.api.post('/api/admin/faq').set('Authorization', global).send(nueva);
    assert.equal(creada.status, 201);
    const id = creada.body.id_faq;
    assert.equal((await ctx.api.put(`/api/admin/faq/${id}`).set('Authorization', global).send({ pregunta: 'P', respuesta: 'R' })).status, 200);
    assert.equal((await ctx.api.delete(`/api/admin/faq/${id}`).set('Authorization', global)).status, 204);
  });

  test('La informacion modificada por el administrador es la que usa el asistente (RF-12 + RF-05)', async () => {
    const creada = await ctx.api.post('/api/admin/informacion').set('Authorization', global)
      .send({ id_dependencia: 4, titulo: 'Salones', contenido: '[DATO DE PRUEBA] Los cambios de salón se publican en cartelera.' });
    const r = await chat(ctx.api, '¿Dónde veo el cambio de salón de mi clase?');
    assert.equal(r.body.escalada, false);
    assert.match(r.body.respuesta, /cartelera/);
    await ctx.api.delete(`/api/admin/informacion/${creada.body.id_info}`).set('Authorization', global);
  });
});

describe('Historial, reportes y estadisticas con filtros y alcance', () => {
  let ctx, global, admisiones, registro, ids = {};
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
    ids.adm = (await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?')).body.id_conversacion;
    ids.reg = (await chat(ctx.api, '¿Cómo solicito un certificado de notas?')).body.id_conversacion;
    ids.sin = (await chat(ctx.api, '¿Puedo cambiarme de programa a mitad de semestre?')).body.id_conversacion;
  });
  after(async () => { await ctx.pool.end(); });

  test('RF-15: el administrador global ve todas las interacciones; el de dependencia solo las suyas', async () => {
    const g = await ctx.api.get('/api/admin/reportes/interacciones').set('Authorization', global);
    assert.equal(g.body.length, 3);
    assert.deepEqual(g.body.map((x) => x.estado).sort(), ['escalada', 'resuelta', 'resuelta']);
    const a = await ctx.api.get('/api/admin/reportes/interacciones').set('Authorization', admisiones);
    assert.equal(a.body.length, 1);
    assert.equal(a.body[0].dependencia, 'Admisiones');
    assert.equal((await ctx.api.get('/api/admin/reportes/interacciones?dependencia=2').set('Authorization', admisiones)).status, 403);
  });

  test('RF-17: filtros por dependencia y periodo', async () => {
    const porDep = await ctx.api.get('/api/admin/reportes/interacciones?dependencia=2').set('Authorization', global);
    assert.equal(porDep.body.length, 1);
    const hoy = new Date().toISOString().slice(0, 10);
    const hoyOk = await ctx.api.get(`/api/admin/reportes/interacciones?desde=${hoy}&hasta=${hoy}`).set('Authorization', global);
    assert.equal(hoyOk.body.length, 3, 'el limite superior es inclusivo');
    const futuro = await ctx.api.get('/api/admin/reportes/interacciones?desde=2999-01-01').set('Authorization', global);
    assert.equal(futuro.body.length, 0);
    const pasado = await ctx.api.get('/api/admin/reportes/interacciones?hasta=2000-01-01').set('Authorization', global);
    assert.equal(pasado.body.length, 0);
    assert.equal((await ctx.api.get('/api/admin/reportes/interacciones?desde=ayer').set('Authorization', global)).status, 400);
    assert.equal((await ctx.api.get('/api/admin/reportes/interacciones?desde=2026-02-01&hasta=2026-01-01').set('Authorization', global)).status, 400);
  });

  test('RF-16: estadisticas agregadas, incluyendo consultas sin dependencia identificada', async () => {
    const g = await ctx.api.get('/api/admin/estadisticas').set('Authorization', global);
    assert.equal(g.body.total, 3);
    assert.equal(g.body.escaladas, 1);
    assert.ok(g.body.por_dependencia.some((d) => d.dependencia === 'Sin identificar' && d.total === 1 && d.escaladas === 1));
    assert.ok(g.body.temas_mas_consultados.length > 0);
    const r = await ctx.api.get('/api/admin/estadisticas').set('Authorization', registro);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.por_dependencia.length, 1);
    const filtrado = await ctx.api.get('/api/admin/estadisticas?desde=2999-01-01').set('Authorization', global);
    assert.equal(filtrado.body.total, 0);
  });

  test('RF-13: el historial administrativo respeta el alcance y no expone el id_sesion', async () => {
    const g = await ctx.api.get('/api/admin/conversaciones').set('Authorization', global);
    assert.equal(g.body.length, 3);
    assert.ok(g.body.every((c) => !('id_sesion' in c)));
    assert.equal(g.body.filter((c) => c.escalada).length, 1);
    const a = await ctx.api.get('/api/admin/conversaciones').set('Authorization', admisiones);
    assert.equal(a.body.length, 1);

    const propia = await ctx.api.get(`/api/admin/conversaciones/${ids.adm}`).set('Authorization', admisiones);
    assert.equal(propia.status, 200);
    assert.equal(propia.body.mensajes.length, 2);
    assert.ok(!('id_sesion' in propia.body));
    const ajena = await ctx.api.get(`/api/admin/conversaciones/${ids.reg}`).set('Authorization', admisiones);
    assert.equal(ajena.status, 404);
    assert.equal((await ctx.api.get(`/api/admin/conversaciones/${ids.sin}`).set('Authorization', global)).status, 200);
  });

  test('Q6: el historial administrativo informa la dependencia y la ficha de cada consulta', async () => {
    const g = await ctx.api.get('/api/admin/conversaciones').set('Authorization', global);
    const porId = new Map(g.body.map((c) => [c.id_conversacion, c]));
    assert.equal(porId.get(ids.adm).dependencia, 'Admisiones');
    assert.equal(porId.get(ids.reg).dependencia, 'Registro y Control');
    assert.equal(porId.get(ids.sin).dependencia, null, 'una consulta sin dependencia identificada no inventa una');

    const d = await ctx.api.get(`/api/admin/conversaciones/${ids.sin}`).set('Authorization', global);
    assert.equal(d.body.consultas.length, 1);
    assert.equal(d.body.consultas[0].estado, 'escalada');
    assert.equal(d.body.consultas[0].motivo_escalamiento, 'dependencia_no_identificada');
    assert.ok(Number.isInteger(d.body.consultas[0].tiempo_respuesta_ms));
    assert.ok(!('id_sesion' in d.body));

    const a = await ctx.api.get(`/api/admin/conversaciones/${ids.adm}`).set('Authorization', admisiones);
    assert.equal(a.body.consultas.length, 1);
    assert.equal(a.body.consultas[0].dependencia, 'Admisiones');
    assert.equal(a.body.consultas[0].estado, 'resuelta');
  });
});
