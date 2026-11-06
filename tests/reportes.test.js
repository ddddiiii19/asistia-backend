const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararEntorno, iniciarSesion, iniciarUsuario, chat } = require('./ayuda');
const { generarDatosReportes, limpiar, CUENTA_SEED } = require('../scripts/seed-reportes');

describe('Q6: reportes - resumen de indicadores', () => {
  let ctx, global, registro, admisiones, usuario;
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
    admisiones = await iniciarSesion(ctx.api, 'admin_admisiones');
    usuario = await iniciarUsuario(ctx.api);
  });
  after(async () => { await ctx.pool.end(); });

  const resumen = (token, query = '') => ctx.api.get(`/api/admin/reportes/resumen${query}`).set('Authorization', token);

  test('sin datos devuelve ceros, listas vacías y promedio/tasa nulos (sin error)', async () => {
    const r = await resumen(global);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.equal(r.body.resueltas, 0);
    assert.equal(r.body.tasa_resolucion, null);
    assert.equal(r.body.tiempo_promedio_ms, null);
    assert.equal(r.body.tiempo_p95_ms, null);
    for (const k of ['por_dependencia', 'temas_mas_consultados', 'preguntas_mas_frecuentes', 'faq_mas_consultadas', 'consultas_por_dia']) {
      assert.deepEqual(r.body[k], [], k);
    }
  });

  test('exige sesión de administrador: sin token 401, cuenta de usuario 403', async () => {
    assert.equal((await ctx.api.get('/api/admin/reportes/resumen')).status, 401);
    const r = await resumen(usuario);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'rol_insuficiente');
  });

  test('el chat registra el tiempo de respuesta y el resumen lo promedia', async () => {
    await chat(ctx.api, '¿Cuáles son los requisitos de inscripción?');
    await chat(ctx.api, '¿Cómo solicito un certificado de notas?');
    await chat(ctx.api, '¿Puedo cambiarme de programa a mitad de semestre?');
    const { rows } = await ctx.pool.query('SELECT tiempo_respuesta_ms FROM consulta');
    assert.equal(rows.length, 3);
    assert.ok(rows.every((x) => Number.isInteger(x.tiempo_respuesta_ms) && x.tiempo_respuesta_ms >= 0));

    const r = await resumen(global);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.escaladas, 1);
    assert.equal(r.body.resueltas, 2);
    assert.equal(r.body.tasa_resolucion, 66.7);
    assert.ok(Number.isInteger(r.body.tiempo_promedio_ms));
    assert.ok(Number.isInteger(r.body.tiempo_p95_ms));
    assert.ok(r.body.tiempo_p95_ms >= r.body.tiempo_promedio_ms);
    assert.ok(r.body.por_dependencia.some((d) => d.dependencia === 'Sin identificar' && d.total === 1 && d.resueltas === 0));
    assert.equal(r.body.consultas_por_dia.length, 1);
    assert.equal(r.body.consultas_por_dia[0].total, 3);
    assert.match(r.body.consultas_por_dia[0].dia, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('el administrador de dependencia solo ve su dependencia y no puede pedir otra', async () => {
    const r = await resumen(registro);
    assert.equal(r.body.total, 1);
    assert.deepEqual(r.body.por_dependencia.map((d) => d.dependencia), ['Registro y Control']);
    const ajena = await resumen(admisiones, '?dependencia=2');
    assert.equal(ajena.status, 403);
    assert.equal(ajena.body.error, 'fuera_de_alcance');
  });

  test('filtros por dependencia y por periodo; fechas inválidas responden 400', async () => {
    assert.equal((await resumen(global, '?dependencia=1')).body.total, 1);
    assert.equal((await resumen(global, '?desde=2999-01-01')).body.total, 0);
    assert.equal((await resumen(global, '?hasta=2000-01-01')).body.total, 0);
    assert.equal((await resumen(global, '?desde=ayer')).status, 400);
    assert.equal((await resumen(global, '?desde=2026-02-01&hasta=2026-01-01')).status, 400);
  });

  test('la lista de interacciones incluye tiempo de respuesta y motivo del escalamiento', async () => {
    const r = await ctx.api.get('/api/admin/reportes/interacciones').set('Authorization', global);
    const escalada = r.body.find((x) => x.estado === 'escalada');
    assert.equal(escalada.motivo_escalamiento, 'dependencia_no_identificada');
    assert.ok(Number.isInteger(escalada.tiempo_respuesta_ms));
    const resuelta = r.body.find((x) => x.estado === 'resuelta');
    assert.equal(resuelta.motivo_escalamiento, null);
  });

  test('preguntas frecuentes: agrupa redacciones que solo difieren en mayúsculas, signos o espacios', async () => {
    // Antes de esta prueba ya existe una consulta "¿Cómo solicito un certificado de notas?".
    await chat(ctx.api, 'CÓMO SOLICITO UN CERTIFICADO DE NOTAS');
    await chat(ctx.api, '  como solicito un certificado de notas  '); // sin tilde: es otra redacción
    const r = await resumen(global);
    const [top, ...resto] = r.body.preguntas_mas_frecuentes;
    assert.equal(top.total, 2);
    assert.equal(top.dependencia, 'Registro y Control');
    assert.match(top.pregunta, /solicito un certificado de notas/i, 'se muestra la redacción original, sin alterar letras');
    assert.ok(resto.some((x) => x.total === 1 && /como solicito/i.test(x.pregunta)));
  });

  test('faq_mas_consultadas refleja el contador acumulado del catálogo, con alcance por rol', async () => {
    await ctx.api.post('/api/faq/2/consulta').set('Authorization', usuario);
    await ctx.api.post('/api/faq/2/consulta').set('Authorization', usuario);
    await ctx.api.post('/api/faq/1/consulta').set('Authorization', usuario);
    const g = await resumen(global);
    assert.deepEqual(g.body.faq_mas_consultadas.map((f) => [f.id_faq, f.frecuencia]), [[2, 2], [1, 1]]);
    const a = await resumen(admisiones);
    assert.deepEqual(a.body.faq_mas_consultadas.map((f) => f.id_faq), [1]);
  });
});

describe('Q6: datos de prueba para reportes (seed)', () => {
  let ctx, global, registro;
  before(async () => {
    ctx = await prepararEntorno();
    global = await iniciarSesion(ctx.api, 'admin');
    registro = await iniciarSesion(ctx.api, 'admin_registro');
  });
  after(async () => { await ctx.pool.end(); });

  const resumen = (token, query = '') => ctx.api.get(`/api/admin/reportes/resumen${query}`).set('Authorization', token);

  test('genera el lote pedido y los indicadores son coherentes entre sí', async () => {
    const out = await generarDatosReportes({ pool: ctx.pool, total: 120, dias: 45 });
    assert.equal(out.conversaciones, 120);
    const r = (await resumen(global)).body;
    assert.equal(r.total, 120);
    assert.equal(r.resueltas + r.escaladas, 120);
    assert.equal(r.por_dependencia.reduce((s, d) => s + d.total, 0), 120);
    assert.equal(r.por_dependencia.reduce((s, d) => s + d.escaladas, 0), r.escaladas);
    assert.equal(r.consultas_por_dia.reduce((s, d) => s + d.total, 0), 120);
    assert.ok(r.tiempo_promedio_ms >= 1200 && r.tiempo_promedio_ms <= 9000);
    assert.ok(Number.isInteger(r.tiempo_p95_ms));
    assert.ok(r.tiempo_p95_ms >= 1200 && r.tiempo_p95_ms <= 9000);
    assert.ok(r.preguntas_mas_frecuentes[0].total > 1, 'hay preguntas repetidas');
    assert.ok(r.temas_mas_consultados.length > 0);
    // Registro y Control es la dependencia con mayor peso en el lote de prueba.
    assert.equal(r.por_dependencia[0].dependencia, 'Registro y Control');
    // Toda consulta sin dependencia identificada se escala.
    const sin = r.por_dependencia.find((d) => d.dependencia === 'Sin identificar');
    assert.equal(sin.resueltas, 0);
  });

  test('los datos de prueba no contaminan al usuario de demostración: su historial sigue vacío', async () => {
    const usuario = await iniciarUsuario(ctx.api);
    const r = await ctx.api.get('/api/conversaciones').set('Authorization', usuario);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
    const { rows } = await ctx.pool.query('SELECT activo FROM cuenta_usuario WHERE nombre_usuario = $1', [CUENTA_SEED]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].activo, false);
    // La cuenta técnica no puede iniciar sesión, ni siquiera adivinando su nombre.
    const login = await ctx.api.post('/api/auth/login').send({ identificador: CUENTA_SEED, contrasena: 'cualquierClave123' });
    assert.equal(login.status, 401);
  });

  test('las fechas quedan en el pasado y dentro del periodo pedido', async () => {
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS fuera FROM consulta
        WHERE fecha > CURRENT_TIMESTAMP OR fecha < CURRENT_TIMESTAMP - interval '46 days'`);
    assert.equal(rows[0].fuera, 0);
  });

  test('el alcance por rol se mantiene con datos masivos', async () => {
    const g = (await resumen(global)).body;
    const dep = g.por_dependencia.find((d) => d.dependencia === 'Registro y Control');
    const r = (await resumen(registro)).body;
    assert.equal(r.total, dep.total);
    assert.equal(r.por_dependencia.length, 1);
  });

  test('es idempotente: volver a ejecutarlo reemplaza su lote y no duplica', async () => {
    const out = await generarDatosReportes({ pool: ctx.pool, total: 30, dias: 10 });
    assert.equal(out.eliminadas, 120);
    assert.equal((await resumen(global)).body.total, 30);
  });

  test('es determinista: la misma semilla genera la misma distribución', async () => {
    const a = (await resumen(global)).body.por_dependencia.map((d) => [d.dependencia, d.total]);
    await generarDatosReportes({ pool: ctx.pool, total: 30, dias: 10 });
    const b = (await resumen(global)).body.por_dependencia.map((d) => [d.dependencia, d.total]);
    assert.deepEqual(a, b);
  });

  test('--limpiar elimina solo los datos de prueba y respeta consultas reales', async () => {
    const usuario = await ctx.pool.query("SELECT id_usuario FROM cuenta_usuario WHERE nombre_usuario = 'usuario_demo'");
    const conv = await ctx.pool.query("INSERT INTO conversacion (id_sesion, id_usuario) VALUES ('sesion-real-0000001', $1) RETURNING id_conversacion", [usuario.rows[0].id_usuario]);
    const msg = await ctx.pool.query("INSERT INTO mensaje (id_conversacion, emisor, contenido) VALUES ($1, 'usuario', 'consulta real') RETURNING id_mensaje", [conv.rows[0].id_conversacion]);
    await ctx.pool.query('INSERT INTO consulta (id_conversacion, id_mensaje, id_dependencia, clasificacion) VALUES ($1, $2, 1, $3)', [conv.rows[0].id_conversacion, msg.rows[0].id_mensaje, 'real']);

    assert.equal(await limpiar(ctx.pool), 30);
    const cuentaSeed = await ctx.pool.query('SELECT 1 FROM cuenta_usuario WHERE nombre_usuario = $1', [CUENTA_SEED]);
    assert.equal(cuentaSeed.rowCount, 0, 'también se retira la cuenta técnica');
    const r = (await resumen(global)).body;
    assert.equal(r.total, 1);
    // Una consulta anterior a Q6 no tiene tiempo registrado: el promedio la ignora.
    assert.equal(r.tiempo_promedio_ms, null);
  });
});
