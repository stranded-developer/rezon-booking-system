-- Venue contact details, photos and their Storage bucket (D58).
begin;
select plan(19);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');

create function pg_temp.as_api(p_actor text, p_reason text default null) returns void language sql as $$
  select set_config('request.headers',
    json_build_object('x-rg-actor', p_actor, 'x-rg-reason-b64', encode(convert_to(p_reason, 'UTF8'), 'base64'))::text, true);
$$;
create temp table t_mark as select coalesce(max(id), 0) as id from audit_log;
grant select on t_mark to public;

-- ── Contact details ─────────────────────────────────────────────────────────
select lives_ok(
  $$ update venue_settings set address = '1 George St, Sydney NSW 2000', phone = '+61 2 9000 0000',
       contact_email = 'Hello@Raceground.test', intro = 'Pool, sims and VR.', instagram_url = 'https://www.instagram.com/raceground/' $$,
  'valid contact details are accepted');
select is((select contact_email::text from venue_settings where contact_email = 'hello@raceground.test'), 'Hello@Raceground.test',
  'contact email compares in any case');
select throws_ok($$ update venue_settings set phone = '12ab' $$, '23514', null, 'phone must look like a phone number');
select throws_ok($$ update venue_settings set contact_email = 'not-an-email' $$, '23514', null, 'contact email must look like an email');
select throws_ok($$ update venue_settings set instagram_url = 'http://instagram.com/raceground' $$, '23514', null, 'Instagram link must be https');
select throws_ok($$ update venue_settings set instagram_url = 'https://evil.example/instagram.com/x' $$, '23514', null, 'Instagram link must be on instagram.com');
select throws_ok($$ update venue_settings set address = '' $$, '23514', null, 'empty address is stored as null, not empty text');
select throws_ok($$ update venue_settings set intro = repeat('x', 1001) $$, '23514', null, 'intro is at most 1000 characters');

-- ── Photos ──────────────────────────────────────────────────────────────────
select pg_temp.as_api('00000000-0000-0000-0000-00000000b001', 'New photo');
insert into venue_photos (id, storage_path, caption, sort)
values ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000f0001.jpg', 'The sims', 1);
select results_eq(
  $$ select actor_staff_id, action, reason from audit_log where id > (select id from t_mark) and entity = 'venue_photos' $$,
  $$ values ('00000000-0000-0000-0000-00000000b001'::uuid, 'venue_photos.insert', 'New photo') $$,
  'adding a photo through the API is audited with actor and reason');

select pg_temp.as_api('00000000-0000-0000-0000-00000000b001');
delete from venue_photos where id = '00000000-0000-0000-0000-0000000f0001';
select is(
  (select before ->> 'caption' from audit_log where id > (select id from t_mark) and action = 'venue_photos.delete'),
  'The sims', 'removing a photo is audited with what was removed');

select throws_ok($$ insert into venue_photos (storage_path) values ('../secrets.jpg') $$, '23514', null, 'storage path must be a uuid file name');
select throws_ok($$ insert into venue_photos (storage_path) values ('00000000-0000-0000-0000-0000000f0002.gif') $$, '23514', null, 'only jpg, png or webp files');
select throws_ok($$ insert into venue_photos (storage_path, caption) values ('00000000-0000-0000-0000-0000000f0003.png', '') $$, '23514', null, 'empty caption is stored as null');

-- ── Privileges ──────────────────────────────────────────────────────────────
select table_privs_are('public', 'venue_photos', 'anon', array[]::text[], 'visitors have no direct access to photo rows');
select table_privs_are('public', 'venue_photos', 'authenticated', array[]::text[], 'signed-in users have no direct access to photo rows');

-- ── Storage bucket ──────────────────────────────────────────────────────────
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'venue-photos' $$,
  $$ values (true, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp']) $$,
  'venue-photos bucket: public read, 5 MB, images only');
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0::bigint, 'no Storage policy lets browsers upload, change or delete files');

set local role anon;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-photos', '00000000-0000-0000-0000-0000000f0004.jpg') $$,
  '42501', null, 'a visitor cannot upload a photo');
reset role;
set local role authenticated;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-photos', '00000000-0000-0000-0000-0000000f0005.jpg') $$,
  '42501', null, 'a signed-in user cannot upload a photo');
reset role;

select * from finish();
rollback;
