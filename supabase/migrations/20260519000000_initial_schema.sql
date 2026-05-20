-- ============================================================
-- Meal Prep App — initial schema
-- Apply this in Supabase: SQL Editor → New query → Run
-- ============================================================

-- ----------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------

create table recipes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references auth.users(id) on delete cascade,
  visibility    text not null default 'private'
                  check (visibility in ('private', 'household', 'system')),
  name          text not null,
  time_min      int,
  servings      int not null default 1,
  macros_total  bool not null default false,
  calories      int,
  protein       numeric,
  carbs         numeric,
  fat           numeric,
  macros_source text default 'manual'
                  check (macros_source in ('manual', 'computed')),
  proteins      text[] not null default '{}',
  tags          text[] not null default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  position   int not null,
  raw_text   text not null,
  quantity   numeric,
  unit       text,
  name       text,
  category   text,
  is_pantry  bool not null default false
);

create table recipe_steps (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes(id) on delete cascade,
  position      int not null,
  text          text not null,
  timer_seconds int
);

create table households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz default now(),
  primary key (household_id, user_id)
);

create table plans (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  household_id       uuid references households(id) on delete set null,
  name               text not null default 'Current plan',
  default_multiplier int not null default 1,
  archived_at        timestamptz,
  created_at         timestamptz default now()
);

create table plan_items (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references plans(id) on delete cascade,
  recipe_id          uuid not null references recipes(id) on delete restrict,
  position           int not null,
  assigned_protein   text,
  portion_multiplier numeric not null default 1,
  added_at           timestamptz default now()
);

create table shopping_check_state (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  item_key   text not null,
  is_checked bool not null default false,
  updated_at timestamptz default now(),
  unique (plan_id, item_key)
);

-- ----------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------

create index on recipes(owner_id) where owner_id is not null;
create index on recipes(visibility);
create index on recipes using gin(proteins);
create index on recipe_ingredients(recipe_id);
create index on recipe_steps(recipe_id);
create index on plan_items(plan_id);
create index on shopping_check_state(plan_id);

-- ----------------------------------------------------------------
-- updated_at trigger for recipes
-- ----------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------

alter table recipes               enable row level security;
alter table recipe_ingredients    enable row level security;
alter table recipe_steps          enable row level security;
alter table households            enable row level security;
alter table household_members     enable row level security;
alter table plans                 enable row level security;
alter table plan_items            enable row level security;
alter table shopping_check_state  enable row level security;

-- recipes
create policy "recipes_select" on recipes
  for select using (visibility = 'system' or owner_id = auth.uid());

create policy "recipes_insert" on recipes
  for insert with check (owner_id = auth.uid());

create policy "recipes_update" on recipes
  for update using (owner_id = auth.uid());

create policy "recipes_delete" on recipes
  for delete using (owner_id = auth.uid());

-- recipe_ingredients
create policy "recipe_ingredients_select" on recipe_ingredients
  for select using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id
        and (r.visibility = 'system' or r.owner_id = auth.uid())
    )
  );

create policy "recipe_ingredients_insert" on recipe_ingredients
  for insert with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_ingredients_update" on recipe_ingredients
  for update using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_ingredients_delete" on recipe_ingredients
  for delete using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

-- recipe_steps
create policy "recipe_steps_select" on recipe_steps
  for select using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id
        and (r.visibility = 'system' or r.owner_id = auth.uid())
    )
  );

create policy "recipe_steps_insert" on recipe_steps
  for insert with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_steps_update" on recipe_steps
  for update using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_steps_delete" on recipe_steps
  for delete using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.owner_id = auth.uid()
    )
  );

-- plans
create policy "plans_all" on plans
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- plan_items
create policy "plan_items_all" on plan_items
  for all using (
    exists (
      select 1 from plans p
      where p.id = plan_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from plans p
      where p.id = plan_id and p.owner_id = auth.uid()
    )
  );

-- shopping_check_state
create policy "shopping_check_state_all" on shopping_check_state
  for all using (
    exists (
      select 1 from plans p
      where p.id = plan_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from plans p
      where p.id = plan_id and p.owner_id = auth.uid()
    )
  );

-- households: deny all in v1
create policy "households_deny_all" on households
  as restrictive
  for all using (false);

-- household_members: deny all in v1
create policy "household_members_deny_all" on household_members
  as restrictive
  for all using (false);
