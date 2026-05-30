-- Allow anonymous (and authenticated) read of recipe CHILDREN for public recipes.
--
-- The public recipe page (/r/$recipeId) is served to logged-out visitors, so anon
-- must be able to read a recipe's ingredients, steps, and translations. The prior
-- SELECT policies on these tables were `TO authenticated` and only covered
-- system + own recipes, so a public page would render with no ingredients/steps.
--
-- These policies mirror the parent `recipes_select` visibility logic: readable
-- when the parent recipe is system, or public+approved (not soft-deleted), or
-- owned by the caller. anon has no auth.uid(), so the owner branch is inert for it.

-- recipe_ingredients
drop policy if exists recipe_ingredients_select on public.recipe_ingredients;
create policy recipe_ingredients_select on public.recipe_ingredients
  for select to anon, authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_ingredients.recipe_id
      and ( r.owner_id = (select auth.uid())
         or r.visibility = 'system'
         or (r.deleted_at is null and r.visibility = 'public' and r.moderation_status = 'approved') )
  ));

-- recipe_steps
drop policy if exists recipe_steps_select on public.recipe_steps;
create policy recipe_steps_select on public.recipe_steps
  for select to anon, authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_steps.recipe_id
      and ( r.owner_id = (select auth.uid())
         or r.visibility = 'system'
         or (r.deleted_at is null and r.visibility = 'public' and r.moderation_status = 'approved') )
  ));

-- recipe_translations
drop policy if exists recipe_translations_select on public.recipe_translations;
create policy recipe_translations_select on public.recipe_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_translations.recipe_id
      and ( r.owner_id = (select auth.uid())
         or r.visibility = 'system'
         or (r.deleted_at is null and r.visibility = 'public' and r.moderation_status = 'approved') )
  ));

-- recipe_ingredient_translations (join through recipe_ingredients)
drop policy if exists ingredient_translations_select on public.recipe_ingredient_translations;
create policy ingredient_translations_select on public.recipe_ingredient_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.recipe_ingredients ri
    join public.recipes r on r.id = ri.recipe_id
    where ri.id = recipe_ingredient_translations.ingredient_id
      and ( r.owner_id = (select auth.uid())
         or r.visibility = 'system'
         or (r.deleted_at is null and r.visibility = 'public' and r.moderation_status = 'approved') )
  ));

-- recipe_step_translations (join through recipe_steps)
drop policy if exists step_translations_select on public.recipe_step_translations;
create policy step_translations_select on public.recipe_step_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.recipe_steps rs
    join public.recipes r on r.id = rs.recipe_id
    where rs.id = recipe_step_translations.step_id
      and ( r.owner_id = (select auth.uid())
         or r.visibility = 'system'
         or (r.deleted_at is null and r.visibility = 'public' and r.moderation_status = 'approved') )
  ));
