// Q7 — (1) Las respuestas de una dependencia incluyen su contacto. (2) El administrador global puede crear
// cuentas de dependencia, que solo ven las respuestas y reportes de su propia dependencia.
// Pruebas nuevas: no modifican las de entregas anteriores y no llaman a OpenAI (usan el simulador).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, chat, PASSWORD } = require('./ayuda');
const { conContacto } = require('../src/ia/contacto');

describe('conContacto (función)', () => {
  const dep = { nombre: 'Bienestar', contacto_responsable: 'bienestar@teinco.edu.co o bienestar2@teinco.edu.co · Tel. 601 743 32 00' };

  test('agrega el contacto en una línea aparte al final de la respuesta', () => {
    assert.equal(conContacto('Texto.', dep), 'Texto.\n\nContacto de Bienestar: bienestar@teinco.edu.co o bienestar2@teinco.edu.co · Tel. 601 743 32 00.');
  });
  test('no lo repite si la respuesta ya incluye alguno de los correos (sin distinguir mayúsculas)', () => {
    const r = 'Escribe a Bienestar@TEINCO.edu.co para agendar.';
    assert.equal(conContacto(r, dep), r);
  });
  test('no agrega nada si la dependencia no tiene contacto o no hay dependencia', () => {
    assert.equal(conContacto('Texto.', { nombre: 'X', contacto_responsable: null }), 'Texto.');
    assert.equal(conContacto('Texto.', { nombre: 'X', contacto_responsable: '   ' }), 'Texto.');
    assert.equal(conContacto('Texto.', null), 'Texto.');
  });
  test('no duplica el punto final y funciona con un contacto sin correo', () => {
    assert.equal(conContacto('A', { nombre: 'X', contacto_responsable: 'Tel. 601 743 32 00.' }), 'A\n\nContacto de X: Tel. 601 743 32 00.');
  });
});

describe('contacto de la dependencia en las respuestas del asistente', () => {
  let ctx;
  const CONTACTO_ADM = 'admisiones@teinco.test · Tel. 601 743 32 00';
  before(async () => {
    ctx = await prepararEntorno();
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = $1, correos = ARRAY['admisiones@teinco.test'], telefono = '601 743 32 00' WHERE nombre = 'Admisiones'", [CONTACTO_ADM]);
  });
  after(async () => { await ctx.pool.end(); });

  // Q8: el contacto ya no va como línea dentro del texto: viaja en el campo `contacto` y el mensaje guardado no lo repite.
  test('una respuesta resuelta de Admisiones trae su correo y teléfono en el campo contacto, y el mensaje guardado no lo repite', async () => {
    const r = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    assert.equal(r.status, 200);
    assert.equal(r.body.escalada, false);
    assert.equal(r.body.dependencia.nombre, 'Admisiones');
    assert.equal(r.body.contacto.texto, CONTACTO_ADM);
    assert.deepEqual(r.body.contacto.correos, ['admisiones@teinco.test']);
    assert.equal(r.body.contacto.telefono, '601 743 32 00');
    assert.doesNotMatch(r.body.respuesta, /admisiones@teinco\.test|Contacto de/, 'el contacto no se repite dentro del mensaje');
    const { rows } = await ctx.pool.query("SELECT contenido FROM mensaje WHERE emisor = 'asistente' ORDER BY id_mensaje DESC LIMIT 1");
    assert.equal(rows[0].contenido, r.body.respuesta);
  });

  test('la respuesta escalada lleva el contacto en su campo y no dentro del mensaje', async () => {
    const ctx2 = await prepararEntorno({ ia: { nombre: 'prueba',
      clasificar: async () => ({ dependencia_id: 1, tema: 'x', intencion: 'consulta' }),
      generar: async () => ({ suficiente: false, respuesta: '', fuentes: [] }) } });
    try {
      await ctx2.pool.query("UPDATE dependencia SET contacto_responsable = $1, correos = ARRAY['admisiones@teinco.test'], telefono = '601 743 32 00' WHERE nombre = 'Admisiones'", [CONTACTO_ADM]);
      const r = await chat(ctx2.api, 'Pregunta sin respaldo');
      assert.equal(r.body.escalada, true);
      assert.equal(r.body.contacto.texto, CONTACTO_ADM);
      assert.doesNotMatch(r.body.respuesta, /admisiones@teinco\.test|Contacto de Admisiones/);
    } finally { await ctx2.pool.end(); }
  });

  test('si la dependencia no tiene contacto cargado, la respuesta no agrega nada ni falla', async () => {
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = NULL, correos = '{}', telefono = NULL WHERE nombre = 'Admisiones'");
    const r = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?', { id_sesion: 'sesion-de-prueba-0002' });
    assert.equal(r.status, 200);
    assert.equal(r.body.escalada, false);
    assert.doesNotMatch(r.body.respuesta, /Contacto de/);
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = $1, correos = ARRAY['admisiones@teinco.test'], telefono = '601 743 32 00' WHERE nombre = 'Admisiones'", [CONTACTO_ADM]);
  });

  test('la respuesta de una pregunta frecuente también trae el contacto (campo aparte) y suma una sola consulta', async () => {
    const token = await iniciarSesion(ctx.api, 'usuario_demo');
    const lista = (await ctx.api.get('/api/faq').set('Authorization', token)).body;
    const faq = lista.find((f) => f.dependencia === 'Admisiones');
    const antes = (await ctx.pool.query('SELECT frecuencia FROM pregunta_frecuente WHERE id_faq = $1', [faq.id_faq])).rows[0].frecuencia;
    const r = await ctx.api.post(`/api/faq/${faq.id_faq}/consulta`).set('Authorization', token);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['contacto', 'dependencia', 'id_faq', 'pregunta', 'respuesta']);
    assert.equal(r.body.contacto.texto, CONTACTO_ADM);
    assert.equal(r.body.dependencia.nombre, 'Admisiones');
    const despues = (await ctx.pool.query('SELECT frecuencia FROM pregunta_frecuente WHERE id_faq = $1', [faq.id_faq])).rows[0].frecuencia;
    assert.equal(despues, antes + 1);
    assert.equal((await ctx.api.post('/api/faq/999999/consulta').set('Authorization', token)).status, 404);
  });

  test('un saludo no lleva contacto (no es una respuesta de una dependencia)', async () => {
    const r = await chat(ctx.api, 'Hola');
    assert.doesNotMatch(r.body.respuesta, /Contacto de/);
  });
});

describe('creación de cuentas de dependencia (administrador global)', () => {
  let ctx, global, adminAdmisiones;
  const CLAVE = 'Clave-nueva-segura-9';
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    adminAdmisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
  });
  after(async () => { await ctx.pool.end(); });

  const crear = (token, cuerpo) => ctx.api.post('/api/admin/cuentas/administradores-dependencia').set('Authorization', token).send(cuerpo);
  const idDependencia = async (nombre) => (await ctx.pool.query('SELECT id_dependencia FROM dependencia WHERE nombre = $1', [nombre])).rows[0].id_dependencia;

  test('crea la cuenta con rol de dependencia, sin exponer el hash, y permite iniciar sesión con su alcance', async () => {
    const dep = await idDependencia('Bienestar');
    const r = await crear(global, { nombre_usuario: 'bienestar_nuevo', correo: 'Bienestar.Nuevo@example.test', contrasena: CLAVE, id_dependencia: dep });
    assert.equal(r.status, 201);
    assert.equal(r.body.cuenta.alcance_admin, 'dependencia');
    assert.equal(r.body.cuenta.id_dependencia, dep);
    assert.equal(r.body.cuenta.dependencia, 'Bienestar');
    assert.equal('contrasena_hash' in r.body.cuenta, false);
    const fila = (await ctx.pool.query("SELECT rol, id_dependencia, correo FROM administrador WHERE nombre_usuario = 'bienestar_nuevo'")).rows[0];
    assert.deepEqual(fila, { rol: 'dependencia', id_dependencia: dep, correo: 'bienestar.nuevo@example.test' });
    const login = await ctx.api.post('/api/auth/login').send({ identificador: 'bienestar_nuevo', contrasena: CLAVE });
    assert.equal(login.status, 200);
    assert.equal(login.body.cuenta.tipo, 'administrador');
    assert.equal(login.body.cuenta.alcance_admin, 'dependencia');
    assert.equal(login.body.cuenta.id_dependencia, dep);
  });

  test('rechaza duplicados (nombre o correo, también frente a cuentas de Usuario) y datos inválidos', async () => {
    const dep = await idDependencia('Bienestar');
    const base = { nombre_usuario: 'otra_cuenta', correo: 'otra@example.test', contrasena: CLAVE, id_dependencia: dep };
    assert.equal((await crear(global, { ...base, nombre_usuario: 'bienestar_nuevo' })).status, 409);
    assert.equal((await crear(global, { ...base, correo: 'bienestar.nuevo@example.test' })).status, 409);
    assert.equal((await crear(global, { ...base, nombre_usuario: 'USUARIO_DEMO' })).status, 409);
    assert.equal((await crear(global, { ...base, contrasena: 'corta' })).status, 400);
    assert.equal((await crear(global, { ...base, correo: 'no-es-correo' })).status, 400);
    assert.equal((await crear(global, { ...base, id_dependencia: undefined })).status, 400);
    assert.equal((await crear(global, { ...base, id_dependencia: 'abc' })).status, 400);
    assert.equal((await crear(global, { ...base, id_dependencia: 99999 })).status, 404);
    assert.equal((await ctx.pool.query("SELECT 1 FROM administrador WHERE nombre_usuario = 'otra_cuenta'")).rowCount, 0);
  });

  test('un administrador global no se puede crear por este medio aunque se envíe el rol', async () => {
    const dep = await idDependencia('Admisiones');
    const r = await crear(global, { nombre_usuario: 'intento_global', correo: 'intento@example.test', contrasena: CLAVE, id_dependencia: dep, rol: 'global' });
    assert.equal(r.status, 201);
    assert.equal((await ctx.pool.query("SELECT rol FROM administrador WHERE nombre_usuario = 'intento_global'")).rows[0].rol, 'dependencia');
  });

  test('solo el administrador global puede crearlas: el de dependencia y los usuarios reciben 403, sin sesión 401', async () => {
    const dep = await idDependencia('Admisiones');
    const cuerpo = { nombre_usuario: 'no_permitida', correo: 'no@example.test', contrasena: CLAVE, id_dependencia: dep };
    assert.equal((await crear(adminAdmisiones, cuerpo)).status, 403);
    const usuario = await iniciarSesion(ctx.api, 'usuario_demo');
    assert.equal((await crear(usuario, cuerpo)).status, 403);
    assert.equal((await ctx.api.post('/api/admin/cuentas/administradores-dependencia').send(cuerpo)).status, 401);
  });

  test('la cuenta creada ve solo las respuestas y los reportes de su dependencia', async () => {
    const dep = await idDependencia('Registro y Control');
    await crear(global, { nombre_usuario: 'registro_nuevo', correo: 'registro.nuevo@example.test', contrasena: CLAVE, id_dependencia: dep });
    await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?'); // Admisiones
    await chat(ctx.api, '¿Cómo solicito un certificado de notas?', { id_sesion: 'sesion-de-prueba-0003' }); // Registro y Control
    const nuevo = await iniciarSesion(ctx.api, 'registro_nuevo', CLAVE);

    const resumen = (await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', nuevo)).body;
    assert.equal(resumen.total, 1);
    assert.deepEqual(resumen.por_dependencia.map((d) => d.dependencia), ['Registro y Control']);
    const global_ = (await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', global)).body;
    assert.equal(global_.total, 2);

    const interacciones = (await ctx.api.get('/api/admin/reportes/interacciones').set('Authorization', nuevo)).body;
    assert.ok(interacciones.length > 0);
    assert.ok(interacciones.every((i) => i.dependencia === 'Registro y Control'));

    const conversaciones = (await ctx.api.get('/api/admin/conversaciones').set('Authorization', nuevo)).body;
    assert.equal(conversaciones.length, 1);
    assert.match(conversaciones[0].primera_consulta, /certificado de notas/);

    const otraDep = await idDependencia('Admisiones');
    assert.equal((await ctx.api.get(`/api/admin/reportes/resumen?dependencia=${otraDep}`).set('Authorization', nuevo)).status, 403);
  });

  test('la cuenta de dependencia no puede crear otras cuentas ni modificar contenido', async () => {
    const nuevo = await iniciarSesion(ctx.api, 'registro_nuevo', CLAVE);
    assert.equal((await ctx.api.post('/api/admin/informacion').set('Authorization', nuevo).send({ id_dependencia: 1, titulo: 'x', contenido: 'y' })).status, 403);
  });
});
