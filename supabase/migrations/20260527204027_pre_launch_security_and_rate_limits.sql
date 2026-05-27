-- Pre-launch security hardening and rate limiting
-- Fixes all db advisor warnings: search_path, SECURITY DEFINER exposure,
-- RLS performance, storage listing, missing FK indexes.
-- Adds daily_ai_usage table for estimateMacros rate limiting (10/user/day).

-- === Functions: add SET search_path TO 'public' ===

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_active_plan(p_user_id uuid, p_household_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, owner_id uuid, household_id uuid, name text, default_multiplier integer, archived_at timestamptz, created_at timestamptz, item_count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  select
    p.id, p.owner_id, p.household_id, p.name, p.default_multiplier,
    p.archived_at, p.created_at, count(pi.id) as item_count
  from plans p
  left join plan_items pi on pi.plan_id = p.id
  where p.archived_at is null
    and (
      (p_household_id is not null and p.household_id = p_household_id)
      or (p_household_id is null and p.owner_id = p_user_id and p.household_id is null)
    )
  group by p.id
  order by p.created_at desc
  limit 1;
$$;

CREATE OR REPLACE FUNCTION public.get_recipe_cook_counts(p_user_id uuid, p_recipe_ids uuid[])
RETURNS TABLE(recipe_id uuid, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  select recipe_id, count(*)
  from cook_log
  where user_id = p_user_id
    and recipe_id = any(p_recipe_ids)
  group by recipe_id;
$$;

CREATE OR REPLACE FUNCTION public.get_library_meta()
RETURNS json LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  select json_build_object(
    'proteins', (
      select coalesce(array_agg(distinct p order by p), '{}')
      from recipes, unnest(proteins) p
    ),
    'tags', (
      select coalesce(array_agg(distinct t order by t), '{}')
      from recipes, unnest(tags) t
    ),
    'ingredients', (
      select coalesce(array_agg(distinct ri.name order by ri.name), '{}')
      from recipe_ingredients ri
      where ri.name is not null
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_library_meta(lang text DEFAULT 'pt'::text)
RETURNS json LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  select json_build_object(
    'proteins', (
      select coalesce(array_agg(distinct p order by p), '{}')
      from recipes, unnest(proteins) p
    ),
    'tags', (
      select coalesce(array_agg(distinct t order by t), '{}')
      from recipes, unnest(tags) t
    ),
    'ingredients', (
      select coalesce(array_agg(distinct coalesce(rit.name, ri.name) order by coalesce(rit.name, ri.name)), '{}')
      from recipe_ingredients ri
      left join recipe_ingredient_translations rit
        on rit.ingredient_id = ri.id and rit.language = lang
      where ri.name is not null
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.update_recipe_like_count()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.type = 'like' THEN
    UPDATE recipes SET like_count = like_count + 1 WHERE id = NEW.recipe_id;
  ELSIF TG_OP = 'DELETE' AND OLD.type = 'like' THEN
    UPDATE recipes SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.recipe_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_recipe_cook_count()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recipes SET cook_count = cook_count + 1 WHERE id = NEW.recipe_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE recipes SET cook_count = GREATEST(0, cook_count - 1) WHERE id = OLD.recipe_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_popularity_score(
  p_cook_count integer, p_save_count integer, p_like_count integer,
  p_is_featured boolean, p_created_at timestamptz
)
RETURNS integer LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT
    (p_cook_count * 3 + p_save_count * 2 + p_like_count * 1)
    + (CASE WHEN p_is_featured THEN 50 ELSE 0 END)
    + (CASE WHEN p_created_at > NOW() - INTERVAL '7 days' THEN 20 ELSE 0 END)
$$;

CREATE OR REPLACE FUNCTION public.sync_recipe_cook_count()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recipes
    SET
      cook_count = cook_count + 1,
      popularity_score = compute_popularity_score(cook_count + 1, save_count, like_count, is_featured, created_at)
    WHERE id = NEW.recipe_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE recipes
    SET
      cook_count = GREATEST(cook_count - 1, 0),
      popularity_score = compute_popularity_score(GREATEST(cook_count - 1, 0), save_count, like_count, is_featured, created_at)
    WHERE id = OLD.recipe_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_recipe_save_count()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.type = 'save' THEN
    UPDATE recipes
    SET
      save_count = save_count + 1,
      popularity_score = compute_popularity_score(cook_count, save_count + 1, like_count, is_featured, created_at)
    WHERE id = NEW.recipe_id;
  ELSIF TG_OP = 'DELETE' AND OLD.type = 'save' THEN
    UPDATE recipes
    SET
      save_count = GREATEST(save_count - 1, 0),
      popularity_score = compute_popularity_score(cook_count, GREATEST(save_count - 1, 0), like_count, is_featured, created_at)
    WHERE id = OLD.recipe_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_ingredients_fuzzy(search_term text, result_limit integer DEFAULT 8)
RETURNS TABLE(id uuid, name text, similarity double precision)
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT
    i.id,
    i.name,
    GREATEST(
      word_similarity(search_term, i.name),
      COALESCE((
        SELECT MAX(word_similarity(search_term, alias))
        FROM unnest(i.aliases) AS alias
      ), 0),
      COALESCE((
        SELECT MAX(word_similarity(search_term, t.name))
        FROM ingredient_translations t
        WHERE t.ingredient_id = i.id
      ), 0)
    )
    + CASE
        WHEN lower(i.name) = lower(search_term)
          OR EXISTS (
            SELECT 1 FROM ingredient_translations t
            WHERE t.ingredient_id = i.id AND lower(t.name) = lower(search_term)
          ) THEN 1.0
        WHEN lower(i.name) LIKE lower(search_term) || '%'
          OR EXISTS (
            SELECT 1 FROM ingredient_translations t
            WHERE t.ingredient_id = i.id AND lower(t.name) LIKE lower(search_term) || '%'
          ) THEN 0.5
        ELSE 0.0
      END
    AS similarity
  FROM ingredients i
  WHERE
    word_similarity(search_term, i.name) > 0.15
    OR EXISTS (
      SELECT 1 FROM unnest(i.aliases) AS alias
      WHERE word_similarity(search_term, alias) > 0.15
    )
    OR EXISTS (
      SELECT 1 FROM ingredient_translations t
      WHERE t.ingredient_id = i.id
        AND word_similarity(search_term, t.name) > 0.15
    )
  ORDER BY similarity DESC, length(i.name), i.name
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION public.search_ingredients_fuzzy(search_term text, result_limit integer DEFAULT 10, lang text DEFAULT 'pt'::text)
RETURNS TABLE(id uuid, name text, similarity double precision)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH norm_query AS (
    SELECT lower(unaccent(search_term)) AS q
  )
  SELECT
    i.id,
    COALESCE(t.name, i.name) AS name,
    GREATEST(
      CASE WHEN lower(unaccent(COALESCE(t.name, i.name))) = (SELECT q FROM norm_query) THEN 2.0 ELSE 0 END,
      similarity((SELECT q FROM norm_query), lower(unaccent(COALESCE(t.name, i.name))))::float,
      similarity((SELECT q FROM norm_query), lower(unaccent(i.name)))::float,
      COALESCE((
        SELECT MAX(similarity((SELECT q FROM norm_query), lower(unaccent(a)))::float)
        FROM unnest(i.aliases) AS a
      ), 0)
    )
    - (array_length(string_to_array(COALESCE(t.name, i.name), ','), 1) - 1) * 0.05
    AS score
  FROM ingredients i
  LEFT JOIN ingredient_translations t
    ON t.ingredient_id = i.id
    AND t.language = lang
  WHERE
    i.owner_id IS NULL
    AND (
      word_similarity((SELECT q FROM norm_query), lower(unaccent(COALESCE(t.name, i.name)))) > 0.15
      OR word_similarity((SELECT q FROM norm_query), lower(unaccent(i.name))) > 0.15
      OR EXISTS (
        SELECT 1 FROM unnest(i.aliases) AS a
        WHERE word_similarity((SELECT q FROM norm_query), lower(unaccent(a))) > 0.15
      )
    )
  ORDER BY score DESC
  LIMIT result_limit;
$$;

-- === Revoke EXECUTE on SECURITY DEFINER functions from anon/public ===
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_household_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_in_same_household(uuid) FROM anon;

-- === RLS performance: replace auth.uid() with (select auth.uid()) ===
DROP POLICY IF EXISTS recipes_insert ON public.recipes;
CREATE POLICY recipes_insert ON public.recipes
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS recipe_ingredients_insert ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_insert ON public.recipe_ingredients
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_ingredients.recipe_id
      AND r.owner_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS recipe_steps_insert ON public.recipe_steps;
CREATE POLICY recipe_steps_insert ON public.recipe_steps
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_steps.recipe_id
      AND r.owner_id = (SELECT auth.uid())
  ));

-- === Storage: restrict recipe-images SELECT to own folder (not public listing) ===
DROP POLICY IF EXISTS recipe_images_select ON storage.objects;
CREATE POLICY recipe_images_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'recipe-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

-- === Missing FK indexes ===
CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON public.household_members(user_id);
CREATE INDEX IF NOT EXISTS recipe_reports_user_id_idx ON public.recipe_reports(user_id);
CREATE INDEX IF NOT EXISTS tag_correction_reports_recipe_id_idx ON public.tag_correction_reports(recipe_id);
CREATE INDEX IF NOT EXISTS tag_correction_reports_reported_by_idx ON public.tag_correction_reports(reported_by);
CREATE INDEX IF NOT EXISTS user_ingredient_exclusions_ingredient_id_idx ON public.user_ingredient_exclusions(ingredient_id);
CREATE INDEX IF NOT EXISTS user_ingredient_overrides_ingredient_id_idx ON public.user_ingredient_overrides(ingredient_id);
CREATE INDEX IF NOT EXISTS user_recipe_preferences_recipe_id_idx ON public.user_recipe_preferences(recipe_id);

-- === Rate limiting: daily AI usage tracking ===
CREATE TABLE IF NOT EXISTS public.daily_ai_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  macro_calls int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.daily_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_ai_usage_own ON public.daily_ai_usage
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
