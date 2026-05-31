-- F13 §11.1 — cold-start taste seed.
-- Seeds the SOFT taste layer (cuisines + flavour notes + avoid) only while the user
-- has too few cooks for a computed flavor profile. Never overrides explicit intent
-- or hard dietary filters. RLS on `profiles` already restricts read/update to the
-- owning user, so no new policy is required.
alter table public.profiles
  add column if not exists taste_seed jsonb;

comment on column public.profiles.taste_seed is
  'Cold-start taste seed (F13 §11.1): { cuisines[], flavor_notes[], avoid[], set_at }. Seeds the soft taste layer only while the user has too few cooks for a computed flavor profile; never overrides explicit intent or hard dietary filters.';
