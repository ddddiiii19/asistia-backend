# AsistIA — Back-end (Q4 + Q6)

API REST del asistente conversacional con IA generativa para atender y direccionar consultas de la comunidad académica hacia las divisiones de TEINCO. Esta entrega cubre el **back-end e integración con IA**.

**Stack del backend:** Node.js 20+ · Express 5 · PostgreSQL · JWT · bcrypt · servicio de IA intercambiable (OpenAI o simulador). Para Q5, el frontend acordado es Next.js con Tailwind CSS; el backend sigue siendo una API REST independiente.

> La información institucional de `db/seed.sql`, las cuentas demo y sus correos son **datos ficticios**, no información real de TEINCO. Los correos `ejemplo.invalid` no reciben mensajes reales.

## Requisitos

- Node.js 20 o superior (el desarrollo previo se hizo con Node 22).
- PostgreSQL 14 o superior.
- Una clave de OpenAI y un modelo compatible con Structured Outputs para probar la IA real. Para pruebas funcionales se puede usar `AI_PROVIDER=simulador`.
- Para enviar correos reales de recuperación: una cuenta de Resend, una clave API y un remitente verificado.

## Puesta en marcha

```bash
npm install
createdb -U postgres asistia
cp .env.example .env       # Windows: copy .env.example .env
# Editar .env: DATABASE_URL, JWT_SECRET, JWT_RESET_SECRET,
# ADMIN_SEED_PASSWORD, USER_SEED_PASSWORD y parámetros de OpenAI.
npm run db:init            # ATENCIÓN: borra y vuelve a crear todas las tablas.
npm start                  # o npm run dev
```

La API queda en `http://localhost:3000`. Compruebe `GET /api/health`.

### Cuentas de demostración

`npm run db:init` crea:

- **Administrador global:** `admin`.
- **Administradores de dependencia:** `admin_admisiones`, `admin_registro`, `admin_bienestar`, `admin_coordinacion`.
- **Usuario:** `usuario_demo`.

Las cuentas administrativas usan `ADMIN_SEED_PASSWORD`; la cuenta de usuario usa `USER_SEED_PASSWORD`. En `.env.example` aparecen contraseñas ilustrativas: cámbielas y usa contraseñas distintas en tu entorno. Por defecto los correos demo terminan en `.invalid`; define `USER_DEMO_EMAIL` y las variables `ADMIN_*_EMAIL` con direcciones válidas si vas a probar recuperación real.

Las credenciales se pueden enviar en `identificador` (nombre de usuario o correo) y `contrasena`. El tipo de rol se obtiene de la base de datos; el cliente no puede elegir ni elevar su rol enviando un valor diferente.

### Crear una cuenta de Usuario

No existe autorregistro público. El administrador global puede crear cuentas desde la ruta protegida `POST /api/admin/cuentas/usuarios`:

```json
{
  "nombre_usuario": "nuevo_usuario",
  "correo": "usuario@dominio-validado.com",
  "contrasena": "ClaveSegura2026"
}
```

La contraseña debe tener al menos 10 caracteres, no superar 72 bytes UTF-8 e incluir mayúscula, minúscula y número. El límite en bytes evita que bcrypt trunque silenciosamente contraseñas más largas. La respuesta no devuelve el hash de la contraseña. El administrador de dependencia no puede crear cuentas ni modificar información institucional.

## Autenticación y recuperación de contraseña

### Inicio de sesión

`POST /api/auth/login`

```json
{ "identificador": "usuario_demo", "contrasena": "<contraseña de USER_SEED_PASSWORD>" }
```

La respuesta incluye un JWT de sesión y un objeto `cuenta` cuyo campo `tipo` es `usuario` o `administrador`. El token de acceso dura lo indicado por `JWT_EXPIRA` (por defecto, ocho horas). Las rutas privadas requieren `Authorization: Bearer <token>`.

El usuario solo puede consultar sus propias conversaciones. El administrador consulta el panel según su alcance: el global consulta todas las dependencias y puede modificar información; el de dependencia consulta únicamente su dependencia.

### Solicitar enlace de recuperación

`POST /api/auth/forgot-password`

```json
{ "correo": "usuario@dominio-validado.com" }
```

Por seguridad, siempre devuelve la misma respuesta genérica, exista o no la cuenta. Si el correo está registrado y el proveedor está configurado, la API envía un enlace al frontend terminado en `/restablecer-contrasena?token=...`.

### Establecer contraseña nueva

`POST /api/auth/reset-password`

```json
{ "token": "<token recibido por correo>", "nueva_contrasena": "NuevaClaveSegura2026" }
```

El proceso usa un JWT de recuperación firmado con **`JWT_RESET_SECRET`, separado del secreto de sesión**, con vencimiento corto (15 minutos por defecto, configurable entre 5 y 30). La base de datos almacena el hash SHA-256 del identificador `jti`, no el JWT en texto claro. El enlace es de un solo uso; los enlaces anteriores se invalidan. Al cambiar la contraseña aumenta la versión de autenticación y las sesiones de esa cuenta dejan de ser válidas.

### Configurar envío de correo real

En `.env`, define `RESEND_API_KEY` y `RESEND_FROM`. El remitente debe estar verificado en Resend. La integración envía la solicitud por HTTPS a `POST https://api.resend.com/emails` con autenticación Bearer. Si no se configuran estos valores, el backend puede arrancar y las pruebas pueden ejecutarse, pero el enlace **no se enviará**; el endpoint seguirá respondiendo con el mensaje genérico y el token generado se invalidará. No se escriben el token ni el enlace en los logs. El envío real debe probarse desde una cuenta de correo válida.

## Endpoints principales

| Método y ruta | Acceso | Función |
|---|---|---|
| `GET /api/health` | Público | Salud de API y base de datos |
| `POST /api/auth/login` | Público | Inicio de sesión unificado para los dos roles |
| `GET /api/auth/me` | Usuario o administrador autenticado | Consultar identidad y rol de la sesión |
| `POST /api/auth/forgot-password` | Público, limitado por IP | Solicitar recuperación por correo |
| `POST /api/auth/reset-password` | Público, limitado por IP | Consumir un token y establecer contraseña nueva |
| `GET /api/dependencias` | Público | Listado de dependencias para orientación |
| `POST /api/chat` | Usuario autenticado | Consultar al asistente |
| `GET /api/conversaciones` · `GET /api/conversaciones/:id` | Usuario autenticado | Historial propio, comprobado por cuenta |
| `GET /api/faq` · `POST /api/faq/:id/consulta` | Usuario autenticado | Consultar preguntas frecuentes |
| `GET /api/admin/informacion` | Administrador autenticado | Consultar información según su alcance |
| `POST · PUT · DELETE /api/admin/informacion[/:id]` | Administrador global | Gestionar información institucional |
| `GET /api/admin/faq` | Administrador autenticado | Consultar preguntas frecuentes según su alcance |
| `POST · PUT · DELETE /api/admin/faq[/:id]` | Administrador global | Gestionar preguntas frecuentes |
| `POST /api/admin/cuentas/usuarios` | Administrador global | Crear una cuenta de Usuario |
| `GET /api/admin/conversaciones[/:id]` | Administrador autenticado | Consultar historial administrativo sin exponer `id_sesion`. **Q6:** la lista incluye la `dependencia` de cada conversación y el detalle incluye `consultas` (dependencia, tema, tiempo, estado y motivo de escalamiento, solo las del alcance del administrador). **El administrador de dependencia solo ve los mensajes de las consultas dirigidas a su dependencia** (cada pregunta y la respuesta que recibió), también en el conteo de mensajes y en la primera consulta de la lista; el global ve la conversación completa |
| `GET /api/admin/reportes/interacciones` | Administrador autenticado | Reportes por periodo y dependencia |
| `GET /api/admin/estadisticas` | Administrador autenticado | Estadísticas de uso |
| `GET /api/admin/reportes/resumen` | Administrador autenticado | **Q6:** indicadores del panel de reportes (consultas, resueltas, tiempo promedio, preguntas frecuentes, dependencias, serie diaria) |

Los filtros administrativos se envían como `?dependencia=<id>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD`.

## Q6 — Reportes y datos de prueba

`GET /api/admin/reportes/resumen` acepta los mismos filtros (`dependencia`, `desde`, `hasta`) y el mismo alcance por rol que el resto del panel: el administrador de dependencia solo ve la suya y recibe `403 fuera_de_alcance` si pide otra. Devuelve `total`, `resueltas`, `escaladas`, `tasa_resolucion`, `tiempo_promedio_ms`, `por_dependencia`, `temas_mas_consultados`, `preguntas_mas_frecuentes`, `faq_mas_consultadas` (contador acumulado, sin filtro de fechas) y `consultas_por_dia` (máximo 90 días).

- **Resuelta** = consulta que no generó escalamiento. **Tiempo de respuesta** = procesamiento del asistente (clasificar, generar y verificar), guardado en `consulta.tiempo_respuesta_ms`; las consultas anteriores a Q6 no lo tienen y el promedio las ignora.
- **Preguntas más frecuentes**: se agrupan por texto normalizado (mayúsculas, signos y espacios); las tildes distinguen redacciones.
- `GET /api/admin/reportes/interacciones` ahora incluye `tiempo_respuesta_ms` y `motivo_escalamiento`.

**Base ya creada (con datos que quiere conservar):** `psql -U postgres -d asistia -f db/migracion-q6.sql`. Una base nueva (`npm run db:init`) ya incluye la columna, pero borra todo.

**Datos de prueba:** `npm run db:seed-reportes` crea ~240 consultas ficticias de 60 días (`--total`, `--dias` para ajustar). Es determinista, se puede repetir sin duplicar y todo queda marcado con `id_sesion = 'demo-reportes-NNNN'` y pertenece a la cuenta técnica `demo_reportes`, que está **desactivada** (no inicia sesión) y es distinta de `usuario_demo`, así el historial del usuario de demostración no se llena de datos ficticios. `node scripts/seed-reportes.js --limpiar` retira esas conversaciones y esa cuenta.

## Información general de TEINCO (sedes, carreras, misión, contacto)

El asistente responde **solo** con información cargada y escala lo que no puede sustentar. Para que conozca los temas generales de la institución existe la dependencia **«Información general»**, con 7 textos y 3 preguntas frecuentes sobre: qué es TEINCO, misión y visión, sedes (Bogotá y Mosquera), carreras de pregrado, posgrado y formación para el trabajo, contacto institucional y correos de áreas de apoyo.

```bash
npm run db:cargar-info-general   # después de db:init (o de la migración); se puede repetir para refrescar los textos
```

- **Origen:** son datos **reales** tomados del sitio oficial (`teinco.edu.co/nuestra-institucion` y `/programas-teinco`), consultados el 28/10/2026. Están en `db/info-general-teinco.js` y cada texto cita su fuente. No se incluyen costos, fechas, requisitos, horarios de atención ni datos de personas (cambian con frecuencia o corresponden a otras dependencias).
- **Deben ser validados por TEINCO** (RF-12 / RF-14) antes de usarse en producción: la oferta, las sedes y los canales de contacto cambian y el sitio web puede estar desactualizado. Para actualizarlos, edite `db/info-general-teinco.js` y vuelva a ejecutar el comando, o use los endpoints de información institucional del administrador global.
- **Es idempotente y no destructivo:** no duplica filas, conserva el contador de uso de las preguntas frecuentes y no toca la información de las demás dependencias ni lo que un administrador haya agregado. `db/seed.sql` sigue siendo solo de datos ficticios.
- **Clasificación:** el prompt del clasificador y el simulador envían a esta dependencia las preguntas generales sobre la institución; los trámites y servicios siguen yendo a su dependencia. La dependencia no tiene cuenta de administrador propia: la gestiona el administrador global.
- **Sin repeticiones:** si un mismo texto está cargado como información y como pregunta frecuente, se envía una sola vez al generar la respuesta.
- **Alcance de las pruebas:** se verificaron con el **simulador** (que no es una IA). La calidad con un modelo real depende de `AI_PROVIDER=openai`; pruébelo con `node scripts/probar-openai.js` y con preguntas reales antes de dar por buena la respuesta.

## Ejemplo: consulta al asistente

```http
POST /api/chat
Authorization: Bearer <token de Usuario>
Content-Type: application/json

{
  "id_sesion": "<identificador de 16 a 64 caracteres generado por el cliente>",
  "mensaje": "¿Cómo solicito un certificado de notas?",
  "id_conversacion": 12
}
```

`id_conversacion` es opcional y permite continuar una conversación que pertenezca a la misma cuenta. La tabla `conversacion` relaciona el historial con `id_usuario`; `id_sesion` se conserva como identificador técnico, pero ya no funciona como única credencial para leer el historial.

## Cómo responde el asistente

1. Interpreta y clasifica la consulta mediante el proveedor de IA.
2. Recupera información institucional y preguntas frecuentes de la dependencia identificada.
3. Genera una respuesta basada en esas fuentes.
4. Verifica el respaldo por código, sin usar una segunda IA.
5. Entrega la orientación o escala la consulta a un contacto humano cuando no existe respaldo suficiente.
6. Registra la interacción en PostgreSQL. Si el proveedor de IA falla, la API devuelve `503` y no registra la consulta como escalamiento.

## Seguridad aplicada

- Hash de contraseñas con bcrypt; las contraseñas no se almacenan en texto claro.
- JWT de sesión y JWT de recuperación con secretos diferentes.
- El token de recuperación contiene un `jti`; la base de datos guarda su hash, controla su vencimiento y evita su reutilización.
- Los cambios de contraseña incrementan `auth_version`, lo que revoca las sesiones anteriores.
- El backend determina el rol desde la base de datos y valida permisos en cada ruta protegida.
- Limitación de solicitudes en inicio de sesión, chat y recuperación de contraseña.
- Mensaje genérico en recuperación para reducir la enumeración de correos registrados.
- Historial de cada usuario consultado por `id_usuario`, no por un `id_sesion` conocido por el cliente.
- Consultas SQL parametrizadas; secretos y claves solo en `.env` (no se sube al repositorio).
- La integración de correo nunca escribe el token de recuperación ni el enlace en los logs.

## Pruebas

```bash
createdb -U postgres asistia_test
npm test
npm run probar:openai
```

`npm test` necesita una instancia PostgreSQL de pruebas definida en `TEST_DATABASE_URL` o en la URL por defecto indicada en `.env.example`. Utiliza el simulador de IA y una función de correo de prueba; no envía correo real ni llama a OpenAI. `npm run probar:openai` sí realiza llamadas reales y requiere configurar `OPENAI_API_KEY` y `OPENAI_MODEL`.

## Estructura del proyecto

```
db/            schema.sql · seed.sql · migracion-q6.sql · info-general-teinco.js
scripts/       init-db.js · seed-reportes.js · cargar-info-general.js · probar-openai.js
src/
  app.js · server.js · config.js · errores.js · validar.js · correo.js
  middleware/  auth.js (JWT, roles y revocación de sesiones)
  routes/      publico.js · auth.js · admin.js
  ia/          orquestador.js · verificacion.js · prompts.js · openai.js · simulador.js · index.js
tests/         pruebas automatizadas (node:test + supertest)
```

## Limitaciones y tareas pendientes

- En la base de datos se cargan cuentas y contenido ficticios. Se deben registrar correos válidos y configurar el proveedor para comprobar el envío real de recuperación.
- El frontend Next.js/Tailwind corresponde a Q5; debe implementar las pantallas de login, olvido de contraseña y restablecimiento, además del manejo seguro del token recibido por URL.
- Se debe ejecutar `npm test` en un entorno con PostgreSQL y probar el envío real desde un correo autorizado antes de afirmar que la recuperación funciona en producción.
- La conexión real con OpenAI debe validarse mediante `npm run probar:openai`.
- La verificación de respaldo comprueba fuentes y suficiencia declaradas, pero no puede garantizar por completo la fidelidad de la paráfrasis generada por el modelo; esto se evaluará en Q7.
- La limitación de solicitudes es en memoria y está pensada para una instancia de demostración.

## Control de versiones

```bash
git init
git add .
git commit -m "Q4: backend con roles, recuperación segura e integración con IA"
```

`.env` y `node_modules/` están en `.gitignore`: nunca subas secretos al repositorio.
