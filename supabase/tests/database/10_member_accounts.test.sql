-- member_link_account and qr_version.
begin;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a101', 'staffer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a102', 'Link.Me@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a103', 'intruder@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a104', 'brand.new@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000a101', 'Staffer', 'cashier', 'x');
insert into customers (id, name, email, created_at) values
  ('00000000-0000-0000-0000-00000000c101', 'Older Guest', 'link.me@test.local', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000c102', 'Newer Guest', 'LINK.ME@test.local', '2021-01-01');
insert into members (id, customer_id, tier_id, status) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000c101', (select id from membership_tiers where name = 'Gold'), 'active');

-- ── Linking ─────────────────────────────────────────────────────────────────
select throws_like($$ select member_link_account('00000000-0000-0000-0000-00000000a101', 'staffer@test.local', 'S', null) $$,
  'RG:forbidden:%', 'a staff login cannot become a customer account');
select throws_like($$ select member_link_account('00000000-0000-0000-0000-00000000a102', '  ', 'X', null) $$,
  'RG:invalid:%', 'an email is required');
select is(member_link_account('00000000-0000-0000-0000-00000000a102', 'Link.Me@TEST.local', 'Ignored', null),
  '00000000-0000-0000-0000-00000000c101'::uuid, 'links the oldest customer with the same email, any case');
select is((select auth_user_id from customers where id = '00000000-0000-0000-0000-00000000c101'), '00000000-0000-0000-0000-00000000a102'::uuid, 'auth user stored');
select is((select name from customers where id = '00000000-0000-0000-0000-00000000c101'), 'Older Guest', 'existing name kept');
select is(member_link_account('00000000-0000-0000-0000-00000000a102', 'other@test.local', 'X', null),
  '00000000-0000-0000-0000-00000000c101'::uuid, 'an already linked login always gets its own customer');
select is(member_link_account('00000000-0000-0000-0000-00000000a103', 'link.me@test.local', 'Intruder', null),
  '00000000-0000-0000-0000-00000000c102'::uuid, 'a second login with the same email takes the next unlinked customer');
select throws_like($$ select member_link_account('00000000-0000-0000-0000-00000000a104', 'link.me@test.local', 'Third', null) $$,
  'RG:conflict:%', 'when every customer with that email is linked, another login is refused');
select isnt(member_link_account('00000000-0000-0000-0000-00000000a104', 'brand.new@test.local', 'Bran New', '0400 000 001'), null, 'a new email creates a customer');
select results_eq(
  $$ select name, email::text, phone from customers where auth_user_id = '00000000-0000-0000-0000-00000000a104' $$,
  $$ values ('Bran New', 'brand.new@test.local', '0400 000 001') $$, 'created from the sign-up details, email lower-cased');
select is((select count(*) from audit_log where action in ('customer.account_linked', 'customer.account_created')
  and entity_id in ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-00000000c102',
                    (select id::text from customers where auth_user_id = '00000000-0000-0000-0000-00000000a104'))), 3::bigint, 'links and creations are audited once each');

-- ── QR version ──────────────────────────────────────────────────────────────
select is((select qr_version from members where id = '00000000-0000-0000-0000-00000000d101'), 0, 'a member starts at version 0');
update members set qr_token_hash = repeat('a', 64) where id = '00000000-0000-0000-0000-00000000d101';
select is((select qr_version from members where id = '00000000-0000-0000-0000-00000000d101'), 1, 'issuing a card bumps the version');
update members set qr_token_hash = repeat('a', 64), qr_version = 7 where id = '00000000-0000-0000-0000-00000000d101';
select is((select qr_version from members where id = '00000000-0000-0000-0000-00000000d101'), 1, 'the same hash again does not bump, and the version cannot be set directly');
select lives_ok($$ select admin_reissue_qr('00000000-0000-0000-0000-00000000d101', null, repeat('c', 64), 'member reissued') $$, 'reissue without staff (member self-service)');
select is((select qr_version from members where id = '00000000-0000-0000-0000-00000000d101'), 2, 'a reissue bumps the version');

select function_privs_are('public', 'member_link_account', array['uuid', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'signed-in users cannot link accounts directly');

select * from finish();
rollback;
