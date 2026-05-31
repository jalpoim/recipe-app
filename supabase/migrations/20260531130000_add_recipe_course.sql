-- F13 — meal-type classification.
-- `course` distinguishes meals from non-meals so plan generation stops suggesting
-- desserts/snacks/drinks/sides. Values: main | breakfast | dessert | snack | drink |
-- side. Plan generation includes main + breakfast and excludes the rest.
-- Backfilled by scripts/classify-recipe-course.ts (Haiku); nullable so unclassified
-- recipes are treated as meals (the generator excludes only known non-meal courses).
alter table public.recipes
  add column if not exists course text;

comment on column public.recipes.course is
  'Meal-type classification (F13): main | breakfast | dessert | snack | drink | side. Plan generation includes main/breakfast and excludes dessert/snack/drink/side. Backfilled by scripts/classify-recipe-course.ts (Haiku).';
