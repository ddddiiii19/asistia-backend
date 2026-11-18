-- AsistIA - Migración Q8 (para bases de datos de Q4 a Q7 que ya tienen datos).
-- Agrega el contacto estructurado de cada dependencia: varios correos y un teléfono.
-- No borra ni modifica datos existentes (contacto_responsable se conserva). Es seguro ejecutarla más de una vez.
-- Esta parte solo crea las columnas; para llenarlas desde contacto_responsable use: npm run db:migrar-q8
-- (que ejecuta este archivo y luego llena correos y telefono solo donde estén vacíos).
-- (Si prefiere empezar de cero, `npm run db:init` ya crea las columnas, pero BORRA todos los datos.)

ALTER TABLE dependencia ADD COLUMN IF NOT EXISTS correos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE dependencia ADD COLUMN IF NOT EXISTS telefono VARCHAR(100);
