// Adaptador de correo transaccional usando la API HTTPS de Resend (sin SDK adicional).
// Requiere RESEND_API_KEY y RESEND_FROM; el remitente debe estar verificado en el proveedor.
async function enviarCorreoRecuperacion({ config, correo, url }) {
  const mail = config.correo || {};
  if (!mail.apiKey || !mail.from) {
    throw new Error('El servicio de correo transaccional no está configurado.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mail.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mail.from,
      to: [correo],
      subject: 'Recuperación de contraseña de AsistIA',
      text: `Recibimos una solicitud para cambiar la contraseña de tu cuenta de AsistIA.\n\nAbre este enlace dentro de los próximos ${config.resetMinutos} minutos para definir una contraseña nueva:\n${url}\n\nSi no solicitaste este cambio, ignora este mensaje. El enlace no se puede usar más de una vez.`,
      html: `<p>Recibimos una solicitud para cambiar la contraseña de tu cuenta de AsistIA.</p><p>Abre este enlace dentro de los próximos ${config.resetMinutos} minutos para definir una contraseña nueva:</p><p><a href="${url}">Restablecer contraseña</a></p><p>Si no solicitaste este cambio, ignora este mensaje. El enlace no se puede usar más de una vez.</p>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    // No se incluyen cuerpo/respuesta del proveedor en el error para evitar filtrar datos sensibles.
    throw new Error(`El proveedor de correo respondió con HTTP ${response.status}.`);
  }
}

module.exports = { enviarCorreoRecuperacion };
