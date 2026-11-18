const { HttpError } = require('./errores');

const RE_SESION = /^[A-Za-z0-9_-]{16,64}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function textoObligatorio(valor, campo, max) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new HttpError(400, 'dato_invalido', `El campo '${campo}' es obligatorio y debe ser texto.`);
  }
  const limpio = valor.trim();
  if (max && limpio.length > max) {
    throw new HttpError(400, 'dato_invalido', `El campo '${campo}' no puede superar ${max} caracteres.`);
  }
  return limpio;
}

function idSesion(valor) {
  if (typeof valor !== 'string' || !RE_SESION.test(valor)) {
    throw new HttpError(400, 'sesion_invalida', "El campo 'id_sesion' debe tener entre 16 y 64 caracteres (letras, numeros, '-' o '_').");
  }
  return valor;
}

function entero(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, 'dato_invalido', `El campo '${campo}' debe ser un entero positivo.`);
  }
  return n;
}

function enteroOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  return entero(valor, campo);
}

function fechaOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !RE_FECHA.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new HttpError(400, 'fecha_invalida', `El parametro '${campo}' debe tener formato AAAA-MM-DD.`);
  }
  return valor;
}

function validarCorreo(valor, campo = 'correo') {
  const correo = textoObligatorio(valor, campo, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new HttpError(400, 'correo_invalido', `El campo '${campo}' debe contener un correo válido.`);
  }
  return correo;
}

function validarNuevaContrasena(valor) {
  if (typeof valor !== 'string' || valor.length < 10 || Buffer.byteLength(valor, 'utf8') > 72 ||
      !/[a-z]/.test(valor) || !/[A-Z]/.test(valor) || !/[0-9]/.test(valor)) {
    throw new HttpError(400, 'contrasena_insegura', 'La contraseña debe tener al menos 10 caracteres, no superar 72 bytes e incluir mayúscula, minúscula y número.');
  }
  return valor;
}

// Q8: contacto de una dependencia. `correos` es una lista (o un texto separado por comas, punto y coma o saltos de línea)
// con al menos un correo válido; `telefono` es opcional. El texto resultante debe caber en contacto_responsable (150).
function validarContactoDependencia(b) {
  const crudo = Array.isArray(b.correos) ? b.correos : (typeof b.correos === 'string' ? b.correos.split(/[,;\n]+|\s+o\s+/i) : []);
  const correos = [];
  for (const c of crudo) {
    if (typeof c !== 'string' || c.trim() === '') continue;
    const correo = validarCorreo(c, 'correos');
    if (!correos.includes(correo)) correos.push(correo);
  }
  if (correos.length === 0) throw new HttpError(400, 'dato_invalido', "El campo 'correos' debe incluir al menos un correo válido.");
  if (correos.length > 5) throw new HttpError(400, 'dato_invalido', "El campo 'correos' no puede tener más de 5 correos.");
  let telefono = null;
  if (b.telefono !== undefined && b.telefono !== null && String(b.telefono).trim() !== '') {
    if (typeof b.telefono !== 'string') throw new HttpError(400, 'dato_invalido', "El campo 'telefono' debe ser texto.");
    telefono = b.telefono.trim().replace(/\s+/g, ' ');
    // Admite varios números con su etiqueta (por ejemplo "601 743 32 00 · WhatsApp 301 333 79 56").
    if (!/^[\p{L}\d\s+().,:·\/-]{7,100}$/u.test(telefono) || telefono.replace(/\D/g, '').length < 7) {
      throw new HttpError(400, 'dato_invalido', "El campo 'telefono' debe ser un número de teléfono válido (por ejemplo 601 743 32 00); puede incluir varios números.");
    }
  }
  const largo = `${correos.join(' o ')}${telefono ? ` · Tel. ${telefono}` : ''}`.length;
  if (largo > 150) throw new HttpError(400, 'dato_invalido', 'El contacto (correos y teléfono) es demasiado largo: use menos correos o más cortos.');
  return { correos, telefono };
}

// Nombre comparable de una dependencia: sin mayúsculas, tildes ni espacios repetidos.
function normalizarNombre(nombre) {
  return String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = {
  validarContactoDependencia, normalizarNombre, textoObligatorio, idSesion, entero, enteroOpcional, fechaOpcional, validarCorreo, validarNuevaContrasena };
