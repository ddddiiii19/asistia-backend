const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Limite de solicitudes', () => {
  let ctx;
  before(async () => {
    process.env.CHAT_LIMITE = '2'; // debe definirse antes de crear la aplicacion
    const { prepararEntorno } = require('./ayuda');
    process.env.CHAT_LIMITE = '2';
    ctx = await prepararEntorno();
  });
  after(async () => { await ctx.pool.end(); });

  test('el chat rechaza con 429 al superar el limite por minuto (protege el credito de la API)', async () => {
    const { chat } = require('./ayuda');
    assert.equal((await chat(ctx.api, 'Hola')).status, 200);
    assert.equal((await chat(ctx.api, 'Hola')).status, 200);
    const r = await chat(ctx.api, 'Hola');
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'demasiadas_solicitudes');
  });
});
