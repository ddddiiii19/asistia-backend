const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, iniciarUsuario, tokenUsuario, chat, SESION, OTRA_SESION } = require('./ayuda');

describe('Chat: flujo de consulta, respuesta y escalamiento', () => {
  let ctx;
  before(async () => { ctx = await prepararEntorno(); });
  after(async () => { await ctx.pool.end(); });

  test('Consulta con informacion disponible: direcciona y responde sin escalar (RF-01 a RF-08)', async () => {
    const r = await chat(ctx.api, '¿Cuáles son los requisitos para inscribirme?');
    assert.equal(r.status, 200);
    assert.equal(r.body.escalada, false);
    assert.equal(r.body.dependencia.nombre, 'Admisiones');
    assert.match(r.body.respuesta, /inscripción/);
    const { rows } = await ctx.pool.query(
      `SELECT c.clasificacion, d.nombre, (SELECT count(*) FROM escalamiento) AS esc
         FROM consulta c JOIN dependencia d USING (id_dependencia)`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nombre, 'Admisiones');
    assert.equal(Number(rows[0].esc), 0);
  });

  test('Cortesia (saludo, gracias, chao): responde breve sin escalar ni registrar consulta', async () => {
    const contar = async () => (await ctx.pool.query('SELECT (SELECT count(*) FROM consulta) AS c, (SELECT count(*) FROM escalamiento) AS e')).rows[0];
    const antes = await contar();
    for (const texto of ['Hola', 'Buenas tardes', 'Muchas gracias', 'Chao']) {
      const r = await chat(ctx.api, texto);
      assert.equal(r.status, 200, texto);
      assert.equal(r.body.escalada, false, texto);
      assert.equal(r.body.dependencia, null, texto);
      assert.doesNotMatch(r.body.respuesta, /escalamiento/, texto);
    }
    const saludo = await chat(ctx.api, 'Hola');
    assert.match(saludo.body.respuesta, /AsistIA/);
    assert.match(saludo.body.respuesta, /Admisiones/);
    const despues = await contar();
    assert.equal(Number(despues.e), Number(antes.e), 'la cortesia no genera escalamientos');
    assert.equal(Number(despues.c), Number(antes.c), 'la cortesia no cuenta como consulta en los reportes');
  });

  test('Un saludo seguido de una pregunta se trata como consulta', async () => {
    const r = await chat(ctx.api, 'Hola, ¿cómo solicito un certificado de notas?');
    assert.equal(r.body.escalada, false);
    assert.equal(r.body.dependencia.nombre, 'Registro y Control');
  });

  test('Consulta sin dependencia identificable: escala con mensaje generico (RF-07)', async () => {
    const r = await chat(ctx.api, '¿Puedo cambiarme de programa a mitad de semestre?');
    assert.equal(r.status, 200);
    assert.equal(r.body.escalada, true);
    assert.equal(r.body.dependencia, null);
    assert.match(r.body.respuesta, /caso de escalamiento/);
    const { rows } = await ctx.pool.query('SELECT motivo, estado FROM escalamiento ORDER BY id_escalamiento DESC LIMIT 1');
    assert.equal(rows[0].motivo, 'dependencia_no_identificada');
    assert.equal(rows[0].estado, 'pendiente');
  });

  test('El mensaje del usuario y la respuesta quedan registrados en la conversacion (RF-09)', async () => {
    const a = await chat(ctx.api, '¿Cómo solicito un certificado de notas?');
    const id = a.body.id_conversacion;
    const b = await chat(ctx.api, 'Necesito también una constancia', { id_conversacion: id });
    assert.equal(b.body.id_conversacion, id, 'continua la misma conversacion');
    const token = await tokenUsuario(ctx.api);
    const det = await ctx.api.get(`/api/conversaciones/${id}`).set('Authorization', token);
    assert.equal(det.status, 200);
    assert.deepEqual(det.body.mensajes.map((m) => m.emisor), ['usuario', 'asistente', 'usuario', 'asistente']);
    const lista = await ctx.api.get('/api/conversaciones').set('Authorization', token);
    assert.ok(lista.body.some((c) => c.id_conversacion === id && c.dependencia === 'Registro y Control'));
  });

  test('Una cuenta de usuario no puede consultar ni continuar conversaciones de otra cuenta', async () => {
    const admin = await iniciarSesion(ctx.api, 'admin');
    const creada = await ctx.api.post('/api/admin/cuentas/usuarios').set('Authorization', admin).send({
      nombre_usuario: 'otro_usuario', correo: 'otro.usuario@example.test', contrasena: 'ClaveSegura2026',
    });
    assert.equal(creada.status, 201);
    const tokenOtro = await iniciarUsuario(ctx.api, 'otro_usuario', 'ClaveSegura2026');
    const a = await chat(ctx.api, '¿Cómo agendo una cita psicológica?');
    const id = a.body.id_conversacion;
    const lee = await ctx.api.get(`/api/conversaciones/${id}`).set('Authorization', tokenOtro);
    assert.equal(lee.status, 404);
    const sigue = await ctx.api.post('/api/chat').set('Authorization', tokenOtro).send({ id_sesion: OTRA_SESION, mensaje: 'hola', id_conversacion: id });
    assert.equal(sigue.status, 404);
  });

  test('Validaciones de entrada', async () => {
    const token = await tokenUsuario(ctx.api);
    assert.equal((await ctx.api.post('/api/chat').set('Authorization', token).send({ id_sesion: SESION })).status, 400);
    assert.equal((await ctx.api.post('/api/chat').set('Authorization', token).send({ id_sesion: SESION, mensaje: '   ' })).status, 400);
    assert.equal((await chat(ctx.api, 'x'.repeat(1001))).status, 400);
    assert.equal((await ctx.api.post('/api/chat').set('Authorization', token).send({ id_sesion: 'corto', mensaje: 'hola' })).status, 400);
    const malformado = await ctx.api.post('/api/chat').set('Authorization', token).set('Content-Type', 'application/json').send('{no es json');
    assert.equal(malformado.status, 400);
    assert.equal(malformado.body.error, 'json_invalido');
  });
});

describe('Chat: casos de escalamiento controlados con una IA de prueba', () => {
  function iaDePrueba({ generar }) {
    return {
      nombre: 'ia-de-prueba',
      async clasificar({ dependencias }) { return { dependencia_id: dependencias.find((d) => d.nombre === 'Bienestar').id_dependencia, tema: 'Cita psicológica' }; },
      generar,
    };
  }

  test('Informacion insuficiente: escala hacia el contacto de la dependencia', async () => {
    const ctx = await prepararEntorno({ ia: iaDePrueba({ generar: async () => ({ suficiente: false, respuesta: '', fuentes: [] }) }) });
    try {
      const r = await chat(ctx.api, 'Quiero una cita');
      assert.equal(r.body.escalada, true);
      assert.equal(r.body.dependencia.nombre, 'Bienestar');
      assert.match(r.body.respuesta, /comunicarte directamente con la dependencia indicada/);
      assert.match(r.body.contacto.texto, /contacto\.bienestar@ejemplo\.invalid/);
      const { rows } = await ctx.pool.query('SELECT motivo FROM escalamiento');
      assert.equal(rows[0].motivo, 'informacion_insuficiente');
      const cons = await ctx.pool.query('SELECT clasificacion FROM consulta');
      assert.equal(cons.rows[0].clasificacion, 'cita psicológica');
    } finally { await ctx.pool.end(); }
  });

  test('Respuesta que cita una fuente inexistente no se entrega: escala por respaldo no verificable', async () => {
    const ctx = await prepararEntorno({ ia: iaDePrueba({ generar: async () => ({ suficiente: true, respuesta: 'Cuesta 50.000 pesos.', fuentes: ['INFO-999'] }) }) });
    try {
      const r = await chat(ctx.api, 'Cuanto cuesta la cita');
      assert.equal(r.body.escalada, true);
      assert.doesNotMatch(r.body.respuesta, /50\.000/);
      const { rows } = await ctx.pool.query('SELECT motivo FROM escalamiento');
      assert.equal(rows[0].motivo, 'respaldo_no_verificable');
    } finally { await ctx.pool.end(); }
  });

  test('Dependencia sin informacion registrada: escala sin llamar a la generacion', async () => {
    let llamadas = 0;
    const ctx = await prepararEntorno({ ia: iaDePrueba({ generar: async () => { llamadas += 1; return { suficiente: true, respuesta: 'x', fuentes: ['INFO-1'] }; } }) });
    try {
      await ctx.pool.query('DELETE FROM informacion_institucional WHERE id_dependencia = 3; DELETE FROM pregunta_frecuente WHERE id_dependencia = 3;');
      const r = await chat(ctx.api, 'Quiero una cita');
      assert.equal(r.body.escalada, true);
      assert.equal(llamadas, 0);
      const { rows } = await ctx.pool.query('SELECT motivo FROM escalamiento');
      assert.equal(rows[0].motivo, 'sin_informacion_institucional');
    } finally { await ctx.pool.end(); }
  });

  test('Si el servicio de IA falla responde 503 y no se registra nada (no es un escalamiento)', async () => {
    const ctx = await prepararEntorno({ ia: { nombre: 'ia-caida', clasificar: async () => { throw new Error('timeout'); }, generar: async () => ({}) } });
    try {
      const r = await chat(ctx.api, 'Hola');
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'servicio_ia_no_disponible');
      const { rows } = await ctx.pool.query('SELECT (SELECT count(*) FROM conversacion) AS c, (SELECT count(*) FROM mensaje) AS m, (SELECT count(*) FROM escalamiento) AS e');
      assert.deepEqual([rows[0].c, rows[0].m, rows[0].e], ['0', '0', '0']);
    } finally { await ctx.pool.end(); }
  });

  test('Un id de dependencia inventado por la IA se descarta (se trata como no identificada)', async () => {
    const ctx = await prepararEntorno({ ia: { nombre: 'ia-erronea', clasificar: async () => ({ dependencia_id: 9999, tema: 'x' }), generar: async () => ({}) } });
    try {
      const r = await chat(ctx.api, 'Hola');
      assert.equal(r.body.escalada, true);
      assert.equal(r.body.dependencia, null);
    } finally { await ctx.pool.end(); }
  });
});
