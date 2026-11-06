-- AsistIA - DATOS DE PRUEBA FICTICIOS.
-- Estos datos NO corresponden a informacion real de TEINCO. Se reemplazan por informacion
-- institucional validada desde el panel administrativo (RF-12 / RF-14).
-- Los correos .invalid se usan solo para las cuentas de prueba; no reciben mensajes reales.
-- Los contactos usan el dominio reservado ".invalid", que nunca resuelve a un correo real.

INSERT INTO dependencia (nombre, descripcion, contacto_responsable) VALUES
 ('Admisiones',             'Procesos de inscripcion y admision.',                    '[DATO DE PRUEBA] contacto.admisiones@ejemplo.invalid'),
 ('Registro y Control',     'Certificados, matricula y registro academico.',          '[DATO DE PRUEBA] contacto.registro@ejemplo.invalid'),
 ('Bienestar',              'Apoyo psicosocial y servicios de bienestar.',            '[DATO DE PRUEBA] contacto.bienestar@ejemplo.invalid'),
 ('Coordinación académica', 'Horarios, programas y asuntos academicos.',              '[DATO DE PRUEBA] contacto.coordinacion@ejemplo.invalid');

INSERT INTO informacion_institucional (id_dependencia, titulo, contenido) VALUES
 (1, 'Proceso de inscripción',  '[DATO DE PRUEBA] Para inscribirse se diligencia el formulario de inscripción y se presentan los documentos solicitados dentro de las fechas del calendario de admisiones.'),
 (2, 'Certificados de notas',   '[DATO DE PRUEBA] Los certificados de notas se solicitan a Registro y Control indicando el número de documento y el tipo de certificado requerido.'),
 (2, 'Consulta de matrícula',   '[DATO DE PRUEBA] El estado de la matrícula se consulta con Registro y Control.'),
 (3, 'Apoyo psicosocial',       '[DATO DE PRUEBA] Las citas de apoyo psicosocial se solicitan a Bienestar, que confirma la fecha de atención.'),
 (4, 'Horarios de clase',       '[DATO DE PRUEBA] Los horarios del periodo vigente y sus ajustes se confirman con Coordinación académica.');

INSERT INTO pregunta_frecuente (id_dependencia, pregunta, respuesta) VALUES
 (1, '¿Cuáles son los requisitos de inscripción?', '[DATO DE PRUEBA] Formulario de inscripción diligenciado y documentos solicitados por Admisiones.'),
 (2, '¿Cómo solicito un certificado de notas?',    '[DATO DE PRUEBA] Se solicita a Registro y Control indicando número de documento y tipo de certificado.'),
 (3, '¿Cómo agendo una cita psicológica?',         '[DATO DE PRUEBA] Se solicita a Bienestar, que confirma la fecha de atención.'),
 (4, '¿Dónde consulto mi horario de clases?',      '[DATO DE PRUEBA] Coordinación académica confirma los horarios del periodo vigente.');
