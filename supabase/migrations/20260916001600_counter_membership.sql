-- Memberships paid for at the counter (D61), and an optional reason on complimentary members (D62).
--
-- A counter membership is venue-managed: money is taken at the till in cash or on the card terminal,
-- it runs for a whole number of months and then simply expires. There is no Stripe subscription, so
-- nothing renews itself and nothing can fail to renew.

-- ── Complimentary members no longer need a reason (D62) ─────────────────────
create or replace function public.admin_create_member(p_staff uuid, p_member jsonb, p_reason text)
returns public.members
language plpgsql
set search_path = ''
as $$
declare
  v_customer uuid;
  v public.members;
begin
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
    nullif(trim(p_reason), '')
  );
  return v;
end;
$$;

-- ── Free minutes can now come from a till payment, not only a Stripe invoice ─
alter table public.member_balance_ledger
  add column payment_id uuid references public.payments (id) on delete restrict;
comment on column public.member_balance_ledger.payment_id is 'Till payment a counter membership grant came from';

-- One grant per payment, the same guarantee stripe_invoice_id gives online.
create unique index ledger_once_per_payment on public.member_balance_ledger (payment_id) where payment_id is not null;

alter table public.member_balance_ledger drop constraint ledger_grant_has_invoice;
alter table public.member_balance_ledger add constraint ledger_grant_has_source
  check (kind <> 'grant' or stripe_invoice_id is not null or payment_id is not null);

-- ── Selling a membership at the counter ─────────────────────────────────────
/*
 One transaction: customer, membership period, payment, cash movement, free minutes, audit.

 p: { customerId?, name, email, phone, tierId, months, method ('cash'|'card_terminal'),
      amountCents, externalRef?, qrTokenHash?, now? }

 The amount is recomputed here from the tier price and the months; the till only proposes it.
*/
create or replace function public.pos_sell_membership(p_staff uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_months int := (p ->> 'months')::int;
  v_method text := p ->> 'method';
  v_tier public.membership_tiers;
  v_shift uuid;
  v_customer public.customers;
  v_member public.members;
  v_payment public.payments;
  v_expected int;
  v_gst int;
  v_balance int;
  v_grant int;
  v_new_member boolean := false;
  v_from timestamptz;
begin
  if v_months is null or v_months not in (1, 3, 6, 9, 12) then
    perform private.fail('invalid', 'Choose 1, 3, 6, 9 or 12 months');
  end if;
  if v_method is null or v_method not in ('cash', 'card_terminal') then
    perform private.fail('invalid', 'Pay by cash or card at the counter');
  end if;

  select * into v_tier from public.membership_tiers where id = (p ->> 'tierId')::uuid and active;
  if v_tier.id is null then
    perform private.fail('invalid', 'Choose an active tier');
  end if;

  select id into v_shift from public.shifts where closed_at is null for share;
  if v_shift is null then
    perform private.fail('no_shift', 'Open the till before selling a membership');
  end if;

  v_expected := v_tier.monthly_price_cents * v_months;
  if coalesce((p ->> 'amountCents')::int, -1) <> v_expected then
    perform private.fail('amount_mismatch', format('This membership costs %s cents', v_expected));
  end if;
  v_gst := round(v_expected::numeric / 11);

  -- ── Customer: the one given, else matched on email or phone, else new ─────
  if nullif(p ->> 'customerId', '') is not null then
    select * into v_customer from public.customers where id = (p ->> 'customerId')::uuid;
    if v_customer.id is null then
      perform private.fail('not_found', 'That customer no longer exists');
    end if;
  else
    if coalesce(length(trim(p ->> 'name')), 0) = 0 then
      perform private.fail('invalid', 'Name is required');
    end if;
    if nullif(trim(p ->> 'email'), '') is null and nullif(trim(p ->> 'phone'), '') is null then
      perform private.fail('invalid', 'An email or phone number is required');
    end if;
    if nullif(trim(p ->> 'email'), '') is not null then
      select * into v_customer from public.customers where email = trim(p ->> 'email')::extensions.citext order by created_at limit 1;
    end if;
    if v_customer.id is null and nullif(trim(p ->> 'phone'), '') is not null then
      select * into v_customer from public.customers where phone = trim(p ->> 'phone') order by created_at limit 1;
    end if;
    if v_customer.id is null then
      insert into public.customers (name, email, phone)
      values (trim(p ->> 'name'), nullif(trim(p ->> 'email'), '')::extensions.citext, nullif(trim(p ->> 'phone'), ''))
      returning * into v_customer;
    end if;
  end if;

  -- ── Membership period ─────────────────────────────────────────────────────
  select * into v_member from public.members where customer_id = v_customer.id for update;
  if v_member.id is not null and v_member.stripe_subscription_id is not null then
    perform private.fail('stripe_billed', 'This membership is billed online; change it there instead');
  end if;

  if v_member.id is null then
    v_new_member := true;
    insert into public.members (customer_id, tier_id, status, qr_token_hash, current_period_end)
    values (v_customer.id, v_tier.id, 'active', nullif(p ->> 'qrTokenHash', ''), v_now + make_interval(months => v_months))
    returning * into v_member;
  else
    -- Renewing early adds to the time left; renewing after it lapsed starts from today.
    v_from := greatest(v_now, coalesce(v_member.current_period_end, v_now));
    update public.members
    set tier_id = v_tier.id,
        status = 'active',
        ended_at = null,
        pending_tier_id = null,
        current_period_end = v_from + make_interval(months => v_months),
        qr_token_hash = coalesce(qr_token_hash, nullif(p ->> 'qrTokenHash', ''))
    where id = v_member.id
    returning * into v_member;
  end if;

  -- ── Money ─────────────────────────────────────────────────────────────────
  insert into public.payments (member_id, method, amount_cents, gst_cents, external_ref, staff_id, shift_id)
  values (v_member.id, v_method, v_expected, v_gst, nullif(trim(p ->> 'externalRef'), ''), p_staff, v_shift)
  returning * into v_payment;

  if v_method = 'cash' then
    insert into public.cash_movements (shift_id, kind, amount_cents, payment_id, staff_id)
    values (v_shift, 'sale', v_expected, v_payment.id, p_staff);
  end if;

  -- ── Free play for the months paid for, up to the tier's cap ───────────────
  select coalesce(balance_minutes, 0) into v_balance from public.member_balances where member_id = v_member.id;
  v_grant := greatest(0, least(v_tier.monthly_free_minutes * v_months, v_tier.max_balance_minutes - coalesce(v_balance, 0)));
  if v_grant > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, payment_id, reason)
    values (v_member.id, v_grant, 'grant', v_payment.id, format('%s months paid at the counter', v_months));
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (
    p_staff, 'member.sell_counter', 'members', v_member.id::text,
    jsonb_build_object('member_no', v_member.member_no, 'tier_id', v_tier.id, 'months', v_months,
                       'amount_cents', v_expected, 'method', v_method, 'payment_id', v_payment.id,
                       'current_period_end', v_member.current_period_end, 'minutes_granted', v_grant,
                       'new_member', v_new_member)
  );

  return jsonb_build_object(
    'memberId', v_member.id, 'memberNo', v_member.member_no, 'customerId', v_customer.id,
    'newMember', v_new_member, 'currentPeriodEnd', v_member.current_period_end,
    'amountCents', v_expected, 'gstCents', v_gst, 'minutesGranted', v_grant, 'paymentId', v_payment.id
  );
end;
$$;

-- ── Expiry: a counter membership simply runs out ────────────────────────────
/*
 Venue-managed memberships (no Stripe subscription) end when their period is over. Online ones are
 left alone: Stripe tells us when those end. Runs daily; the counter also treats a membership whose
 period has passed as inactive straight away.
*/
create or replace function public.membership_expire_venue(p_now timestamptz default now())
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    update public.members
    set status = 'ended', ended_at = current_period_end
    where stripe_subscription_id is null
      and status in ('active', 'cancelling')
      and current_period_end is not null
      and current_period_end <= p_now
    returning id, member_no, current_period_end
  loop
    insert into public.audit_log (action, entity, entity_id, after)
    values ('member.expired', 'members', r.id::text,
            jsonb_build_object('member_no', r.member_no, 'ended_at', r.current_period_end));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.pos_sell_membership(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pos_sell_membership(uuid, jsonb) to service_role;
revoke execute on function public.membership_expire_venue(timestamptz) from public, anon, authenticated;
grant execute on function public.membership_expire_venue(timestamptz) to service_role;
