// Q8 — Formato estándar de respuesta: (1) mensaje, (2) contacto (correo y teléfono) y (3) dependencia, sin redundancia.
// Pruebas nuevas: no modifican las anteriores y no llaman a OpenAI (usan el simulador o una IA de prueba).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, chat, tokenUsuario } = require('./ayuda');
const {
  extraerContacto, componerTextoContacto, contactoDe, mensajeIncluyeContacto, limpiarMensaje, formatoRespuesta,
} = require('../src/ia/contacto');
const { mensajeEscalamiento } = require('../src/ia/orquestador');

const BIENESTAR = {
  id_dependencia: 3, nombre: 'Bienestar', correos: ['bienestar@teinco.test', 'bienestar2@teinco.test'], telefono: '601 743 32 00', contacto_responsable: null,
};

describe('funciones del formato estándar', () => {
  test('extraerContacto separa correos y teléfono(s) del texto libre sin perder nada', () => {
    assert.deepEqual(extraerContacto('a@x.co o b@x.co · Tel. 601 743 32 00'), { correos: ['a@x.co', 'b@x.co'], telefono: '601 743 32 00' });
    assert.deepEqual(extraerContacto('601 743 32 00 · WhatsApp 301 333 79 56 · coord@teinco.edu.co'),
      { correos: ['coord@teinco.edu.co'], telefono: '601 743 32 00 · WhatsApp 301 333 79 56' });
    assert.deepEqual(extraerContacto('[DATO DE PRUEBA] contacto.x@ejemplo.invalid'), { correos: ['contacto.x@ejemplo.invalid'], telefono: null });
    assert.deepEqual(extraerContacto(null), { correos: [], telefono: null });
    assert.deepEqual(extraerContacto('A@x.co, a@X.co'), { correos: ['A@x.co'], telefono: null }, 'no repite correos que solo cambian de mayúsculas');
  });

  test('componerTextoContacto y contactoDe arman el texto "correo(s) · Tel. número"', () => {
    assert.equal(componerTextoContacto(['a@x.co', 'b@x.co'], '601 743 32 00'), 'a@x.co o b@x.co · Tel. 601 743 32 00');
    assert.equal(componerTextoContacto([], '601 743 32 00'), 'Tel. 601 743 32 00');
    assert.equal(componerTextoContacto(['a@x.co'], null), 'a@x.co');
    assert.deepEqual(contactoDe(BIENESTAR), { correos: BIENESTAR.correos, telefono: '601 743 32 00', texto: 'bienestar@teinco.test o bienestar2@teinco.test · Tel. 601 743 32 00' });
  });

  test('contactoDe usa el texto libre solo si la dependencia no tiene contacto estructurado, y es null sin contacto', () => {
    assert.equal(contactoDe({ correos: [], telefono: null, contacto_responsable: ' Oficina 203 ' }).texto, 'Oficina 203');
    assert.equal(contactoDe({ correos: [], telefono: null, contacto_responsable: '  ' }), null);
    assert.equal(contactoDe({ correos: [], telefono: null, contacto_responsable: null }), null);
    assert.equal(contactoDe(null), null);
  });

  test('formatoRespuesta: tres partes y el contacto no se repite si el mensaje ya lo trae', () => {
    const f = formatoRespuesta({ mensaje: 'Puedes agendar en la oficina.', dependencia: BIENESTAR });
    assert.deepEqual(Object.keys(f), ['respuesta', 'contacto', 'dependencia']);
    assert.equal(f.respuesta, 'Puedes agendar en la oficina.');
    assert.deepEqual(f.dependencia, { id_dependencia: 3, nombre: 'Bienestar' });
    assert.equal(f.contacto.telefono, '601 743 32 00');
    assert.equal(formatoRespuesta({ mensaje: 'Escribe a BIENESTAR@teinco.test para agendar.', dependencia: BIENESTAR }).contacto, null);
    assert.equal(formatoRespuesta({ mensaje: 'Llama al 6017433200 para agendar.', dependencia: BIENESTAR }).contacto, null);
    assert.equal(mensajeIncluyeContacto('Texto sin datos', BIENESTAR), false);
  });

  test('sin dependencia identificada, contacto y dependencia son null', () => {
    assert.deepEqual(formatoRespuesta({ mensaje: '¡Hola!', dependencia: null }), { respuesta: '¡Hola!', contacto: null, dependencia: null });
  });

  test('limpiarMensaje retira, solo al mostrar, el contacto y el nombre que los mensajes anteriores a Q8 traían en el texto', () => {
    const resuelto = 'Se solicita en línea.\n\nContacto de Bienestar: bienestar@teinco.test · Tel. 601 743 32 00.';
    assert.equal(limpiarMensaje(resuelto, BIENESTAR), 'Se solicita en línea.');
    const escalado = 'No cuento con información suficiente para responder tu consulta con certeza. Te recomiendo comunicarte directamente con Bienestar. Contacto: bienestar@teinco.test · Tel. 601 743 32 00. Tu consulta quedó registrada como caso de escalamiento.';
    const limpio = limpiarMensaje(escalado, BIENESTAR);
    assert.doesNotMatch(limpio, /Bienestar|teinco\.test|601 743/);
    assert.match(limpio, /comunicarte directamente con la dependencia indicada\. Tu consulta quedó registrada/);
    assert.equal(limpiarMensaje('Texto normal', BIENESTAR), 'Texto normal');
  });

  test('el mensaje de escalamiento no nombra la dependencia ni trae su contacto', () => {
    const m = mensajeEscalamiento(BIENESTAR);
    assert.doesNotMatch(m, /Bienestar|@|601/);
    assert.match(m, /comunicarte directamente con la dependencia indicada/);
    assert.doesNotMatch(mensajeEscalamiento(null), /@/);
  });
});

describe('formato en el chat, las preguntas frecuentes y los historiales', () => {
  let ctx, usuario, global, admisiones, registro;
  const CONTACTO_ADM = 'admisiones@teinco.test · Tel. 601 743 32 00';
  // prepararEntorno reinicia la base de pruebas: tras usar otro entorno se vuelve a fijar el contacto de Admisiones.
  const fijarContactoAdmisiones = () => ctx.pool.query(
    "UPDATE dependencia SET contacto_responsable = $1, correos = ARRAY['admisiones@teinco.test'], telefono = '601 743 32 00' WHERE nombre = 'Admisiones'", [CONTACTO_ADM]);
  before(async () => {
    ctx = await prepararEntorno();
    await fijarContactoAdmisiones();
    usuario = await tokenUsuario(ctx.api);
    global = await iniciarSesion(ctx.api, 'admin');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
  });
  after(async () => { await ctx.pool.end(); });

  test('respuesta resuelta: mensaje, contacto y dependencia separados; el mensaje no repite ni el contacto ni el nombre del contacto', async () => {
    const r = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ['id_conversacion', 'respuesta', 'contacto', 'dependencia', 'escalada']);
    assert.equal(r.body.escalada, false);
    assert.deepEqual(r.body.dependencia, { id_dependencia: 1, nombre: 'Admisiones' });
    assert.deepEqual(r.body.contacto, { correos: ['admisiones@teinco.test'], telefono: '601 743 32 00', texto: CONTACTO_ADM });
    assert.doesNotMatch(r.body.respuesta, /admisiones@teinco\.test|601 743 32 00|Contacto/);
    const guardado = (await ctx.pool.query("SELECT contenido FROM mensaje WHERE emisor = 'asistente' ORDER BY id_mensaje DESC LIMIT 1")).rows[0].contenido;
    assert.equal(guardado, r.body.respuesta, 'solo se guarda el mensaje');
  });

  test('escalamiento con dependencia: mensaje neutro, contacto y dependencia en sus campos', async () => {
    const ctx2 = await prepararEntorno({ ia: { nombre: 'prueba',
      clasificar: async () => ({ dependencia_id: 3, tema: 'x', intencion: 'consulta' }),
      generar: async () => ({ suficiente: false, respuesta: '', fuentes: [] }) } });
    try {
      const r = await chat(ctx2.api, 'Pregunta sin respaldo');
      assert.equal(r.body.escalada, true);
      assert.equal(r.body.respuesta, mensajeEscalamiento({ nombre: 'Bienestar' }));
      assert.doesNotMatch(r.body.respuesta, /Bienestar|@ejemplo|Contacto/);
      assert.equal(r.body.dependencia.nombre, 'Bienestar');
      assert.match(r.body.contacto.texto, /contacto\.bienestar@ejemplo\.invalid/);
      const guardado = (await ctx2.pool.query("SELECT contenido FROM mensaje WHERE emisor = 'asistente'")).rows[0].contenido;
      assert.equal(guardado, r.body.respuesta);
    } finally { await ctx2.pool.end(); await prepararEntorno().then(async (e) => { await e.pool.end(); }); await fijarContactoAdmisiones(); }
  });

  test('escalamiento sin dependencia identificada y saludo: contacto y dependencia nulos', async () => {
    const sinDep = await chat(ctx.api, 'xyzzy plugh qwerty', { id_sesion: 'sesion-de-prueba-0003' });
    assert.equal(sinDep.body.escalada, true);
    assert.equal(sinDep.body.contacto, null);
    assert.equal(sinDep.body.dependencia, null);
    const hola = await chat(ctx.api, 'Hola', { id_sesion: 'sesion-de-prueba-0004' });
    assert.equal(hola.body.contacto, null);
    assert.equal(hola.body.dependencia, null);
    assert.match(hola.body.respuesta, /AsistIA/);
  });

  test('dependencia sin contacto cargado: contacto nulo, dependencia presente y sin errores', async () => {
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = NULL, correos = '{}', telefono = NULL WHERE nombre = 'Registro y Control'");
    const r = await chat(ctx.api, '¿Cómo solicito un certificado de notas?', { id_sesion: 'sesion-de-prueba-0005' });
    assert.equal(r.status, 200);
    assert.equal(r.body.contacto, null);
    assert.equal(r.body.dependencia.nombre, 'Registro y Control');
    await ctx.pool.query("UPDATE dependencia SET contacto_responsable = 'contacto.registro@ejemplo.invalid', correos = ARRAY['contacto.registro@ejemplo.invalid'] WHERE nombre = 'Registro y Control'");
  });

  test('si el mensaje ya trae el correo de la dependencia, el contacto no se repite', async () => {
    const ia = { nombre: 'prueba',
      clasificar: async () => ({ dependencia_id: 3, tema: 'x', intencion: 'consulta' }),
      generar: async ({ contexto }) => ({ suficiente: true, respuesta: 'Escribe a contacto.bienestar@ejemplo.invalid para agendar.', fuentes: [contexto[0].ref] }) };
    const ctx4 = await prepararEntorno({ ia });
    try {
      const r = await chat(ctx4.api, 'Quiero agendar');
      assert.equal(r.body.escalada, false);
      assert.equal(r.body.contacto, null);
      assert.equal(r.body.dependencia.nombre, 'Bienestar');
      assert.equal(r.body.respuesta.split('contacto.bienestar@ejemplo.invalid').length - 1, 1);
    } finally { await ctx4.pool.end(); await prepararEntorno().then(async (e) => { await e.pool.end(); }); await fijarContactoAdmisiones(); }
  });

  test('pregunta frecuente: misma estructura (respuesta, contacto y dependencia) y sin repetir el contacto', async () => {
    const lista = (await ctx.api.get('/api/faq').set('Authorization', usuario)).body;
    const faq = lista.find((f) => f.dependencia === 'Admisiones');
    const r = await ctx.api.post(`/api/faq/${faq.id_faq}/consulta`).set('Authorization', usuario);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['contacto', 'dependencia', 'id_faq', 'pregunta', 'respuesta']);
    assert.equal(r.body.contacto.texto, CONTACTO_ADM);
    assert.deepEqual(r.body.dependencia, { id_dependencia: 1, nombre: 'Admisiones' });
    assert.doesNotMatch(r.body.respuesta, /admisiones@teinco\.test|Contacto de/);
    // Si el texto de la pregunta ya incluye el correo, el bloque de contacto se omite.
    const original = (await ctx.pool.query('SELECT respuesta FROM pregunta_frecuente WHERE id_faq = $1', [faq.id_faq])).rows[0].respuesta;
    await ctx.pool.query("UPDATE pregunta_frecuente SET respuesta = respuesta || ' Escríbenos a admisiones@teinco.test.' WHERE id_faq = $1", [faq.id_faq]);
    try {
      const r2 = await ctx.api.post(`/api/faq/${faq.id_faq}/consulta`).set('Authorization', usuario);
      assert.equal(r2.body.contacto, null);
      assert.equal(r2.body.respuesta.split('admisiones@teinco.test').length - 1, 1);
    } finally {
      await ctx.pool.query('UPDATE pregunta_frecuente SET respuesta = $2 WHERE id_faq = $1', [faq.id_faq, original]);
    }
  });

  test('"Mi historial": las respuestas del asistente usan el mismo formato; las del usuario no cambian', async () => {
    const primera = await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?', { id_sesion: 'sesion-de-prueba-0006' });
    const idConv = primera.body.id_conversacion;
    await chat(ctx.api, 'Gracias', { id_sesion: 'sesion-de-prueba-0006', id_conversacion: idConv });
    const h = await ctx.api.get(`/api/conversaciones/${idConv}`).set('Authorization', usuario);
    assert.equal(h.status, 200);
    const [u1, a1, u2, a2] = h.body.mensajes;
    assert.equal(u1.emisor, 'usuario');
    assert.equal('contacto' in u1, false);
    assert.equal(a1.contenido, primera.body.respuesta);
    assert.equal(a1.contacto.texto, CONTACTO_ADM);
    assert.deepEqual(a1.dependencia, { id_dependencia: 1, nombre: 'Admisiones' });
    assert.equal(u2.emisor, 'usuario');
    assert.equal(a2.contacto, null);
    assert.equal(a2.dependencia, null);
  });

  test('historial con mensajes anteriores a Q8: se muestran sin el contacto en el texto y con sus bloques', async () => {
    const conv = (await ctx.pool.query("INSERT INTO conversacion (id_sesion, id_usuario) VALUES ('sesion-de-prueba-0007', (SELECT id_usuario FROM cuenta_usuario WHERE nombre_usuario = 'usuario_demo')) RETURNING id_conversacion")).rows[0].id_conversacion;
    const m = (await ctx.pool.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'usuario', 'Requisitos de inscripción') RETURNING id_mensaje", [conv])).rows[0].id_mensaje;
    await ctx.pool.query("INSERT INTO consulta (id_conversacion, id_mensaje, id_dependencia, clasificacion) VALUES ($1, $2, 1, 'inscripcion')", [conv, m]);
    await ctx.pool.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'asistente', $2)", [conv, `Se diligencia el formulario.\n\nContacto de Admisiones: ${CONTACTO_ADM}.`]);
    const h = await ctx.api.get(`/api/conversaciones/${conv}`).set('Authorization', usuario);
    const asistente = h.body.mensajes.find((x) => x.emisor === 'asistente');
    assert.equal(asistente.contenido, 'Se diligencia el formulario.');
    assert.equal(asistente.contacto.texto, CONTACTO_ADM);
    assert.equal(asistente.dependencia.nombre, 'Admisiones');
    const crudo = (await ctx.pool.query("SELECT contenido FROM mensaje WHERE id_conversacion = $1 AND emisor = 'asistente'", [conv])).rows[0].contenido;
    assert.match(crudo, /Contacto de Admisiones/, 'la fila guardada no se modifica');
  });

  test('historial del administrador: mismo formato, global y por dependencia, con el alcance de siempre', async () => {
    await chat(ctx.api, '¿Cómo solicito un certificado de notas?', { id_sesion: 'sesion-de-prueba-0008' });
    const lista = (await ctx.api.get('/api/admin/conversaciones').set('Authorization', admisiones)).body;
    assert.ok(lista.length > 0);
    const det = (await ctx.api.get(`/api/admin/conversaciones/${lista[0].id_conversacion}`).set('Authorization', admisiones)).body;
    const respuestas = det.mensajes.filter((x) => x.emisor === 'asistente');
    assert.ok(respuestas.length > 0);
    for (const r of respuestas) {
      assert.equal(r.dependencia.nombre, 'Admisiones');
      assert.equal(r.contacto.texto, CONTACTO_ADM);
      assert.doesNotMatch(r.contenido, /admisiones@teinco\.test|Contacto de/);
    }
    const gl = (await ctx.api.get('/api/admin/conversaciones').set('Authorization', global)).body;
    const detG = (await ctx.api.get(`/api/admin/conversaciones/${gl[0].id_conversacion}`).set('Authorization', global)).body;
    const resp = detG.mensajes.find((x) => x.emisor === 'asistente');
    assert.ok('contacto' in resp && 'dependencia' in resp);
    // Registro no ve las respuestas de Admisiones (alcance sin cambios).
    assert.equal((await ctx.api.get(`/api/admin/conversaciones/${lista[0].id_conversacion}`).set('Authorization', registro)).status, 404);
  });
});
