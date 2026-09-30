-- VR rigs are driving simulators, and Double Race is listed before Leaderboard Challenge (D77, D78).
--
-- D77: the venue has 8 simulators — 6 standard rigs and 2 VR rigs — at the same price. The two VR
-- seats were their own resource type at $50/hr, so the website offered them as a separate thing to
-- book and a Quick Race could never land on one. They become resources of the simulator type, so
-- every experience can be booked on them and "Which Driving Simulator?" lists them by name.
--
-- Bookings and sessions point at a resource, never at a type, so their history keeps its rows.
-- The VR type and its happy-hour rate are switched off rather than deleted: past audit entries
-- still name them.
--
-- On a fresh install this does nothing: migrations run before `seed.sql`, so there is no VR type
-- yet, and the seed now creates the two VR rigs as simulators directly.

update public.resources r
set resource_type_id = sim.id,
    label = 'VR Sim ' || r.sort,
    sort = 6 + r.sort,
    updated_at = now()
from public.resource_types vr, public.resource_types sim
where vr.key = 'vr' and sim.key = 'sim' and r.resource_type_id = vr.id;

update public.rate_bands rb
set active = false, updated_at = now()
from public.resource_types vr
where vr.key = 'vr' and rb.resource_type_id = vr.id;

update public.resource_types set active = false, updated_at = now() where key = 'vr';

-- D78: Double Race second, Leaderboard Challenge third. Only while they still hold their launch
-- positions, so an order the venue has since set in the back office is left alone.
update public.experiences set sort = 2, updated_at = now() where key = 'double_race' and sort = 3;
update public.experiences set sort = 3, updated_at = now() where key = 'leaderboard_challenge' and sort = 2;
