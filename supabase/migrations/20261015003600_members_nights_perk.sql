-- Every membership tier lists "SPECIAL MEMBERS NIGHTS ONLY EVENTS" (D108), the owner's wording.
-- Added once, at the end of each tier's listed perks; still editable in the back office.
update public.membership_tiers
   set perks = perks || array['SPECIAL MEMBERS NIGHTS ONLY EVENTS']
 where not ('SPECIAL MEMBERS NIGHTS ONLY EVENTS' = any (perks));
