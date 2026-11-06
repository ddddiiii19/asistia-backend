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

module.exports = { textoObligatorio, idSesion, entero, enteroOpcional, fechaOpcional, validarCorreo, validarNuevaContrasena };
