// Error con codigo HTTP y codigo funcional, para respuestas JSON consistentes.
class HttpError extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

// Manejador global de errores de Express.
function manejadorErrores(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.estado).json({ error: err.codigo, mensaje: err.message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'json_invalido', mensaje: 'El cuerpo de la solicitud no es JSON valido.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'solicitud_muy_grande', mensaje: 'El cuerpo de la solicitud es demasiado grande.' });
  }
  if (err && err.code === '23505') { // nombre/correo único en PostgreSQL
    return res.status(409).json({ error: 'registro_duplicado', mensaje: 'Ya existe un registro con esos datos.' });
  }
  if (err && err.code === '23503') { // violacion de llave foranea en PostgreSQL
    return res.status(400).json({ error: 'referencia_invalida', mensaje: 'El registro referenciado no existe.' });
  }
  console.error('[error]', err && err.message ? err.message : err);
  return res.status(500).json({ error: 'error_interno', mensaje: 'Ocurrio un error interno.' });
}

module.exports = { HttpError, manejadorErrores };
