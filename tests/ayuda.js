require('dotenv').config({ quiet: true });
// Utilidades compartidas por las pruebas. Requiere PostgreSQL con una base de datos de pruebas
// (por defecto postgresql://postgres:postgres@localhost:5432/asistia_test; ver TEST_DATABASE_URL).
// La IA se reemplaza por el simulador: estas pruebas NO llaman a OpenAI.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto_de_pruebas_123456';
process.env.JWT_RESET_SECRET = process.env.JWT_RESET_SECRET || 'otro_secreto_de_pruebas_distinto_1234567890';
process.env.LOGIN_LIMITE = process.env.LOGIN_LIMITE || '1000';
process.env.CHAT_LIMITE = process.env.CHAT_LIMITE || '1000';
process.env.RECUPERACION_LIMITE = process.env.RECUPERACION_LIMITE || '1000';
process.env.RESET_LIMITE = process.env.RESET_LIMITE || '1000';

const { Pool } = require('pg');
const supertest = require('supertest');
const { inicializar } = require('../scripts/init-db');
const { crearApp } = require('../src/app');
const { crearSimulador } = require('../src/ia/simulador');

const URL_BD = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/asistia_test';
const PASSWORD = 'clave-de-pruebas-1';
const SESION = 'sesion-de-prueba-0001';
const OTRA_SESION = 'sesion-de-prueba-0002';
const correosPrueba = [];

async function prepararEntorno({ ia, enviarCorreoRecuperacion } = {}) {
  const pool = new Pool({ connectionString: URL_BD });
  await inicializar({ pool, passwordAdmin: PASSWORD, passwordUsuario: PASSWORD });
  const config = { jwtSecret: process.env.JWT_SECRET, jwtResetSecret: process.env.JWT_RESET_SECRET, jwtExpira: '1h', resetMinutos: 15, frontendUrl: 'http://localhost:3001', correo: {}, corsOrigen: '*', ia: { proveedor: 'simulador' } };
  const mandarCorreo = enviarCorreoRecuperacion || (async ({ correo, url }) => { correosPrueba.push({ correo, url }); });
  const app = crearApp({ pool, ia: ia || crearSimulador(), config, enviarCorreoRecuperacion: mandarCorreo });
  return { pool, app, api: supertest(app) };
}

async function iniciarSesion(api, usuario, contrasena = PASSWORD) {
  const r = await api.post('/api/auth/login').send({ nombre_usuario: usuario, contrasena });
  if (r.status !== 200) throw new Error(`Login fallido para ${usuario}: ${r.status}`);
  return `Bearer ${r.body.token}`;
}

async function iniciarUsuario(api, usuario = 'usuario_demo', contrasena = PASSWORD) {
  return iniciarSesion(api, usuario, contrasena);
}

const tokensUsuario = new WeakMap();
async function tokenUsuario(api) {
  if (!tokensUsuario.has(api)) tokensUsuario.set(api, iniciarUsuario(api));
  return tokensUsuario.get(api);
}

async function chat(api, mensaje, extra = {}) {
  const token = await tokenUsuario(api);
  return api.post('/api/chat').set('Authorization', token).send({ id_sesion: SESION, mensaje, ...extra });
}

module.exports = { prepararEntorno, iniciarSesion, iniciarUsuario, tokenUsuario, chat, PASSWORD, SESION, OTRA_SESION, correosPrueba };
