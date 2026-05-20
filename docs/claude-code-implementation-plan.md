# Meal Prep App — Claude Code Implementation Plan

## How to use this document

This is structured as a sequence of Claude Code sessions, not one giant prompt. Run them in order. After each session, **verify the listed checks pass before moving on**. If something is broken, fix it before adding more code. The total time for v1 is realistically 4-6 weeks of evenings, not a weekend.

Each session prompt is in a fenced block. Copy-paste it into Claude Code at the start of a fresh session. Replace `<placeholders>` with your actual values.

---

## Prerequisites (do these yourself, not in Claude Code)

Before any Claude Code session, get these set up manually:

1. **Supabase project.** Sign up at supabase.com, create a new project, note the project URL and `anon` key. Wait for it to finish provisioning (~2 minutes).
2. **GitHub repo.** Create an empty private repo. You'll push code to it.
3. **Vercel account.** Sign up, connect your GitHub. You'll deploy from the repo later.
4. **Node.js 20+** installed locally.
5. **`pnpm` installed** (`npm install -g pnpm`). Faster than npm, better monorepo support if you ever need it.

Have these values ready before starting Session 1:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for the seed script only, never ship to client)

---

## Session 1 — Foundation: scaffold, auth, deploy

**Goal:** A deployed, signed-in "hello world" app at a real URL. No features yet. You need this working before anything else.

**Prompt:**

```
I'm building a meal prep app. This first session is just the foundation. Do not add any product features.

Stack:
- TanStack Start (latest stable) with React + TypeScript
- Tailwind CSS
- Supabase for auth and database (already provisioned)
- pnpm as package manager
- Deploy target: Vercel

Tasks:
1. Initialize a TanStack Start project in the current directory with TypeScript.
2. Install and configure Tailwind CSS (latest stable).
3. Install @supabase/supabase-js and @supabase/ssr.
4. Create a typed Supabase client setup with separate browser and server clients. Read env vars from .env.local. Add .env.local to .gitignore. Create .env.example with the var names.
5. Build a minimal auth flow:
   - / (landing): if not signed in, show "Sign in with Google" and "Sign in with email" (magic link). If signed in, redirect to /app.
   - /app: protected route. If not signed in, redirect to /. Otherwise show "Signed in as <email>" and a "Sign out" button.
   - /auth/callback: handles the Supabase OAuth callback.
6. Use TanStack Start's route loaders for the auth check on /app, not client-side useEffect redirects.
7. Add a basic mobile-friendly layout: max-w-md mx-auto, sensible padding, dark-themed (background #0A0A0A, foreground #F5F5F5) since the original artifact is dark.
8. Configure for Vercel deployment. Add a vercel.json if needed.

Do not add a database schema yet. Do not add recipes yet. Just auth.

When done, give me:
- The exact commands to run locally (pnpm install, pnpm dev)
- The exact env vars I need to set in .env.local
- The exact env vars I need to set in Vercel
- The Supabase Auth configuration steps I need to do in the Supabase dashboard (redirect URLs, Google OAuth setup)
```

**Verify before moving on:**
- `pnpm dev` runs without errors
- You can sign in with Google locally
- You can sign in with magic link locally
- `/app` redirects to `/` when signed out
- `/` redirects to `/app` when signed in
- Sign out works
- Push to GitHub, deploy to Vercel, the deployed version also works

If any of these fail, do not start Session 2. Fix them first.

---

## Session 2 — Database schema and row-level security

**Goal:** All tables created with RLS policies. No app features touch the DB yet.

**Prompt:**

```
Add the database schema for the meal prep app. Generate Supabase migrations.

Tables to create (Postgres, in Supabase):

recipes:
- id uuid primary key default gen_random_uuid()
- owner_id uuid references auth.users(id) on delete cascade, nullable (null = system recipe)
- visibility text not null check (visibility in ('private','household','system')) default 'private'
- name text not null
- time_min int
- servings int not null default 1
- macros_total bool not null default false  -- false = macros per serving, true = macros for whole recipe
- calories int
- protein_g numeric
- carbs_g numeric
- fat_g numeric
- macros_source text check (macros_source in ('manual','computed')) default 'manual'
- tags text[] default '{}'
- created_at timestamptz default now()
- updated_at timestamptz default now()

recipe_ingredients:
- id uuid pk default gen_random_uuid()
- recipe_id uuid references recipes(id) on delete cascade
- position int not null
- raw_text text not null
- quantity numeric
- unit text
- name text
- category text
- is_pantry bool default false

recipe_steps:
- id uuid pk default gen_random_uuid()
- recipe_id uuid references recipes(id) on delete cascade
- position int not null
- text text not null
- timer_seconds int

households (table exists but unused in v1):
- id uuid pk default gen_random_uuid()
- name text not null
- created_at timestamptz default now()

household_members (table exists but unused in v1):
- household_id uuid references households(id) on delete cascade
- user_id uuid references auth.users(id) on delete cascade
- role text check (role in ('owner','member')) default 'member'
- joined_at timestamptz default now()
- primary key (household_id, user_id)

plans:
- id uuid pk default gen_random_uuid()
- owner_id uuid references auth.users(id) on delete cascade not null
- household_id uuid references households(id) on delete set null  -- always null in v1
- name text not null default 'Current plan'
- default_multiplier int not null default 1
- archived_at timestamptz  -- always null in v1
- created_at timestamptz default now()

plan_items:
- id uuid pk default gen_random_uuid()
- plan_id uuid references plans(id) on delete cascade not null
- recipe_id uuid references recipes(id) on delete restrict not null
- position int not null
- assigned_protein text
- portion_multiplier numeric not null default 1
- added_at timestamptz default now()

shopping_check_state:
- id uuid pk default gen_random_uuid()
- plan_id uuid references plans(id) on delete cascade not null
- item_key text not null  -- normalized ingredient name
- is_checked bool not null default false
- updated_at timestamptz default now()
- unique (plan_id, item_key)

Indexes:
- recipes(owner_id) where owner_id is not null
- recipes(visibility)
- recipe_ingredients(recipe_id)
- recipe_steps(recipe_id)
- plan_items(plan_id)
- shopping_check_state(plan_id)

Row-level security: enable RLS on every table. Policies:
- recipes: SELECT allowed when visibility='system' OR owner_id=auth.uid(). INSERT/UPDATE/DELETE only when owner_id=auth.uid().
- recipe_ingredients, recipe_steps: SELECT allowed when the parent recipe is visible to the user. Mutations only when the parent recipe is owned by the user.
- plans: SELECT/INSERT/UPDATE/DELETE only when owner_id=auth.uid().
- plan_items, shopping_check_state: SELECT/INSERT/UPDATE/DELETE only when the parent plan is owned by the user.
- households, household_members: deny all in v1 (we'll add policies in v2). Use restrictive policies.

Also generate TypeScript types from this schema. Use supabase gen types or write them manually — match exactly.

When done, give me:
- The migration file(s) to apply via Supabase CLI or SQL editor
- The TypeScript types in src/types/db.ts
- A script in scripts/verify-schema.ts that I can run with tsx to confirm RLS is working (signed-in test queries that should and shouldn't return data)
```

**Verify before moving on:**
- Migration applied cleanly in Supabase
- All tables visible in Supabase Table Editor
- RLS is enabled on every table (red shield icons in dashboard)
- The verify-schema script passes
- Manually check in SQL editor: `select * from recipes` as an anon user returns nothing; as a signed-in user returns only their own + system recipes

---

## Session 3 — Import the starter recipes

**Goal:** The existing 90 recipes from the artifact loaded into Supabase as system recipes (for personal testing only — these won't ship publicly).

**Prompt:**

```
I have an existing React artifact at <path> that contains a hardcoded RECIPES array with 90 recipes. The file is receitas-fit-v33.tsx. The data structure is roughly:

{
  n: string,         // name
  cal: number,       // calories
  p: number,         // protein g
  c: number,         // carbs g
  f: number,         // fat g
  t: number,         // time min
  bs: number,        // base servings
  tags: string[],    // tags
  i: string[],       // ingredients as strings like "200g peito de frango"
  s: string[]        // steps
}

Note: macros (cal/p/c/f) are for the WHOLE recipe at base servings, not per serving. macros_total should be true.

Write a one-time seed script at scripts/seed-recipes.ts that:
1. Reads the RECIPES array from the artifact (parse the .tsx file, or have me paste the array as JSON — your call, recommend the most reliable approach).
2. Uses the Supabase service role key to bypass RLS.
3. For each recipe: insert into recipes (visibility='system', owner_id=null, macros_total=true), then insert each ingredient with a position index and raw_text, attempting basic parsing of quantity/unit/name with a regex (don't be perfect, just attempt; null is fine if parsing fails). Then insert each step with a position index.
4. Detect pantry items (oil, salt, pepper, water, vinegar, common spices) and set is_pantry=true.
5. Map common Portuguese ingredient categories: meat/fish ('Talho/Peixaria'), produce ('Frutas/Legumes'), dairy ('Lacticínios'), grains ('Mercearia'), etc. Best-effort.
6. Idempotent: if a recipe with the same name already exists as a system recipe, skip it (don't duplicate on re-run).
7. Wrap everything in a transaction per recipe so partial inserts don't happen.

Use environment variable SUPABASE_SERVICE_ROLE_KEY. The script should refuse to run if NODE_ENV=production.

Give me the command to run it.
```

**Verify before moving on:**
- Script runs without errors
- Supabase Table Editor shows 90 rows in `recipes` with `visibility='system'`
- A spot-check on 2-3 recipes shows ingredients and steps populated with correct counts
- Pantry items have `is_pantry=true`

---

## Session 3.5 — i18n foundation: translation tables, protein slug migration, LLM translation

**Goal:** Before building any more UI, establish the full i18n foundation so every subsequent session is language-aware from the start. This session has no visible UI changes — it is entirely schema, data, and infrastructure.

**Why now:** The translation tables affect every query. Retrofitting them after Sessions 4–6 are built is significantly more painful than doing it once here.

**Prerequisites:**
- `ANTHROPIC_API_KEY` added to `.env.local` (get from console.anthropic.com)
- Supabase project accessible (service role key already in `.env.local` from Session 3)

**Install before starting:**
```bash
pnpm add i18next react-i18next i18next-browser-languagedetector @anthropic-ai/sdk
```

**Prompt:**

```
Add full i18n infrastructure to the meal prep app. No UI changes in this session — only schema, data migration, translation script, and i18next setup.

## 1. Schema migration (apply via Supabase SQL editor)

Add three translation tables:

```sql
-- Recipe name translations
create table recipe_translations (
  recipe_id uuid references recipes(id) on delete cascade,
  language  text not null,
  name      text not null,
  primary key (recipe_id, language)
);
alter table recipe_translations enable row level security;
create policy "recipe_translations_select" on recipe_translations for select to authenticated
  using (exists (
    select 1 from recipes r where r.id = recipe_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));

-- Ingredient translations (name, unit, raw_text)
create table recipe_ingredient_translations (
  ingredient_id uuid references recipe_ingredients(id) on delete cascade,
  language      text not null,
  name          text,
  unit          text,
  raw_text      text not null,
  primary key (ingredient_id, language)
);
alter table recipe_ingredient_translations enable row level security;
create policy "ingredient_translations_select" on recipe_ingredient_translations for select to authenticated
  using (exists (
    select 1 from recipe_ingredients ri
    join recipes r on r.id = ri.recipe_id
    where ri.id = ingredient_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));

-- Step translations
create table recipe_step_translations (
  step_id  uuid references recipe_steps(id) on delete cascade,
  language text not null,
  text     text not null,
  primary key (step_id, language)
);
alter table recipe_step_security enable row level security;
create policy "step_translations_select" on recipe_step_translations for select to authenticated
  using (exists (
    select 1 from recipe_steps rs
    join recipes r on r.id = rs.recipe_id
    where rs.id = step_id
    and (r.visibility = 'system' or r.owner_id = (select auth.uid()))
  ));
```

## 2. Migrate existing Portuguese content into translation tables

Write and run `scripts/migrate-to-translations.ts` using the service role key:

- For every recipe: insert into `recipe_translations (recipe_id, 'pt', name)`
- For every recipe_ingredient: insert into `recipe_ingredient_translations (ingredient_id, 'pt', name, unit, raw_text)`
- For every recipe_step: insert into `recipe_step_translations (step_id, 'pt', text)`

Idempotent: use `insert ... on conflict do nothing`.

## 3. Migrate protein tokens to language-agnostic English slugs

The `proteins text[]` column currently stores Portuguese tokens (e.g. `'frango'`). Migrate them to English slugs so the filter logic is language-agnostic. Apply via SQL:

```sql
update recipes set proteins = array(
  select case
    when unnest = 'frango'       then 'chicken'
    when unnest = 'salmão'       then 'salmon'
    when unnest = 'atum'         then 'tuna'
    when unnest = 'peru'         then 'turkey'
    when unnest = 'bacalhau'     then 'cod'
    when unnest = 'ovos'         then 'eggs'
    when unnest = 'carne'        then 'beef'
    when unnest = 'carne moída'  then 'beef'
    when unnest = 'porco'        then 'pork'
    when unnest = 'whey'         then 'whey'
    when unnest = 'tofu'         then 'tofu'
    when unnest = 'camarão'      then 'shrimp'
    else unnest
  end
  from unnest(proteins)
);
```

After running, verify with `select distinct unnest(proteins) from recipes order by 1` — all values should be English slugs. Add any remaining Portuguese values to the case statement.

## 4. LLM translation script

Write `scripts/translate-recipes.ts` that:

1. Fetches all recipes with their ingredients and steps from Supabase (service role).
2. Checks which recipes already have an `'en'` row in `recipe_translations` — skips those (idempotent).
3. For each untranslated recipe, calls the Claude API (claude-haiku-4-5-20251001 for cost efficiency) with a structured prompt:

```
Translate the following Portuguese recipe content to English.
Return a JSON object with exactly this structure:
{
  "name": "<translated recipe name>",
  "ingredients": [
    { "id": "<ingredient_id>", "name": "<translated name or null>", "unit": "<translated unit or null>", "raw_text": "<full translated ingredient line>" }
  ],
  "steps": [
    { "id": "<step_id>", "text": "<translated step text>" }
  ]
}
Keep measurements and quantities unchanged. Keep proper nouns (brand names, dish names) unchanged.
```

4. Inserts the translated content into the three translation tables with `language = 'en'`.
5. Processes recipes in batches of 5 to avoid rate limits.
6. Logs progress and any failures. Failed recipes are retried once.
7. Refuses to run if `NODE_ENV=production`.

Run with: `npx tsx scripts/translate-recipes.ts`

## 5. Update src/types/db.ts

Add TypeScript types for the three new translation tables (Row/Insert/Update pattern matching the existing types).

## 6. Update src/lib/supabase/queries.ts

Make `fetchLibrary` and `fetchRecipeById` language-aware:

- Both accept an optional `language: string` param (default `'pt'`).
- Join to translation tables: `recipe_translations`, `recipe_ingredient_translations`, `recipe_step_translations`.
- Use `left join ... on ... and language = $lang` — fall back to the original column value if no translation row exists (coalesce pattern).
- The returned type should present `name`, `raw_text`, `text` already resolved to the requested language — callers do not need to know about the translation layer.

## 7. Set up i18next

Create `src/i18n/index.ts` — configure i18next with:
- `i18next-browser-languagedetector` for auto-detection (localStorage → browser language → fallback 'pt')
- Supported languages: `['pt', 'en']`
- Fallback: `'pt'`
- Translation files loaded from `src/i18n/locales/{lang}/common.json`

Create `src/i18n/locales/pt/common.json` and `src/i18n/locales/en/common.json` with at minimum:

```json
{
  "nav": { "recipes": "Receitas", "plan": "Plano", "list": "Lista" },
  "proteins": {
    "chicken": "Frango", "salmon": "Salmão", "tuna": "Atum",
    "turkey": "Peru", "cod": "Bacalhau", "eggs": "Ovos",
    "beef": "Carne", "pork": "Porco", "whey": "Whey",
    "tofu": "Tofu", "shrimp": "Camarão"
  },
  "categories": {
    "meat": "Talho/Peixaria", "produce": "Frutas/Legumes",
    "dairy": "Lacticínios", "grains": "Mercearia", "other": "Outros"
  },
  "filters": { "protein": "Proteína", "time": "Tempo", "calories": "Calorias" },
  "actions": { "addToPlan": "Adicionar ao plano", "remove": "Remover", "replace": "Substituir", "clearFilters": "Limpar filtros" }
}
```

English version has the English equivalents. Keep keys identical across both files.

Initialize i18next in `src/main.tsx` (or equivalent app entry point) before the React render.

Do not change any UI components yet — the hook `useTranslation` will be adopted in Session 4 when the library UI is rebuilt.
```

**Verify before moving on:**
- `recipe_translations` has one `'pt'` row per recipe (90 rows)
- `recipe_ingredient_translations` has `'pt'` rows for all ingredients
- `recipe_step_translations` has `'pt'` rows for all steps
- `select distinct unnest(proteins) from recipes` shows only English slugs
- `recipe_translations` also has `'en'` rows for all 90 recipes after translation script runs
- Spot-check 3 recipes: English names, ingredients, and steps are accurate translations
- `src/i18n/locales/en/common.json` and `pt/common.json` exist and are valid JSON
- `fetchLibrary()` and `fetchRecipeById()` still return correct data (existing library page still works)

---

## Session 4 — Recipe library (read-only)

**Goal:** A working browse/filter/sort library with best-in-class mobile filter UX. No add-to-plan yet.

**Note:** The basic library scaffold (route, loader, card, detail page) was built in an earlier pass but the filter UX needs to be rebuilt to match this spec. Replace the existing filter panel entirely.

**Install before starting:**
```bash
pnpm add vaul
```

**Prompt:**

```
Rebuild the recipe library filter UX at /app/library to match a modern mobile pattern.

## Library page layout (top to bottom)

1. Persistent search bar — always visible at the top, no toggle needed. Filters recipes by name as the user types (case-insensitive). URL search param: q.

2. Category chip row — a single horizontal row of three filter category chips, always visible below the search bar:
   - "Proteína" (shows selected protein names when active, e.g. "Frango · Salmão")
   - "Tempo" (shows selected time when active, e.g. "< 30 min")
   - "Calorias" (shows selected cal cap when active, e.g. "< 500 cal")
   - Tapping any chip opens the single filter bottom sheet (see below), scrolled to that section.
   - Active chips turn green (border-[#16A34A] text-[#15803d] bg-[#dcfce7]).

3. Sort + count row — "{n} receitas" on the left, sort dropdown on the right (P/Cal ↓, Proteína ↓, Calorias ↑, Tempo ↑).

4. Recipe list — vertical stack of cards.

## Filter bottom sheet (Vaul Drawer)

Use `vaul` for the bottom sheet. One single sheet contains all filter sections — tapping a category chip opens the sheet and scrolls to that section.

Sections inside the sheet:

### Proteína
Multi-select chip grid. Values come from all unique entries in recipes.proteins[] across visible recipes (e.g. Frango, Salmão, Peru, Atum, Bacalhau, Ovos, Carne, Whey). Tapping a chip toggles it. Multiple selections use OR logic — a recipe matches if any of its proteins[] values are in the selected set. URL param: proteins[] array.

### Tempo
Single-select chips: "< 15 min", "< 30 min", "< 60 min". Selecting one sets a max time cap. No selection = no filter (all recipes visible including 90+ min ones). URL param: maxTime number.

### Calorias
Single-select chips: "< 300", "< 500", "< 700". Sets a max calories-per-serving cap. No selection = no filter. URL param: maxCal number.

### Tags
Multi-select chip grid. Only show tags appearing in 3+ recipes (frequency filter). All selections use AND logic. URL param: tags[] array.

### Ingredientes
A combobox input — as the user types, show matching ingredient names as suggestions below the input (substring match against all unique ingredient names across recipes filtered by currently selected proteins). Tapping a suggestion adds it as a removable pill above the input. Multiple ingredients use AND logic (recipe must contain all selected ingredients). URL param: ingredients[] array.

A "Limpar filtros" button at the bottom of the sheet clears all filters.
A drag handle at the top and tap-outside-to-dismiss behavior (Vaul handles both).

## Recipe cards

Each card shows:
- Recipe name
- First protein token (e.g. "Frango") + time if available, on the same row
- P/Cal badge: "P/Cal {ratio}" — green ≥ 1.0, yellow ≥ 0.7, red otherwise
- Macro grid: Cal · P · C · G — all rounded to integers
- Up to 4 tags as pills, "+N" overflow if more

Tapping a card navigates to /app/library/$recipeId.

## Recipe detail page (/app/library/$recipeId)

Keep the existing implementation. The "Adicionar ao plano" button remains disabled — it will be wired in Session 5. The detail page must accept an optional `from` search param (`?from=plan`) so Session 5 can pass context for showing different actions.

## Filter state

All filter state lives in URL search params (validateSearch). This preserves state across navigation and back button.

Do not implement add-to-plan. Do not implement the cooking companion. Just browse, filter, sort, view detail.
```

**Verify before moving on:**
- Library loads all 90 recipes
- Search bar always visible, filters by name in real time
- Tapping each category chip opens the bottom sheet
- Protein multi-select (OR logic) filters correctly
- Time single-select chips filter correctly — no selection shows all recipes including 90+ min
- Calories single-select chips filter correctly
- Ingredient combobox narrows by typed text, multi-select uses AND logic
- Sort works for all four options
- Back button from detail page returns to library with all filter state preserved
- Bottom sheet drag-to-dismiss works on mobile

---

## Session 5 — Schema update + meal prep plan

**Goal:** Add the ingredients schema, build the plan page and bottom navigation. All recipe discovery flows through the library — no duplicate recipe picker modal.

**Schema changes (apply via Supabase SQL editor before building UI):**

```sql
-- Canonical ingredient catalogue
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  default_unit text,
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
create index on ingredients(owner_id) where owner_id is not null;
alter table ingredients enable row level security;
-- System ingredients (owner_id null): readable by all authenticated users
create policy "ingredients_select" on ingredients for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
-- User-created ingredients: full CRUD by owner
create policy "ingredients_insert" on ingredients for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "ingredients_update" on ingredients for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "ingredients_delete" on ingredients for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Per-user category overrides for system ingredients
create table user_ingredient_overrides (
  user_id uuid references auth.users(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete cascade,
  category text not null,
  primary key (user_id, ingredient_id)
);
alter table user_ingredient_overrides enable row level security;
create policy "overrides_all" on user_ingredient_overrides for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
```

Add these types to `src/types/db.ts` to match.

**Prompt:**

```
Build the meal prep plan page at /app/plan and the global bottom navigation.

## Bottom navigation (persistent across all app routes)

Add a bottom nav to the app layout (src/routes/app.tsx) with three tabs:
- "Receitas" → /app/library (book icon)
- "Plano" → /app/plan (calendar icon) — shows a live badge with the count of plan_items in the current plan
- "Lista" → /app/shopping (shopping cart icon) — disabled/greyed out for now (Session 6)

The active tab is highlighted in green (#16A34A). The nav is fixed to the bottom, safe-area aware (pb-safe or equivalent). All pages already have pb-28 padding to clear it.

## Plan page (/app/plan)

### Data model
- A user has at most one non-archived plan at a time.
- On load: if no active plan exists, create one automatically (name='Current plan', default_multiplier=1).
- "Limpar plano" archives the current plan (archived_at = now()) and creates a fresh one (with confirm dialog).

### Page layout

Header: "Meu plano" + recipe count subtitle.

Default multiplier control: a segmented control (1× 2× 3× 4×) that updates plan.default_multiplier. Changing it immediately rescales all displayed macros and totals.

Plan items list: each card shows:
- Recipe name (tappable — navigates to /app/library/$recipeId?from=plan)
- First protein + time row
- Macros per serving × portion_multiplier × default_multiplier (Cal · P · C · G)
- A small "×" button (top-right corner) to remove the item immediately (no confirm)

Empty state: when no plan_items exist, show a centred message "O teu plano está vazio" and a green "Adicionar receita" button that navigates to /app/library.

Weekly totals section (below items): total calories, total protein, total fat, total carbs — summed across all plan_items using (macros per serving × portion_multiplier × default_multiplier).

"Limpar plano" button at the bottom (destructive, requires confirm dialog).

### Recipe detail page — context-aware actions

The existing detail page at /app/library/$recipeId must detect the `from=plan` search param and swap its bottom action:
- Default (from=library or no param): "Adicionar ao plano" button — adds the recipe as a plan_item (portion_multiplier=1, position = max+1) then stays on the page with a toast "Adicionado ao plano ✓"
- from=plan: show "Remover do plano" (removes the plan_item) and "Substituir" (navigates to /app/library?replacing=<planItemId> so the user can pick a replacement from the library — when they add a recipe in replace context it replaces rather than appends)

### State
Use TanStack Query for plan and plan_items. Mutations for add/remove/replace with optimistic updates. Invalidate plan query on success.

Do not implement the shopping list tab yet (Session 6). Do not implement the cooking companion (Session 7).
```

**Verify before moving on:**
- Bottom nav visible on all /app/* pages, correct tab highlighted
- Plan tab badge updates in real time when recipes are added/removed
- /app/plan with no plan auto-creates one
- "Adicionar receita" empty state navigates to library
- Adding a recipe from library detail page shows toast, plan badge increments
- Removing via "×" on plan card works instantly
- "Substituir" from plan context navigates to library, replacing works
- Default multiplier rescales all totals consistently
- Weekly totals are accurate
- Limpar plano confirm dialog works, creates fresh plan

---

## Session 6 — Shopping list

**Goal:** Three-tab navigation complete. Shopping list with two views, custom items, persistent checkboxes, and per-user category overrides.

**Prompt:**

```
Build the shopping list page at /app/shopping and activate the Lista tab in the bottom nav.

## Data

Fetch the user's current plan with all plan_items, each with their recipe and recipe_ingredients.

Quantity scaling: ingredient.quantity × (plan_item.portion_multiplier × plan.default_multiplier) / recipe.servings. This gives the total quantity for that ingredient across the doses being cooked.

Filter out is_pantry=true ingredients.

## Two view modes

Toggle at the top of the page ("Por receita" | "Lista global").

### Por receita
Ingredients grouped under each recipe heading. Each ingredient is a checkbox row showing the scaled quantity + name.

### Lista global
All ingredients across all recipes aggregated and grouped by category. Same ingredient + unit across multiple recipes → sum the quantities. Categories: Talho/Peixaria · Frutas/Legumes · Lacticínios · Mercearia · Outros.

Category resolution order:
1. Check user_ingredient_overrides for the current user + ingredient — use override category if found.
2. Fall back to the ingredient's default category from the ingredients table (if linked).
3. Fall back to the category stored on recipe_ingredients.
4. Fall back to "Outros".

Each category name is tappable — tapping it opens a small picker to reassign the category for that ingredient. On confirm, upsert into user_ingredient_overrides. The change persists across all future shopping lists for this user.

## Custom items

A persistent "+" button (bottom-right FAB or top-right of the Lista global view) opens an inline form: text input for item name + auto-categorization attempt (keyword map → Portuguese ingredient categories). If unrecognised, show a compact category picker before saving. Custom items are stored in shopping_check_state with item_key = `custom:${uuid}` and an extra `label` column (add this column to shopping_check_state).

Custom items appear in Lista global under their category, alongside plan-derived items. They also appear in a "Itens extra" section in Por receita view.

## Checkbox persistence

item_key per mode:
- Por receita: `recipe:${plan_item.id}:ingredient:${ingredient.id}`
- Lista global: `global:${normalized_name}:${unit}`
- Custom: `custom:${uuid}`

Toggling upserts into shopping_check_state. On load, fetch all rows for the plan and apply. Checked items render with strikethrough + muted colour.

"Limpar marcações" button clears all non-custom checks for the plan. A separate "Limpar itens extra" removes custom items.

## Navigation

The Lista tab in the bottom nav is now active. No back button needed — use the bottom nav to switch tabs.
```

**Verify before moving on:**
- Lista tab in bottom nav now active and navigates correctly
- Por receita view groups ingredients correctly under each recipe
- Lista global groups by category, quantities summed correctly
- Pantry items excluded
- Tapping a category name → picker → saves override → persists on reload
- Custom item "+" flow works: auto-categorize → fallback picker → item appears in list
- Checkbox state persists across page reloads
- Limpar marcações clears plan checkboxes, not custom items
- Quantities scale correctly with plan multipliers

---

## Session 7 — Cooking companion

**Goal:** A single-recipe step-by-step cooking mode.

**Prompt:**

```
Add a cooking companion mode to the recipe detail page (/app/library/$recipeId and from plan items).

Behavior:
- Add a "Cozinhar" button to the recipe detail page.
- Tapping it enters a full-screen cooking mode that takes over the viewport.
- Cooking mode shows:
  - Recipe name at top (smaller)
  - Current step number (e.g., "Passo 2 de 5") prominently
  - Current step text in large readable font (text-2xl, line-relaxed)
  - If the current step has timer_seconds, show a circular countdown timer with start/pause/reset
  - The ingredient list is accessible via a "Ingredientes" button that opens a bottom sheet
  - "Anterior" and "Próximo" navigation buttons at the bottom
  - On the last step, "Próximo" becomes "Concluído" and exits cooking mode
- A "Sair" button at the top-right exits cooking mode and returns to the recipe detail.
- Cooking mode prevents the screen from sleeping if the Wake Lock API is available. Gracefully degrade if not.

Timer behavior:
- Plays a short beep when it hits 0 (use Web Audio API; do not bundle an audio file)
- Persists across step navigation if the user manually goes back (timer state in component state is fine; no need to persist across page reloads)

Do not record cooking history or any "made this" state in v1. Just the UX.
```

**Verify before moving on:**
- Cooking mode opens from recipe detail
- Steps navigate forward and back
- Timers count down and beep at zero
- Ingredients sheet opens cleanly
- Wake Lock works on a real mobile device (test this on your phone, not just desktop)
- Exiting returns to the right place

---

## Session 8 — Polish, PWA, deploy

**Goal:** Mobile installability, error states, deployed to Vercel.

**Prompt:**

```
Final polish pass before personal launch:

1. PWA configuration:
   - Add a manifest.webmanifest with the app name, short_name, theme color #0A0A0A, background color #0A0A0A, display: standalone.
   - Generate placeholder app icons (192x192, 512x512) — use a simple colored square with a fork-and-knife emoji or similar, we'll replace with real ones later.
   - Add the necessary <link> tags in the root HTML head.
   - Add a service worker for basic offline support: cache the app shell so the app loads even with no network. Use Workbox or write a minimal one. Recipes/plans don't need to work offline in v1 — just the shell.

2. Error states:
   - 404 page
   - Generic error boundary that shows "Algo correu mal" with a "Tentar novamente" button
   - Loading skeletons for the library page and plan page (not spinners — skeleton placeholders that match the layout)

3. Form validation:
   - All Supabase mutations should handle errors gracefully (show a toast or inline error, don't crash)
   - Optimistic updates should roll back on failure

4. Empty states:
   - Empty plan: "Comece por escolher uma proteína acima" with an arrow pointing up
   - Empty shopping list: "Adiciona receitas ao plano para gerar a lista"
   - Library with no matches: "Sem receitas com estes filtros"

5. Accessibility minimum:
   - All buttons have aria-labels where the visual content is just an icon
   - Color contrast checked on the green/yellow/red P/Cal badges (the yellow especially)
   - Focus states visible (Tailwind ring-2 on interactive elements)

6. Deploy:
   - Confirm pnpm build runs clean
   - Push to GitHub
   - Vercel should auto-deploy
   - Confirm the deployed version works end-to-end with a real account

When done, give me a checklist of things to test manually on a real mobile device before declaring v1 complete.
```

**Verify before declaring v1 done:**
- "Add to Home Screen" on iOS Safari installs the app with the right icon
- Same on Android Chrome
- App launches in standalone mode (no browser chrome)
- All flows work on a real phone (not just browser devtools)
- Error states show correctly when you simulate failures (turn off wifi, try to add a recipe)

---

## After v1: the 4-week test

Use the app daily for 4 weeks with your girlfriend. Track:
1. How often you open it (should be ~1x per week for planning, plus occasional recipe lookups)
2. What's missing that bothers you
3. What's there that you never use

Do not add features during this period. The point is to validate the v1 scope. Write notes; do not code.

After 4 weeks, look at the notes. The next features come from real friction, not speculation.

---

## What to do when a session goes wrong

Some things will break. When they do:

1. **Don't ask Claude Code to fix it without first understanding what's wrong.** Read the error. Check the network tab. Check Supabase logs. Form a hypothesis. Then ask for a targeted fix.

2. **Don't start the next session if the current one is broken.** Compounding bugs across sessions is the worst possible state. Stop, fix, then continue.

3. **Commit after every working session.** Use git tags or branches per session. If session 6 wrecks session 5, you can `git reset --hard` to the last known good state without losing earlier work.

4. **Keep a session log.** A simple `notes.md` where you write what each session did, what didn't work, and what you changed manually. After 8 sessions, your future self will thank you.
