// Carga la información GENERAL de TEINCO (sedes, oferta académica, misión y visión, contacto) para que el asistente
// pueda responder esos temas. Crea la dependencia "Información general" si no existe y agrega o actualiza su
// información y sus preguntas frecuentes (ver db/info-general-teinco.js).
//
// Uso: npm run db:cargar-info-general      (requiere DATABASE_URL; ejecútelo después de npm run db:init o de la migración)
//
// - Es idempotente: se puede repetir para refrescar los textos; no duplica filas.
// - No borra nada: no toca las demás dependencias ni lo que un administrador haya agregado.
// - Al actualizar una pregunta frecuente conserva su contador de uso.
const { INFO_GENERAL } = require('../db/info-general-teinco');

async function cargarInfoGeneral({ pool, datos = INFO_GENERAL }) {
  const cliente = await pool.connect();
  const resumen = { dependencia: null, informacion: { nuevas: 0, actualizadas: 0 }, faq: { nuevas: 0, actualizadas: 0 } };
  try {
    await cliente.query('BEGIN');
    const d = datos.dependencia;
    const existente = (await cliente.query('SELECT id_dependencia FROM dependencia WHERE nombre = $1', [d.nombre])).rows[0];
    let idDependencia;
    if (existente) {
      idDependencia = existente.id_dependencia;
      await cliente.query('UPDATE dependencia SET descripcion = $2, contacto_responsable = $3 WHERE id_dependencia = $1', [idDependencia, d.descripcion, d.contacto_responsable]);
      resumen.dependencia = 'actualizada';
    } else {
      idDependencia = (await cliente.query(
        'INSERT INTO dependencia (nombre, descripcion, contacto_responsable) VALUES ($1, $2, $3) RETURNING id_dependencia',
        [d.nombre, d.descripcion, d.contacto_responsable])).rows[0].id_dependencia;
      resumen.dependencia = 'creada';
    }

    for (const i of datos.informacion) {
      const fila = (await cliente.query('SELECT id_info, contenido FROM informacion_institucional WHERE id_dependencia = $1 AND titulo = $2', [idDependencia, i.titulo])).rows[0];
      if (!fila) {
        await cliente.query('INSERT INTO informacion_institucional (id_dependencia, titulo, contenido) VALUES ($1, $2, $3)', [idDependencia, i.titulo, i.contenido]);
        resumen.informacion.nuevas += 1;
      } else if (fila.contenido !== i.contenido) {
        await cliente.query('UPDATE informacion_institucional SET contenido = $2, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_info = $1', [fila.id_info, i.contenido]);
        resumen.informacion.actualizadas += 1;
      }
    }

    for (const f of datos.faq) {
      const fila = (await cliente.query('SELECT id_faq, respuesta FROM pregunta_frecuente WHERE id_dependencia = $1 AND pregunta = $2', [idDependencia, f.pregunta])).rows[0];
      if (!fila) {
        await cliente.query('INSERT INTO pregunta_frecuente (id_dependencia, pregunta, respuesta) VALUES ($1, $2, $3)', [idDependencia, f.pregunta, f.respuesta]);
        resumen.faq.nuevas += 1;
      } else if (fila.respuesta !== f.respuesta) {
        await cliente.query('UPDATE pregunta_frecuente SET respuesta = $2 WHERE id_faq = $1', [fila.id_faq, f.respuesta]);
        resumen.faq.actualizadas += 1;
      }
    }
    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
  return resumen;
}

module.exports = { cargarInfoGeneral };

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL en .env (ver .env.example).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  cargarInfoGeneral({ pool })
    .then((r) => {
      console.log(`Información general de TEINCO cargada (dependencia ${r.dependencia}).`);
      console.log(`  Información: ${r.informacion.nuevas} nuevas, ${r.informacion.actualizadas} actualizadas.`);
      console.log(`  Preguntas frecuentes: ${r.faq.nuevas} nuevas, ${r.faq.actualizadas} actualizadas.`);
      console.log('Fuente: sitio oficial de TEINCO. Debe ser validada por la institución antes de usarse en producción.');
    })
    .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
