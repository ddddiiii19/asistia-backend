-- AsistIA - Migración Q6 (para bases de datos de Q4/Q5 que ya tienen datos).
-- Agrega el tiempo de respuesta por consulta, necesario para el reporte de tiempo promedio.
-- No borra datos. Es seguro ejecutarla más de una vez.
-- Uso: psql -U postgres -d asistia -f db/migracion-q6.sql
-- (Si prefiere empezar de cero, `npm run db:init` ya crea la columna, pero BORRA todos los datos.)

ALTER TABLE consulta
  ADD COLUMN IF NOT EXISTS tiempo_respuesta_ms INTEGER
  CHECK (tiempo_respuesta_ms IS NULL OR tiempo_respuesta_ms >= 0);
