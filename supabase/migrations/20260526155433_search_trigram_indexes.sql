-- Trigram indexes for ILIKE '%term%' search on recipe names.
-- pg_trgm breaks text into 3-char chunks so leading-wildcard queries
-- can use an index instead of scanning every row.
create index if not exists idx_recipes_name_trgm
  on recipes using gin (name gin_trgm_ops);

create index if not exists idx_recipe_translations_name_trgm
  on recipe_translations using gin (name gin_trgm_ops);
