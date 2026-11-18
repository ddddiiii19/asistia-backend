// Solo lectura. Lista los textos de información institucional y preguntas frecuentes que traen el contacto de su
// dependencia (correo o teléfono) dentro del texto, para limpiarlos desde el panel: el contacto se muestra aparte.
// Uso: npm run db:revisar-contactos (requiere DATABASE_URL en el .env). No modifica la base de datos.
const { mensajeIncluyeContacto } = require('../src/ia/contacto');

async function revisarContactos(pool) {
  const { rows: deps } = await pool.query('SELECT id_dependencia, nombre, correos, telefono, contacto_responsable FROM dependencia ORDER BY id_dependencia');
  const hallazgos = [];
  for (const d of deps) {
    const info = await pool.query('SELECT id_info, titulo, contenido FROM informacion_institucional WHERE id_dependencia = $1 ORDER BY id_info', [d.id_dependencia]);
    for (const i of info.rows) {
      if (mensajeIncluyeContacto(`${i.titulo} ${i.contenido}`, d)) hallazgos.push({ dependencia: d.nombre, tipo: 'Información institucional', id: i.id_info, titulo: i.titulo });
    }
    const faq = await pool.query('SELECT id_faq, pregunta, respuesta FROM pregunta_frecuente WHERE id_dependencia = $1 ORDER BY id_faq', [d.id_dependencia]);
    for (const f of faq.rows) {
      if (mensajeIncluyeContacto(`${f.pregunta} ${f.respuesta}`, d)) hallazgos.push({ dependencia: d.nombre, tipo: 'Pregunta frecuente', id: f.id_faq, titulo: f.pregunta });
    }
  }
  return hallazgos;
}

module.exports = { revisarContactos };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  revisarContactos(pool)
    .then(async (hallazgos) => {
      if (hallazgos.length === 0) console.log('Ningún texto de información ni pregunta frecuente trae el contacto de su dependencia.');
      else {
        console.log(`${hallazgos.length} texto(s) traen el contacto dentro (edítalos desde el panel para quitarlo):`);
        for (const h of hallazgos) console.log(`- [${h.dependencia}] ${h.tipo} #${h.id}: ${h.titulo}`);
      }
      await pool.end();
    })
    .catch(async (err) => { console.error('No se pudo revisar:', err.message); await pool.end(); process.exit(1); });
}
