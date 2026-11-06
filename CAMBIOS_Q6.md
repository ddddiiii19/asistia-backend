# Q6 — Cambios aplicados al backend de AsistIA

Entrega: **Panel de reportes** (módulo de reportes con datos de prueba) e **historial administrativo** de conversaciones. El comportamiento de Q4 (IA, roles, recuperación de contraseña) no cambia.

## Cambios
- `db/schema.sql` y `db/migracion-q6.sql`: columna `consulta.tiempo_respuesta_ms` (nullable, >= 0).
- `src/ia/orquestador.js`: mide y registra el tiempo de procesamiento de cada consulta.
- `src/routes/admin.js`: nuevo `GET /api/admin/reportes/resumen`; la lista de interacciones añade `tiempo_respuesta_ms` y `motivo_escalamiento`.
- `scripts/seed-reportes.js` (`npm run db:seed-reportes`): datos ficticios, repetibles y removibles (`--limpiar`). Pertenecen a la cuenta técnica desactivada `demo_reportes` (no a `usuario_demo`).
- `src/routes/admin.js` (RF-13, cambios aditivos): `GET /api/admin/conversaciones` añade `dependencia` y `GET /api/admin/conversaciones/:id` añade `consultas` (solo las del alcance del administrador). No se quita ni renombra ningún campo de Q4.
- `tests/reportes.test.js`: 15 pruebas nuevas; `tests/admin.test.js`: 1 prueba nueva (historial con dependencia y fichas).

## Alcance del historial y conocimiento general de TEINCO
- `src/routes/admin.js`: el administrador de dependencia ya no ve los mensajes de otras dependencias dentro de una misma conversación (detalle, conteo de mensajes y primera consulta de la lista). El global conserva la vista completa. `tests/alcance-historial.test.js` (6 pruebas) cubre conversaciones mixtas en ambos órdenes y falla con el código anterior.
- Dependencia **«Información general»** con datos reales de TEINCO (sedes, carreras, misión y visión, contacto): `db/info-general-teinco.js`, `scripts/cargar-info-general.js` (`npm run db:cargar-info-general`, idempotente) y `tests/info-general.test.js` (14 pruebas). Ver el README: los datos provienen del sitio oficial (consultado el 28/10/2026) y TEINCO debe validarlos.
- `src/ia/prompts.js` y `src/ia/simulador.js`: las preguntas generales sobre la institución se asignan a esa dependencia. `src/ia/orquestador.js`: un mismo texto cargado como información y como pregunta frecuente se envía una sola vez.

## Verificación
`npm test`: 87 de 87 (51 de Q4 + 36 nuevas) contra PostgreSQL 16 y el simulador de IA. No se probó con la API real de OpenAI: las respuestas sobre TEINCO se verificaron con el simulador, que no es una IA.

## Atención
- Las consultas anteriores a Q6 no tienen tiempo registrado; el promedio las ignora.
- Los datos de `seed-reportes` son ficticios (preguntas de ejemplo, no conversaciones reales).
