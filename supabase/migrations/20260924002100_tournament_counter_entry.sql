-- Adding someone to a tournament at the counter (D75).
--
-- Staff choose either:
--   paid   — cash or the card terminal, recorded on the open shift and in the day's takings,
--            exactly the way a membership sold at the counter is (D61); or
--   free   — entered with nothing taken, for a comp or an arrangement made another way.
--
-- One transaction, like every other money path: the spot is checked and taken, the money is
-- recorded, and the whole thing is audited together or not at all.

create or replace function public.tournament_counter_entry(p_staff uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_method text := nullif(p ->> 'method', '');
  v_amount int := coalesce((p ->> 'amountCents')::int, 0);
  t public.tournaments;
  v_customer public.customers;
  v_member public.members;
  v_shift uuid;
  v_gst int;
  v_payment public.payments;
  v_entry public.tournament_entries;
begin
  -- `free` means nothing is taken; anything else has to be money the till can hold.
  if v_method is null or v_method not in ('cash', 'card_terminal', 'free') then
    perform private.fail('invalid', 'Choose cash, card or no charge');
  end if;
  if v_method = 'free' and v_amount <> 0 then
    perform private.fail('invalid', 'An entry with no charge is $0.00');
  end if;
  if v_method <> 'free' and v_amount <= 0 then
    perform private.fail('invalid', 'Enter the amount taken, or choose no charge');
  end if;

  perform public.expire_stale_tournament_holds(v_now);

  select * into t from public.tournaments where id = (p ->> 'tournamentId')::uuid for update;
  if t.id is null then
    perform private.fail('not_found', 'Tournament not found');
  end if;
  if t.starts_at <= v_now then
    perform private.fail('tournament_started', 'That tournament has already started');
  end if;

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

  -- Recorded against their membership when they have a live one, so it shows in their history.
  select * into v_member from public.members where customer_id = v_customer.id and status in ('active', 'cancelling');

  if v_method <> 'free' then
    select id into v_shift from public.shifts where closed_at is null for share;
    if v_shift is null then
      perform private.fail('no_shift', 'Open the till before taking an entry fee');
    end if;
  end if;

  if public.tournament_spots_left(t.id, v_now) <= 0 then
    perform private.fail('tournament_full', 'That tournament is full');
  end if;

  v_gst := private.gst_of(v_amount);

  begin
    insert into public.tournament_entries (
      tournament_id, customer_id, member_id, status, free_entry,
      pricing_snapshot, total_cents, gst_cents, cancel_token_hash
    ) values (
      t.id, v_customer.id, v_member.id, 'confirmed',
      -- `free_entry` means a membership covered it. An entry comped at the counter is not that,
      -- so it stays false and the $0 payment row is what records the decision.
      false,
      jsonb_build_object('source', 'counter', 'method', v_method, 'staffId', p_staff),
      v_amount, v_gst, nullif(p ->> 'cancelTokenHash', '')
    ) returning * into v_entry;
  exception when unique_violation then
    perform private.fail('already_entered', 'That person is already signed up for this tournament');
  end;

  insert into public.payments (tournament_entry_id, method, amount_cents, gst_cents, external_ref, staff_id, shift_id)
  values (v_entry.id, v_method, v_amount, v_gst, nullif(trim(p ->> 'externalRef'), ''), p_staff, v_shift)
  returning * into v_payment;

  if v_method = 'cash' then
    insert into public.cash_movements (shift_id, kind, amount_cents, payment_id, staff_id)
    values (v_shift, 'sale', v_amount, v_payment.id, p_staff);
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after, reason)
  values (
    p_staff, 'tournament.counter_entry', 'tournament_entries', v_entry.id::text,
    jsonb_build_object('ref', v_entry.ref, 'tournament_id', t.id, 'customer_id', v_customer.id,
                       'member_id', v_member.id, 'method', v_method, 'amount_cents', v_amount,
                       'payment_id', v_payment.id),
    nullif(trim(p ->> 'reason'), '')
  );

  return jsonb_build_object(
    'entryId', v_entry.id,
    'ref', v_entry.ref,
    'customerId', v_customer.id,
    'customerName', v_customer.name,
    'newCustomer', v_customer.created_at >= v_now - interval '1 minute',
    'method', v_method,
    'amountCents', v_amount,
    'gstCents', v_gst,
    'paymentId', v_payment.id,
    'receiptNo', v_payment.receipt_no,
    'spotsLeft', public.tournament_spots_left(t.id, v_now)
  );
end;
$$;

revoke execute on function public.tournament_counter_entry(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_counter_entry(uuid, jsonb) to service_role;
