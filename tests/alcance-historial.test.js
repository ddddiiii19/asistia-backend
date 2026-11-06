const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, chat } = require('./ayuda');

// Una misma conversación puede contener preguntas dirigidas a dependencias distintas. El administrador de una
// dependencia solo debe ver las suyas (y la respuesta que recibieron); el global ve la conversación completa.
describe('historial administrativo: alcance por dependencia en conversaciones mixtas', () => {
  let ctx, global, admisiones, registro, ids = {};
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
    // A: empieza en Admisiones y sigue en Registro y Control.
    const a1 = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    ids.a = a1.body.id_conversacion;
    await chat(ctx.api, '¿Cómo solicito un certificado de notas?', { id_conversacion: ids.a });
    // B: empieza en Registro y Control y sigue en Admisiones (la primera pregunta NO es de Admisiones).
    const b1 = await chat(ctx.api, '¿Cómo consulto mi matrícula?', { id_sesion: 'sesion-de-prueba-0003' });
    ids.b = b1.body.id_conversacion;
    await chat(ctx.api, '¿Cuándo es la inscripción de aspirantes?', { id_conversacion: ids.b, id_sesion: 'sesion-de-prueba-0003' });
  });
  after(async () => { await ctx.pool.end(); });

  const detalle = (token, id) => ctx.api.get(`/api/admin/conversaciones/${id}`).set('Authorization', token);
  const lista = async (token) => new Map((await ctx.api.get('/api/admin/conversaciones').set('Authorization', token)).body.map((c) => [c.id_conversacion, c]));
  const textos = (r) => r.body.mensajes.map((m) => m.contenido).join(' | ');

  test('el administrador global ve la conversación completa (4 mensajes y 2 consultas)', async () => {
    const r = await detalle(global, ids.a);
    assert.equal(r.body.mensajes.length, 4);
    assert.equal(r.body.consultas.length, 2);
    assert.match(textos(r), /certificado de notas/);
    assert.match(textos(r), /requisitos de inscripción/);
  });

  test('Admisiones solo ve su pregunta y su respuesta, no la pregunta de Registro y Control', async () => {
    const r = await detalle(admisiones, ids.a);
    assert.equal(r.status, 200);
    assert.equal(r.body.mensajes.length, 2);
    assert.deepEqual(r.body.mensajes.map((m) => m.emisor), ['usuario', 'asistente']);
    assert.match(r.body.mensajes[0].contenido, /requisitos de inscripción/);
    assert.doesNotMatch(textos(r), /certificado/i);
    assert.equal(r.body.consultas.length, 1);
    assert.equal(r.body.consultas[0].dependencia, 'Admisiones');
  });

  test('Registro y Control ve únicamente la otra mitad de la misma conversación', async () => {
    const r = await detalle(registro, ids.a);
    assert.equal(r.body.mensajes.length, 2);
    assert.match(r.body.mensajes[0].contenido, /certificado de notas/);
    assert.doesNotMatch(textos(r), /requisitos de inscripción/i);
    assert.equal(r.body.consultas.length, 1);
    assert.equal(r.body.consultas[0].dependencia, 'Registro y Control');
  });

  test('la lista cuenta mensajes y muestra la primera consulta solo dentro del alcance', async () => {
    const g = await lista(global);
    assert.equal(g.get(ids.a).mensajes, 4);
    assert.match(g.get(ids.a).primera_consulta, /requisitos de inscripción/);

    const a = await lista(admisiones);
    assert.equal(a.get(ids.a).mensajes, 2);
    assert.match(a.get(ids.a).primera_consulta, /requisitos de inscripción/);
    // En B la primera pregunta es de Registro y Control: Admisiones debe ver SU pregunta, no esa.
    assert.equal(a.get(ids.b).mensajes, 2);
    assert.match(a.get(ids.b).primera_consulta, /inscripción de aspirantes/);
    assert.doesNotMatch(a.get(ids.b).primera_consulta, /matrícula/i);

    const r = await lista(registro);
    assert.equal(r.get(ids.b).mensajes, 2);
    assert.match(r.get(ids.b).primera_consulta, /matrícula/i);
  });

  test('un administrador global que filtra por dependencia sigue pudiendo abrir la conversación completa', async () => {
    const l = await ctx.api.get('/api/admin/conversaciones?dependencia=1').set('Authorization', global);
    assert.ok(l.body.find((c) => c.id_conversacion === ids.a));
    assert.equal(l.body.find((c) => c.id_conversacion === ids.a).mensajes, 4, 'el filtro no oculta mensajes al global');
  });

  test('el id_sesion sigue sin exponerse', async () => {
    const r = await detalle(admisiones, ids.a);
    assert.ok(!('id_sesion' in r.body));
    const l = await ctx.api.get('/api/admin/conversaciones').set('Authorization', admisiones);
    assert.ok(l.body.every((c) => !('id_sesion' in c)));
  });
});
