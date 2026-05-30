-- Performance indexes (pre-emptive — tables are small today but these avoid
-- sequential scans and unindexed sorts as the recipe set grows).

-- Trigram indexes so ILIKE '%term%' ingredient search can use an index.
-- (pg_trgm is already enabled; recipe names already have trigram indexes.)
create index if not exists recipe_ingredients_name_trgm
  on public.recipe_ingredients using gin (name gin_trgm_ops);
create index if not exists recipe_ingredients_raw_text_trgm
  on public.recipe_ingredients using gin (raw_text gin_trgm_ops);

-- Composite partial indexes matching fetchLibrary's keyset pagination order
-- (sort column, then id), scoped to the always-applied deleted_at IS NULL filter.
-- pcal_ratio already has a dedicated index, so it is omitted here.
create index if not exists recipes_protein_id_idx
  on public.recipes (protein desc nulls last, id) where deleted_at is null;
create index if not exists recipes_calories_id_idx
  on public.recipes (calories asc nulls last, id) where deleted_at is null;
create index if not exists recipes_time_min_id_idx
  on public.recipes (time_min asc nulls last, id) where deleted_at is null;
create index if not exists recipes_popularity_id_idx
  on public.recipes (popularity_score desc nulls last, id) where deleted_at is null;
create index if not exists recipes_cook_count_id_idx
  on public.recipes (cook_count desc nulls last, id) where deleted_at is null;
