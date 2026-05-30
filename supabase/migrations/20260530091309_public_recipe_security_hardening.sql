-- Public-recipe / SEO security hardening.
--
-- Context: we are opening recipe content to anonymous visitors (SEO + sharing).
-- This migration closes pre-existing exposure on `profiles` and tightens grants
-- so that broadening the public surface does not leak user data.

-- ── 1. profiles PII lockdown ────────────────────────────────────────────────
-- The old `profiles_select` policy was `USING (true)` for the `public` role,
-- which exposed every column (incl. `email`, `intolerances`, flavor data) to
-- anon and to any authenticated user via the Data API. Replace it with a
-- public-safe view + an own-row-only base policy.

-- Public-safe projection: only non-sensitive columns. Runs as the view owner
-- (security_invoker = off) so it bypasses the base-table RLS below, but can
-- never leak email/dietary/flavor data because those columns are not present.
--
-- NOTE: the security advisor flags this as `security_definer_view` (lint 0010,
-- ERROR). That is a deliberate, documented exception. security_invoker = true
-- is not viable here: the base table is own-row-only (below), so an invoker
-- view would return nothing across users and break public author attribution.
-- This view is safe because it is default-deny — it selects an explicit list
-- of public-by-design columns, has no write path, and a future sensitive column
-- on `profiles` is NOT exposed unless this view is edited. The lint-clean
-- alternative (splitting profiles into public + private tables) is tracked
-- separately as a larger refactor.
create or replace view public.public_profiles
  with (security_invoker = off) as
  select user_id, username, display_name, avatar_url, bio
  from public.profiles;

grant select on public.public_profiles to anon, authenticated;
-- The view is auto-updatable; ensure no write path exists through it.
revoke insert, update, delete, truncate on public.public_profiles
  from anon, authenticated;

-- Base table: a user may read only their OWN full row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- anon must not touch the base profiles table at all.
revoke select on public.profiles from anon;

-- ── 2. anon is read-only on recipe + profile tables ─────────────────────────
-- Default Supabase grants included write privileges for anon; anon never writes.
revoke insert, update, delete, truncate on
  public.recipes, public.recipe_ingredients, public.recipe_steps,
  public.recipe_translations, public.recipe_ingredient_translations,
  public.recipe_step_translations, public.profiles
from anon;

-- ── 3. function hardening ───────────────────────────────────────────────────
-- Trigger-only functions: never meant to be invoked via PostgREST /rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_profile_email() from public, anon, authenticated;

-- RLS-helper SECURITY DEFINER functions: authenticated needs EXECUTE for policy
-- evaluation; anon does not and should not reach them via /rpc.
revoke execute on function public.get_auth_household_id() from public, anon;
grant execute on function public.get_auth_household_id() to authenticated;
revoke execute on function public.is_in_same_household(uuid) from public, anon;
grant execute on function public.is_in_same_household(uuid) to authenticated;

-- search_path hygiene on the three flagged SECURITY INVOKER functions.
alter function public.increment_shopping_trips(uuid) set search_path = public, pg_temp;
alter function public.increment_creator_points(uuid, numeric) set search_path = public, pg_temp;
alter function public.refresh_platform_averages() set search_path = public, pg_temp;

-- ── 4. drop unrestricted households INSERT ──────────────────────────────────
-- The legitimate create-household flow runs through the service-role client
-- (bypasses RLS); authenticated users have no need to INSERT households directly,
-- and the old `WITH CHECK (true)` policy allowed unrestricted inserts.
drop policy if exists households_insert on public.households;
