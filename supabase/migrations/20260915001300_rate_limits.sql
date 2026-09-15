-- Rate limiting for public endpoints (spec/architecture.md §3.9). Kept in Postgres so every API
-- instance (Vercel runs many) shares the same counters. Fixed windows: simple and good enough to stop
-- guessing referral codes, booking links and hold spam.

create table public.rate_limits (
  key text primary key check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits int not null check (hits >= 0)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;
comment on table public.rate_limits is 'Fixed-window request counters; rows are overwritten, not accumulated';
create index rate_limits_window_idx on public.rate_limits (window_start);

/*
 Counts one request for p_key. Returns allowed (false once the limit is passed in this window),
 the hits so far and when the window resets. Atomic under concurrency (single upsert).
*/
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int, p_now timestamptz default now())
returns table (allowed boolean, hits int, reset_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    perform private.fail('invalid', 'Rate limit and window must be positive');
  end if;
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key) do update
    set hits = case when r.window_start = excluded.window_start then r.hits + 1 else 1 end,
        window_start = excluded.window_start
  returning r.hits into v_hits;
  -- Housekeeping: old windows are useless; clear a few at a time.
  delete from public.rate_limits
  where ctid in (select ctid from public.rate_limits where window_start < p_now - interval '1 day' limit 100);
  return query select v_hits <= p_limit, v_hits, v_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke execute on function public.rate_limit_hit(text, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int, timestamptz) to service_role;
