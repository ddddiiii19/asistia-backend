// SIMULADOR de IA (NO es inteligencia artificial).
// Permite desarrollar y probar el back-end sin clave de API ni costo. Clasifica por palabras clave
// y "responde" reutilizando el texto de las fuentes institucionales mas relacionadas.
const PALABRAS_POR_DEPENDENCIA = [
  { nombre: 'admision', claves: ['inscrip', 'admisi', 'requisit', 'aspirante'] },
  { nombre: 'registro', claves: ['certificado', 'notas', 'matricula', 'constancia'] },
  { nombre: 'bienestar', claves: ['psicolog', 'cita', 'bienestar', 'apoyo'] },
  { nombre: 'coordinacion', claves: ['horario', 'clase', 'coordinaci', 'salon'] },
  // Información general de TEINCO (se activa solo si existe esa dependencia; ver scripts/cargar-info-general.js).
  { nombre: 'informacion general', claves: ['sede', 'carrera', 'oferta', 'pregrado', 'posgrado', 'especializacion', 'ciclos propedeuticos', 'mecatronica', 'ingenieria', 'marketing', 'contaduria', 'administracion de empresas', 'diseno digital', 'telefono', 'whatsapp', 'mosquera', 'caracas', 'mision', 'vision', 'campus virtual', 'educacion continuada', 'que es teinco'] },
];
const IGNORAR = new Set(['como', 'para', 'donde', 'puedo', 'quiero', 'necesito', 'saber', 'tengo', 'hacer', 'cual',
  'cuales', 'cuando', 'quien', 'esta', 'este', 'estoy', 'algun', 'sobre', 'desde', 'hasta', 'entre', 'tiene',
  'tienen', 'solicito', 'solicitar', 'cuanto', 'cuesta', 'hola', 'quisiera', 'favor', 'mucho', 'tambien']);

function normalizar(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Mensajes que son solo cortesia (sin pregunta ni solicitud).
const RELLENO = '( (a|todos|equipo|asistia|amigo|que|tal|como|estas|dias|tardes|noches|por|todo|muy|amable))*';
const CORTESIA = [
  { intencion: 'saludo', re: new RegExp(`^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos)${RELLENO}$`) },
  { intencion: 'agradecimiento', re: new RegExp(`^(muchas |mil |ok |listo |perfecto )?(gracias|muy amable)${RELLENO}$`) },
  { intencion: 'despedida', re: new RegExp(`^(chao|chau|adios|hasta luego|hasta pronto|nos vemos|bye)${RELLENO}$`) },
];

function crearSimulador() {
  return {
    nombre: 'simulador',
    async clasificar({ mensaje, dependencias }) {
      const texto = normalizar(mensaje);
      const limpio = texto.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const cortesia = limpio.split(' ').length <= 4 && CORTESIA.find((c) => c.re.test(limpio));
      if (cortesia) return { dependencia_id: null, tema: 'cortesia', intencion: cortesia.intencion };
      for (const regla of PALABRAS_POR_DEPENDENCIA) {
        const clave = regla.claves.find((k) => texto.includes(k));
        const dep = dependencias.find((d) => normalizar(d.nombre).startsWith(regla.nombre));
        if (clave && dep) return { dependencia_id: dep.id_dependencia, tema: clave, intencion: 'consulta' };
      }
      return { dependencia_id: null, tema: 'sin clasificar', intencion: 'consulta' };
    },
    async generar({ mensaje, contexto }) {
      const tokens = normalizar(mensaje).split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !IGNORAR.has(t));
      const puntuadas = contexto.map((c) => {
        const texto = normalizar(`${c.titulo} ${c.contenido}`);
        return { c, puntos: tokens.filter((t) => texto.includes(t.slice(0, 5))).length };
      }).filter((x) => x.puntos > 0).sort((a, b) => b.puntos - a.puntos).slice(0, 2);
      if (puntuadas.length === 0) return { suficiente: false, respuesta: '', fuentes: [] };
      return {
        suficiente: true,
        respuesta: puntuadas.map((x) => x.c.contenido).join(' '),
        fuentes: puntuadas.map((x) => x.c.ref),
      };
    },
  };
}

module.exports = { crearSimulador };
