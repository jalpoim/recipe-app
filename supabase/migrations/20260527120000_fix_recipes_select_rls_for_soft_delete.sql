-- Fix: PostgreSQL applies the SELECT policy as an implicit WITH CHECK on the new row
-- during UPDATE. The previous SELECT policy required deleted_at IS NULL, so soft-deleting
-- a recipe (setting deleted_at to a non-null value) always violated RLS.
--
-- Fix: owners can always SELECT their own recipes regardless of deleted_at.
-- All application queries already filter deleted_at=is.null explicitly, so no
-- soft-deleted recipes will appear in the UI.

DROP POLICY IF EXISTS "recipes_select" ON recipes;

CREATE POLICY "recipes_select" ON recipes
  FOR SELECT USING (
    -- Owner sees all their own recipes (incl. soft-deleted) — needed for soft-delete UPDATE to work
    (owner_id = (SELECT auth.uid()))
    OR (
      deleted_at IS NULL AND (
        visibility = 'system'
        OR (
          visibility = 'household'
          AND owner_id IN (
            SELECT hm2.user_id
            FROM household_members hm1
            JOIN household_members hm2 ON hm1.household_id = hm2.household_id
            WHERE hm1.user_id = (SELECT auth.uid())
          )
        )
        OR (visibility = 'public' AND moderation_status = 'approved')
      )
    )
  );
