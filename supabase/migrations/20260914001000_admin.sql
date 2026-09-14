-- Back office (spec/back-office.md).
--
-- 1. Automatic audit of configuration changes. The API sets two request headers on every admin
--    write: x-rg-actor (operator staff id) and x-rg-reason-b64 (optional UTF-8 reason, base64).
--    PostgREST exposes them as request.headers, and an AFTER trigger writes the audit row in the
--    same transaction as the change, so a config change can never be saved without its audit.
--    Writes that don't come through the API (migrations, seed, psql) have no request.headers and
--    are not audited.
-- 2. Member administration and partial refunds as single-transaction functions.

-- ── Audit context from request headers ──────────────────────────────────────
create or replace function private.request_header(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.headers', true), '')::json ->> p_name;
$$;

create or replace function private.audit_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := private.request_header('x-rg-actor');
begin
  if v is null then
    return null;
  end if;
  return v::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.audit_reason()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := private.request_header('x-rg-reason-b64');
begin
  if v is null or v = '' then
    return null;
  end if;
  return convert_from(decode(v, 'base64'), 'UTF8');
exception when others then
  return null;
end;
$$;

create or replace function private.audit_config_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_ignore text[] := array['updated_at'];
begin
  if current_setting('request.headers', true) is null or current_setting('request.headers', true) = '' then
    return null;
  end if;
  -- POS closes bump referral_codes.uses_count; that is recorded by the close itself.
  if tg_table_name = 'referral_codes' then
    v_ignore := array_append(v_ignore, 'uses_count');
  end if;
  if tg_op = 'UPDATE' and (v_before - v_ignore) = (v_after - v_ignore) then
    return null;
  end if;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, before, after, reason)
  values (
    private.audit_actor(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'day_of_week', v_before ->> 'day_of_week'),
    v_before,
    v_after,
    private.audit_reason()
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'venue_settings', 'opening_hours', 'resource_types', 'resources', 'rate_bands', 'happy_hours',
    'membership_tiers', 'tier_prices', 'referral_codes'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_config_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- ── Members ─────────────────────────────────────────────────────────────────
/*
 Complimentary / manual membership (no billing). p_member:
   name, email, phone, tierId, validUntil (optional timestamptz), qrTokenHash (sha256 hex)
*/
create or replace function public.admin_create_member(p_staff uuid, p_member jsonb, p_reason text)
returns public.members
language plpgsql
set search_path = ''
as $$
declare
  v_customer uuid;
  v public.members;
begin
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.fail('invalid', 'A reason is required for a complimentary membership');
  end if;
  if coalesce(length(trim(p_member ->> 'name')), 0) = 0 then
    perform private.fail('invalid', 'Name is required');
  end if;
  if nullif(trim(p_member ->> 'email'), '') is null and nullif(trim(p_member ->> 'phone'), '') is null then
    perform private.fail('invalid', 'An email or phone number is required');
  end if;
  if not exists (select 1 from public.membership_tiers where id = (p_member ->> 'tierId')::uuid and active) then
    perform private.fail('invalid', 'Choose an active tier');
  end if;

  insert into public.customers (name, email, phone)
  values (trim(p_member ->> 'name'), nullif(trim(p_member ->> 'email'), ''), nullif(trim(p_member ->> 'phone'), ''))
  returning id into v_customer;

  insert into public.members (customer_id, tier_id, status, qr_token_hash, current_period_end)
  values (v_customer, (p_member ->> 'tierId')::uuid, 'active', p_member ->> 'qrTokenHash', (p_member ->> 'validUntil')::timestamptz)
  returning * into v;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after, reason)
  values (
    p_staff, 'member.create_complimentary', 'members', v.id::text,
    jsonb_build_object('member_no', v.member_no, 'tier_id', v.tier_id, 'customer_id', v_customer,
                       'name', trim(p_member ->> 'name'), 'current_period_end', v.current_period_end),
    trim(p_reason)
  );
  return v;
end;
$$;

create or replace function public.admin_adjust_balance(p_member uuid, p_staff uuid, p_delta_minutes int, p_reason text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_before int;
  v_after int;
begin
  if p_delta_minutes is null or p_delta_minutes = 0 then
    perform private.fail('invalid', 'Adjustment must add or remove minutes');
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.fail('invalid', 'A reason is required');
  end if;
  if not exists (select 1 from public.members where id = p_member) then
    perform private.fail('not_found', 'Member not found');
  end if;
  select coalesce(sum(delta_minutes), 0) into v_before from public.member_balance_ledger where member_id = p_member;
  insert into public.member_balance_ledger (member_id, delta_minutes, kind, actor_staff_id, reason)
  values (p_member, p_delta_minutes, 'adjust', p_staff, trim(p_reason));
  v_after := v_before + p_delta_minutes;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, before, after, reason)
  values (p_staff, 'member.balance_adjust', 'members', p_member::text,
          jsonb_build_object('balance_minutes', v_before), jsonb_build_object('balance_minutes', v_after, 'delta_minutes', p_delta_minutes),
          trim(p_reason));
  return v_after;
end;
$$;

create or replace function public.admin_reissue_qr(p_member uuid, p_staff uuid, p_token_hash text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform private.fail('invalid', 'Invalid card token');
  end if;
  update public.members set qr_token_hash = p_token_hash where id = p_member;
  if not found then
    perform private.fail('not_found', 'Member not found');
  end if;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, reason)
  values (p_staff, 'member.qr_reissue', 'members', p_member::text, coalesce(nullif(trim(p_reason), ''), 'card reissued'));
end;
$$;

-- ── Tiers ───────────────────────────────────────────────────────────────────
-- Stripe price sync and member notification come with Phase 5; this records the local change.
create or replace function public.admin_set_tier_price(p_tier uuid, p_staff uuid, p_amount_cents int, p_reason text)
returns public.membership_tiers
language plpgsql
set search_path = ''
as $$
declare
  v public.membership_tiers;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    perform private.fail('invalid', 'Price must be $0.00 or more');
  end if;
  select * into v from public.membership_tiers where id = p_tier for update;
  if v.id is null then
    perform private.fail('not_found', 'Tier not found');
  end if;
  if v.monthly_price_cents = p_amount_cents then
    perform private.fail('invalid', 'That is already the price');
  end if;
  update public.membership_tiers set monthly_price_cents = p_amount_cents where id = p_tier returning * into v;
  insert into public.tier_prices (tier_id, amount_cents) values (p_tier, p_amount_cents);
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after, reason)
  values (p_staff, 'tier.price_change', 'membership_tiers', p_tier::text,
          jsonb_build_object('monthly_price_cents', p_amount_cents), nullif(trim(p_reason), ''));
  return v;
end;
$$;

-- ── Partial refunds ─────────────────────────────────────────────────────────
create or replace function public.pos_refund_payment(p_payment uuid, p_staff uuid, p_amount_cents int, p_reason text)
returns public.refunds
language plpgsql
set search_path = ''
as $$
declare
  p public.payments;
  v_refunded int;
  v_shift uuid;
  v public.refunds;
begin
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.fail('invalid', 'A reason is required');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform private.fail('invalid', 'Refund must be more than $0.00');
  end if;
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then
    perform private.fail('not_found', 'Payment not found');
  end if;
  if p.method = 'stripe' then
    perform private.fail('stripe_refund_required', 'Online payments are refunded through Stripe');
  end if;
  if p.method = 'free' then
    perform private.fail('invalid', 'Nothing was paid');
  end if;
  select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds where payment_id = p.id;
  if v_refunded + p_amount_cents > p.amount_cents then
    perform private.fail('refund_exceeds_payment', 'Refund is more than what is left of the payment');
  end if;
  select id into v_shift from public.shifts where closed_at is null for share;
  if v_shift is null then
    perform private.fail('no_open_shift', 'Open a shift before refunding');
  end if;
  insert into public.refunds (payment_id, amount_cents, reason, staff_id, shift_id)
  values (p.id, p_amount_cents, trim(p_reason), p_staff, v_shift)
  returning * into v;
  if p.method = 'cash' then
    insert into public.cash_movements (shift_id, kind, amount_cents, refund_id, staff_id)
    values (v_shift, 'refund', -p_amount_cents, v.id, p_staff);
  end if;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after, reason)
  values (p_staff, 'payment.refund', 'payments', p.id::text,
          jsonb_build_object('refund_cents', p_amount_cents, 'method', p.method, 'refunded_total_cents', v_refunded + p_amount_cents),
          trim(p_reason));
  return v;
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke execute on function
  public.admin_create_member(uuid, jsonb, text),
  public.admin_adjust_balance(uuid, uuid, int, text),
  public.admin_reissue_qr(uuid, uuid, text, text),
  public.admin_set_tier_price(uuid, uuid, int, text),
  public.pos_refund_payment(uuid, uuid, int, text)
from public, anon, authenticated;

grant execute on function
  public.admin_create_member(uuid, jsonb, text),
  public.admin_adjust_balance(uuid, uuid, int, text),
  public.admin_reissue_qr(uuid, uuid, text, text),
  public.admin_set_tier_price(uuid, uuid, int, text),
  public.pos_refund_payment(uuid, uuid, int, text)
to service_role;
