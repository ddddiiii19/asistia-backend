// Información GENERAL de TEINCO (qué es, misión y visión, sedes, oferta académica y contacto) para el asistente.
//
// A diferencia de db/seed.sql (datos ficticios de prueba), estos datos son REALES: se tomaron del sitio oficial de
// la institución. Aun así deben ser validados y mantenidos por TEINCO (RF-12 / RF-14): los programas, las sedes y los
// canales de contacto cambian, y el sitio web puede estar desactualizado. Se cargan con `npm run db:cargar-info-general`.
//
// Fuentes (consultadas el 28/10/2026):
//   - https://teinco.edu.co/nuestra-institucion/  (misión, visión, sedes, áreas de apoyo; modificada el 18/09/2026)
//   - https://teinco.edu.co/programas-teinco/     (oferta académica; modificada el 10/04/2026)
// Solo se incluye lo que esas páginas afirman. No se incluyen costos, fechas, requisitos ni horarios de atención
// (cambian con frecuencia y corresponden a Admisiones o a Registro y Control), ni datos de personas.

const FECHA_CONSULTA = '28/10/2026';
const FUENTE = `Fuente: sitio oficial de TEINCO (teinco.edu.co), consultado el ${FECHA_CONSULTA}.`;
const conFuente = (texto) => `${texto} ${FUENTE}`;

const SEDES = 'TEINCO tiene sedes en Bogotá y en Mosquera. En Bogotá: la Sede 7 de Agosto (sede principal), en la Avenida Calle 63 Nº 22-39, y la Sede Avenida Caracas, en la Avenida Caracas Nº 63-85. En Mosquera: la Sede Mosquera, en la Carrera 5 Nº 1-26 (barrio Centro), y un punto de información en la Carrera 3 Nº 4-57.';
const CONTACTO = 'Teléfono: 601 743 32 00. WhatsApp: 301 333 79 56. Correo: coordregistroycontrol@teinco.edu.co. Sitio web: teinco.edu.co. Campus virtual: campusvirtual.teinco.edu.co. Atención en Bogotá y Mosquera.';
const PREGRADOS = 'Carreras (programas de pregrado) que ofrece TEINCO: Diseño Digital Publicitario; Marketing y Negocios Digitales (modalidad presencial y virtual); Ingeniería Mecatrónica; Ingeniería de Sistemas (modalidad presencial y virtual); Administración de Empresas (modalidad presencial y virtual); y Contaduría Pública.';

const INFO_GENERAL = {
  dependencia: {
    nombre: 'Información general',
    descripcion: 'Información general de TEINCO: qué es la institución, misión y visión, sedes y ubicación, oferta de programas académicos (carreras) y datos de contacto institucionales.',
    contacto_responsable: '601 743 32 00 · WhatsApp 301 333 79 56 · coordregistroycontrol@teinco.edu.co',
  },
  informacion: [
    {
      titulo: '¿Qué es TEINCO?',
      contenido: conFuente('TEINCO es la Corporación Tecnológica Industrial Colombiana, una institución de educación superior con sede en Bogotá D.C. y presencia en Mosquera. Su formación se organiza por ciclos propedéuticos (técnico, tecnólogo y profesional) y también ofrece formación para el trabajo, posgrado y educación continuada. Sitio oficial: teinco.edu.co.'),
    },
    {
      titulo: 'Misión y visión',
      contenido: conFuente('Misión: como institución de educación superior, TEINCO se encarga de la formación integral de las personas mediante programas académicos en diferentes niveles y modalidades, desde la formación para el trabajo y el desarrollo humano hasta el posgrado, respondiendo a las exigencias de los sectores productivos y con base en los principios de equidad, autonomía, diversidad y cuidado ambiental. Visión: ser referente nacional por su liderazgo en la formación por ciclos propedéuticos y por la pertinencia de su oferta académica, que abarca todas las modalidades y niveles, formando profesionales idóneos, con sentido social, habilidades y criterio para afrontar las exigencias de un mercado global.'),
    },
    { titulo: 'Sedes de TEINCO', contenido: conFuente(SEDES) },
    {
      titulo: 'Carreras y programas de pregrado',
      contenido: conFuente(`${PREGRADOS} La duración, los requisitos, los costos y las fechas de inscripción se consultan en la página de cada programa en teinco.edu.co o con Admisiones.`),
    },
    {
      titulo: 'Posgrado, formación para el trabajo y educación continuada',
      contenido: conFuente('Posgrado: Especialización en Eficiencia Energética. Formación para el trabajo (técnicos laborales): Auxiliar de Mercadeo y Social Media, Auxiliar en Automatización e Instrumentación Industrial, Auxiliar de Sistemas de Información y Auxiliar Administrativo. TEINCO también cuenta con una oferta de Educación Continuada.'),
    },
    { titulo: 'Contacto institucional', contenido: conFuente(CONTACTO) },
    {
      titulo: 'Áreas de apoyo para estudiantes',
      contenido: conFuente('Correos de algunas áreas que trabajan con los estudiantes: Bienestar, bienestar@teinco.edu.co (oficina «Vívela TEINCO», Sede 7 de Agosto, piso 2); Sector Externo, direccionorii@teinco.edu.co; Prácticas, practicas@teinco.edu.co; Investigación (DITA), direccion.investigaciones@teinco.edu.co; Vicerrectoría académica, vicerrectoria.academica@teinco.edu.co. Los horarios de atención pueden cambiar: confírmalos por los canales institucionales.'),
    },
  ],
  faq: [
    { pregunta: '¿Dónde están las sedes de TEINCO?', respuesta: conFuente(SEDES) },
    {
      pregunta: '¿Qué carreras y programas académicos ofrece TEINCO?',
      respuesta: conFuente('Carreras de pregrado: Diseño Digital Publicitario, Marketing y Negocios Digitales, Ingeniería Mecatrónica, Ingeniería de Sistemas, Administración de Empresas y Contaduría Pública. También hay una especialización (Eficiencia Energética), cuatro programas técnicos laborales y educación continuada.'),
    },
    { pregunta: '¿Cómo puedo comunicarme con TEINCO?', respuesta: conFuente(CONTACTO) },
  ],
};

module.exports = { INFO_GENERAL, FECHA_CONSULTA };
