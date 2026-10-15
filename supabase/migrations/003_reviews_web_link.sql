-- ─────────────────────────────────────────────────────────────────────
--  Molara · Migración 003 — Reseñas en Google + verificación de reservas web por WhatsApp
--  Ejecútala una vez en Supabase → SQL Editor. Es idempotente (se puede repetir).
-- ─────────────────────────────────────────────────────────────────────
-- Link para dejar reseña en Google (Perfil de Empresa → "Pedir reseñas" → copiar link, ej: https://g.page/r/XXXX/review)
alter table public.clinics add column if not exists google_review_url text;
