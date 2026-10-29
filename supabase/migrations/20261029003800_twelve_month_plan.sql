-- D114: a 12-month plan paid monthly through Stripe. Twelve payments, then it stops; the member
-- can't cancel it themselves. Stripe ends it (the subscription's cancel_at), so here we only need
-- to know the date, and not to mistake that planned end for a cancellation.

alter table public.members add column term_ends_at timestamptz;
comment on column public.members.term_ends_at is
  'A fixed-term Stripe plan (D114) ends here after its last payment; null = rolling monthly until cancelled';

/*
 A Stripe subscription's current state. p: subscriptionId, stripeStatus, cancelAtPeriodEnd, cancelAt,
 periodEnd, termEndsAt. A cancel_at that is just the plan's own end (termEndsAt) is not a cancellation.
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
  v_term_end timestamptz := (p ->> 'termEndsAt')::timestamptz;
  v_cancelling boolean := coalesce((p ->> 'cancelAtPeriodEnd')::boolean, false)
    or ((p ->> 'cancelAt') is not null and (p ->> 'cancelAt')::timestamptz is distinct from v_term_end);
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
    term_ends_at = v_term_end,
    ended_at = case when v_status = 'ended' then coalesce(ended_at, now()) else null end
  where id = p_member;

  perform private.member_status_audit(p_member, m.status, v_status, 'stripe.subscription');
  return v_status;
end;
$$;
