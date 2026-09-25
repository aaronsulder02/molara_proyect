-- =====================================================================
--  MOLARA · Esquema multi-tenant para consultorios odontológicos
--  Ejecutar completo en Supabase → SQL Editor → New query → Run
--  Es idempotente: se puede volver a ejecutar sin romper datos.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type appt_status as enum ('pending','confirmed','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appt_channel as enum ('whatsapp','web','panel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum ('owner','admin','staff');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Consultorios (tenant)
-- ---------------------------------------------------------------------
create table if not exists public.clinics (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  phone            text,
  email            text,
  address          text,
  city             text,
  timezone         text not null default 'America/Santiago',
  about            text,
  hours_text       text default 'Lunes a viernes 09:00–19:00 · Sábado 09:00–13:00',
  brand_color      text default '#0E9F8E',
  bot_name         text not null default 'Sofía',
  bot_welcome      text default '¡Hola! 👋 Soy el asistente virtual del consultorio. Puedo agendar, confirmar o cancelar tu hora en segundos.',
  bot_instructions text default '',
  ai_enabled       boolean not null default true,
  slot_minutes     int  not null default 15 check (slot_minutes between 5 and 120),
  min_notice_min   int  not null default 60,
  booking_window_days int not null default 30,
  reminder_template text,           -- nombre de plantilla aprobada en Meta (opcional)
  reminder_template_lang text default 'es',
  plan             text not null default 'trial',
  trial_ends_at    timestamptz default (now() + interval '14 days'),
  created_at       timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'staff',
  full_name  text,
  email      text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index if not exists clinic_members_user_idx on public.clinic_members(user_id);

-- ---------------------------------------------------------------------
-- Catálogo: profesionales, servicios, horarios, bloqueos
-- ---------------------------------------------------------------------
create table if not exists public.dentists (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  name       text not null,
  specialty  text default 'Odontología general',
  color      text default '#0E9F8E',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dentists_clinic_idx on public.dentists(clinic_id);

create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  name         text not null,
  description  text,
  duration_min int  not null default 30 check (duration_min between 5 and 480),
  price        int,
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists services_clinic_idx on public.services(clinic_id);

create table if not exists public.schedules (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  dentist_id uuid not null references public.dentists(id) on delete cascade,
  weekday    int  not null check (weekday between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time)
);
create index if not exists schedules_dentist_idx on public.schedules(dentist_id, weekday);

create table if not exists public.blocked_times (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  dentist_id uuid references public.dentists(id) on delete cascade, -- null = todo el consultorio
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  check (ends_at > starts_at)
);
create index if not exists blocked_clinic_idx on public.blocked_times(clinic_id, starts_at);

-- ---------------------------------------------------------------------
-- Pacientes y citas
-- ---------------------------------------------------------------------
create table if not exists public.patients (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  full_name  text,
  phone      text not null,           -- formato E.164 sin '+', ej: 56912345678
  email      text,
  rut        text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  dentist_id      uuid not null references public.dentists(id) on delete restrict,
  service_id      uuid references public.services(id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          appt_status  not null default 'pending',
  channel         appt_channel not null default 'panel',
  notes           text,
  reminder_sent_at timestamptz,
  confirmed_at    timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists appts_clinic_start_idx on public.appointments(clinic_id, starts_at);
create index if not exists appts_patient_idx on public.appointments(patient_id);

-- Motor anti doble-reserva: un profesional no puede tener dos citas activas solapadas
do $$ begin
  alter table public.appointments
    add constraint appointments_no_overlap
    exclude using gist (dentist_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending','confirmed'));
exception when duplicate_object or duplicate_table then null; end $$;

-- ---------------------------------------------------------------------
-- Integraciones: WhatsApp Cloud API e Instagram
-- ---------------------------------------------------------------------
create table if not exists public.whatsapp_accounts (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null unique references public.clinics(id) on delete cascade,
  phone_number_id text not null unique,
  waba_id         text not null,
  display_phone   text,
  verified_name   text,
  quality_rating  text,
  access_token    text not null,
  status          text not null default 'connected',
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.instagram_accounts (
  clinic_id    uuid primary key references public.clinics(id) on delete cascade,
  ig_user_id   text not null,
  access_token text not null,
  api_host     text not null default 'graph.facebook.com', -- o graph.instagram.com
  username     text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Conversaciones de WhatsApp
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  wa_id           text not null,               -- teléfono del paciente
  patient_id      uuid references public.patients(id) on delete set null,
  profile_name    text,
  mode            text not null default 'bot' check (mode in ('bot','human')),
  state           jsonb not null default '{}'::jsonb,
  unread          int not null default 0,
  last_message    text,
  last_message_at timestamptz default now(),
  last_inbound_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (clinic_id, wa_id)
);
create index if not exists conv_clinic_last_idx on public.conversations(clinic_id, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  author          text not null default 'patient', -- patient | bot | ai | staff | system
  type            text not null default 'text',
  body            text,
  payload         jsonb,
  wa_message_id   text unique,
  status          text,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Seguridad: Row Level Security
-- El backend usa la SECRET KEY (bypass RLS). Estas políticas protegen el
-- acceso directo con la clave publicable: cada usuario solo ve su consultorio.
-- ---------------------------------------------------------------------
create or replace function public.is_clinic_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = cid and m.user_id = auth.uid());
$$;

create or replace function public.is_clinic_admin(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinic_members m
                 where m.clinic_id = cid and m.user_id = auth.uid() and m.role in ('owner','admin'));
$$;

alter table public.clinics            enable row level security;
alter table public.clinic_members     enable row level security;
alter table public.dentists           enable row level security;
alter table public.services           enable row level security;
alter table public.schedules          enable row level security;
alter table public.blocked_times      enable row level security;
alter table public.patients           enable row level security;
alter table public.appointments       enable row level security;
alter table public.whatsapp_accounts  enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;

drop policy if exists clinics_member_read on public.clinics;
create policy clinics_member_read on public.clinics for select using (public.is_clinic_member(id));
drop policy if exists clinics_admin_update on public.clinics;
create policy clinics_admin_update on public.clinics for update using (public.is_clinic_admin(id));

drop policy if exists members_read on public.clinic_members;
create policy members_read on public.clinic_members for select using (public.is_clinic_member(clinic_id));
drop policy if exists members_admin_all on public.clinic_members;
create policy members_admin_all on public.clinic_members for all
  using (public.is_clinic_admin(clinic_id)) with check (public.is_clinic_admin(clinic_id));

-- Tablas operativas: cualquier miembro del consultorio puede leer/escribir
do $$
declare t text;
begin
  foreach t in array array['dentists','services','schedules','blocked_times','patients',
                           'appointments','conversations','messages'] loop
    execute format('drop policy if exists %I_member_all on public.%I', t, t);
    execute format('create policy %I_member_all on public.%I for all
                    using (public.is_clinic_member(clinic_id))
                    with check (public.is_clinic_member(clinic_id))', t, t);
  end loop;
end $$;

-- Credenciales de integraciones: solo administradores
drop policy if exists wa_admin_all on public.whatsapp_accounts;
create policy wa_admin_all on public.whatsapp_accounts for all
  using (public.is_clinic_admin(clinic_id)) with check (public.is_clinic_admin(clinic_id));
drop policy if exists ig_admin_all on public.instagram_accounts;
create policy ig_admin_all on public.instagram_accounts for all
  using (public.is_clinic_admin(clinic_id)) with check (public.is_clinic_admin(clinic_id));

-- ---------------------------------------------------------------------
-- Vista de apoyo para el dashboard
-- ---------------------------------------------------------------------
create or replace view public.appointment_details
with (security_invoker = true) as
select a.*,
       p.full_name as patient_name, p.phone as patient_phone,
       d.name as dentist_name, d.color as dentist_color,
       s.name as service_name, s.price as service_price
from public.appointments a
join public.patients p on p.id = a.patient_id
join public.dentists d on d.id = a.dentist_id
left join public.services s on s.id = a.service_id;
