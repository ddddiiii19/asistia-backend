const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { HttpError } = require('../errores');
const { textoObligatorio, validarNuevaContrasena } = require('../validar');
const { requiereToken } = require('../middleware/auth');
const { enviarCorreoRecuperacion: enviarCorreoPorDefecto } = require('../correo');

// Hash ficticio para que el login de una cuenta inexistente haga también una comparación bcrypt.
const HASH_RELLENO = bcrypt.hashSync('relleno-no-valido', 12);
const MENSAJE_RECUPERACION = 'Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer la contraseña.';
const MENSAJE_RESET_INVALIDO = 'El enlace de recuperación no es válido o ya venció. Solicita uno nuevo.';

function hashJti(jti) {
  return crypto.createHash('sha256').update(jti).digest('hex');
}

function rutasAuth({ pool, config, enviarCorreoRecuperacion = enviarCorreoPorDefecto }) {
  const router = express.Router();
  const limitadorLogin = rateLimit({
    windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_LIMITE) || 20,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'demasiados_intentos', mensaje: 'Demasiados intentos de acceso. Intenta más tarde.' },
  });
  const limitadorRecuperacion = rateLimit({
    windowMs: 15 * 60 * 1000, limit: Number(process.env.RECUPERACION_LIMITE) || 5,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'demasiadas_solicitudes', mensaje: 'Has solicitado demasiados enlaces. Intenta más tarde.' },
  });
  const limitadorRestablecimiento = rateLimit({
    windowMs: 15 * 60 * 1000, limit: Number(process.env.RESET_LIMITE) || 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'demasiadas_solicitudes', mensaje: 'Has intentado demasiados restablecimientos. Solicita un enlace nuevo más tarde.' },
  });

  // Login unificado. El tipo de cuenta y sus permisos proceden de la base de datos, nunca del formulario.
  router.post('/login', limitadorLogin, async (req, res) => {
    const identificador = textoObligatorio(
      (req.body && (req.body.identificador || req.body.nombre_usuario)), 'identificador', 254,
    ).toLowerCase();
    const contrasena = textoObligatorio(req.body && req.body.contrasena, 'contrasena', 200);
    const { rows } = await pool.query(
      `SELECT 'usuario'::text AS tipo_cuenta, id_usuario AS id_cuenta, nombre_usuario, correo,
              contrasena_hash, auth_version, 'usuario'::text AS rol_interno, NULL::int AS id_dependencia
         FROM cuenta_usuario
        WHERE activo = TRUE AND (LOWER(nombre_usuario) = $1 OR LOWER(correo) = $1)
       UNION ALL
       SELECT 'administrador'::text, id_administrador, nombre_usuario, correo, contrasena_hash,
              auth_version, rol, id_dependencia
         FROM administrador
        WHERE LOWER(nombre_usuario) = $1 OR LOWER(correo) = $1
        LIMIT 2`, [identificador]);
    const cuenta = rows.length === 1 ? rows[0] : null;
    const valido = await bcrypt.compare(contrasena, cuenta ? cuenta.contrasena_hash : HASH_RELLENO);
    if (!cuenta || !valido) {
      throw new HttpError(401, 'credenciales_invalidas', 'Usuario/correo o contraseña incorrectos.');
    }

    const tipo = cuenta.tipo_cuenta;
    const payload = tipo === 'administrador'
      ? { tipo, rol: 'administrador', alcance_admin: cuenta.rol_interno, dep: cuenta.id_dependencia, ver: Number(cuenta.auth_version) }
      : { tipo, rol: 'usuario', ver: Number(cuenta.auth_version) };
    const token = jwt.sign(payload, config.jwtSecret, {
      algorithm: 'HS256', subject: String(cuenta.id_cuenta), expiresIn: config.jwtExpira,
    });
    const respuesta = {
      token,
      cuenta: { tipo, rol: tipo, nombre_usuario: cuenta.nombre_usuario, correo: cuenta.correo },
    };
    if (tipo === 'administrador') {
      // Se conserva esta propiedad para compatibilidad con el panel administrativo de Q4.
      respuesta.administrador = {
        nombre_usuario: cuenta.nombre_usuario,
        rol: cuenta.rol_interno,
        id_dependencia: cuenta.id_dependencia,
      };
      respuesta.cuenta.alcance_admin = cuenta.rol_interno;
      respuesta.cuenta.id_dependencia = cuenta.id_dependencia;
    }
    res.json(respuesta);
  });

  router.get('/me', requiereToken({ secreto: config.jwtSecret, pool }), async (req, res) => {
    res.json({ cuenta: req.auth });
  });

  // Respuesta deliberadamente genérica para no revelar si un correo tiene una cuenta registrada.
  router.post('/forgot-password', limitadorRecuperacion, async (req, res) => {
    const correoEntrada = req.body && req.body.correo;
    const correo = typeof correoEntrada === 'string' ? correoEntrada.trim().toLowerCase() : '';
    if (!correo || correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(202).json({ mensaje: MENSAJE_RECUPERACION });
    }

    const { rows } = await pool.query(
      `SELECT 'usuario'::text AS tipo_cuenta, id_usuario AS id_cuenta, correo
         FROM cuenta_usuario WHERE LOWER(correo) = $1 AND activo = TRUE
       UNION ALL
       SELECT 'administrador'::text, id_administrador, correo
         FROM administrador WHERE LOWER(correo) = $1
        LIMIT 2`, [correo]);

    // No se envía enlace cuando el correo es ambiguo (posible inconsistencia introducida manualmente en BD).
    if (rows.length !== 1) return res.status(202).json({ mensaje: MENSAJE_RECUPERACION });
    const cuenta = rows[0];
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { tipo_cuenta: cuenta.tipo_cuenta, proposito: 'restablecer_contrasena', jti },
      config.jwtResetSecret,
      { algorithm: 'HS256', subject: String(cuenta.id_cuenta), expiresIn: `${config.resetMinutos}m` },
    );
    const expiracion = new Date(Date.now() + config.resetMinutos * 60 * 1000);
    await pool.query(
      `UPDATE token_recuperacion_contrasena SET usado_en = CURRENT_TIMESTAMP
        WHERE tipo_cuenta = $1 AND id_cuenta = $2 AND usado_en IS NULL`,
      [cuenta.tipo_cuenta, cuenta.id_cuenta]);
    await pool.query(
      `INSERT INTO token_recuperacion_contrasena (tipo_cuenta, id_cuenta, jti_hash, expira_en)
       VALUES ($1, $2, $3, $4)`,
      [cuenta.tipo_cuenta, cuenta.id_cuenta, hashJti(jti), expiracion]);

    const base = String(config.frontendUrl || '').replace(/\/$/, '');
    const url = `${base}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
    try {
      await enviarCorreoRecuperacion({ config, correo: cuenta.correo, url });
    } catch (err) {
      // No registrar el token ni el enlace. El endpoint sigue respondiendo de manera genérica.
      await pool.query(
        `UPDATE token_recuperacion_contrasena SET usado_en = CURRENT_TIMESTAMP
          WHERE jti_hash = $1 AND usado_en IS NULL`, [hashJti(jti)]);
      console.warn('[auth] no se pudo enviar el correo de recuperación; revisa la configuración del proveedor de correo.');
    }
    return res.status(202).json({ mensaje: MENSAJE_RECUPERACION });
  });

  router.post('/reset-password', limitadorRestablecimiento, async (req, res) => {
    const token = textoObligatorio(req.body && req.body.token, 'token', 4096);
    const nuevaContrasena = validarNuevaContrasena(req.body && req.body.nueva_contrasena);
    let claims;
    try {
      claims = jwt.verify(token, config.jwtResetSecret, { algorithms: ['HS256'] });
      if (claims.proposito !== 'restablecer_contrasena' || !claims.jti ||
          !['usuario', 'administrador'].includes(claims.tipo_cuenta) || !/^\d+$/.test(String(claims.sub))) {
        throw new Error('Claims inválidos.');
      }
    } catch {
      throw new HttpError(400, 'token_recuperacion_invalido', MENSAJE_RESET_INVALIDO);
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(
        `SELECT id_token, tipo_cuenta, id_cuenta
           FROM token_recuperacion_contrasena
          WHERE jti_hash = $1 AND tipo_cuenta = $2 AND id_cuenta = $3
            AND usado_en IS NULL AND expira_en > CURRENT_TIMESTAMP
          FOR UPDATE`,
        [hashJti(claims.jti), claims.tipo_cuenta, Number(claims.sub)]);
      if (rows.length !== 1) {
        await cliente.query('ROLLBACK');
        throw new HttpError(400, 'token_recuperacion_invalido', MENSAJE_RESET_INVALIDO);
      }

      const hash = await bcrypt.hash(nuevaContrasena, 12);
      const tabla = claims.tipo_cuenta === 'usuario' ? 'cuenta_usuario' : 'administrador';
      const idColumna = claims.tipo_cuenta === 'usuario' ? 'id_usuario' : 'id_administrador';
      const actualizada = await cliente.query(
        `UPDATE ${tabla} SET contrasena_hash = $1, auth_version = auth_version + 1 WHERE ${idColumna} = $2`,
        [hash, Number(claims.sub)]);
      if (actualizada.rowCount !== 1) {
        await cliente.query('ROLLBACK');
        throw new HttpError(400, 'token_recuperacion_invalido', MENSAJE_RESET_INVALIDO);
      }
      // Token de recuperación de un solo uso y revocación de enlaces anteriores del mismo usuario.
      await cliente.query(
        `UPDATE token_recuperacion_contrasena SET usado_en = CURRENT_TIMESTAMP
          WHERE tipo_cuenta = $1 AND id_cuenta = $2 AND usado_en IS NULL`,
        [claims.tipo_cuenta, Number(claims.sub)]);
      await cliente.query('COMMIT');
      return res.json({ mensaje: 'Contraseña actualizada. Inicia sesión con la nueva contraseña.' });
    } catch (err) {
      try { await cliente.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      cliente.release();
    }
  });

  return router;
}

module.exports = { rutasAuth };
