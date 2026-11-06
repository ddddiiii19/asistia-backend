const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararEntorno, iniciarSesion, iniciarUsuario, PASSWORD, correosPrueba } = require('./ayuda');

const EMAIL_DEMO = 'usuario.demo@ejemplo.invalid';
const NUEVA_CLAVE = 'NuevaClaveSegura2026';

describe('Cuentas de Usuario y Administrador', () => {
  let ctx;
  before(async () => { ctx = await prepararEntorno(); });
  after(async () => { await ctx.pool.end(); });

  test('el login identifica el rol desde la base de datos; el usuario no puede entrar al panel administrativo', async () => {
    const usuario = await ctx.api.post('/api/auth/login').send({ identificador: EMAIL_DEMO, contrasena: PASSWORD });
    assert.equal(usuario.status, 200);
    assert.equal(usuario.body.cuenta.tipo, 'usuario');
    assert.equal(usuario.body.cuenta.rol, 'usuario');
    assert.equal((await ctx.api.get('/api/admin/informacion').set('Authorization', `Bearer ${usuario.body.token}`)).status, 403);
    const admin = await ctx.api.post('/api/auth/login').send({ identificador: 'admin', contrasena: PASSWORD });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.cuenta.tipo, 'administrador');
    assert.equal((await ctx.api.post('/api/chat').set('Authorization', `Bearer ${admin.body.token}`).send({
      id_sesion: 'sesion-de-prueba-0001', mensaje: 'Hola',
    })).status, 403);
  });

  test('el administrador global puede crear una cuenta de Usuario, no exponer hash ni aceptar duplicados', async () => {
    const admin = await iniciarSesion(ctx.api, 'admin');
    const body = { nombre_usuario: 'nuevo_usuario', correo: 'Nuevo.Usuario@example.test', contrasena: NUEVA_CLAVE };
    const creada = await ctx.api.post('/api/admin/cuentas/usuarios').set('Authorization', admin).send(body);
    assert.equal(creada.status, 201);
    assert.equal(creada.body.cuenta.rol, 'usuario');
    assert.equal('contrasena_hash' in creada.body.cuenta, false);
    assert.equal((await ctx.api.post('/api/admin/cuentas/usuarios').set('Authorization', admin).send(body)).status, 409);
    const login = await ctx.api.post('/api/auth/login').send({ identificador: 'nuevo_usuario', contrasena: NUEVA_CLAVE });
    assert.equal(login.status, 200);
    assert.equal(login.body.cuenta.tipo, 'usuario');
  });
});

describe('Recuperación de contraseña con JWT de un solo uso', () => {
  let ctx;
  before(async () => {
    correosPrueba.length = 0;
    ctx = await prepararEntorno();
  });
  after(async () => { await ctx.pool.end(); });

  test('el correo desconocido y el existente devuelven la misma respuesta genérica', async () => {
    const desconocido = await ctx.api.post('/api/auth/forgot-password').send({ correo: 'no.existe@example.test' });
    const conocido = await ctx.api.post('/api/auth/forgot-password').send({ correo: EMAIL_DEMO });
    assert.equal(desconocido.status, 202);
    assert.equal(conocido.status, 202);
    assert.equal(desconocido.body.mensaje, conocido.body.mensaje);
    assert.equal(correosPrueba.length, 1);
  });

  test('restablecer contraseña consume el token una sola vez y revoca sesiones anteriores', async () => {
    const sesionAnterior = await iniciarUsuario(ctx.api);
    const forgot = await ctx.api.post('/api/auth/forgot-password').send({ correo: EMAIL_DEMO });
    assert.equal(forgot.status, 202);
    const enviado = correosPrueba.at(-1);
    const token = new URL(enviado.url).searchParams.get('token');
    assert.ok(token);

    const cambio = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: NUEVA_CLAVE });
    assert.equal(cambio.status, 200);
    const reutilizado = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: 'OtraClaveSegura2026' });
    assert.equal(reutilizado.status, 400);
    const sesionRevocada = await ctx.api.get('/api/faq').set('Authorization', sesionAnterior);
    assert.equal(sesionRevocada.status, 401);
    assert.equal((await ctx.api.post('/api/auth/login').send({ identificador: 'usuario_demo', contrasena: PASSWORD })).status, 401);
    assert.equal((await ctx.api.post('/api/auth/login').send({ identificador: EMAIL_DEMO, contrasena: NUEVA_CLAVE })).status, 200);
  });

  test('rechaza tokens manipulados, vencidos y contraseñas que no cumplen la política mínima', async () => {
    assert.equal((await ctx.api.post('/api/auth/reset-password').send({ token: 'token-falso', nueva_contrasena: NUEVA_CLAVE })).status, 400);
    const vencido = jwt.sign(
      { tipo_cuenta: 'usuario', proposito: 'restablecer_contrasena', jti: 'jti-vencido' },
      process.env.JWT_RESET_SECRET, { subject: '1', expiresIn: '-1s', algorithm: 'HS256' },
    );
    assert.equal((await ctx.api.post('/api/auth/reset-password').send({ token: vencido, nueva_contrasena: NUEVA_CLAVE })).status, 400);
    const forgot = await ctx.api.post('/api/auth/forgot-password').send({ correo: EMAIL_DEMO });
    assert.equal(forgot.status, 202);
    const token = new URL(correosPrueba.at(-1).url).searchParams.get('token');
    const débil = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: 'corta' });
    assert.equal(débil.status, 400);
    const excesiva = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: 'A1' + 'a'.repeat(72) });
    assert.equal(excesiva.status, 400);
    // El enlace sigue válido porque la validación de contraseña se ejecuta antes de consumirlo.
    const válido = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: 'NuevaClaveSegura2027' });
    assert.equal(válido.status, 200);
  });

  test('la recuperación también funciona para Administrador y revoca su sesión anterior', async () => {
    const sesionAnterior = await iniciarSesion(ctx.api, 'admin');
    const forgot = await ctx.api.post('/api/auth/forgot-password').send({ correo: 'admin@ejemplo.invalid' });
    assert.equal(forgot.status, 202);
    const token = new URL(correosPrueba.at(-1).url).searchParams.get('token');
    const reset = await ctx.api.post('/api/auth/reset-password').send({ token, nueva_contrasena: 'NuevaClaveAdmin2026' });
    assert.equal(reset.status, 200);
    assert.equal((await ctx.api.get('/api/admin/informacion').set('Authorization', sesionAnterior)).status, 401);
    const login = await ctx.api.post('/api/auth/login').send({ identificador: 'admin', contrasena: 'NuevaClaveAdmin2026' });
    assert.equal(login.status, 200);
    assert.equal(login.body.cuenta.tipo, 'administrador');
  });
});
