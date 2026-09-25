-- ─────────────────────────────────────────────────────────────────────
--  Molara · Migración 002 — Conexión automática con Meta (webhook por consultorio)
--  Ejecútala una vez en Supabase → SQL Editor. Es idempotente (se puede repetir).
-- ─────────────────────────────────────────────────────────────────────
alter table public.whatsapp_accounts add column if not exists app_id                text;
alter table public.whatsapp_accounts add column if not exists app_secret            text;
alter table public.whatsapp_accounts add column if not exists webhook_verify_token  text;
alter table public.whatsapp_accounts add column if not exists webhook_status        text not null default 'pending'; -- pending | active | error
alter table public.whatsapp_accounts add column if not exists webhook_url           text;
alter table public.whatsapp_accounts add column if not exists webhook_verified_at   timestamptz;
alter table public.whatsapp_accounts add column if not exists webhook_last_event_at timestamptz;
alter table public.whatsapp_accounts add column if not exists token_expires_at      timestamptz;
alter table public.whatsapp_accounts add column if not exists setup_report          jsonb;
alter table public.whatsapp_accounts add column if not exists setup_at              timestamptz;

create unique index if not exists whatsapp_accounts_verify_token_idx
  on public.whatsapp_accounts (webhook_verify_token) where webhook_verify_token is not null;
