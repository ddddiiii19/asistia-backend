const jwt = require('jsonwebtoken');
const { HttpError } = require('../errores');

function extraerToken(req) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) throw new HttpError(401, 'no_autenticado', 'Debes iniciar sesión para continuar.');
  return token;
}

// Verifica JWT y comprueba la versión de autenticación actual para revocar sesiones al cambiar la clave.
function requiereToken({ secreto, pool }) {
  return async (req, _res, next) => {
    try {
      const token = extraerToken(req);
      let p;
      try {
        p = jwt.verify(token, secreto, { algorithms: ['HS256'] });
      } catch {
        throw new HttpError(401, 'token_invalido', 'La sesión es inválida o ha expirado. Inicia sesión nuevamente.');
      }
      if (!['usuario', 'administrador'].includes(p.tipo) || !Number.isInteger(Number(p.sub))) {
        throw new HttpError(401, 'token_invalido', 'La sesión es inválida o ha expirado. Inicia sesión nuevamente.');
      }

      const consulta = p.tipo === 'usuario'
        ? await pool.query('SELECT auth_version FROM cuenta_usuario WHERE id_usuario = $1 AND activo = TRUE', [Number(p.sub)])
        : await pool.query('SELECT auth_version FROM administrador WHERE id_administrador = $1', [Number(p.sub)]);
      if (consulta.rowCount !== 1 || Number(consulta.rows[0].auth_version) !== Number(p.ver)) {
        throw new HttpError(401, 'sesion_revocada', 'La sesión dejó de ser válida. Inicia sesión nuevamente.');
      }

      req.auth = {
        id: Number(p.sub),
        tipo: p.tipo,
        rol: p.rol,
        alcance_admin: p.alcance_admin ?? null,
        id_dependencia: p.dep ?? null,
      };
      if (p.tipo === 'administrador') {
        req.admin = { id: req.auth.id, rol: req.auth.alcance_admin, id_dependencia: req.auth.id_dependencia };
      } else {
        req.usuario = { id: req.auth.id, rol: 'usuario' };
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requiereAdministrador(opciones) {
  const validarToken = requiereToken(opciones);
  return (req, res, next) => validarToken(req, res, (err) => {
    if (err) return next(err);
    if (req.auth.tipo !== 'administrador') {
      return next(new HttpError(403, 'rol_insuficiente', 'Esta función requiere una cuenta de administrador.'));
    }
    return next();
  });
}

function requiereUsuario(opciones) {
  const validarToken = requiereToken(opciones);
  return (req, res, next) => validarToken(req, res, (err) => {
    if (err) return next(err);
    if (req.auth.tipo !== 'usuario') {
      return next(new HttpError(403, 'rol_insuficiente', 'Esta función requiere una cuenta de usuario.'));
    }
    return next();
  });
}

// Solo el administrador global puede modificar información o crear cuentas de usuario.
function soloGlobal(req, _res, next) {
  if (!req.admin || req.admin.rol !== 'global') {
    return next(new HttpError(403, 'permiso_denegado', 'Solo el administrador global puede realizar esta acción.'));
  }
  return next();
}

module.exports = { requiereToken, requiereAuth: requiereAdministrador, requiereUsuario, soloGlobal };
