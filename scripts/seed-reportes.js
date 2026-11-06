// Genera DATOS DE PRUEBA FICTICIOS de conversaciones y consultas para el módulo de reportes (Q6).
// Uso:
//   npm run db:seed-reportes                 # crea ~240 consultas de los últimos 60 días
//   node scripts/seed-reportes.js --total 400 --dias 90
//   node scripts/seed-reportes.js --limpiar  # elimina únicamente los datos generados por este script
//
// - NO borra ni modifica información institucional, preguntas frecuentes ni cuentas.
// - Todo lo que crea queda marcado con id_sesion = 'demo-reportes-NNNN' y pertenece a la cuenta desactivada
//   'demo_reportes', de modo que puede ejecutarse varias veces (reemplaza su propio lote anterior) y retirarse
//   por completo con --limpiar (conversaciones y cuenta técnica).
// - Es determinista (misma semilla = mismos datos), útil para sustentación y para pruebas repetibles.
// - Los textos son preguntas de ejemplo y NO corresponden a conversaciones reales de la comunidad de TEINCO.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { mensajeEscalamiento } = require('../src/ia/orquestador');

const PREFIJO_SESION = 'demo-reportes-';
// Cuenta técnica dueña de las conversaciones de prueba. Está DESACTIVADA (no puede iniciar sesión ni recuperar
// contraseña) y no es usuario_demo, para que el historial del usuario de demostración no se llene de datos ficticios.
const CUENTA_SEED = 'demo_reportes';
const CORREO_SEED = 'demo-reportes@ejemplo.invalid';

// Banco de preguntas de ejemplo. `peso` controla cuántas veces se repite (así hay preguntas "más frecuentes");
// `sinRespaldo` marca consultas que el asistente no puede sustentar con la información cargada y escala.
const BANCO = {
  Admisiones: {
    peso: 26,
    preguntas: [
      { texto: '¿Cuáles son los requisitos de inscripción?', tema: 'requisitos de inscripción', peso: 10 },
      { texto: '¿Cuándo cierran las inscripciones?', tema: 'fechas de inscripción', peso: 6 },
      { texto: '¿Qué documentos debo entregar para la admisión?', tema: 'documentos de admisión', peso: 5 },
      { texto: '¿Cuál es el costo del formulario de inscripción?', tema: 'costos de inscripción', peso: 1, sinRespaldo: true },
      { texto: '¿Puedo inscribirme a dos programas a la vez?', tema: 'inscripción a varios programas', peso: 1, sinRespaldo: true },
    ],
  },
  'Registro y Control': {
    peso: 32,
    preguntas: [
      { texto: '¿Cómo solicito un certificado de notas?', tema: 'certificado de notas', peso: 12 },
      { texto: '¿Cómo consulto el estado de mi matrícula?', tema: 'estado de matrícula', peso: 8 },
      { texto: '¿Cuánto tarda en salir un certificado de estudio?', tema: 'tiempos de certificados', peso: 1, sinRespaldo: true },
      { texto: '¿Cómo solicito un duplicado del carné estudiantil?', tema: 'duplicado de carné', peso: 1, sinRespaldo: true },
      { texto: '¿Cómo hago el cambio de programa?', tema: 'cambio de programa', peso: 1, sinRespaldo: true },
    ],
  },
  Bienestar: {
    peso: 14,
    preguntas: [
      { texto: '¿Cómo agendo una cita psicológica?', tema: 'cita de apoyo psicosocial', peso: 10 },
      { texto: '¿Qué servicios de bienestar ofrece TEINCO?', tema: 'servicios de bienestar', peso: 5 },
      { texto: '¿Hay apoyos o becas para estudiantes?', tema: 'apoyos económicos', peso: 1, sinRespaldo: true },
    ],
  },
  'Coordinación académica': {
    peso: 18,
    preguntas: [
      { texto: '¿Dónde consulto mi horario de clases?', tema: 'horario de clases', peso: 10 },
      { texto: '¿Cómo solicito un cambio de grupo?', tema: 'cambio de grupo', peso: 4 },
      { texto: '¿Quién es el coordinador de mi programa?', tema: 'contacto de coordinación', peso: 1, sinRespaldo: true },
    ],
  },
};

// Consultas que el asistente no logra asociar a ninguna dependencia (siempre se escalan).
const SIN_DEPENDENCIA = {
  peso: 3,
  preguntas: [
    { texto: '¿Dónde queda la cafetería?', tema: 'otros', peso: 3 },
    { texto: '¿Hay parqueadero para estudiantes?', tema: 'otros', peso: 2 },
    { texto: '¿Cuál es la clave del wifi del campus?', tema: 'otros', peso: 2 },
  ],
};

// Generador pseudoaleatorio determinista (mulberry32).
function crearAleatorio(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function elegirPonderado(lista, peso, azar) {
  const total = lista.reduce((s, x) => s + peso(x), 0);
  let r = azar() * total;
  for (const x of lista) {
    r -= peso(x);
    if (r < 0) return x;
  }
  return lista[lista.length - 1];
}

// Segundos transcurridos desde "ahora" hasta el momento de la consulta: más consultas recientes que antiguas,
// pocas en fin de semana y dentro del horario de 7:00 a 21:00.
function segundosAtras(azar, dias) {
  const ahora = new Date();
  for (let intento = 0; intento < 50; intento += 1) {
    const dia = Math.floor(dias * (1 - Math.sqrt(azar())));
    const fecha = new Date(ahora.getTime() - dia * 86400000);
    const finDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6;
    if (finDeSemana && azar() > 0.2) continue;
    fecha.setHours(7 + Math.floor(azar() * 14), Math.floor(azar() * 60), Math.floor(azar() * 60), 0);
    const seg = Math.floor((ahora.getTime() - fecha.getTime()) / 1000);
    if (seg >= 120) return seg; // nunca en el futuro ni "ahora mismo"
  }
  return 3600 * 24;
}

// Tiempo de respuesta simulado (ms): entre ~1,2 y ~9 s, con cola larga; las escaladas tardan algo más.
function tiempoRespuesta(azar, escalada) {
  const base = 1200 + Math.pow(azar(), 2.2) * 6500;
  return Math.round(base + (escalada ? 400 + azar() * 800 : 0));
}

async function limpiar(pool) {
  const r = await pool.query('DELETE FROM conversacion WHERE id_sesion LIKE $1', [`${PREFIJO_SESION}%`]);
  // La cuenta técnica solo existe para este lote; se retira si ya no tiene conversaciones.
  await pool.query(
    `DELETE FROM cuenta_usuario cu WHERE cu.nombre_usuario = $1
        AND NOT EXISTS (SELECT 1 FROM conversacion cv WHERE cv.id_usuario = cu.id_usuario)`, [CUENTA_SEED]);
  return r.rowCount;
}

// Crea (si no existe) la cuenta técnica desactivada con una contraseña aleatoria que nadie conoce.
async function asegurarCuentaSeed(cliente) {
  const existente = (await cliente.query('SELECT id_usuario FROM cuenta_usuario WHERE nombre_usuario = $1', [CUENTA_SEED])).rows[0];
  if (existente) return existente.id_usuario;
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  return (await cliente.query(
    `INSERT INTO cuenta_usuario (nombre_usuario, correo, contrasena_hash, activo)
     VALUES ($1, $2, $3, FALSE) RETURNING id_usuario`, [CUENTA_SEED, CORREO_SEED, hash])).rows[0].id_usuario;
}

async function generarDatosReportes({ pool, total = 240, dias = 60, semilla = 2026 }) {
  const azar = crearAleatorio(semilla);
  const deps = (await pool.query('SELECT id_dependencia, nombre, descripcion, contacto_responsable FROM dependencia')).rows;
  const porNombre = new Map(deps.map((d) => [d.nombre, d]));
  const faltantes = Object.keys(BANCO).filter((n) => !porNombre.has(n));
  if (faltantes.length > 0) {
    throw new Error(`Faltan dependencias en la base de datos (${faltantes.join(', ')}). Ejecute primero npm run db:init.`);
  }

  const cliente = await pool.connect();
  const resumen = { conversaciones: 0, escaladas: 0, eliminadas: 0 };
  try {
    await cliente.query('BEGIN');
    const idUsuarioSeed = await asegurarCuentaSeed(cliente);
    resumen.eliminadas = (await cliente.query('DELETE FROM conversacion WHERE id_sesion LIKE $1', [`${PREFIJO_SESION}%`])).rowCount;

    const grupos = [...Object.entries(BANCO).map(([nombre, g]) => ({ nombre, ...g })), { nombre: null, ...SIN_DEPENDENCIA }];
    for (let i = 1; i <= total; i += 1) {
      const grupo = elegirPonderado(grupos, (g) => g.peso, azar);
      const pregunta = elegirPonderado(grupo.preguntas, (q) => q.peso, azar);
      const dependencia = grupo.nombre ? porNombre.get(grupo.nombre) : null;
      const escalada = !dependencia || pregunta.sinRespaldo === true || azar() < 0.06;
      const motivo = !dependencia ? 'dependencia_no_identificada'
        : pregunta.sinRespaldo ? 'informacion_insuficiente' : 'respaldo_no_verificable';
      const ms = tiempoRespuesta(azar, escalada);
      const atras = segundosAtras(azar, dias);
      const respuesta = escalada
        ? mensajeEscalamiento(dependencia)
        : `[DATO DE PRUEBA] Respuesta de ejemplo orientada por ${dependencia.nombre}.`;

      const idSesion = `${PREFIJO_SESION}${String(i).padStart(4, '0')}`;
      const conv = await cliente.query(
        `INSERT INTO conversacion (id_sesion, id_usuario, fecha_inicio)
         VALUES ($1, $2, CURRENT_TIMESTAMP - ($3::float8 * interval '1 second')) RETURNING id_conversacion`,
        [idSesion, idUsuarioSeed, atras]);
      const idConv = conv.rows[0].id_conversacion;
      const msg = await cliente.query(
        `INSERT INTO mensaje (id_conversacion, emisor, contenido, fecha)
         VALUES ($1, 'usuario', $2, CURRENT_TIMESTAMP - ($3::float8 * interval '1 second')) RETURNING id_mensaje`,
        [idConv, pregunta.texto, atras]);
      const cons = await cliente.query(
        `INSERT INTO consulta (id_conversacion, id_mensaje, id_dependencia, clasificacion, tiempo_respuesta_ms, fecha)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP - ($6::float8 * interval '1 second')) RETURNING id_consulta`,
        [idConv, msg.rows[0].id_mensaje, dependencia ? dependencia.id_dependencia : null, pregunta.tema, ms, atras]);
      await cliente.query(
        `INSERT INTO mensaje (id_conversacion, emisor, contenido, fecha)
         VALUES ($1, 'asistente', $2, CURRENT_TIMESTAMP - ($3::float8 * interval '1 second') + ($4::float8 * interval '1 millisecond'))`,
        [idConv, respuesta, atras, ms]);
      if (escalada) {
        await cliente.query(
          `INSERT INTO escalamiento (id_consulta, motivo, estado, fecha)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP - ($4::float8 * interval '1 second'))`,
          [cons.rows[0].id_consulta, motivo, azar() < 0.55 ? 'atendido' : 'pendiente', atras]);
        resumen.escaladas += 1;
      }
      resumen.conversaciones += 1;
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

module.exports = { generarDatosReportes, limpiar, PREFIJO_SESION, CUENTA_SEED };

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  const args = process.argv.slice(2);
  const valor = (nombre, defecto) => {
    const i = args.indexOf(nombre);
    const n = i >= 0 ? Number(args[i + 1]) : defecto;
    if (!Number.isInteger(n) || n <= 0 || n > 5000) {
      console.error(`El valor de ${nombre} debe ser un entero entre 1 y 5000.`);
      process.exit(1);
    }
    return n;
  };
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL en .env (ver .env.example).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tarea = args.includes('--limpiar')
    ? limpiar(pool).then((n) => console.log(`Se eliminaron ${n} conversaciones de prueba de reportes.`))
    : generarDatosReportes({ pool, total: valor('--total', 240), dias: valor('--dias', 60) }).then((r) => {
      console.log(`Datos de prueba de reportes creados: ${r.conversaciones} consultas (${r.escaladas} escaladas).`);
      if (r.eliminadas > 0) console.log(`Se reemplazó el lote anterior (${r.eliminadas} conversaciones).`);
      console.log('Son datos ficticios. Para retirarlos: node scripts/seed-reportes.js --limpiar');
    });
  tarea
    .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
