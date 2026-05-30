-- Tracks free-typed recipe ingredients that couldn't be confidently linked to the
-- canonical catalog on save (see resolveIngredientLinks in recipe-queries.ts). The owner
-- reviews these periodically (via MCP / service role) to grow the catalog + aliases.
create table if not exists unmatched_ingredients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  normalized_name text,
  user_id         uuid references auth.users(id) on delete set null,
  recipe_id       uuid references recipes(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table unmatched_ingredients enable row level security;

-- Any authenticated user may log their own unmatched ingredients. No SELECT policy:
-- review is done by the owner via the service role (bypasses RLS), not the app.
create policy "unmatched_insert_own" on unmatched_ingredients
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create index if not exists unmatched_ingredients_norm
  on unmatched_ingredients (normalized_name);
