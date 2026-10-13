-- The experience cards follow the owner's three mockups (D98): their wording, and a button text
-- of each experience's own. The cards print the lime line in capitals, so it is stored as a
-- sentence and whoever edits it in the back office types it normally.

alter table public.experiences
  add column button_label text check (button_label is null or length(trim(button_label)) between 1 and 40);
comment on column public.experiences.button_label is
  'The words on the card''s button, e.g. "Book your first race". Empty = "Book <name>".';

-- Only while each card still carries the wording it launched with, so text the venue has
-- already changed in the back office is left alone.
update public.experiences
   set tagline = 'Your first lap starts here.',
       bullets = array[
         'Never raced before? You''re in the right place.',
         'Jump in, hit the track, and find your pace.',
         'Race solo or challenge your mates.'
       ],
       button_label = 'Book your first race'
 where key = 'quick_race' and tagline = 'Quick Race, Time trial, Drift, and more.';

update public.experiences
   set tagline = 'Twice the time. Twice the trash talk.',
       bullets = array[
         'More laps. More battles. More bragging rights.',
         'Master the track, then push for your fastest lap.',
         'The perfect session to challenge your mates.'
       ],
       button_label = 'Book the full experience'
 where key = 'double_race' and tagline = 'Full Experience, Double Race, Drift, Free Roam, and more';

update public.experiences
   set tagline = 'One lap. One leaderboard. Can you top it?',
       bullets = array[
         'Chase the fastest lap and claim your spot.',
         'Put your name above your friends'' names.',
         'Monthly prizes for the top three drivers.'
       ],
       button_label = 'Take on the leaderboard'
 where key = 'leaderboard_challenge' and tagline = 'Time attack';
