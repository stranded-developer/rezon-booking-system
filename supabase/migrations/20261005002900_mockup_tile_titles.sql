-- The owner's mockup titles the four tiles under the hero by what you do there (D88), and puts
-- "Race. Play. Hang out. Compete." on a line beneath them. Only tiles still carrying their launch
-- titles are renamed, so anything the owner has already changed in the back office is left alone.
update public.site_tiles t
   set title = v.new_title
  from (values ('Race.', 'Sim Racing'), ('Play.', 'VR Sim Racing'), ('Hang out.', 'Billiards'), ('Compete.', 'The Lounge')) as v (old_title, new_title)
 where t.section = 'highlights' and t.title = v.old_title;
