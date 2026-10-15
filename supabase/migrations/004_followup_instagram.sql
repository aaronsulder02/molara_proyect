-- ─────────────────────────────────────────────────────────────────────
--  Molara · Migración 004 — Reseña al día siguiente de la cita + invitación a Instagram
--  Ejecútala una vez en Supabase → SQL Editor. Es idempotente (se puede repetir).
-- ─────────────────────────────────────────────────────────────────────
-- Cita a la que ya se le pidió reseña (el cron la envía el día después de la atención)
alter table public.appointments add column if not exists review_requested_at timestamptz;
-- Plantilla aprobada en Meta para pedir la reseña fuera de la ventana de 24 h (opcional)
alter table public.clinics add column if not exists review_template      text;
alter table public.clinics add column if not exists review_template_lang text default 'es';
-- Instagram: cuenta a seguir y beneficio para seguidores que el asistente ofrece al terminar una reserva
alter table public.clinics add column if not exists instagram_handle text;
alter table public.clinics add column if not exists instagram_perk   text;
