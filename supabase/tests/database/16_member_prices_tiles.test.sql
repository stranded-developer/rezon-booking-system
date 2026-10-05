-- Member prices (D82), Single/Double Session (D83), the membership poster (D84), arriving early
-- (D85) and the home page tiles (D87).
begin;
select plan(18);

-- ── Single Session and Double Session ───────────────────────────────────────
select results_eq(
  $$ select key, name, tagline from public.experiences where key in ('quick_race', 'double_race') order by sort $$,
  $$ values ('quick_race', 'Single Session', 'Quick Race, Time trial, Drift, and more.'),
            ('double_race', 'Double Session', 'Full Experience, Double Race, Drift, Free Roam, and more') $$,
  'the two sessions carry their new names and what they cover (D83)');

-- ── The poster's member prices ──────────────────────────────────────────────
select results_eq(
  $$ select e.key, t.name::text, p.price_cents
       from public.experience_member_prices p
       join public.experiences e on e.id = p.experience_id
       join public.membership_tiers t on t.id = p.tier_id
      where e.key in ('quick_race', 'double_race', 'leaderboard_challenge')
      order by e.sort, t.sort $$,
  $$ values ('quick_race', 'Silver', 3200), ('quick_race', 'Gold', 2800), ('quick_race', 'Diamond', 2800),
            ('double_race', 'Silver', 5200), ('double_race', 'Gold', 4600), ('double_race', 'Diamond', 4600) $$,
  'member prices are the poster''s: Silver $32 / $52, Gold and Diamond $28 / $46 (D82)');
select is((select count(*)::int from public.experience_member_prices p join public.experiences e on e.id = p.experience_id
            where e.key = 'leaderboard_challenge'), 0,
  'Leaderboard Challenge is not on the poster, so it keeps the tier percentage');
select lives_ok($$ select private.seed_launch_member_prices() $$, 'running the member prices again is harmless');
select is((select count(*)::int from public.experience_member_prices p join public.experiences e on e.id = p.experience_id
            where e.key in ('quick_race', 'double_race')), 6, '...and adds nothing a second time');
select throws_ok(
  $$ insert into public.experience_member_prices (experience_id, tier_id, price_cents)
     select e.id, t.id, 1 from public.experiences e, public.membership_tiers t where e.key = 'quick_race' and t.name = 'Gold' $$,
  '23505', null, 'one price per tier per experience');

-- ── The poster's wording ────────────────────────────────────────────────────
select is((select perks from public.membership_tiers where name = 'Silver'), array['Monday - Friday'], 'Silver''s lines (D84)');
select is((select perks from public.membership_tiers where name = 'Gold'),
  array['Monday - Sunday', 'Free 2 Hours Billiard Tables Every Month', '20% Off for additional food and drinks', 'Early Access Registration / promos'],
  'Gold''s lines, word for word with the spelling fixed');
select is((select cardinality(perks) from public.membership_tiers where name = 'Diamond'), 8, 'Diamond lists eight lines');
select results_eq(
  $$ select name::text, monthly_price_cents, discount_bp, monthly_free_minutes / 30 from public.membership_tiers where name in ('Silver', 'Gold', 'Diamond') order by sort $$,
  $$ values ('Silver', 4800, 1000, 2), ('Gold', 7800, 2000, 4), ('Diamond', 12800, 2000, 8) $$,
  'the poster''s tiers: $48 / $78 / $128, 10% / 20% / 20% off, 2 / 4 / 8 races a month');

-- ── Arriving early (D85) ────────────────────────────────────────────────────
select is((select arrive_early_minutes from public.venue_settings where id = 1), 15, 'guests are asked to arrive 15 minutes early');

-- ── The home page tiles (D87) ───────────────────────────────────────────────
select results_eq(
  $$ select section, string_agg(title, ' | ' order by sort) from public.site_tiles
      where title in ('Sim Racing', 'VR Sim Racing', 'Billiards', 'The Lounge', 'Solo Race', 'Race with Friends', 'VR Race', 'Free Roam',
                      'Leaderboard Challenge', 'Time Attack', 'F1', 'GT3', 'Rally', 'Drift', 'Supercars', 'Offroad Trucks', '& Others')
      group by section order by section $$,
  $$ values ('driving', 'F1 | GT3 | Rally | Drift | Supercars | Offroad Trucks | & Others'),
            ('events', 'Solo Race | Race with Friends | VR Race | Free Roam | Leaderboard Challenge | Time Attack'),
            ('highlights', 'Sim Racing | VR Sim Racing | Billiards | The Lounge') $$,
  'the launch tiles, by section and in order — the first four as the mockup names them (D88)');
select throws_ok($$ insert into public.site_tiles (section, title) values ('footer', 'x') $$, '23514', null, 'a tile belongs to one of the three sections');

insert into public.site_tiles (id, section, title, sort) values ('00000000-0000-0000-0000-0000000ff601', 'driving', 'pgTAP Hidden Tile', 99);
update public.site_tiles set active = false where id = '00000000-0000-0000-0000-0000000ff601';

set local role anon;
select is((select count(*)::int from public.site_tiles where title = 'pgTAP Hidden Tile'), 0, 'anon never sees a tile that is off');
select ok((select count(*) from public.experience_member_prices) >= 6, 'anon reads the member prices the membership page shows');
select throws_ok($$ update public.site_tiles set title = 'x' $$, '42501', null, 'anon cannot change a tile');
select throws_ok($$ delete from public.experience_member_prices $$, '42501', null, 'anon cannot change a member price');
reset role;

-- A change to a price is audited with who and why, like every other price.
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a601', 'mp@test.local', 'authenticated', 'authenticated');
insert into public.staff (id, auth_user_id, display_name, role, pin_hash)
values ('00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000a601', 'MP', 'superadmin', 'x');
select set_config('request.headers',
  json_build_object('x-rg-actor', '00000000-0000-0000-0000-00000000b601',
                    'x-rg-reason-b64', encode(convert_to('Poster', 'UTF8'), 'base64'))::text, true);
update public.experience_member_prices set price_cents = 2700
 where tier_id = (select id from public.membership_tiers where name = 'Gold')
   and experience_id = (select id from public.experiences where key = 'quick_race');
select is(
  (select actor_staff_id::text || ' / ' || reason from public.audit_log where entity = 'experience_member_prices' order by id desc limit 1),
  '00000000-0000-0000-0000-00000000b601 / Poster',
  'a member price change is audited with who and why');

select * from finish();
rollback;
