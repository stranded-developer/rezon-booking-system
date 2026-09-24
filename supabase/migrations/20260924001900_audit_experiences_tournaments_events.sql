-- Audit the tables added in 20260923001800.
--
-- They were created without the `audit_config_change` trigger every other configuration table
-- carries, which broke the rule in spec/README.md: **every change to money or rules is written to
-- the audit log with actor, before and after**. Experiences and their promotional prices *are*
-- prices, and a tournament carries an entry fee, so a change to any of them must be traceable to
-- the person who made it. Site events are marketing copy rather than money, but they are edited in
-- the same screens by the same people, and leaving them out would be an odd exception to explain.

do $$
declare
  t text;
begin
  foreach t in array array['experiences', 'experience_promos', 'tournaments', 'site_events'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_config_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;
