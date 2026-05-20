-- Canonical ingredient catalogue
-- Pulled forward from Session 5 to support ingredient normalization script.

create table ingredients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text check (category in ('meat', 'produce', 'dairy', 'grains', 'other')),
  default_unit text,
  owner_id     uuid references auth.users(id) on delete cascade,
  created_at   timestamptz default now()
);

-- System ingredients (owner_id null): unique by lowercased name
create unique index ingredients_system_name_uq
  on ingredients(lower(name))
  where owner_id is null;

-- User-created ingredients: unique by lowercased name per user
create unique index ingredients_user_name_uq
  on ingredients(lower(name), owner_id)
  where owner_id is not null;

create index on ingredients(owner_id) where owner_id is not null;

alter table ingredients enable row level security;

-- System ingredients readable by all authenticated users
-- User ingredients readable only by their owner
create policy "ingredients_select" on ingredients
  for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

create policy "ingredients_insert" on ingredients
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "ingredients_update" on ingredients
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "ingredients_delete" on ingredients
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Per-user category overrides for system ingredients
create table user_ingredient_overrides (
  user_id       uuid references auth.users(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete cascade,
  category      text not null check (category in ('meat', 'produce', 'dairy', 'grains', 'other')),
  primary key (user_id, ingredient_id)
);

alter table user_ingredient_overrides enable row level security;

create policy "overrides_all" on user_ingredient_overrides
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Link recipe_ingredients to canonical ingredients (nullable — populated by normalization script)
alter table recipe_ingredients
  add column ingredient_id uuid references ingredients(id) on delete set null;

create index on recipe_ingredients(ingredient_id) where ingredient_id is not null;
