-- Member accounts on the booking site (spec/membership.md §6, spec/booking-site.md).
--
-- 1. A signed-in user (Supabase Auth, email confirmed; the API checks) is linked to the customer record with
--    the same email, so counter-sold members, earlier guest bookings and online sign-ups meet in one account.
-- 2. Member QR tokens are derived by the API from a server secret + member id + qr_version, so the account
--    page can show the current QR again. Only the hash is stored; qr_version moves on whenever the hash changes.

-- ── QR version ──────────────────────────────────────────────────────────────
alter table public.members add column qr_version int not null default 0 check (qr_version >= 0);
comment on column public.members.qr_version is 'Bumped whenever qr_token_hash changes; the API derives the QR token for this version';

create or replace function private.bump_qr_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two identical concurrent reissues write the same hash; the second is not a change and doesn't bump.
  if new.qr_token_hash is distinct from old.qr_token_hash then
    new.qr_version := old.qr_version + 1;
  else
    new.qr_version := old.qr_version;
  end if;
  return new;
end;
$$;

create trigger members_bump_qr_version before update on public.members
  for each row execute function private.bump_qr_version();

-- ── Link a login to a customer ──────────────────────────────────────────────
/*
 Returns the customer id for this auth user, linking or creating the customer on first use.
 - Already linked → that customer.
 - Otherwise the oldest unlinked customer with the same email (any case) is linked.
 - A customer with that email linked to a different login → conflict.
 - No customer → one is created from the sign-up name/phone.
 The caller must have checked the email is confirmed.
*/
create or replace function public.member_link_account(p_auth_user uuid, p_email text, p_name text, p_phone text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_email text := lower(trim(p_email));
begin
  if p_auth_user is null or coalesce(v_email, '') = '' then
    perform private.fail('invalid', 'A confirmed email is required');
  end if;
  if exists (select 1 from public.staff where auth_user_id = p_auth_user) then
    perform private.fail('forbidden', 'Staff logins cannot be used as customer accounts');
  end if;

  select * into v_customer from public.customers where auth_user_id = p_auth_user;
  if v_customer.id is not null then
    return v_customer.id;
  end if;

  select * into v_customer from public.customers
  where lower(email::text) = v_email
  order by (auth_user_id is not null), created_at
  limit 1
  for update;

  if v_customer.id is not null and v_customer.auth_user_id is not null then
    perform private.fail('conflict', 'This email is already linked to another account');
  end if;

  if v_customer.id is null then
    insert into public.customers (auth_user_id, name, email, phone)
    values (p_auth_user, coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), v_email, nullif(trim(p_phone), ''))
    returning * into v_customer;
    insert into public.audit_log (action, entity, entity_id, after)
    values ('customer.account_created', 'customers', v_customer.id::text, jsonb_build_object('auth_user_id', p_auth_user));
  else
    update public.customers set auth_user_id = p_auth_user where id = v_customer.id;
    insert into public.audit_log (action, entity, entity_id, after)
    values ('customer.account_linked', 'customers', v_customer.id::text, jsonb_build_object('auth_user_id', p_auth_user));
  end if;
  return v_customer.id;
end;
$$;

revoke execute on function public.member_link_account(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.member_link_account(uuid, text, text, text) to service_role;
