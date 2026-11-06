# Q4 — Cambios aplicados al backend de AsistIA

## Alcance de esta actualización

Se modificó el código del backend incluido en este ZIP. No se cambió el funcionamiento central del asistente ni la integración IA de Q4; los cambios se enfocan en autenticación, cuentas, recuperación de contraseña y propiedad del historial.

## Dos roles de aplicación

- `usuario`: inicia sesión y puede usar chat, preguntas frecuentes e historial propio.
- `administrador`: inicia sesión y accede al panel según su alcance interno existente (`global` o `dependencia`). El administrador global puede crear cuentas de Usuario; los administradores de dependencia mantienen sus restricciones anteriores.

El backend obtiene el rol desde la base de datos. No permite asignarse el rol desde el formulario. El login acepta nombre de usuario o correo.

## Recuperación de contraseña

- `POST /api/auth/forgot-password`: respuesta genérica para evitar revelar si un correo existe.
- `POST /api/auth/reset-password`: valida el JWT de recuperación, su vencimiento y su identificador de un solo uso.
- El token de recuperación emplea `JWT_RESET_SECRET`, separado de `JWT_SECRET`, vence tras 15 minutos por defecto y su `jti` se almacena como hash SHA-256.
- La contraseña nueva se almacena con bcrypt y el cambio incrementa `auth_version`, revocando las sesiones previas.
- El envío de correo usa la API HTTPS de Resend y requiere configurar `RESEND_API_KEY` y `RESEND_FROM`. Si faltan estas variables, el backend no envía correo y el token se invalida; no se escribe el token en logs.

## Base de datos

Se añadieron `cuenta_usuario`, `token_recuperacion_contrasena`, correos de administradores, `auth_version` y la relación de `conversacion` con `id_usuario`. El historial del usuario se filtra por cuenta autenticada y no solo por `id_sesion`.

**Atención:** `npm run db:init` vuelve a crear las tablas y elimina los datos anteriores. Debe usarse con una base de datos de desarrollo/pruebas o después de respaldar datos que se quieran conservar.

## Nuevas rutas / cambios de acceso

- `POST /api/auth/login`: login unificado de Usuario y Administrador.
- `GET /api/auth/me`: consulta el rol asociado a la sesión.
- `POST /api/auth/forgot-password` y `POST /api/auth/reset-password`: recuperación segura.
- `POST /api/admin/cuentas/usuarios`: creación de cuenta de Usuario, solo para administrador global.
- `POST /api/chat`, `/api/conversaciones*` y `/api/faq*` ahora requieren token de Usuario.
- `/api/admin/*` requiere token de Administrador.

## Variables nuevas

`JWT_RESET_SECRET`, `RESET_TOKEN_MINUTOS`, `FRONTEND_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `USER_SEED_PASSWORD`, `USER_DEMO_EMAIL`, `ADMIN_GLOBAL_EMAIL`, `ADMIN_ADMISIONES_EMAIL`, `ADMIN_REGISTRO_EMAIL`, `ADMIN_BIENESTAR_EMAIL`, `ADMIN_COORDINACION_EMAIL`. También se documentaron los límites `RECUPERACION_LIMITE` y `RESET_LIMITE`.

Las cuentas demo usan correos `.invalid`. `USER_DEMO_EMAIL` permite configurar el correo de la cuenta `usuario_demo`; también deben configurarse `ADMIN_*_EMAIL` con correos controlados y un remitente verificado del proveedor para probar recuperación real. La contraseña debe contener al menos 10 caracteres, incluir mayúscula, minúscula y número, y no superar 72 bytes UTF-8 por el uso de bcrypt.

## Verificación

Se comprobó la sintaxis de todos los archivos JavaScript con `node --check`. No se pudo ejecutar la suite automatizada en este entorno porque no están instaladas las dependencias de `npm` (`pg`, `dotenv`, entre otras) y la instalación automática no terminó. Antes de dar por finalizado Q4 en el equipo del estudiante, ejecutar `npm install`, `npm test` contra una base PostgreSQL de pruebas y probar el envío real de correo con credenciales configuradas.

## Coherencia con las siguientes fases

Q5 debe implementar en el frontend Next.js + Tailwind las pantallas de inicio de sesión, “Olvidé mi contraseña” y restablecimiento, además del envío del token Bearer a las rutas protegidas. Q1, Q2 y Q3 también deberán actualizarse para reflejar las cuentas, los nuevos requisitos y los flujos de recuperación; esta actualización se limita al ZIP del backend Q4.
