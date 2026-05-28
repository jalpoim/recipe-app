-- Flavor Identity Phase 1 schema additions

-- profiles: cook style from onboarding
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cook_style text;
-- valid values: 'optimizer' | 'time_crunched' | 'explorer' | 'dietary' | 'meal_prepper' | null

-- recipes: dietary flags (aggregate from ingredients) + cooking method
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS dietary_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cooking_method text;
-- dietary_flags values: 'vegan' | 'vegetarian' | 'gluten-free' | 'dairy-free' | 'keto' | 'nut-free'
-- cooking_method values: 'grill' | 'bake' | 'fry' | 'slow-cook' | 'steam' | 'air-fry' | 'no-cook'

-- user_cook_profile: axis scores, specialty badge, lifetime counters
CREATE TABLE IF NOT EXISTS user_cook_profile (
  user_id              uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  explorer_score       numeric NOT NULL DEFAULT 0,
  optimizer_score      numeric NOT NULL DEFAULT 0,
  planner_score        numeric NOT NULL DEFAULT 0,
  swift_score          numeric NOT NULL DEFAULT 0,
  creator_points       numeric NOT NULL DEFAULT 0,
  specialty_badge_key  text,
  lifetime_cook_count  integer NOT NULL DEFAULT 0,
  shopping_trip_count  integer NOT NULL DEFAULT 0,
  explored_cuisines    text[] NOT NULL DEFAULT '{}',
  explored_proteins    text[] NOT NULL DEFAULT '{}',
  last_computed_at     timestamptz
);

ALTER TABLE user_cook_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own cook profile"
  ON user_cook_profile FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users can upsert own cook profile"
  ON user_cook_profile FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
