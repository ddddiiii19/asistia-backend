// Configuración leída desde variables de entorno (ver .env.example).
// Ninguna credencial se escribe en el código ni se versiona en el repositorio.
require('dotenv').config({ quiet: true });

const config = {
  puerto: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpira: process.env.JWT_EXPIRA || '8h',
  jwtResetSecret: process.env.JWT_RESET_SECRET,
  resetMinutos: Math.min(Math.max(Number(process.env.RESET_TOKEN_MINUTOS) || 15, 5), 30),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  corsOrigen: process.env.CORS_ORIGIN || 'http://localhost:3001',
  correo: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM,
  },
  ia: {
    proveedor: process.env.AI_PROVIDER || 'openai', // 'openai' | 'simulador'
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModelo: process.env.OPENAI_MODEL,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 30000,
  },
};

function validarConfig(c = config) {
  const problemas = [];
  if (!c.databaseUrl) problemas.push('Falta DATABASE_URL.');
  if (!c.jwtSecret || c.jwtSecret.length < 16) problemas.push('JWT_SECRET debe tener al menos 16 caracteres aleatorios.');
  if (!c.jwtResetSecret || c.jwtResetSecret.length < 32) problemas.push('JWT_RESET_SECRET debe tener al menos 32 caracteres aleatorios.');
  if (c.jwtSecret && c.jwtResetSecret && c.jwtSecret === c.jwtResetSecret) problemas.push('JWT_RESET_SECRET debe ser diferente de JWT_SECRET.');
  if (!Number.isInteger(c.resetMinutos) || c.resetMinutos < 5 || c.resetMinutos > 30) problemas.push('RESET_TOKEN_MINUTOS debe estar entre 5 y 30.');
  if (!['openai', 'simulador'].includes(c.ia.proveedor)) problemas.push("AI_PROVIDER debe ser 'openai' o 'simulador'.");
  if (c.ia.proveedor === 'openai') {
    if (!c.ia.openaiApiKey) problemas.push('Falta OPENAI_API_KEY (o use AI_PROVIDER=simulador).');
    if (!c.ia.openaiModelo) problemas.push('Falta OPENAI_MODEL.');
  }
  const correoCampos = [c.correo && c.correo.apiKey, c.correo && c.correo.from];
  if (correoCampos.some(Boolean) && !correoCampos.every(Boolean)) {
    problemas.push('Para habilitar la recuperación por correo, complete RESEND_API_KEY y RESEND_FROM.');
  }
  return problemas;
}

module.exports = { config, validarConfig };
