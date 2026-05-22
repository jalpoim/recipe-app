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

## Session 9 — Auth, persistence, and error feedback

**Goal:** Google OAuth, cross-device category override persistence, toast feedback on all mutations, and a 404 page. These are the four gaps identified after Session 8 that block confident daily use.

**Prerequisites:**
- Google OAuth credentials set up in Google Cloud Console (OAuth 2.0 client ID + secret)
- Credentials added to Supabase Auth → Providers → Google
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` already set in Vercel

**Prompt:**

```
Fix the four remaining gaps in the meal prep app before the 4-week test.

## 1. Google OAuth

Add a "Continuar com Google" button to the sign-in page (src/routes/index.tsx), below the magic link form, separated by an "ou" divider.

Button style: white background, border-[#E5E7EB], flex row with a Google SVG icon (inline, standard 4-colour Google G) and the label "Continuar com Google". Full width, same height as the submit button.

Implementation:
- Call supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
- The existing /auth/callback route already handles the redirect — no changes needed there.
- Disable the button while the OAuth redirect is in flight (set a loading flag on click).

## 2. Toast system

Create a lightweight global toast component at src/components/Toast.tsx:
- Renders a fixed bottom-centre pill (above the bottom nav, so bottom-20 or bottom-24)
- Accepts a message string and a variant: 'success' | 'error'
- Success: bg-[#16A34A] text-white. Error: bg-[#DC2626] text-white.
- Auto-dismisses after 2.5s. Animated: slide up on enter, fade out on exit (Tailwind transition classes, no library).
- Exposed via a useToast() hook backed by a simple React context (ToastProvider wrapping the app in src/routes/__root.tsx).

Wire toast feedback onto every mutation that currently has no error handling:

In src/routes/app/library/index.tsx:
- addRecipeToPlan onError → toast error "Erro ao adicionar ao plano"
- replacePlanItem onError → toast error "Erro ao substituir receita"

In src/routes/app/plan.tsx:
- removePlanItem onError → toast error "Erro ao remover receita"
- updatePlanMultiplier onError → toast error "Erro ao actualizar multiplicador"

In src/routes/app/shopping.tsx:
- upsertCheck onError → toast error "Erro ao guardar"
- addCustomShoppingItem onError → toast error "Erro ao adicionar item"
- deleteCustomShoppingItem onError → toast error "Erro ao remover item"
- clearNonCustomChecks onError → toast error "Erro ao limpar marcações"
- clearCustomItems onError → toast error "Erro ao limpar itens"

In src/routes/app/library/$recipeId.tsx:
- The existing showToast("Adicionado ao plano ✓") is fine — wire it to the new global toast system instead of the local one so the component can be simplified.

## 3. Category override persistence (cross-device)

Currently stored in localStorage. Replace with a Supabase-backed table.

### Schema (apply via Supabase SQL editor)

```sql
create table user_category_overrides (
  user_id       uuid references auth.users(id) on delete cascade,
  ingredient_name text not null,
  category      text not null,
  updated_at    timestamptz default now(),
  primary key (user_id, ingredient_name)
);
alter table user_category_overrides enable row level security;
create policy "user_category_overrides_all" on user_category_overrides
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

### Server functions (add to src/lib/supabase/shopping-queries.ts)

```ts
// GET: fetch all overrides for current user
fetchCategoryOverrides: createServerFn GET → select * from user_category_overrides where user_id = auth.uid()
// Returns: { ingredient_name: string, category: string }[]

// POST: upsert a single override
upsertCategoryOverride: createServerFn POST → input { ingredientName: string, category: string }
→ upsert { user_id: auth.uid(), ingredient_name, category, updated_at: now() } on conflict (user_id, ingredient_name) do update
```

### Update src/routes/app/shopping.tsx

- Replace the localStorage categoryOverrides state with a TanStack Query query backed by fetchCategoryOverrides.
- On load, build the categoryOverrides record from the query data: { [row.ingredient_name]: row.category }.
- When the user confirms a category change, call upsertCategoryOverride and invalidate the query.
- Remove all localStorage.getItem / localStorage.setItem calls for category overrides.

## 4. 404 page

Add a notFoundComponent to the root route in src/routes/__root.tsx:

```tsx
function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FAFAF8] px-4 text-center">
      <p className="text-5xl">🥗</p>
      <h1 className="text-xl font-semibold text-[#1A1A1A]">Página não encontrada</h1>
      <p className="text-sm text-[#6B7280]">Este endereço não existe.</p>
      <a href="/app/library" className="mt-2 rounded-lg bg-[#16A34A] px-5 py-2.5 text-sm font-semibold text-white">
        Ir para as receitas
      </a>
    </div>
  )
}
```

Pass it as `notFoundComponent: NotFound` on the root route options.
```

**Verify before moving on:**
- "Continuar com Google" button appears on sign-in page, redirects to Google, lands back at /app
- Tapping category name in shopping list → picker → change persists on reload on a different device/browser
- All error toasts appear when mutations fail (test by temporarily disabling network)
- Navigating to /app/nonexistent shows the 404 page, not a blank screen

---

## Session 10 — Households

**Goal:** Two-person shared household with one shared plan, shared recipe library, invite-by-link flow, and leave/dissolve logic.

**Design decisions (locked):**
- One shared plan per household — no personal plan while in a household
- Invite via a single-use shareable link (`/join/[token]`), no expiry, revocable from Settings
- Hard cap: 2 members max
- Household name auto-set to "[First] & [First]" from both members' email prefixes
- New recipes created while in a household default to `visibility = 'household'`
- On household creation: inviter's existing private recipes migrate to `visibility = 'household'`; inviter's active plan becomes the household plan (`plans.household_id = household.id`)
- On invite acceptance: invitee's active plan is archived; invitee is added to household and sees the shared plan
- On leave (< 2 members remain): household plan is archived; both users get a fresh personal plan; all household recipes revert to `visibility = 'private'` on their respective `owner_id`
- Conflict strategy: last-write-wins (Postgres upserts are atomic enough)
- UI lives in the existing Settings page as a new "Household" section

**Schema changes (apply via Supabase SQL editor before building UI):**

```sql
-- Invite tokens
create table household_invites (
  id           uuid primary key default gen_random_uuid(),
  token        uuid unique not null default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete cascade,
  used_at      timestamptz,
  created_at   timestamptz default now()
);
alter table household_invites enable row level security;
-- Only the creator can read/delete their own invite tokens
create policy "invites_select" on household_invites for select to authenticated
  using (created_by = (select auth.uid()));
create policy "invites_delete" on household_invites for delete to authenticated
  using (created_by = (select auth.uid()));
-- Allow anon read for the join page (token lookup before auth)
create policy "invites_anon_select" on household_invites for select to anon
  using (used_at is null);

-- Household members policies
create policy "household_members_select" on household_members for select to authenticated
  using (user_id = (select auth.uid())
    or household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    ));

-- Households: readable by members
create policy "households_select" on households for select to authenticated
  using (id in (
    select household_id from household_members where user_id = (select auth.uid())
  ));

-- Drop the v1 deny-all policies on households/household_members before adding the above.

-- Update recipes RLS: household members can see visibility='household' recipes from same household
drop policy if exists "recipes_select" on recipes;
create policy "recipes_select" on recipes for select to authenticated
  using (
    owner_id = (select auth.uid())
    or visibility = 'system'
    or (
      visibility = 'household'
      and owner_id in (
        select hm2.user_id from household_members hm1
        join household_members hm2 on hm1.household_id = hm2.household_id
        where hm1.user_id = (select auth.uid())
      )
    )
  );

-- Update plans RLS: household members can read/write the household plan
drop policy if exists "plans_select" on plans;
create policy "plans_select" on plans for select to authenticated
  using (
    owner_id = (select auth.uid())
    or household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );
drop policy if exists "plans_update" on plans;
create policy "plans_update" on plans for update to authenticated
  using (
    owner_id = (select auth.uid())
    or household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    or household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );

-- plan_items and shopping_check_state: extend to household plans
drop policy if exists "plan_items_select" on plan_items;
create policy "plan_items_select" on plan_items for all to authenticated
  using (
    plan_id in (
      select id from plans where
        owner_id = (select auth.uid())
        or household_id in (
          select household_id from household_members where user_id = (select auth.uid())
        )
    )
  );
drop policy if exists "shopping_check_state_all" on shopping_check_state;
create policy "shopping_check_state_all" on shopping_check_state for all to authenticated
  using (
    plan_id in (
      select id from plans where
        owner_id = (select auth.uid())
        or household_id in (
          select household_id from household_members where user_id = (select auth.uid())
        )
    )
  );
```

**Prompt:**

```
Implement the household feature for the meal prep app. All design decisions are locked — do not deviate.

## Design summary (locked)

- Two-person household (hard cap: 2 members)
- One shared plan per household; no personal plan while in a household
- Invite via single-use shareable link (/join/[token]), no expiry, revocable from Settings
- Household name auto-set to "[First] & [First]" from both users' email prefixes (everything before @)
- New recipes created while in household → visibility = 'household'
- On household creation: inviter's private recipes → visibility = 'household'; inviter's active plan gets household_id set (becomes the shared plan)
- On invite acceptance: invitee's active plan archived; invitee joins household and sees the shared plan
- On leave (< 2 members): household plan archived; both get fresh personal plans; household recipes revert to visibility = 'private' on their owner_id
- Conflict strategy: last-write-wins (Postgres upserts are atomic)
- UI: Settings page, new "Household" section

The schema changes (household_invites table, updated RLS for recipes/plans/plan_items/shopping_check_state, policies on households/household_members) have already been applied to the database.

## 1. New server functions — src/lib/supabase/household-queries.ts

createServerFn for each of these. Use the authenticated Supabase client (getCookies/setCookie pattern already in plan-queries.ts):

**createHousehold()**
- POST, no input
- Creates a households row (name = placeholder, set properly after both users join)
- Adds current user to household_members (role = 'owner')
- Migrates current user's private recipes to visibility = 'household': UPDATE recipes SET visibility = 'household' WHERE owner_id = auth.uid() AND visibility = 'private'
- Sets household_id on the user's current active plan: UPDATE plans SET household_id = new_household_id WHERE owner_id = auth.uid() AND archived_at IS NULL
- Returns the household row

**generateInviteToken()**
- POST, no input
- Inserts into household_invites for the caller's household
- Returns the token (uuid)

**revokeInviteToken()**
- POST, input: { token: string }
- Deletes the household_invites row where created_by = auth.uid()

**fetchInviteInfo(token)**
- GET, input: { token: string }
- Runs as anon (no auth required) — used on the /join/[token] page before the user signs in
- Selects from household_invites (where used_at IS NULL) + joins to households + auth.users to get the inviter's email
- Returns: { inviterName: string, householdExists: boolean } or null if token invalid/used
- Note: to query auth.users from a server function you need the service role key — use process.env.SUPABASE_SERVICE_ROLE_KEY for this function only

**acceptInvite(token)**
- POST, input: { token: string }
- Validates token exists and used_at IS NULL
- Validates the household is not already full (count household_members < 2)
- Archives the current user's active plan (if any): UPDATE plans SET archived_at = now() WHERE owner_id = auth.uid() AND archived_at IS NULL AND household_id IS NULL
- Adds user to household_members (role = 'member')
- Marks invite as used: UPDATE household_invites SET used_at = now()
- Updates household name: "[inviterFirst] & [joinerFirst]" (extract first part of each email before @)
- Returns the household row

**fetchHouseholdInfo()**
- GET, no input
- Returns null if user is not in a household
- Returns: { household: { id, name }, members: { userId, email, role }[], inviteToken: string | null }
- inviteToken = the unused invite token for this household created by the current user (if any)

**leaveHousehold()**
- POST, no input
- Removes current user from household_members
- Archives the household plan: UPDATE plans SET archived_at = now() WHERE household_id = household.id AND archived_at IS NULL
- Creates a fresh personal plan for current user: INSERT INTO plans (owner_id, name) VALUES (auth.uid(), 'Current plan')
- Reverts this user's household recipes to private: UPDATE recipes SET visibility = 'private' WHERE owner_id = auth.uid() AND visibility = 'household'
- If the other member still exists in the household: also archive their plan and create a fresh personal plan for them + revert their recipes (requires service role for cross-user writes)
- Returns { ok: true }

## 2. New route — src/routes/join/$token.tsx

Public route (no auth guard). This page is accessible before sign-in.

Page behavior:
- In the loader, call fetchInviteInfo(token). If null (invalid/used/not found), show an error state: "Este convite não é válido ou já foi utilizado."
- If valid, show: "[InviterName] convidou-te para o seu household" + the household name if available, or just "Meal Prep" + "Aceitar convite" CTA button
- Design matches the rest of the app (bg-[#FAFAF8], green button, max-w-md centered)

On "Aceitar convite":
- If the user is already authenticated: call acceptInvite(token) directly, then navigate to /app/library
- If not authenticated: save the token to localStorage under key 'pendingInviteToken', then navigate to / (sign-in page)

## 3. Update src/routes/app.tsx — process pending invite after auth

In the beforeLoad of the /app route (after getAuthUser() confirms auth):

```ts
// After confirming user is authenticated, check for pending invite
const pendingToken = typeof localStorage !== 'undefined'
  ? localStorage.getItem('pendingInviteToken')
  : null
if (pendingToken) {
  localStorage.removeItem('pendingInviteToken')
  try {
    await acceptInvite({ data: { token: pendingToken } })
  } catch {
    // Silently ignore — invite may be expired or already used
  }
}
```

## 4. Update src/lib/supabase/plan-queries.ts — ensureActivePlan is household-aware

The ensureActivePlan function must return the household plan if the user is in a household:

```ts
// Check for household membership first
const { data: membership } = await supabase
  .from('household_members')
  .select('household_id')
  .eq('user_id', user.id)
  .maybeSingle()

if (membership) {
  // Return the active household plan
  const { data: householdPlan } = await supabase
    .from('plans')
    .select('*')
    .eq('household_id', membership.household_id)
    .is('archived_at', null)
    .maybeSingle()
  if (householdPlan) return householdPlan as Plan
  // If no active household plan exists, create one
  const { data, error } = await supabase
    .from('plans')
    .insert({ owner_id: user.id, household_id: membership.household_id, name: 'Current plan' })
    .select().single()
  if (error) throw new Error(error.message)
  return data as Plan
}
// Fall through to personal plan logic (existing code)
```

Also update addRecipeToPlan to use the same household-aware lookup (same pattern).

## 5. Update src/routes/app/settings.tsx — Household section

Add a "Household" section below the existing Language and Theme sections.

### State: no household

Show:
- A "Criar household" button (green, full-width rounded-2xl)
- Below it, small muted text: "Cria um household para partilhar o plano com outra pessoa."

On tap:
- Call createHousehold()
- Then call generateInviteToken()
- Show the invite link in a copyable input: `${window.location.origin}/join/${token}`
- Add a "Copiar link" button (copies to clipboard via navigator.clipboard.writeText)
- Add a "Revogar convite" link (calls revokeInviteToken, clears the displayed link)

### State: in household, invite pending (no second member yet)

Show:
- Household name as a section title
- "Aguardando membro..." with a muted subtitle
- The invite link (same copyable input as above)
- "Revogar convite" link

### State: in household, 2 members

Show:
- Household name as a section title
- Both member emails (or name derived from email prefix) listed as small pills or rows
- A "Sair do household" button (outlined, text-[#DC2626] border-[#DC2626]) with a confirmation dialog: "Ao sair, o plano partilhado será arquivado e ambos voltarão ao plano pessoal."

Use useQuery with fetchHouseholdInfo for the state, invalidate on all mutations.

## 6. Update src/types/db.ts

Add the HouseholdInvite type (Row/Insert/Update). Add household_invites to the Database type. Add a helper type HouseholdMemberWithEmail for use in fetchHouseholdInfo.

## Notes

- Do not add recipe creation UI in this session — recipe visibility defaulting to 'household' will be handled when recipe creation is built.
- The fetchActivePlanWithCount query used in the bottom nav badge already reads from the plans table via the updated RLS, so the badge will reflect the household plan automatically.
- Do not implement household name editing — the auto-name is final in v1.
- fetchInviteInfo must not require auth — it is called from the /join route before the user has signed in. The anon RLS policy on household_invites covers the token lookup. For fetching the inviter's name from auth.users, use the service role key.
```

**Verify before moving on:**
- Creating a household from Settings works; invite link is displayed and copyable
- Opening the invite link in an incognito window shows the invite screen with the inviter's name
- Signing in via the invite link (new account) lands in /app/library with the shared plan visible
- Both users see the same plan items and shopping list
- Adding a recipe on one device appears on the other after refresh
- Settings shows both member names once the second user has joined
- "Sair do household" archives the shared plan and both users get a fresh empty personal plan
- After leaving, the previously shared recipes are private to their original owners
- Invite token is consumed after use — opening the link again shows "convite inválido"
- Hard cap: attempting to use a second invite on a full household shows an error

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

---

## Session 11 — Behavioural foundations: cook log, interactions, user tags, system tag i18n

**Goal:** Lay the data foundations that every future feature — recommendations, rotation intelligence, social proof, the Sunday email — depends on. No visible UI changes except system tags now displaying translated labels. This session is entirely schema, data, and infrastructure.

**Why now:** The cook log is the single most important table not yet in the schema. Every week a plan is archived without it is a signal permanently lost. User interactions (likes, saves, hides) need to exist before you have enough users to make recommendations meaningful — you want historical data from day one. These tables are cheap to add now and expensive to retrofit later.

---

## 1. Schema changes (apply via Supabase MCP execute_sql)

### cook_log

```sql
create table cook_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  recipe_id    uuid not null references recipes(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  cooked_at    timestamptz not null default now(),
  source       text not null check (source in ('planned', 'manual')),
  rating       smallint check (rating between 1 and 5),
  created_at   timestamptz not null default now()
);

alter table cook_log enable row level security;

create policy "cook_log_select" on cook_log for select to authenticated
  using (user_id = (select auth.uid())
    or household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    ));

create policy "cook_log_insert" on cook_log for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "cook_log_update" on cook_log for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cook_log_delete" on cook_log for delete to authenticated
  using (user_id = (select auth.uid()));

create index on cook_log(user_id);
create index on cook_log(recipe_id);
create index on cook_log(household_id) where household_id is not null;
create index on cook_log(cooked_at desc);
```

### user_recipe_interactions

```sql
create table user_recipe_interactions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  uuid not null references recipes(id) on delete cascade,
  type       text not null check (type in ('like', 'save', 'hide')),
  user_tags  text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id, type)
);

alter table user_recipe_interactions enable row level security;

create policy "interactions_select" on user_recipe_interactions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "interactions_insert" on user_recipe_interactions for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "interactions_update" on user_recipe_interactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "interactions_delete" on user_recipe_interactions for delete to authenticated
  using (user_id = (select auth.uid()));

create index on user_recipe_interactions(user_id);
create index on user_recipe_interactions(recipe_id);
```

### user_tags on recipes (for user-created recipes only)

```sql
alter table recipes add column if not exists user_tags text[] not null default '{}';
```

`user_tags` is freeform, household-scoped, and never translated. Only meaningful on recipes where `owner_id` is not null. System recipes (`owner_id = null`) always have `user_tags = '{}'`.

### notification_preferences

```sql
create table notification_preferences (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  weekly_email_enabled boolean not null default true,
  updated_at           timestamptz not null default now()
);

alter table notification_preferences enable row level security;

create policy "notif_prefs_all" on notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

---

## 2. Add types to src/types/db.ts

Add full Row/Insert/Update + `Relationships: []` entries for:
- `cook_log`
- `user_recipe_interactions`
- `notification_preferences`

Add `user_tags: string[]` to the `recipes` Row, Insert, and Update types.

Export convenience types:
```typescript
export type CookLog = Database['public']['Tables']['cook_log']['Row']
export type CookLogInsert = Database['public']['Tables']['cook_log']['Insert']
export type UserRecipeInteraction = Database['public']['Tables']['user_recipe_interactions']['Row']
export type NotificationPreferences = Database['public']['Tables']['notification_preferences']['Row']
```

---

## 3. Cook log server functions (src/lib/supabase/cook-log-queries.ts)

```typescript
// POST: log a recipe as cooked
logRecipeCooked({ recipeId, source, householdId? })
  // inserts into cook_log with cooked_at = now()

// POST: rate a cook log entry
rateCookLogEntry({ cookLogId, rating })
  // updates cook_log.rating

// GET: fetch cook log for current user (most recent first, limit 50)
fetchCookLog(): Promise<CookLog[]>

// GET: fetch cook counts per recipe (for social proof display)
// Returns { recipeId: string, count: number }[]
fetchRecipeCookCounts(recipeIds: string[]): Promise<{ recipe_id: string; count: number }[]>
```

---

## 4. User recipe interactions server functions (src/lib/supabase/interaction-queries.ts)

```typescript
// POST: upsert an interaction (like, save, or hide)
upsertInteraction({ recipeId, type })

// POST: remove an interaction
removeInteraction({ recipeId, type })

// GET: fetch all interactions for current user
fetchInteractions(): Promise<UserRecipeInteraction[]>
```

---

## 5. Trigger: auto-log cooked recipes from archived plans

When `archiveAndCreatePlan` is called (the user starts a new week), silently insert `cook_log` rows for all plan items in the plan being archived, with `source = 'planned'`. This bootstraps cook history automatically from existing behaviour with no user action required.

Update `archiveAndCreatePlan` in `src/lib/supabase/plan-queries.ts`:

```typescript
// Before archiving, fetch all plan items
const { data: items } = await supabase
  .from('plan_items')
  .select('recipe_id')
  .eq('plan_id', planId)

// Insert cook_log rows for each
if (items && items.length > 0) {
  await supabase.from('cook_log').insert(
    items.map((item) => ({
      user_id: user.id,
      recipe_id: item.recipe_id,
      household_id: plan.household_id ?? null,
      source: 'planned',
      cooked_at: new Date().toISOString(),
    }))
  )
}
```

---

## 6. System tag i18n keys

Add a `tags` block to both `src/i18n/locales/pt/common.json` and `src/i18n/locales/en/common.json`:

**pt:**
```json
"tags": {
  "air-fryer": "Air Fryer",
  "forno": "Forno",
  "micro-ondas": "Micro-ondas",
  "sem-cozinha": "Sem Cozinha",
  "uma-frigideira": "Uma Frigideira",
  "indiano": "Indiano",
  "português": "Português",
  "sem-glúten": "Sem Glúten",
  "vegetariano": "Vegetariano",
  "pequeno-almoço": "Pequeno-almoço",
  "meal-prep": "Meal Prep",
  "leve": "Leve",
  "rápido": "Rápido",
  "reconfortante": "Reconfortante"
}
```

**en:**
```json
"tags": {
  "air-fryer": "Air Fryer",
  "forno": "Oven",
  "micro-ondas": "Microwave",
  "sem-cozinha": "No-Cook",
  "uma-frigideira": "One-Pan",
  "indiano": "Indian",
  "português": "Portuguese",
  "sem-glúten": "Gluten-Free",
  "vegetariano": "Vegetarian",
  "pequeno-almoço": "Breakfast",
  "meal-prep": "Meal Prep",
  "leve": "Light",
  "rápido": "Quick",
  "reconfortante": "Comfort Food"
}
```

Then update every place that renders a system tag verbatim — `RecipeCard` in `library/index.tsx` and the Tags section in `FilterSheet` — to use `t(`tags.${tag}`)` instead of `{tag}`.

---

## 7. Surface cook counts on recipe cards (optional, do last)

In `fetchLibrary`, add an aggregate subquery or a separate `fetchRecipeCookCounts` call to get total cook counts per recipe. Add a small muted count to `RecipeCard`:

```tsx
{cookCount > 0 && (
  <span className="text-[10px] text-[#9CA3AF]">{cookCount}× cooked</span>
)}
```

Only show when `cookCount > 0`. This is the first surface of social proof and requires no user interaction — it populates automatically from the auto-log in step 5.

---

## Verify before moving on

- `cook_log` table exists; archiving a plan inserts rows automatically
- `user_recipe_interactions` table exists; like/save/hide server functions work
- `notification_preferences` table exists
- `user_tags` column exists on `recipes`
- System tags display translated labels in both PT and EN (check by switching language in Settings)
- Cook counts appear on recipe cards after archiving at least one plan

---

## Current state (as of May 2026) — read this before starting any new session

### What is fully built and deployed

| Area | Status | Notes |
|------|--------|-------|
| Auth (magic link + Google OAuth) | ✅ Done | |
| Recipe library — browse, filter, search, sort | ✅ Done | Cursor-based pagination, 24/page, virtual list |
| Library filters — Vaul bottom sheet | ✅ Done | Protein chips, time/cal caps, tags, ingredients |
| Recipe detail — portion scaling, cooking companion | ✅ Done | Timer is global across steps (not per-step) |
| Meal prep plan — add/replace/remove/clear | ✅ Done | |
| Shopping list — per-recipe + global, checkboxes, pantry | ✅ Done | |
| Households — shared plan + shopping, JWT-backed | ✅ Done | JWT refresh on invite accept fixed May 2026 |
| Performance — JWT session, getSession(), household from app_metadata | ✅ Done | get_active_plan, get_recipe_cook_counts RPCs |
| i18n — PT + EN, recipe/ingredient/step translations | ✅ Done | |
| PWA manifest + icons | ✅ Done | |
| Settings — profile, sign out, household management | ✅ Done | |
| cook_log table + server functions | ✅ Schema+fns done | **No UI yet — nothing calls logRecipeCooked** |
| user_recipe_interactions table + server functions | ✅ Schema+fns done | **No UI yet** |
| System tag translations (i18n keys) | ✅ Done | tags.* block in both locale files; FilterSheet + RecipeCard use t('tags.*') |
| Tags section collapse in FilterSheet | ✅ Done | 6 tags shown by default, Ver mais/Ver menos toggle |
| Filter chip visual feedback | ✅ Done | Section highlight on sheet open via sheetSection state |
| PostHog analytics | ✅ Done | All events wired: recipe_viewed, filter_applied, search_performed, tab_switched, plan_archived, shopping_view_toggled, recipe_added_to_plan |
| Cook counts on library cards | ✅ Done | fetchRecipeCookCounts RPC wired to RecipeCard |
| Language switch cache fix | ✅ Done | lang added to filterKey so switching language triggers refetch (May 2026) |
| Recipe creation UI | ❌ Not done | Deferred — see locked decisions below |

### Recipe library — what's in the DB

- **95 system recipes** (visibility='system', owner_id=null):
  - 50 Joe x Fitness (Korean/Asian, from cookbook — `scripts/joe-x-fitness-recipes.json`)
  - 45 AI-generated (`scripts/ai-generated-recipes.json`) — 20 were deleted after quality check (ERROR-level macro issues)
- **116 Cooking Abs cookbook recipes** (visibility='system', owner_id=null, seeded from `scripts/cookbook-recipes.json`) — Portuguese fitness cooking
- Total: **211 system recipes**

Tags are now clean: `fit`, `alto proteína`, `rápido`, `coreano`, `meal-prep`, `air-fryer`, `micro-ondas`, `sem-cozinha`, `uma-frigideira`, `leve`, `reconfortante`, `acompanhamento`, `sopa`, `vegetariano`.

### Recipe creation UI — locked decisions (for when this is built)

- **Tag input**: show canonical system tags as pre-built chips organised by section. Text input autocompletes against system tags first, then user's previously used custom tags. Free text allowed for new custom tags.
- **Hard cap**: 6 system tags per recipe. 7th chip disabled until one is removed.
- **Cuisine tags**: max 1 per recipe (enforced by UI — selecting a new cuisine deselects the previous).
- **Cooking method tags**: max 1 per recipe in most cases.
- **`alto-proteína`**: auto-applied when `pcal_ratio ≥ 0.7`. Not user-selectable.
- **`fit` tag**: shown as a toggle ("Esta receita é uma versão fit de um prato clássico?"). Default off. User opts in explicitly.
- **`vegan` implies `vegetariano`**: selecting vegan auto-applies vegetarian and disables it as a separate option.
- **Custom tags**: stored in `recipes.tags[]` like system tags. A tag is "custom" if its slug is not in the locale files. Custom tags appear in a "Os meus tags" section in the filter sheet, visible only to that user.
- **Tag promotion**: periodically query `SELECT unnest(tags), count(*) FROM recipes WHERE owner_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`. Run Claude against top candidates. Human reviews and approves. Promoted tags added to locale files — instantly become system tags everywhere.
- **AI tag suggestion**: after ingredients/steps/macros are filled in, auto-suggest tags using Claude. User accepts, rejects, or modifies before saving.

### Key architectural decisions already locked in

- **Cursor pagination** — composite `(sort_field, id)` cursor, 24 per page
- **Sort** — server-side for pagination, client-side reorder for instant UX (sort excluded from queryKey)
- **Auth** — `getSession()` everywhere except security-sensitive mutations (those use `getUser()`)
- **household_id** — stored in `app_metadata` JWT claims; refreshed explicitly after join/leave
- **Translations** — `recipe_translations`, `recipe_ingredient_translations`, `recipe_step_translations` tables keyed by `(entity_id, language)`. Falls back to PT if EN row missing.
- **Macros** — stored, not computed. `macros_total = true` means divide by servings for per-serving display.

### What to do next — Session 11 (cook log UI)

Sessions 10.5 is fully done. Schema and server functions for Session 11 are also done. Only the UI remains:

1. **Cook log UI** — "Cozinhei isto" button on the recipe detail page (accessible from both library and plan) and at the end of the cooking companion flow. On tap: call `logRecipeCooked({ recipeId, source: 'manual', householdId })`, invalidate cook counts, show toast. Button label updates to "Cozinhei isto outra vez" after first tap with a debounce of 3s to prevent accidental double-logs. Undo available immediately after each tap.
2. **"Cozinhaste isto X vezes"** — Show personal cook count on the recipe detail page (not the card) using `fetchRecipeCookCounts`. Only show when count > 0.
3. **No auto-log on plan archive** — Planning ≠ cooking. Removed from scope.

### Supabase project

- Project ID: `kgvycfrvxzkfhvuazzle`
- Region: eu-west-1
- Users: joao.chaves.g@hotmail.com (main), jchavesalp@gmail.com (test account), mariaa.ramalho97@gmail.com (girlfriend)
- Household: `6cf657e3-823c-4a9a-bf27-b2cd3b857641` (owner: jchavesalp, member: mariaa)
- No regressions: plan page, shopping list, household flows all work as before
