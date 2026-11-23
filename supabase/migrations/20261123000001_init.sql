-- =====================================================================
-- Shagun Platform — initial schema
-- Multi-wedding (multi-tenant by event_id), Direct UPI (Phase 1),
-- column-level encryption with a key kept in Supabase Vault,
-- RLS on every table, append-only audit log.
--
-- BEFORE running this migration, create the encryption key once:
--   select vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'shagun_enc_key');
-- Never change or delete that secret: encrypted columns cannot be read without it.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('family_admin', 'viewer', 'counter_staff');
create type public.guest_side as enum ('bride', 'groom', 'both');
create type public.contribution_type as enum ('online', 'lifafa', 'gift');
create type public.contribution_purpose as enum ('shagun', 'kanyadaan', 'aashirwad_gift');
create type public.contribution_status as enum (
  'created', 'pending', 'success', 'failed',          -- gateway (Phase 2)
  'claimed', 'verified', 'rejected', 'refunded',      -- direct UPI / bank
  'awaiting_counter', 'received'                       -- lifafa / physical gift
);
create type public.otp_mode as enum ('off', 'smart', 'always');
create type public.payment_mode as enum ('direct', 'gateway', 'both');
create type public.event_status as enum ('draft', 'upcoming', 'live', 'completed', 'archived');
create type public.media_kind as enum ('guest_photo', 'counter_photo', 'lifafa_open', 'payment_screenshot');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[a-z0-9-]{4,40}$'),
  bride_name      text not null check (char_length(bride_name) between 1 and 80),
  groom_name      text not null check (char_length(groom_name) between 1 and 80),
  event_date      date not null,
  venue           text check (char_length(venue) <= 200),
  status          public.event_status not null default 'upcoming',
  welcome_text_hi text check (char_length(welcome_text_hi) <= 300),
  welcome_text_en text check (char_length(welcome_text_en) <= 300),
  theme_color     text not null default '#881337' check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  couple_photo_url text,
  otp_mode        public.otp_mode not null default 'smart',
  payment_mode    public.payment_mode not null default 'direct',
  guest_form_open boolean not null default true,
  next_token      integer not null default 1,
  delete_after    date,
  created_by      uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.event_payment_settings (
  event_id        uuid primary key references public.events on delete cascade,
  payee_name      text not null check (char_length(payee_name) between 2 and 100),
  upi_id_enc      bytea,
  upi_id_masked   text,
  bank_name       text,
  bank_acc_enc    bytea,
  bank_acc_masked text,
  ifsc            text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  updated_by      uuid references auth.users,
  updated_at      timestamptz not null default now()
);

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  event_id   uuid not null references public.events on delete cascade,
  role       public.app_role not null,
  invited_email text check (char_length(invited_email) <= 254),
  invited_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create table public.guests (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events on delete cascade,
  name           text not null check (char_length(name) between 2 and 80),
  mobile_enc     bytea not null,
  mobile_hash    text not null,
  mobile_masked  text not null,
  side           public.guest_side not null,
  relation       text not null check (char_length(relation) between 1 and 40),
  relation_other text check (char_length(relation_other) <= 60),
  city           text check (char_length(city) <= 80),
  family_count   integer check (family_count between 1 and 50),
  language       text not null default 'hi' check (language in ('hi', 'en')),
  consent_at     timestamptz not null,
  otp_verified   boolean not null default false,
  assisted_by    uuid references auth.users,
  created_at     timestamptz not null default now()
);
create index guests_event_mobile_idx on public.guests (event_id, mobile_hash);
create index guests_event_created_idx on public.guests (event_id, created_at desc);

create table public.contributions (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events on delete cascade,
  guest_id              uuid not null references public.guests on delete cascade,
  token_no              text not null,
  type                  public.contribution_type not null,
  purpose               public.contribution_purpose not null default 'shagun',
  declared_amount_paise bigint check (declared_amount_paise between 0 and 100000000),
  counted_amount_paise  bigint check (counted_amount_paise between 0 and 100000000),
  status                public.contribution_status not null,
  description           text check (char_length(description) <= 120),
  message               text check (char_length(message) <= 500),
  guest_secret_hash     text not null,
  received_by           uuid references auth.users,
  received_at           timestamptz,
  counted_by            uuid references auth.users,
  counted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (event_id, token_no)
);
create index contributions_event_idx on public.contributions (event_id, created_at desc);

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events on delete cascade,
  contribution_id    uuid not null references public.contributions on delete cascade,
  method             text not null check (method in ('direct_upi', 'bank_transfer', 'gateway')),
  amount_paise       bigint not null check (amount_paise between 100 and 100000000),
  utr_enc            bytea,
  utr_hash           text,
  utr_masked         text,
  status             public.contribution_status not null default 'claimed',
  gateway_order_id   text,
  gateway_payment_id text unique,
  failure_code       text,
  failure_reason     text,
  failure_source     text,
  verified_by        uuid references auth.users,
  verified_at        timestamptz,
  reject_reason      text check (char_length(reject_reason) <= 200),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- One UTR can be claimed only once per wedding (stops copy-paste fraud)
create unique index payments_event_utr_uniq on public.payments (event_id, utr_hash) where utr_hash is not null;
create index payments_event_idx on public.payments (event_id, created_at desc);

create table public.media (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events on delete cascade,
  contribution_id uuid references public.contributions on delete cascade,
  kind            public.media_kind not null,
  storage_path    text not null unique,
  uploaded_by     uuid references auth.users,
  created_at      timestamptz not null default now()
);
create index media_contribution_idx on public.media (contribution_id);

-- Service-role only tables (RLS on, no policies)
create table public.otp_challenges (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events on delete cascade,
  mobile_hash text not null,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  verified_at timestamptz,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index otp_challenges_lookup_idx on public.otp_challenges (event_id, mobile_hash, created_at desc);

create table public.rate_events (
  id          bigserial primary key,
  event_id    uuid,
  bucket      text not null,
  ip_hash     text not null,
  mobile_hash text,
  created_at  timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (bucket, ip_hash, created_at desc);

create table public.audit_logs (
  id         bigserial primary key,
  event_id   uuid,
  user_id    uuid,
  action     text not null,
  table_name text,
  record_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_event_idx on public.audit_logs (event_id, created_at desc);

-- ---------------------------------------------------------------------
-- Private helpers (not reachable through the API)
-- ---------------------------------------------------------------------
create or replace function private.enc_key()
returns text language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'shagun_enc_key' limit 1;
  if k is null then
    raise exception 'Encryption key shagun_enc_key missing in Vault';
  end if;
  return k;
end $$;

create or replace function private.encrypt(p text)
returns bytea language sql stable security definer set search_path = '' as $$
  select case when p is null then null
    else extensions.pgp_sym_encrypt(p, private.enc_key(), 'cipher-algo=aes256') end
$$;

create or replace function private.decrypt(p bytea)
returns text language sql stable security definer set search_path = '' as $$
  select case when p is null then null
    else extensions.pgp_sym_decrypt(p, private.enc_key()) end
$$;

create or replace function private.hmac(p text)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p, private.enc_key(), 'sha256'), 'hex')
$$;

create or replace function private.mask(p text, keep_start int, keep_end int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when char_length(p) <= keep_start + keep_end then repeat('x', char_length(p))
    else left(p, keep_start) || repeat('x', char_length(p) - keep_start - keep_end) || right(p, keep_end)
  end
$$;

create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function private.audit(p_event uuid, p_action text, p_table text, p_record text, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (event_id, user_id, action, table_name, record_id, detail)
  values (p_event, auth.uid(), p_action, p_table, p_record, p_detail);
$$;

create or replace function private.require_aal2()
returns void language plpgsql stable set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Two-step verification required' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Role helpers (used in RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Platform admins do NOT automatically see family data: they must hold a role on the event.
create or replace function public.has_event_role(p_event uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and event_id = p_event and role = any (p_roles)
  )
$$;

-- ---------------------------------------------------------------------
-- updated_at + audit triggers
-- ---------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger events_touch before update on public.events for each row execute function private.touch_updated_at();
create trigger contributions_touch before update on public.contributions for each row execute function private.touch_updated_at();
create trigger payments_touch before update on public.payments for each row execute function private.touch_updated_at();

create or replace function private.audit_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status
     or (to_jsonb(new) ->> 'counted_amount_paise') is distinct from (to_jsonb(old) ->> 'counted_amount_paise') then
    insert into public.audit_logs (event_id, user_id, action, table_name, record_id, detail)
    values (new.event_id, auth.uid(), 'status_change', tg_table_name, new.id::text,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'counted_amount_paise', to_jsonb(new) -> 'counted_amount_paise'));
  end if;
  return new;
end $$;

create trigger contributions_audit after update on public.contributions for each row execute function private.audit_status_change();
create trigger payments_audit after update on public.payments for each row execute function private.audit_status_change();

-- Audit log is append-only, even for the table owner path through the API
create or replace function private.block_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.block_audit_mutation();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.platform_admins        enable row level security;
alter table public.events                 enable row level security;
alter table public.event_payment_settings enable row level security;
alter table public.user_roles             enable row level security;
alter table public.guests                 enable row level security;
alter table public.contributions          enable row level security;
alter table public.payments               enable row level security;
alter table public.media                  enable row level security;
alter table public.otp_challenges         enable row level security;
alter table public.rate_events            enable row level security;
alter table public.audit_logs             enable row level security;

-- Clients never write tables directly: every write goes through RPCs / edge functions.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.otp_challenges, public.rate_events from anon, authenticated;
revoke all on all tables in schema public from anon;

create policy "self can see own admin row" on public.platform_admins
  for select to authenticated using (user_id = auth.uid());

create policy "members and platform admins read events" on public.events
  for select to authenticated using (
    public.is_platform_admin()
    or public.has_event_role(id, array['family_admin','viewer','counter_staff']::public.app_role[])
  );

create policy "family reads payment settings" on public.event_payment_settings
  for select to authenticated using (public.has_event_role(event_id, array['family_admin','viewer']::public.app_role[]));

create policy "read own roles, admins read event roles" on public.user_roles
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or public.has_event_role(event_id, array['family_admin']::public.app_role[])
  );

create policy "family reads guests" on public.guests
  for select to authenticated using (public.has_event_role(event_id, array['family_admin','viewer']::public.app_role[]));

create policy "family reads contributions" on public.contributions
  for select to authenticated using (public.has_event_role(event_id, array['family_admin','viewer']::public.app_role[]));

create policy "family reads payments" on public.payments
  for select to authenticated using (public.has_event_role(event_id, array['family_admin','viewer']::public.app_role[]));

create policy "family and counter read media rows" on public.media
  for select to authenticated using (public.has_event_role(event_id, array['family_admin','viewer','counter_staff']::public.app_role[]));

create policy "family admin reads audit" on public.audit_logs
  for select to authenticated using (
    public.is_platform_admin() and event_id is null
    or public.has_event_role(event_id, array['family_admin']::public.app_role[])
  );

-- Column-level grants: encrypted columns, hashes and secrets are never selectable by clients
revoke select on public.guests, public.contributions, public.payments, public.event_payment_settings from authenticated;
grant select (id, event_id, name, mobile_masked, side, relation, relation_other, city, family_count,
              language, consent_at, otp_verified, assisted_by, created_at) on public.guests to authenticated;
grant select (id, event_id, guest_id, token_no, type, purpose, declared_amount_paise, counted_amount_paise,
              status, description, message, received_by, received_at, counted_by, counted_at, created_at, updated_at)
  on public.contributions to authenticated;
grant select (id, event_id, contribution_id, method, amount_paise, utr_masked, status, gateway_order_id,
              gateway_payment_id, failure_code, failure_reason, failure_source, verified_by, verified_at,
              reject_reason, created_at, updated_at) on public.payments to authenticated;
grant select (event_id, payee_name, upi_id_masked, bank_name, bank_acc_masked, ifsc, updated_by, updated_at)
  on public.event_payment_settings to authenticated;

-- ---------------------------------------------------------------------
-- Public RPC (anon): event page for guests — safe fields only
-- ---------------------------------------------------------------------
create or replace function public.public_event(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', e.code, 'bride_name', e.bride_name, 'groom_name', e.groom_name,
    'event_date', e.event_date, 'venue', e.venue, 'status', e.status,
    'welcome_text_hi', e.welcome_text_hi, 'welcome_text_en', e.welcome_text_en,
    'theme_color', e.theme_color, 'couple_photo_url', e.couple_photo_url,
    'payment_mode', e.payment_mode, 'guest_form_open', e.guest_form_open
      and e.status in ('upcoming', 'live')
      and (e.delete_after is null or e.delete_after >= current_date),
    'payee_name', s.payee_name,
    'has_upi', s.upi_id_enc is not null,
    'has_bank', s.bank_acc_enc is not null
  )
  from public.events e
  left join public.event_payment_settings s on s.event_id = e.id
  where e.code = lower(p_code) and e.status <> 'draft'
$$;

-- ---------------------------------------------------------------------
-- Service-role RPCs (called only from edge functions)
-- ---------------------------------------------------------------------
create or replace function public.svc_mobile_hash(p_mobile text)
returns text language sql stable security definer set search_path = '' as $$
  select private.hmac(p_mobile)
$$;

create or replace function public.svc_event_by_code(p_code text)
returns table (id uuid, otp_mode public.otp_mode, payment_mode public.payment_mode, is_open boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.otp_mode, e.payment_mode,
         e.guest_form_open and e.status in ('upcoming','live')
           and (e.delete_after is null or e.delete_after >= current_date)
  from public.events e where e.code = lower(p_code)
$$;

create or replace function public.svc_event_payee(p_event uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'payee_name', payee_name,
    'upi_id', private.decrypt(upi_id_enc),
    'bank_name', bank_name,
    'bank_account', private.decrypt(bank_acc_enc),
    'ifsc', ifsc)
  from public.event_payment_settings where event_id = p_event
$$;

-- Atomic guest + contributions insert. p_items: [{type, purpose, declared_amount_paise, description, message}]
create or replace function public.svc_submit_entry(
  p_event uuid, p_name text, p_mobile text, p_side public.guest_side, p_relation text,
  p_relation_other text, p_city text, p_family_count int, p_language text,
  p_otp_verified boolean, p_assisted_by uuid, p_secret_hash text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_guest uuid;
  v_item jsonb;
  v_type public.contribution_type;
  v_n int;
  v_token text;
  v_contrib uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 3 then
    raise exception 'items must have 1 to 3 entries';
  end if;

  insert into public.guests (event_id, name, mobile_enc, mobile_hash, mobile_masked, side, relation,
                             relation_other, city, family_count, language, consent_at, otp_verified, assisted_by)
  values (p_event, trim(p_name), private.encrypt(p_mobile), private.hmac(p_mobile),
          private.mask(p_mobile, 2, 3), p_side, p_relation, nullif(trim(p_relation_other), ''),
          nullif(trim(p_city), ''), p_family_count, coalesce(p_language, 'hi'), now(), p_otp_verified, p_assisted_by)
  returning id into v_guest;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_type := (v_item ->> 'type')::public.contribution_type;
    update public.events set next_token = next_token + 1 where id = p_event returning next_token - 1 into v_n;
    v_token := case v_type when 'online' then 'O' when 'lifafa' then 'L' else 'G' end || '-' || lpad(v_n::text, 4, '0');

    insert into public.contributions (event_id, guest_id, token_no, type, purpose, declared_amount_paise,
                                      status, description, message, guest_secret_hash)
    values (p_event, v_guest, v_token, v_type,
            coalesce((v_item ->> 'purpose')::public.contribution_purpose, 'shagun'),
            nullif(v_item ->> 'declared_amount_paise', '')::bigint,
            case v_type when 'online' then 'pending'::public.contribution_status else 'awaiting_counter' end,
            nullif(trim(v_item ->> 'description'), ''), nullif(trim(v_item ->> 'message'), ''), p_secret_hash)
    returning id into v_contrib;

    v_out := v_out || jsonb_build_object('id', v_contrib, 'token_no', v_token, 'type', v_type);
  end loop;

  insert into public.audit_logs (event_id, user_id, action, table_name, record_id, detail)
  values (p_event, p_assisted_by, case when p_assisted_by is null then 'guest_submit' else 'assisted_submit' end,
          'guests', v_guest::text, jsonb_build_object('items', jsonb_array_length(p_items)));

  return jsonb_build_object('guest_id', v_guest, 'contributions', v_out);
end $$;

create or replace function public.svc_attach_media(p_event uuid, p_contribution uuid, p_kind public.media_kind, p_path text, p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.media (event_id, contribution_id, kind, storage_path, uploaded_by)
  values (p_event, p_contribution, p_kind, p_path, p_user)
$$;

-- Guest claims a Direct UPI / bank payment with their UTR
create or replace function public.svc_claim_utr(
  p_contribution uuid, p_secret_hash text, p_amount_paise bigint, p_utr text, p_method text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.contributions%rowtype;
  v_payment uuid;
begin
  select * into c from public.contributions where id = p_contribution for update;
  if not found or c.guest_secret_hash <> p_secret_hash or c.type <> 'online' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if c.status not in ('pending', 'rejected') then
    raise exception 'already_claimed';
  end if;

  insert into public.payments (event_id, contribution_id, method, amount_paise, utr_enc, utr_hash, utr_masked, status)
  values (c.event_id, c.id, p_method, p_amount_paise, private.encrypt(p_utr), private.hmac(p_utr),
          private.mask(p_utr, 0, 4), 'claimed')
  returning id into v_payment;

  update public.contributions
     set status = 'claimed', declared_amount_paise = p_amount_paise
   where id = c.id;

  return jsonb_build_object('payment_id', v_payment, 'event_id', c.event_id);
exception when unique_violation then
  raise exception 'utr_already_used';
end $$;

create or replace function public.svc_rate_hit(p_bucket text, p_event uuid, p_ip_hash text, p_mobile_hash text, p_window_minutes int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total int; v_distinct int;
begin
  insert into public.rate_events (event_id, bucket, ip_hash, mobile_hash) values (p_event, p_bucket, p_ip_hash, p_mobile_hash);
  select count(*), count(distinct mobile_hash) into v_total, v_distinct
    from public.rate_events
   where bucket = p_bucket and ip_hash = p_ip_hash
     and created_at > now() - make_interval(mins => p_window_minutes);
  return jsonb_build_object('total', v_total, 'distinct_mobiles', v_distinct);
end $$;

create or replace function public.svc_mobile_seen(p_event uuid, p_mobile_hash text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guests where event_id = p_event and mobile_hash = p_mobile_hash)
$$;

create or replace function public.svc_can_invite(p_caller uuid, p_event uuid, p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = p_caller)
      or (p_role in ('viewer','counter_staff') and exists (
            select 1 from public.user_roles
             where user_id = p_caller and event_id = p_event and role = 'family_admin'))
$$;

-- ---------------------------------------------------------------------
-- Authenticated RPCs
-- ---------------------------------------------------------------------

-- Platform admin creates a wedding
create or replace function public.create_event(
  p_code text, p_bride text, p_groom text, p_date date, p_venue text, p_delete_after date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.events (code, bride_name, groom_name, event_date, venue, delete_after, created_by)
  values (lower(p_code), p_bride, p_groom, p_date, p_venue, coalesce(p_delete_after, p_date + 365), auth.uid())
  returning id into v_id;
  perform private.audit(v_id, 'event_create', 'events', v_id::text, jsonb_build_object('code', lower(p_code)));
  return v_id;
end $$;

-- Family admin (or platform admin) updates guest-facing settings
create or replace function public.update_event_settings(
  p_event uuid, p_status public.event_status, p_otp_mode public.otp_mode, p_form_open boolean,
  p_welcome_hi text, p_welcome_en text, p_theme text, p_venue text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or public.has_event_role(p_event, array['family_admin']::public.app_role[])) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.events set
    status = coalesce(p_status, status), otp_mode = coalesce(p_otp_mode, otp_mode),
    guest_form_open = coalesce(p_form_open, guest_form_open),
    welcome_text_hi = p_welcome_hi, welcome_text_en = p_welcome_en,
    theme_color = coalesce(p_theme, theme_color), venue = coalesce(p_venue, venue)
  where id = p_event;
  perform private.audit(p_event, 'event_settings_update', 'events', p_event::text, null);
end $$;

create or replace function public.set_payment_settings(
  p_event uuid, p_payee text, p_upi text, p_bank_name text, p_account text, p_ifsc text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or public.has_event_role(p_event, array['family_admin']::public.app_role[])) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if p_upi is not null and p_upi !~ '^[a-zA-Z0-9.\-_]{2,200}@[a-zA-Z]{2,64}$' then raise exception 'invalid_upi'; end if;
  if p_account is not null and p_account !~ '^[0-9]{9,18}$' then raise exception 'invalid_account'; end if;

  insert into public.event_payment_settings as s
    (event_id, payee_name, upi_id_enc, upi_id_masked, bank_name, bank_acc_enc, bank_acc_masked, ifsc, updated_by, updated_at)
  values (p_event, p_payee, private.encrypt(p_upi), private.mask(split_part(p_upi, '@', 1), 2, 1) || '@' || split_part(p_upi, '@', 2),
          p_bank_name, private.encrypt(p_account), private.mask(p_account, 0, 4), upper(p_ifsc), auth.uid(), now())
  on conflict (event_id) do update set
    payee_name = excluded.payee_name, upi_id_enc = excluded.upi_id_enc, upi_id_masked = excluded.upi_id_masked,
    bank_name = excluded.bank_name, bank_acc_enc = excluded.bank_acc_enc, bank_acc_masked = excluded.bank_acc_masked,
    ifsc = excluded.ifsc, updated_by = excluded.updated_by, updated_at = now();

  perform private.audit(p_event, 'payment_settings_update', 'event_payment_settings', p_event::text, null);
end $$;

-- Reveal a guest's full mobile number (family admin, 2FA, audited)
create or replace function public.reveal_guest_mobile(p_guest uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_mobile text;
begin
  select event_id, private.decrypt(mobile_enc) into v_event, v_mobile from public.guests where id = p_guest;
  if v_event is null or not public.has_event_role(v_event, array['family_admin']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.require_aal2();
  perform private.audit(v_event, 'reveal_mobile', 'guests', p_guest::text, null);
  return v_mobile;
end $$;

-- Payments list for verification. Family admins (2FA) see full UTR; viewers see masked.
create or replace function public.admin_list_payments(p_event uuid)
returns table (id uuid, contribution_id uuid, token_no text, guest_name text, method text, amount_paise bigint,
               utr text, status public.contribution_status, reject_reason text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_full boolean;
begin
  if not public.has_event_role(p_event, array['family_admin','viewer']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_full := public.has_event_role(p_event, array['family_admin']::public.app_role[])
            and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
  if v_full then
    perform private.audit(p_event, 'list_payments_full', 'payments', null, null);
  end if;
  return query
    select p.id, p.contribution_id, c.token_no, g.name, p.method, p.amount_paise,
           case when v_full then private.decrypt(p.utr_enc) else p.utr_masked end,
           p.status, p.reject_reason, p.created_at
      from public.payments p
      join public.contributions c on c.id = p.contribution_id
      join public.guests g on g.id = c.guest_id
     where p.event_id = p_event
     order by p.created_at desc;
end $$;

create or replace function public.admin_verify_payment(p_payment uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_contrib uuid;
begin
  select event_id, contribution_id into v_event, v_contrib from public.payments where id = p_payment;
  if v_event is null or not public.has_event_role(v_event, array['family_admin']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.payments set
    status = case when p_approve then 'verified'::public.contribution_status else 'rejected' end,
    verified_by = auth.uid(), verified_at = now(),
    reject_reason = case when p_approve then null else p_reason end
  where id = p_payment;
  update public.contributions set status = case when p_approve then 'verified'::public.contribution_status else 'rejected' end
   where id = v_contrib;
end $$;

-- Counter staff: search without amounts
create or replace function public.counter_lookup(p_event uuid, p_query text)
returns table (contribution_id uuid, token_no text, guest_name text, mobile_masked text, side public.guest_side,
               relation text, type public.contribution_type, purpose public.contribution_purpose,
               status public.contribution_status, description text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if not public.has_event_role(p_event, array['family_admin','counter_staff']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select c.id, c.token_no, g.name, g.mobile_masked, g.side, g.relation, c.type, c.purpose, c.status, c.description, c.created_at
      from public.contributions c join public.guests g on g.id = c.guest_id
     where c.event_id = p_event and c.type in ('lifafa', 'gift')
       and (q = ''
            or upper(c.token_no) = upper(q)
            or (q ~ '^[0-9]{3,4}$' and right(g.mobile_masked, 3) = right(q, 3))
            or g.name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%')
     order by c.created_at desc
     limit 50;
end $$;

create or replace function public.counter_mark_received(p_contribution uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_status public.contribution_status;
begin
  select event_id, status into v_event, v_status from public.contributions where id = p_contribution for update;
  if v_event is null or not public.has_event_role(v_event, array['family_admin','counter_staff']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_status <> 'awaiting_counter' then raise exception 'already_received'; end if;
  update public.contributions set status = 'received', received_by = auth.uid(), received_at = now()
   where id = p_contribution;
end $$;

create or replace function public.admin_undo_received(p_contribution uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.contributions where id = p_contribution;
  if v_event is null or not public.has_event_role(v_event, array['family_admin']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.contributions set status = 'awaiting_counter', received_by = null, received_at = null
   where id = p_contribution and status = 'received';
end $$;

create or replace function public.admin_set_counted_amount(p_contribution uuid, p_paise bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.contributions where id = p_contribution and type = 'lifafa';
  if v_event is null or not public.has_event_role(v_event, array['family_admin']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.contributions set counted_amount_paise = p_paise, counted_by = auth.uid(), counted_at = now()
   where id = p_contribution;
end $$;

create or replace function public.event_summary(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.has_event_role(p_event, array['family_admin','viewer']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'guests', (select count(*) from public.guests where event_id = p_event),
    'online_verified_paise', coalesce((select sum(amount_paise) from public.payments where event_id = p_event and status in ('verified','success')), 0),
    'online_pending_count', (select count(*) from public.payments where event_id = p_event and status = 'claimed'),
    'online_pending_paise', coalesce((select sum(amount_paise) from public.payments where event_id = p_event and status = 'claimed'), 0),
    'online_rejected_count', (select count(*) from public.payments where event_id = p_event and status in ('rejected','failed')),
    'online_unpaid_count', (select count(*) from public.contributions where event_id = p_event and type = 'online' and status = 'pending'),
    'lifafa_count', (select count(*) from public.contributions where event_id = p_event and type = 'lifafa'),
    'lifafa_received', (select count(*) from public.contributions where event_id = p_event and type = 'lifafa' and status = 'received'),
    'lifafa_declared_paise', coalesce((select sum(declared_amount_paise) from public.contributions where event_id = p_event and type = 'lifafa'), 0),
    'lifafa_counted_paise', coalesce((select sum(counted_amount_paise) from public.contributions where event_id = p_event and type = 'lifafa'), 0),
    'lifafa_mismatch', (select count(*) from public.contributions where event_id = p_event and type = 'lifafa'
                         and declared_amount_paise is not null and counted_amount_paise is not null
                         and declared_amount_paise <> counted_amount_paise),
    'gift_count', (select count(*) from public.contributions where event_id = p_event and type = 'gift'),
    'gift_received', (select count(*) from public.contributions where event_id = p_event and type = 'gift' and status = 'received'),
    'by_side', (select coalesce(jsonb_object_agg(side, n), '{}'::jsonb) from
                 (select g.side, count(*) n from public.guests g where g.event_id = p_event group by g.side) s),
    'by_relation', (select coalesce(jsonb_agg(jsonb_build_object('relation', relation, 'guests', n, 'online_paise', paise) order by n desc), '[]'::jsonb) from
                 (select g.relation, count(distinct g.id) n,
                         coalesce(sum(p.amount_paise) filter (where p.status in ('verified','success')), 0) paise
                    from public.guests g
                    left join public.contributions c on c.guest_id = g.id
                    left join public.payments p on p.contribution_id = c.id
                   where g.event_id = p_event group by g.relation) rel)
  ) into r;
  return r;
end $$;

create or replace function public.log_action(p_event uuid, p_action text, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_event_role(p_event, array['family_admin','viewer','counter_staff']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_action not in ('export_csv', 'view_photo', 'print_qr') then raise exception 'unknown_action'; end if;
  perform private.audit(p_event, p_action, null, null, p_detail);
end $$;

create or replace function public.remove_member(p_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.user_roles%rowtype;
begin
  select * into r from public.user_roles where id = p_role_id;
  if not found then return; end if;
  if not (public.is_platform_admin()
          or (r.role <> 'family_admin' and public.has_event_role(r.event_id, array['family_admin']::public.app_role[]))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.user_roles where id = p_role_id;
  perform private.audit(r.event_id, 'member_remove', 'user_roles', p_role_id::text, jsonb_build_object('role', r.role));
end $$;

-- Platform overview: counts only, no family data
-- Counter staff / admin records a photo they uploaded to <event_id>/<contribution_id>/...
create or replace function public.attach_counter_photo(p_contribution uuid, p_path text, p_kind public.media_kind)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.contributions where id = p_contribution;
  if v_event is null or not public.has_event_role(v_event, array['family_admin','counter_staff']::public.app_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_kind not in ('counter_photo', 'lifafa_open') then raise exception 'bad_kind'; end if;
  if split_part(p_path, '/', 1) <> v_event::text or split_part(p_path, '/', 2) <> p_contribution::text then
    raise exception 'bad_path';
  end if;
  insert into public.media (event_id, contribution_id, kind, storage_path, uploaded_by)
  values (v_event, p_contribution, p_kind, p_path, auth.uid());
end $$;

create or replace function public.platform_overview()
returns table (id uuid, code text, bride_name text, groom_name text, event_date date, status public.event_status,
               guests bigint, entries bigint, pending_utr bigint, members bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
    select e.id, e.code, e.bride_name, e.groom_name, e.event_date, e.status,
           (select count(*) from public.guests g where g.event_id = e.id),
           (select count(*) from public.contributions c where c.event_id = e.id),
           (select count(*) from public.payments p where p.event_id = e.id and p.status = 'claimed'),
           (select count(*) from public.user_roles u where u.event_id = e.id)
      from public.events e order by e.event_date desc;
end $$;

-- Data retention: run daily with pg_cron
--   select cron.schedule('shagun-purge', '30 20 * * *', 'select public.purge_expired_events()');
create or replace function public.purge_expired_events()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from storage.objects o
   using public.events e
   where o.bucket_id = 'shagun-media' and (storage.foldername(o.name))[1] = e.id::text
     and e.delete_after < current_date;
  delete from public.events where delete_after < current_date;
  get diagnostics n = row_count;
  delete from public.rate_events where created_at < now() - interval '2 days';
  delete from public.otp_challenges where created_at < now() - interval '2 days';
  insert into public.audit_logs (action, detail) values ('purge', jsonb_build_object('events_deleted', n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function public.public_event(text) to anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_event_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.create_event(text, text, text, date, text, date) to authenticated;
grant execute on function public.update_event_settings(uuid, public.event_status, public.otp_mode, boolean, text, text, text, text) to authenticated;
grant execute on function public.set_payment_settings(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.reveal_guest_mobile(uuid) to authenticated;
grant execute on function public.admin_list_payments(uuid) to authenticated;
grant execute on function public.admin_verify_payment(uuid, boolean, text) to authenticated;
grant execute on function public.counter_lookup(uuid, text) to authenticated;
grant execute on function public.counter_mark_received(uuid) to authenticated;
grant execute on function public.admin_undo_received(uuid) to authenticated;
grant execute on function public.admin_set_counted_amount(uuid, bigint) to authenticated;
grant execute on function public.event_summary(uuid) to authenticated;
grant execute on function public.log_action(uuid, text, jsonb) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.platform_overview() to authenticated;
grant execute on function public.attach_counter_photo(uuid, text, public.media_kind) to authenticated;

grant execute on function public.svc_mobile_hash(text) to service_role;
grant execute on function public.svc_event_by_code(text) to service_role;
grant execute on function public.svc_event_payee(uuid) to service_role;
grant execute on function public.svc_submit_entry(uuid, text, text, public.guest_side, text, text, text, int, text, boolean, uuid, text, jsonb) to service_role;
grant execute on function public.svc_attach_media(uuid, uuid, public.media_kind, text, uuid) to service_role;
grant execute on function public.svc_claim_utr(uuid, text, bigint, text, text) to service_role;
grant execute on function public.svc_rate_hit(text, uuid, text, text, int) to service_role;
grant execute on function public.svc_mobile_seen(uuid, text) to service_role;
grant execute on function public.svc_can_invite(uuid, uuid, public.app_role) to service_role;
grant execute on function public.purge_expired_events() to service_role;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- New functions must be granted explicitly
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for photos, path = <event_id>/<contribution_id>/<kind>-<uuid>.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shagun-media', 'shagun-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "event members read photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'shagun-media'
    and public.has_event_role(private.try_uuid((storage.foldername(name))[1]),
                              array['family_admin','viewer','counter_staff']::public.app_role[])
  );

create policy "counter and admin upload photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'shagun-media'
    and public.has_event_role(private.try_uuid((storage.foldername(name))[1]),
                              array['family_admin','counter_staff']::public.app_role[])
  );

grant usage on schema private to authenticated;
grant execute on function private.try_uuid(text) to authenticated;
