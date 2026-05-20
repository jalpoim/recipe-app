-- Translation tables for recipe content (name, ingredients, steps)
-- Language codes: 'pt' = Portuguese, 'en' = English

-- Recipe name translations
create table recipe_translations (
  recipe_id uuid references recipes(id) on delete cascade,
  language  text not null,
  name      text not null,
  primary key (recipe_id, language)
);

alter table recipe_translations enable row level security;

create policy "recipe_translations_select" on recipe_translations
  for select to authenticated
  using (exists (
    select 1 from recipes r
    where r.id = recipe_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));

create policy "recipe_translations_insert" on recipe_translations
  for insert to authenticated
  with check (exists (
    select 1 from recipes r
    where r.id = recipe_id
    and r.owner_id = (select auth.uid())
  ));

create policy "recipe_translations_update" on recipe_translations
  for update to authenticated
  using (exists (
    select 1 from recipes r
    where r.id = recipe_id
    and r.owner_id = (select auth.uid())
  ));

create policy "recipe_translations_delete" on recipe_translations
  for delete to authenticated
  using (exists (
    select 1 from recipes r
    where r.id = recipe_id
    and r.owner_id = (select auth.uid())
  ));

-- Ingredient translations
create table recipe_ingredient_translations (
  ingredient_id uuid references recipe_ingredients(id) on delete cascade,
  language      text not null,
  name          text,
  unit          text,
  raw_text      text not null,
  primary key (ingredient_id, language)
);

alter table recipe_ingredient_translations enable row level security;

create policy "ingredient_translations_select" on recipe_ingredient_translations
  for select to authenticated
  using (exists (
    select 1 from recipe_ingredients ri
    join recipes r on r.id = ri.recipe_id
    where ri.id = ingredient_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));

create policy "ingredient_translations_insert" on recipe_ingredient_translations
  for insert to authenticated
  with check (exists (
    select 1 from recipe_ingredients ri
    join recipes r on r.id = ri.recipe_id
    where ri.id = ingredient_id
    and r.owner_id = (select auth.uid())
  ));

create policy "ingredient_translations_update" on recipe_ingredient_translations
  for update to authenticated
  using (exists (
    select 1 from recipe_ingredients ri
    join recipes r on r.id = ri.recipe_id
    where ri.id = ingredient_id
    and r.owner_id = (select auth.uid())
  ));

-- Step translations
create table recipe_step_translations (
  step_id  uuid references recipe_steps(id) on delete cascade,
  language text not null,
  text     text not null,
  primary key (step_id, language)
);

alter table recipe_step_translations enable row level security;

create policy "step_translations_select" on recipe_step_translations
  for select to authenticated
  using (exists (
    select 1 from recipe_steps rs
    join recipes r on r.id = rs.recipe_id
    where rs.id = step_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));

create policy "step_translations_insert" on recipe_step_translations
  for insert to authenticated
  with check (exists (
    select 1 from recipe_steps rs
    join recipes r on r.id = rs.recipe_id
    where rs.id = step_id
    and r.owner_id = (select auth.uid())
  ));

create policy "step_translations_update" on recipe_step_translations
  for update to authenticated
  using (exists (
    select 1 from recipe_steps rs
    join recipes r on r.id = rs.recipe_id
    where rs.id = step_id
    and r.owner_id = (select auth.uid())
  ));

-- Indexes for language lookups
create index on recipe_translations(language);
create index on recipe_ingredient_translations(language);
create index on recipe_step_translations(language);
