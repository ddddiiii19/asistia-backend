// Migración Q8: contacto estructurado de las dependencias (correos y teléfono).
// Uso: npm run db:migrar-q8 (requiere DATABASE_URL en el .env). Aditiva e idempotente: no borra nada, no toca
// contacto_responsable y solo llena correos/telefono en las dependencias que aún no los tienen.
const fs = require('node:fs');
const path = require('node:path');
const { extraerContacto } = require('../src/ia/contacto');

async function migrarQ8(pool) {
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'migracion-q8.sql'), 'utf8'));
  const { rows } = await pool.query(
    "SELECT id_dependencia, nombre, contacto_responsable FROM dependencia WHERE cardinality(correos) = 0 AND telefono IS NULL AND COALESCE(btrim(contacto_responsable), '') <> '' ORDER BY id_dependencia");
  const resultado = [];
  for (const d of rows) {
    const { correos, telefono } = extraerContacto(d.contacto_responsable);
    if (correos.length === 0 && !telefono) {
      resultado.push({ id_dependencia: d.id_dependencia, nombre: d.nombre, correos: [], telefono: null, nota: 'sin correo ni teléfono reconocibles; se conserva el texto' });
      continue;
    }
    await pool.query('UPDATE dependencia SET correos = $2, telefono = $3 WHERE id_dependencia = $1', [d.id_dependencia, correos, telefono]);
    resultado.push({ id_dependencia: d.id_dependencia, nombre: d.nombre, correos, telefono });
  }
  return resultado;
}

module.exports = { migrarQ8 };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  migrarQ8(pool)
    .then(async (resultado) => {
      console.log(`Migración Q8 aplicada. Dependencias llenadas ahora: ${resultado.length}.`);
      for (const r of resultado) console.log(`- ${r.nombre}: correos=${JSON.stringify(r.correos)} telefono=${r.telefono ?? '(ninguno)'}${r.nota ? ` [${r.nota}]` : ''}`);
      const { rows } = await pool.query('SELECT nombre, correos, telefono FROM dependencia ORDER BY id_dependencia');
      console.log('Estado actual:');
      for (const d of rows) console.log(`- ${d.nombre}: correos=${JSON.stringify(d.correos)} telefono=${d.telefono ?? '(ninguno)'}`);
      await pool.end();
    })
    .catch(async (err) => { console.error('No se pudo aplicar la migración:', err.message); await pool.end(); process.exit(1); });
}
