-- ============================================================
-- Performance: pcal_ratio generated column + indexes
-- ============================================================

alter table recipes
  add column if not exists pcal_ratio numeric generated always as (
    protein / nullif(calories, 0)
  ) stored;

create index if not exists recipes_pcal_ratio_idx on recipes (pcal_ratio desc nulls last);

-- ============================================================
-- RPC: get_active_plan
-- Returns the active plan row + item count for a user.
-- Accepts household_id from JWT app_metadata — no DB lookup needed.
-- ============================================================

create or replace function get_active_plan(p_user_id uuid, p_household_id uuid default null)
returns table(
  id              uuid,
  owner_id        uuid,
  household_id    uuid,
  name            text,
  default_multiplier int,
  archived_at     timestamptz,
  created_at      timestamptz,
  item_count      bigint
)
language sql stable security invoker as $$
  select
    p.id,
    p.owner_id,
    p.household_id,
    p.name,
    p.default_multiplier,
    p.archived_at,
    p.created_at,
    count(pi.id) as item_count
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

-- ============================================================
-- RPC: get_recipe_cook_counts
-- Returns per-recipe cook counts for a user — DB GROUP BY
-- instead of JS loop over raw rows.
-- ============================================================

create or replace function get_recipe_cook_counts(p_user_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, count bigint)
language sql stable security invoker as $$
  select recipe_id, count(*)
  from cook_log
  where user_id = p_user_id
    and recipe_id = any(p_recipe_ids)
  group by recipe_id;
$$;

-- ============================================================
-- RPC: get_library_meta
-- Returns distinct proteins, tags, and ingredient names from
-- the full library. Drives filter sheet chips — always from DB
-- so new user-created values appear without a code deploy.
-- ============================================================

create or replace function get_library_meta()
returns json
language sql stable security invoker as $$
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

-- Grant execute to authenticated role
grant execute on function get_active_plan(uuid, uuid) to authenticated;
grant execute on function get_recipe_cook_counts(uuid, uuid[]) to authenticated;
grant execute on function get_library_meta() to authenticated;
