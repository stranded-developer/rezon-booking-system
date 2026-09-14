-- Raceground — foundation: extensions, private helper schema, shared trigger functions.
-- Conventions (spec/data-model.md): money = integer cents, percentages = integer basis points,
-- instants = timestamptz (UTC), wall-clock times = time (venue local).

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helpers that must not be exposed through the PostgREST API live in `private`.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prevent_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Unambiguous alphabet shared by booking refs and referral codes (no 0/O, 1/I/L).
create or replace function private.random_code(len int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31 characters
  result text := '';
  b int;
begin
  while length(result) < len loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    -- Reject 248..255 so every character is equally likely (248 = 8 × 31).
    if b < 248 then
      result := result || substr(alphabet, (b % 31) + 1, 1);
    end if;
  end loop;
  return result;
end;
$$;

grant execute on function private.random_code(int) to service_role;
