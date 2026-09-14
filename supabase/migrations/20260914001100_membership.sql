-- Membership billing lifecycle (spec/membership.md). Stripe is the source of truth for the
-- subscription; these functions apply what Stripe reports, each in one transaction, and are
-- idempotent so a webhook delivered twice (or out of order) has exactly one effect.

-- ── Starting a membership at the counter or online ──────────────────────────
/*
 Returns the member to attach to a Stripe Checkout session.
 - New customer (by email) → customer + member in `pending`.
 - Existing member that is pending or ended → reused with the chosen tier. An ended member keeps
   status `ended` (and its forfeit clock) until the first payment succeeds; the balance is intact
   if they re-join before it is forfeited.
 - An active, cancelling or past-due member cannot start another membership.
*/
create or replace function public.membership_checkout_prepare(p_staff uuid, p_name text, p_email text, p_phone text, p_tier uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_member public.members;
begin
  if coalesce(length(trim(p_name)), 0) = 0 then
    perform private.fail('invalid', 'Name is required');
  end if;
  if coalesce(length(trim(p_email)), 0) = 0 then
    perform private.fail('invalid', 'An email is required for a membership');
  end if;
  if not exists (select 1 from public.membership_tiers where id = p_tier and active and stripe_price_id is not null) then
    perform private.fail('tier_unavailable', 'That tier is not available for sale');
  end if;

  -- search_path is empty, so citext's case-insensitive '=' isn't visible here; compare lower-cased text explicitly.
  select * into v_customer from public.customers where lower(email::text) = lower(trim(p_email)) order by created_at limit 1 for update;
  if v_customer.id is null then
    insert into public.customers (name, email, phone)
    values (trim(p_name), trim(p_email), nullif(trim(p_phone), ''))
    returning * into v_customer;
  end if;

  select * into v_member from public.members where customer_id = v_customer.id for update;
  if v_member.id is not null and v_member.status in ('active', 'cancelling', 'past_due') then
    perform private.fail('already_member', 'This customer already has a membership');
  end if;

  if v_member.id is null then
    insert into public.members (customer_id, tier_id, status) values (v_customer.id, p_tier, 'pending') returning * into v_member;
  else
    update public.members set tier_id = p_tier, pending_tier_id = null where id = v_member.id returning * into v_member;
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'member.checkout_started', 'members', v_member.id::text, jsonb_build_object('tier_id', p_tier, 'customer_id', v_customer.id));

  return jsonb_build_object(
    'memberId', v_member.id,
    'memberNo', v_member.member_no,
    'customerId', v_customer.id,
    'stripeCustomerId', v_customer.stripe_customer_id,
    'status', v_member.status
  );
end;
$$;

create or replace function public.membership_set_stripe_customer(p_customer uuid, p_stripe_customer_id text)
returns void
language sql
set search_path = ''
as $$
  update public.customers set stripe_customer_id = p_stripe_customer_id where id = p_customer and stripe_customer_id is distinct from p_stripe_customer_id;
$$;

-- ── Applying Stripe state ───────────────────────────────────────────────────
create or replace function private.member_status_audit(p_member uuid, p_before text, p_after text, p_source text)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_log (action, entity, entity_id, before, after)
  select 'member.status_change', 'members', p_member::text, jsonb_build_object('status', p_before), jsonb_build_object('status', p_after, 'source', p_source)
  where p_before is distinct from p_after;
$$;

/*
 Sync from a Stripe subscription object (always re-read from Stripe by the API, so event order
 doesn't matter). p: subscriptionId, stripeStatus, cancelAtPeriodEnd, cancelAt (unix|null), periodEnd (timestamptz)
 A subscription that isn't the member's current one is ignored (e.g. an old one after re-joining).
*/
create or replace function public.membership_sync_subscription(p_member uuid, p jsonb)
returns text
language plpgsql
set search_path = ''
as $$
declare
  m public.members;
  v_status text;
  v_sub text := p ->> 'subscriptionId';
  v_stripe text := p ->> 'stripeStatus';
  v_cancelling boolean := coalesce((p ->> 'cancelAtPeriodEnd')::boolean, false) or (p ->> 'cancelAt') is not null;
begin
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    perform private.fail('not_found', 'Member not found');
  end if;
  if m.stripe_subscription_id is not null and m.stripe_subscription_id <> v_sub then
    if m.status <> 'ended' then
      return m.status; -- an older subscription; the current one wins
    end if;
  end if;

  v_status := case
    when v_stripe in ('canceled', 'incomplete_expired') then 'ended'
    when v_stripe in ('past_due', 'unpaid', 'paused') then 'past_due'
    when v_stripe in ('active', 'trialing') then case when v_cancelling then 'cancelling' else 'active' end
    else m.status -- incomplete: wait for the first invoice
  end;

  -- Only the member's current subscription may end or reactivate it.
  if v_status = 'ended' and m.stripe_subscription_id is distinct from v_sub then
    return m.status;
  end if;

  update public.members set
    status = v_status,
    stripe_subscription_id = v_sub,
    current_period_end = coalesce((p ->> 'periodEnd')::timestamptz, current_period_end),
    ended_at = case when v_status = 'ended' then coalesce(ended_at, now()) else null end
  where id = p_member;

  perform private.member_status_audit(p_member, m.status, v_status, 'stripe.subscription');
  return v_status;
end;
$$;

/*
 A paid subscription invoice. p: invoiceId, subscriptionId, amountPaidCents, periodEnd
 Applies a pending tier change first, then activates, records the payment and grants the
 month's free-play minutes (never above the tier's balance cap). Idempotent per invoice.
*/
create or replace function public.membership_apply_invoice(p_member uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m public.members;
  t public.membership_tiers;
  v_invoice text := p ->> 'invoiceId';
  v_amount int := coalesce((p ->> 'amountPaidCents')::int, 0);
  v_balance int;
  v_grant int := 0;
  v_status text;
  v_payment uuid;
begin
  if v_invoice is null then
    perform private.fail('invalid', 'Invoice id is required');
  end if;
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    perform private.fail('not_found', 'Member not found');
  end if;
  if exists (select 1 from public.payments where method = 'stripe' and external_ref = v_invoice) then
    return jsonb_build_object('applied', false, 'reason', 'duplicate');
  end if;

  update public.members set
    tier_id = coalesce(pending_tier_id, tier_id),
    pending_tier_id = null,
    status = case when m.status = 'cancelling' then 'cancelling' else 'active' end,
    ended_at = null,
    stripe_subscription_id = coalesce(p ->> 'subscriptionId', stripe_subscription_id),
    current_period_end = coalesce((p ->> 'periodEnd')::timestamptz, current_period_end)
  where id = p_member
  returning status into v_status;

  select t2.* into t from public.membership_tiers t2 join public.members m2 on m2.tier_id = t2.id where m2.id = p_member;

  insert into public.payments (member_id, method, amount_cents, gst_cents, external_ref)
  values (p_member, 'stripe', v_amount, private.gst_of(v_amount), v_invoice)
  returning id into v_payment;

  select coalesce(sum(delta_minutes), 0) into v_balance from public.member_balance_ledger where member_id = p_member;
  v_grant := greatest(0, least(t.monthly_free_minutes, t.max_balance_minutes - v_balance));
  if v_grant > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id, reason)
    values (p_member, v_grant, 'grant', v_invoice, 'Monthly free play');
  end if;

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('member.invoice_paid', 'members', p_member::text,
          jsonb_build_object('status', m.status, 'tier_id', m.tier_id, 'balance_minutes', v_balance),
          jsonb_build_object('status', v_status, 'tier_id', t.id, 'granted_minutes', v_grant, 'balance_minutes', v_balance + v_grant,
                             'invoice', v_invoice, 'amount_cents', v_amount, 'payment_id', v_payment));

  return jsonb_build_object('applied', true, 'grantedMinutes', v_grant, 'balanceMinutes', v_balance + v_grant, 'status', v_status, 'tierId', t.id);
end;
$$;

-- A failed renewal cuts benefits off immediately (D28). Stripe keeps retrying; a later invoice.paid reinstates.
create or replace function public.membership_payment_failed(p_member uuid, p_subscription_id text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  m public.members;
begin
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    perform private.fail('not_found', 'Member not found');
  end if;
  if m.stripe_subscription_id is distinct from p_subscription_id or m.status not in ('active', 'cancelling') then
    return m.status;
  end if;
  update public.members set status = 'past_due' where id = p_member;
  perform private.member_status_audit(p_member, m.status, 'past_due', 'stripe.invoice.payment_failed');
  return 'past_due';
end;
$$;

-- ── Tier changes ────────────────────────────────────────────────────────────
/*
 Paid members: the new tier takes effect at the next renewal (pending_tier_id, D41).
 Complimentary members (no subscription): immediately.
*/
create or replace function public.membership_change_tier(p_member uuid, p_staff uuid, p_tier uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m public.members;
  v_mode text;
begin
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    perform private.fail('not_found', 'Member not found');
  end if;
  if not exists (select 1 from public.membership_tiers where id = p_tier and active) then
    perform private.fail('tier_unavailable', 'Choose an active tier');
  end if;
  if m.status = 'ended' then
    perform private.fail('member_inactive', 'This membership has ended');
  end if;

  if m.stripe_subscription_id is null then
    if p_tier = m.tier_id then
      perform private.fail('invalid', 'Already on that tier');
    end if;
    update public.members set tier_id = p_tier, pending_tier_id = null where id = p_member;
    v_mode := 'immediate';
  else
    update public.members set pending_tier_id = case when p_tier = m.tier_id then null else p_tier end where id = p_member;
    v_mode := case when p_tier = m.tier_id then 'cleared' else 'next_renewal' end;
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, before, after, reason)
  values (p_staff, 'member.tier_change', 'members', p_member::text,
          jsonb_build_object('tier_id', m.tier_id, 'pending_tier_id', m.pending_tier_id),
          jsonb_build_object('tier_id', case when v_mode = 'immediate' then p_tier else m.tier_id end,
                             'pending_tier_id', case when v_mode = 'next_renewal' then p_tier end, 'mode', v_mode),
          nullif(trim(p_reason), ''));
  return jsonb_build_object('mode', v_mode);
end;
$$;

-- ── First card at the counter ───────────────────────────────────────────────
-- The cashier can print the first card for a member who has none. Replacing a card is a back office action.
create or replace function public.membership_issue_first_card(p_member uuid, p_staff uuid, p_token_hash text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.members;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform private.fail('invalid', 'Invalid card token');
  end if;
  select * into m from public.members where id = p_member for update;
  if m.id is null then
    perform private.fail('not_found', 'Member not found');
  end if;
  if m.status not in ('active', 'cancelling') then
    perform private.fail('member_inactive', 'The membership is not active yet');
  end if;
  if m.qr_token_hash is not null then
    perform private.fail('card_exists', 'This member already has a card; reissue it in the back office');
  end if;
  update public.members set qr_token_hash = p_token_hash where id = p_member;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id) values (p_staff, 'member.card_issued', 'members', p_member::text);
end;
$$;

-- ── Forfeit (daily job) ─────────────────────────────────────────────────────
-- Balances of memberships that ended more than balance_forfeit_days ago are forfeited (D37).
create or replace function public.membership_forfeit_balances(p_now timestamptz default now())
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_days int := (private.settings()).balance_forfeit_days;
  r record;
  v_count int := 0;
begin
  for r in
    select m.id, b.balance_minutes
    from public.members m
    join public.member_balances b on b.member_id = m.id
    where m.status = 'ended' and m.ended_at < p_now - make_interval(days => v_days) and b.balance_minutes > 0
    for update of m
  loop
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, reason)
    values (r.id, -r.balance_minutes, 'forfeit', format('Membership ended over %s days ago', v_days));
    insert into public.audit_log (action, entity, entity_id, before, after)
    values ('member.balance_forfeit', 'members', r.id::text, jsonb_build_object('balance_minutes', r.balance_minutes), jsonb_build_object('balance_minutes', 0));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke execute on function
  public.membership_checkout_prepare(uuid, text, text, text, uuid),
  public.membership_set_stripe_customer(uuid, text),
  public.membership_sync_subscription(uuid, jsonb),
  public.membership_apply_invoice(uuid, jsonb),
  public.membership_payment_failed(uuid, text),
  public.membership_change_tier(uuid, uuid, uuid, text),
  public.membership_issue_first_card(uuid, uuid, text),
  public.membership_forfeit_balances(timestamptz)
from public, anon, authenticated;

grant execute on function
  public.membership_checkout_prepare(uuid, text, text, text, uuid),
  public.membership_set_stripe_customer(uuid, text),
  public.membership_sync_subscription(uuid, jsonb),
  public.membership_apply_invoice(uuid, jsonb),
  public.membership_payment_failed(uuid, text),
  public.membership_change_tier(uuid, uuid, uuid, text),
  public.membership_issue_first_card(uuid, uuid, text),
  public.membership_forfeit_balances(timestamptz)
to service_role;
