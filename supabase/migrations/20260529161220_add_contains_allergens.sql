-- Positive allergen-containment column on ingredients.
--
-- The library intolerance filter matches a user's intolerances against this column
-- (positive tokens: gluten, dairy, soy, egg, peanut, tree_nut, shellfish, fish) via
-- `.overlaps(contains_allergens, ...)`. Previously the filter matched against
-- `dietary_flags`, which only ever held the inverse "-free" tokens — so intolerance
-- filtering for gluten/dairy/soy/nuts silently matched nothing. This column fixes that.
--
-- The legacy "-free" dietary_flags are now DERIVED from containment ("does not contain X").
-- Both columns are populated by scripts/reaudit-ingredient-signals.draft.ts
-- (Sonnet composition-first pass + deterministic allergen net).

alter table ingredients
  add column if not exists contains_allergens text[] not null default '{}';

create index if not exists ingredients_contains_allergens_gin
  on ingredients using gin (contains_allergens);
