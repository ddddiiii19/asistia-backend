// Q8 — Dependencias personalizadas: el administrador global escribe el nombre al crear la cuenta y el sistema crea la
// dependencia, sus apartados (información, preguntas frecuentes, historial y reportes) y su cuenta de acceso.
// Pruebas nuevas: no llaman a OpenAI (usan el simulador).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, chat, tokenUsuario } = require('./ayuda');

const CLAVE = 'Clave-nueva-segura-9';
const NUEVA = {
  nombre_dependencia: 'Biblioteca y Recursos',
  descripcion: 'Préstamo de libros, bases de datos y recursos bibliográficos de la biblioteca.',
  correos: ['biblioteca@teinco.test', 'recursos@teinco.test'],
  telefono: '601 555 01 02',
  nombre_usuario: 'admin_biblioteca',
  correo: 'admin.biblioteca@example.test',
  contrasena: CLAVE,
};

describe('dependencia nueva creada desde cero al crear la cuenta', () => {
  let ctx, global, bib, admisiones, usuario, idBib;
  const crear = (token, cuerpo) => ctx.api.post('/api/admin/cuentas/administradores-dependencia').set('Authorization', token).send(cuerpo);
  const cuenta = async (sql, p = []) => (await ctx.pool.query(sql, p)).rows;

  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    usuario = await tokenUsuario(ctx.api);
  });
  after(async () => { await ctx.pool.end(); });

  test('crea la dependencia, su contacto estructurado y su cuenta en una sola operación', async () => {
    const r = await crear(global, NUEVA);
    assert.equal(r.status, 201);
    assert.equal(r.body.cuenta.alcance_admin, 'dependencia');
    assert.equal(r.body.cuenta.dependencia, 'Biblioteca y Recursos');
    assert.equal('contrasena_hash' in r.body.cuenta, false);
    assert.equal(r.body.dependencia.nombre, 'Biblioteca y Recursos');
    assert.deepEqual(r.body.dependencia.correos, ['biblioteca@teinco.test', 'recursos@teinco.test']);
    assert.equal(r.body.dependencia.telefono, '601 555 01 02');
    assert.equal(r.body.dependencia.total_informacion, 0);
    assert.equal(r.body.dependencia.total_faq, 0);
    idBib = r.body.dependencia.id_dependencia;
    const dep = (await cuenta('SELECT * FROM dependencia WHERE id_dependencia = $1', [idBib]))[0];
    assert.equal(dep.contacto_responsable, 'biblioteca@teinco.test o recursos@teinco.test · Tel. 601 555 01 02');
    assert.equal(r.body.cuenta.id_dependencia, idBib);
    const login = await ctx.api.post('/api/auth/login').send({ nombre_usuario: 'admin_biblioteca', contrasena: CLAVE });
    assert.equal(login.status, 200);
    assert.equal(login.body.cuenta.alcance_admin, 'dependencia');
    assert.equal(login.body.cuenta.id_dependencia, idBib);
    bib = `Bearer ${login.body.token}`;
  });

  test('la dependencia nueva aparece sin tocar código en el listado público y en el del panel', async () => {
    const publico = (await ctx.api.get('/api/dependencias')).body;
    assert.ok(publico.some((d) => d.nombre === 'Biblioteca y Recursos'));
    assert.equal(publico.every((d) => !('correos' in d) && !('contacto_responsable' in d)), true, 'el listado público no expone el contacto');
    const global2 = (await ctx.api.get('/api/admin/dependencias').set('Authorization', global)).body;
    assert.equal(global2.length, 5);
    const propia = (await ctx.api.get('/api/admin/dependencias').set('Authorization', bib)).body;
    assert.equal(propia.length, 1);
    assert.equal(propia[0].nombre, 'Biblioteca y Recursos');
    assert.equal(propia[0].total_informacion, 0);
    assert.equal(propia[0].total_faq, 0);
  });

  test('su administrador gestiona la información y las preguntas frecuentes de SU dependencia (crear, editar y eliminar)', async () => {
    const info = await ctx.api.post('/api/admin/informacion').set('Authorization', bib).send({ titulo: 'Préstamo de libros', contenido: '[DATO DE PRUEBA] El préstamo de libros se solicita en el mostrador de la biblioteca con el carné vigente.' });
    assert.equal(info.status, 201, 'sin id_dependencia se asigna a la suya');
    assert.equal(info.body.id_dependencia, idBib);
    const edit = await ctx.api.put(`/api/admin/informacion/${info.body.id_info}`).set('Authorization', bib).send({ titulo: 'Préstamo de libros', contenido: '[DATO DE PRUEBA] El préstamo de libros se solicita en el mostrador con el carné vigente.' });
    assert.equal(edit.status, 200);
    const faq = await ctx.api.post('/api/admin/faq').set('Authorization', bib).send({ id_dependencia: idBib, pregunta: '¿Cómo reservo un libro?', respuesta: '[DATO DE PRUEBA] La reserva de libros se hace en el mostrador.' });
    assert.equal(faq.status, 201);
    assert.equal((await ctx.api.put(`/api/admin/faq/${faq.body.id_faq}`).set('Authorization', bib).send({ pregunta: '¿Cómo reservo un libro?', respuesta: 'Nueva' })).status, 200);
    assert.equal((await ctx.api.delete(`/api/admin/faq/${faq.body.id_faq}`).set('Authorization', bib)).status, 204);
    const lista = (await ctx.api.get('/api/admin/informacion').set('Authorization', bib)).body;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].dependencia, 'Biblioteca y Recursos');
    assert.equal((await ctx.api.get('/api/admin/faq').set('Authorization', bib)).body.length, 0);
    assert.equal((await ctx.api.get('/api/admin/dependencias').set('Authorization', bib)).body[0].total_informacion, 1);
  });

  test('permisos sobre otra dependencia: 403 al crear, editar, mover o eliminar contenido ajeno', async () => {
    const ajena = (await ctx.api.get('/api/admin/informacion').set('Authorization', admisiones)).body[0];
    const nuevo = { titulo: 'x', contenido: 'y' };
    assert.equal((await ctx.api.post('/api/admin/informacion').set('Authorization', bib).send({ ...nuevo, id_dependencia: 1 })).status, 403);
    assert.equal((await ctx.api.post('/api/admin/faq').set('Authorization', bib).send({ id_dependencia: 1, pregunta: 'p', respuesta: 'r' })).status, 403);
    assert.equal((await ctx.api.put(`/api/admin/informacion/${ajena.id_info}`).set('Authorization', bib).send(nuevo)).status, 403);
    assert.equal((await ctx.api.delete(`/api/admin/informacion/${ajena.id_info}`).set('Authorization', bib)).status, 403);
    const propia = (await ctx.api.get('/api/admin/informacion').set('Authorization', bib)).body[0];
    assert.equal((await ctx.api.put(`/api/admin/informacion/${propia.id_info}`).set('Authorization', bib).send({ ...nuevo, id_dependencia: 1 })).status, 403, 'tampoco puede mover su registro a otra dependencia');
    const faqAjena = (await ctx.api.get('/api/admin/faq').set('Authorization', admisiones)).body[0];
    assert.equal((await ctx.api.put(`/api/admin/faq/${faqAjena.id_faq}`).set('Authorization', bib).send({ pregunta: 'p', respuesta: 'r' })).status, 403);
    assert.equal((await ctx.api.delete(`/api/admin/faq/${faqAjena.id_faq}`).set('Authorization', bib)).status, 403);
    assert.equal((await ctx.api.put('/api/admin/dependencias/1').set('Authorization', bib).send({ descripcion: 'x' })).status, 403);
    assert.equal((await ctx.api.get('/api/admin/informacion?dependencia=1').set('Authorization', bib)).status, 403);
    assert.equal((await ctx.api.get('/api/admin/reportes/resumen?dependencia=1').set('Authorization', bib)).status, 403);
    assert.equal((await ctx.api.delete('/api/admin/informacion/99999').set('Authorization', bib)).status, 404);
    // El contenido ajeno quedó intacto.
    assert.ok((await ctx.api.get('/api/admin/informacion').set('Authorization', admisiones)).body.some((i) => i.id_info === ajena.id_info));
  });

  test('la IA (simulador) dirige consultas a la dependencia nueva: con contenido responde; en el historial y los reportes se ve', async () => {
    const r = await chat(ctx.api, '¿Cómo solicito el préstamo de libros de la biblioteca?');
    assert.equal(r.status, 200);
    assert.equal(r.body.dependencia.nombre, 'Biblioteca y Recursos');
    assert.equal(r.body.escalada, false);
    assert.match(r.body.respuesta, /mostrador/);
    assert.equal(r.body.contacto.texto, 'biblioteca@teinco.test o recursos@teinco.test · Tel. 601 555 01 02');
    assert.doesNotMatch(r.body.respuesta, /biblioteca@teinco\.test|601 555 01 02/);
    // Historial: lo ve su administrador (con el formato estándar), no el de otra dependencia.
    const lista = (await ctx.api.get('/api/admin/conversaciones').set('Authorization', bib)).body;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].dependencia, 'Biblioteca y Recursos');
    const det = (await ctx.api.get(`/api/admin/conversaciones/${lista[0].id_conversacion}`).set('Authorization', bib)).body;
    const resp = det.mensajes.find((m) => m.emisor === 'asistente');
    assert.equal(resp.dependencia.nombre, 'Biblioteca y Recursos');
    assert.ok(resp.contacto.texto.includes('601 555 01 02'));
    assert.equal((await ctx.api.get('/api/admin/conversaciones').set('Authorization', admisiones)).body.length, 0);
    assert.equal((await ctx.api.get(`/api/admin/conversaciones/${lista[0].id_conversacion}`).set('Authorization', admisiones)).status, 404);
    // Reportes: la dependencia aparece en las estadísticas globales y en el resumen de su propio administrador.
    const resumenG = (await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', global)).body;
    assert.ok(resumenG.por_dependencia.some((d) => d.dependencia === 'Biblioteca y Recursos' && d.total === 1));
    const resumenB = (await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', bib)).body;
    assert.equal(resumenB.total, 1);
    assert.equal(resumenB.por_dependencia.length, 1);
    const filtrado = (await ctx.api.get(`/api/admin/reportes/interacciones?dependencia=${idBib}`).set('Authorization', global)).body;
    assert.equal(filtrado.length, 1);
    const est = (await ctx.api.get('/api/admin/estadisticas').set('Authorization', global)).body;
    assert.ok(est.por_dependencia.some((d) => d.dependencia === 'Biblioteca y Recursos'));
    // Las consultas de otras dependencias no entran en su alcance.
    await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?', { id_sesion: 'sesion-de-prueba-0002' });
    assert.equal((await ctx.api.get('/api/admin/reportes/resumen').set('Authorization', bib)).body.total, 1);
  });

  test('una dependencia sin contenido escala sus consultas (con su contacto y su nombre en bloques aparte)', async () => {
    const r = await crear(global, { ...NUEVA, nombre_dependencia: 'Egresados', descripcion: 'Seguimiento y servicios para egresados y graduados de TEINCO.', correos: 'egresados@teinco.test', telefono: '', nombre_usuario: 'admin_egresados', correo: 'egresados@example.test' });
    assert.equal(r.status, 201);
    assert.equal(r.body.dependencia.telefono, null, 'el teléfono es opcional');
    const c = await chat(ctx.api, '¿Qué servicios tienen para los egresados?', { id_sesion: 'sesion-de-prueba-0009' });
    assert.equal(c.body.dependencia.nombre, 'Egresados');
    assert.equal(c.body.escalada, true);
    assert.equal(c.body.contacto.texto, 'egresados@teinco.test');
    assert.doesNotMatch(c.body.respuesta, /Egresados|egresados@teinco\.test/);
    const motivo = (await ctx.pool.query("SELECT e.motivo FROM escalamiento e JOIN consulta c ON c.id_consulta = e.id_consulta WHERE c.id_dependencia = $1", [r.body.dependencia.id_dependencia])).rows[0];
    assert.equal(motivo.motivo, 'sin_informacion_institucional');
    assert.equal(r.body.dependencia.total_informacion + r.body.dependencia.total_faq, 0);
  });

  test('las dependencias existentes y sus cuentas de demostración se conservan', async () => {
    const nombres = (await cuenta('SELECT nombre FROM dependencia ORDER BY id_dependencia')).map((d) => d.nombre);
    assert.deepEqual(nombres.slice(0, 4), ['Admisiones', 'Registro y Control', 'Bienestar', 'Coordinación académica']);
    assert.equal((await cuenta("SELECT 1 FROM administrador WHERE nombre_usuario IN ('admin_admisiones','admin_registro','admin_bienestar','admin_coordinacion')")).length, 4);
    const r = await chat(ctx.api, '¿Cómo solicito un certificado de notas?', { id_sesion: 'sesion-de-prueba-0010' });
    assert.equal(r.body.dependencia.nombre, 'Registro y Control');
  });
});

describe('nombre repetido, datos inválidos y permisos al crear dependencias', () => {
  let ctx, global, admisiones;
  const crear = (token, cuerpo) => ctx.api.post('/api/admin/cuentas/administradores-dependencia').set('Authorization', token).send(cuerpo);
  const contar = async (tabla) => Number((await ctx.pool.query(`SELECT count(*) FROM ${tabla}`)).rows[0].count);
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
  });
  after(async () => { await ctx.pool.end(); });

  test('un nombre existente (sin distinguir mayúsculas, tildes ni espacios) da 409 y no duplica nada', async () => {
    const deps = await contar('dependencia');
    const admins = await contar('administrador');
    for (const [i, nombre] of ['admisiones', 'ADMISIONES', 'Coordinacion Academica', '  coordinación   ACADÉMICA ', 'Registro y control'].entries()) {
      const r = await crear(global, { ...NUEVA, nombre_dependencia: nombre, nombre_usuario: `dup_${i}`, correo: `dup${i}@example.test` });
      assert.equal(r.status, 409, nombre);
      assert.equal(r.body.error, 'dependencia_existente');
    }
    assert.equal(await contar('dependencia'), deps);
    assert.equal(await contar('administrador'), admins);
  });

  test('si la cuenta no se puede crear (usuario o correo repetidos), tampoco se crea la dependencia', async () => {
    const deps = await contar('dependencia');
    const a = await crear(global, { ...NUEVA, nombre_usuario: 'admin_admisiones' });
    assert.equal(a.status, 409);
    assert.equal(a.body.error, 'cuenta_existente');
    const b = await crear(global, { ...NUEVA, correo: 'ADMIN_admisiones@ejemplo.invalid' });
    assert.equal(b.status, 409);
    assert.equal(await contar('dependencia'), deps, 'la operación es atómica');
  });

  test('rechaza datos inválidos con 400 sin crear nada', async () => {
    const deps = await contar('dependencia');
    const malos = [
      { nombre_dependencia: undefined }, { nombre_dependencia: '  ' }, { nombre_dependencia: 'ab' }, { nombre_dependencia: '123 456' },
      { nombre_dependencia: 'x'.repeat(101) }, { descripcion: undefined }, { descripcion: '' },
      { correos: undefined }, { correos: [] }, { correos: ['no-es-correo'] }, { correos: ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test', 'f@x.test'] },
      { telefono: '123' }, { telefono: 'abc' },
      { correos: ['a-muy-largo-para-que-el-contacto-no-quepa-en-la-columna@dominio-largo-de-prueba.example.test', 'otro-correo-bastante-largo-de-prueba@dominio-largo-de-prueba.example.test'] },
    ];
    for (const m of malos) {
      const r = await crear(global, { ...NUEVA, nombre_usuario: 'cuenta_valida', correo: 'valida@example.test', ...m });
      assert.equal(r.status, 400, JSON.stringify(m));
    }
    assert.equal((await crear(global, { ...NUEVA, contrasena: 'corta' })).status, 400);
    assert.equal(await contar('dependencia'), deps);
  });

  test('solo el administrador global crea dependencias: el de dependencia recibe 403 y sin sesión 401', async () => {
    assert.equal((await crear(admisiones, NUEVA)).status, 403);
    assert.equal((await ctx.api.post('/api/admin/cuentas/administradores-dependencia').send(NUEVA)).status, 401);
  });

  test('acepta correos como texto separado por comas y teléfono con varios números', async () => {
    const r = await crear(global, { ...NUEVA, nombre_dependencia: 'Extensión', correos: 'Ext@Teinco.test, ext2@teinco.test', telefono: '601 743 32 00 · WhatsApp 301 333 79 56' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.dependencia.correos, ['ext@teinco.test', 'ext2@teinco.test']);
    assert.equal(r.body.dependencia.telefono, '601 743 32 00 · WhatsApp 301 333 79 56');
  });
});

describe('editar la descripción y el contacto de una dependencia', () => {
  let ctx, global, admisiones, registro;
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
  });
  after(async () => { await ctx.pool.end(); });

  test('el administrador de una dependencia edita la suya; el contacto se refleja en las respuestas y en contacto_responsable', async () => {
    const r = await ctx.api.put('/api/admin/dependencias/1').set('Authorization', admisiones)
      .send({ descripcion: 'Inscripciones y admisión de aspirantes.', correos: ['nuevo@teinco.test'], telefono: '601 000 11 22', nombre: 'No cambia' });
    assert.equal(r.status, 200);
    assert.equal(r.body.nombre, 'Admisiones', 'el nombre no se edita');
    assert.equal(r.body.descripcion, 'Inscripciones y admisión de aspirantes.');
    assert.deepEqual(r.body.correos, ['nuevo@teinco.test']);
    const fila = (await ctx.pool.query('SELECT contacto_responsable FROM dependencia WHERE id_dependencia = 1')).rows[0];
    assert.equal(fila.contacto_responsable, 'nuevo@teinco.test · Tel. 601 000 11 22');
    const c = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    assert.equal(c.body.contacto.texto, 'nuevo@teinco.test · Tel. 601 000 11 22');
  });

  test('solo se actualiza lo enviado, el global edita cualquiera y el de otra dependencia recibe 403', async () => {
    const soloDescripcion = await ctx.api.put('/api/admin/dependencias/2').set('Authorization', global).send({ descripcion: 'Certificados y matrícula.' });
    assert.equal(soloDescripcion.status, 200);
    assert.deepEqual(soloDescripcion.body.correos, ['contacto.registro@ejemplo.invalid'], 'el contacto no cambia');
    assert.equal((await ctx.api.put('/api/admin/dependencias/2').set('Authorization', admisiones).send({ descripcion: 'x' })).status, 403);
    assert.equal((await ctx.api.put('/api/admin/dependencias/2').set('Authorization', registro).send({ telefono: '601 000 11 22' })).status, 400, 'el contacto exige al menos un correo');
    assert.equal((await ctx.api.put('/api/admin/dependencias/2').set('Authorization', registro).send({})).status, 400);
    assert.equal((await ctx.api.put('/api/admin/dependencias/2').set('Authorization', registro).send({ descripcion: ' ' })).status, 400);
    assert.equal((await ctx.api.put('/api/admin/dependencias/999').set('Authorization', global).send({ descripcion: 'x' })).status, 404);
  });

  test('no existe forma de eliminar dependencias ni cuentas desde el API', async () => {
    assert.equal((await ctx.api.delete('/api/admin/dependencias/1').set('Authorization', global)).status, 404);
    assert.equal((await ctx.api.delete('/api/admin/cuentas/administradores-dependencia/1').set('Authorization', global)).status, 404);
  });
});
