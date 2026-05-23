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
| Web interface guideline fixes | ✅ Done | motion-reduce on skeletons, aria-hidden+Escape on CookingMode sheet backdrop, overscroll-contain, variable shadow fix on tags.map, dark mode on sticky bottom bar (May 2026) |
| CookingMode + StepTimer i18n | ✅ Done | cooking namespace added to both locales; all hardcoded PT strings replaced with t() calls (May 2026) |
| Recipe creation UI | ✅ Done | create.tsx + edit route; image upload; estimate macros; publish toggle |
| Recipe card — saves, curated mode, cooked sort | ✅ Done | Session 16 — bookmark on card, protein pastels, curated chip, replace flow removed |
| Session 17 — recipe creation improvements | ✅ Done | Relaxed validation (steps + proteins optional); 19-slug protein list with Tier 1/2; custom proteins (user_proteins table); custom tags; ProteinPicker extracted to `src/components/ProteinPicker.tsx`; edit form at full parity with create form |
| Session 17 — library UX simplification | ✅ Done | Header reduced to 2 rows: search+sort+filter icon (row 1), mode chips+Settings (row 2); title row and count row removed; Plan tab header replaced with compact meta row (count + calendar icon); Shopping tab header removed entirely |
| Session 17 — multi-select mode | ✅ Done | `mode: LibraryMode` → `modes: LibraryMode[]`; "Todas" clears to empty array (show all); Minhas/Guardadas/Oficiais combinable via OR conditions in fetchLibrary; all callers updated |
| Session 17 — scroll position preservation | ✅ Done | sessionStorage saves scroll on library unmount, `requestAnimationFrame` restore on back navigation once cached recipes render |
| Session 17 — FilterSheet fixes | ✅ Done | Ingredientes moved back to last position (Proteína→Tempo→Calorias→Tags→Ingredientes); ingredient input auto-scrolls section into view on focus; protein "Ver mais" changed to dashed chip style |
| Session 17 — React Compiler + React 19 | ✅ Done | `@rolldown/plugin-babel` + `reactCompilerPreset`; `useDeferredValue` on search input; `preconnect` to Supabase in root; scroll preservation via sessionStorage (React `<Activity>` deferred — experimental in TanStack Router) |
| Session 17 — bug fixes | ✅ Done | "Created by" on own recipes (separate profiles query); P/Cal badge hidden when no macros; optional ingredient double-label; save icon tap target; FAB height; "See More" tag wiring; Mine filter invalidation on create; shopping dark mode |

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

### What to do next — Session 18 (cooking companion redesign)

---

## Locale auto-detection — architecture (implemented May 2026)

### Signal used

`Accept-Language` / `navigator.language` is the industry standard. It reflects the user's OS/browser language preference directly, is available on page load before any auth, and is infrastructure-agnostic (works the same on Vercel, Netlify, or any other host). No IP geolocation needed.

### Language detection
`navigator.language` is already used by `i18next-browser-languagedetector` for initial language selection. The custom `detectLocaleFromBrowser()` in `src/lib/detect-locale.ts` reads the same value and returns `'en'` or `'pt'` (defaulting to `'pt'`).

### Measurement unit detection
The country subtag from `Accept-Language` determines units (`en-US` → US → imperial, everything else → metric). Only US, Liberia (LR), and Myanmar (MM) use imperial — everyone else gets metric. This is fully portable and requires no third-party APIs.

### Bootstrap flow
On first login per browser (`locale_bootstrapped_v1` localStorage key):
1. Detect language + unit from `navigator.language`
2. Apply language to i18next immediately
3. Persist measurement unit to `profiles.measurement_unit` (fire-and-forget)
4. Mark bootstrap done — never runs again unless localStorage is cleared

This means a user's first experience is in their language with correct units, without any onboarding friction. Deliberate changes in Settings always win because the bootstrap flag prevents re-detection.

### Settings UI
`/app/settings` now has a "Measurement units" section (Metric / Imperial) that reads from and writes to `profiles.measurement_unit`. Uses the same checkmark row pattern as Language and Theme.

### Schema change
`profiles.measurement_unit text NOT NULL DEFAULT 'metric' CHECK (measurement_unit IN ('metric', 'imperial'))` — applied via MCP execute_sql (May 2026).

### Future: using measurement_unit in the app
When displaying recipe ingredient quantities, check `profile.measurement_unit` and convert accordingly. All stored quantities are metric (grams, ml). The conversion layer should live in a utility function in `src/lib/units.ts` — not yet built, implement when the cooking companion or ingredient quantities UI needs it.

---

## Session 14 — Micro-animations polish

**Goal:** Add targeted animations to give the app a premium feel. All animations use `transform`/`opacity` only (compositor-friendly). Every animation has a `motion-safe:` or `@media (prefers-reduced-motion: no-preference)` guard. No libraries — pure CSS + minimal React state.

---

### 1. Cooking step slide transition (`$recipeId.tsx` — `CookingMode`)

When `stepIndex` changes, the current step text slides out left/right and the new step slides in from the opposite direction. Track `direction` ('forward' | 'back') alongside `stepIndex`. Apply `translateX` transition on the step text container. Must be interruptible — use CSS `transition` (not JS `setTimeout` sequences) so mid-animation taps respond immediately.

```css
/* in styles.css */
@media (prefers-reduced-motion: no-preference) {
  .step-enter-forward  { animation: slide-in-right 220ms ease both; }
  .step-enter-back     { animation: slide-in-left  220ms ease both; }
}
@keyframes slide-in-right { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
@keyframes slide-in-left  { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: translateX(0); } }
```

### 2. "I Cooked This" success bounce (`$recipeId.tsx`)

On successful log, the `CheckCircle2` icon briefly scales up then back: `scale(1) → scale(1.3) → scale(1)` over 300ms. Implemented as a CSS keyframe applied for one cycle when `logCookMutation.isSuccess` is true. Reset after animation ends via `onAnimationEnd`.

```css
@media (prefers-reduced-motion: no-preference) {
  .cooked-success { animation: cooked-bounce 300ms ease both; }
}
@keyframes cooked-bounce {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.3); }
  100% { transform: scale(1); }
}
```

### 3. Shopping list strikethrough (`shopping.tsx`)

When an item is checked, a green pseudo-element overlay grows `scaleX` from 0 to 1 over 250ms on the text. Implemented with a `::after` pseudo-element using `transform-origin: left; transform: scaleX(0→1)`.

```css
@media (prefers-reduced-motion: no-preference) {
  .item-checked { position: relative; }
  .item-checked::after {
    content: '';
    position: absolute;
    left: 0; top: 50%;
    width: 100%; height: 1px;
    background: #9CA3AF;
    transform-origin: left;
    transform: scaleX(1);
    transition: transform 250ms ease;
  }
  .item-unchecked::after {
    transform: scaleX(0);
  }
}
```

### 4. Add to plan confirmation (`$recipeId.tsx`)

When `addMutation.isSuccess`, the "Add to plan" button briefly scales down to `scale(0.97)` then back to `scale(1)` with a 150ms ease. Signals a confirmed tap. Pure CSS `active:scale-[0.97] transition-transform`.

### 5. Tab bar active indicator slide (`app.tsx` — `BottomNav`)

A green pill underline or dot that slides horizontally between tabs rather than instantly recolouring. Use `transform: translateX()` on a shared indicator element positioned absolutely, calculated from the active tab index.

---

### Notes
- All `transition` declarations must list explicit properties — never `transition: all`
- Set `transform-origin` explicitly where needed (especially pseudo-elements)
- Test with iOS "Reduce Motion" enabled — all animations must be absent when set

---

### Verify before moving on
- Cooking steps slide left/right on Next/Previous
- "I Cooked This" icon bounces on tap
- Shopping list items animate a strikethrough on check
- Add to plan button gives tap feedback
- Tab bar indicator slides smoothly between tabs
- All animations absent when "Reduce Motion" is enabled

---

### What to do next — Session 13 (recipe images)

---

---

> **Session 13 is split into three focused sub-sessions (13a → 13b → 13c). Run them in order.**

---

## Architectural decisions shared across Sessions 13a–13c (locked)

- **Image storage:** Supabase Storage. Two buckets: `recipe-images` (public CDN) and `recipe-images-pending` (private, awaiting moderation).
- **Compression:** hero 1200px wide / 85% JPEG (~500–600KB); thumb 400×400px / 80% JPEG (~40–70KB). Library: `@filencloud/browser-image-compression`. Do NOT use `donaldcwl/browser-image-compression` — unmaintained since 2023.
- **No cook-log photo flow** — images only uploaded at recipe creation time.
- **Visibility:** user recipes default `visibility = 'private'`. Opt-in toggle to publish. Public recipes require moderation before appearing in the library.
- **Moderation:** Sightengine Edge Function on Storage upload. Score > 0.85 → auto-reject. Below → `pending_review`. `trust_level = 1` (after 3 approved) → auto-approved.
- **Community reporting:** 3 unique reports → auto-hide + flag for review.
- **Delete:** soft delete (`deleted_at` timestamp). Queries filter `deleted_at IS NOT NULL`. Hard-purge deferred.
- **i18n:** user recipes stored in translation tables with a single language row (user's active language). Falls back gracefully on language switch.
- **Product direction:** community-enriched library, NOT a social network. No feed, no following, no notifications. Social layer only incentivises quality recipe creation.

---

## Session 13a — Schema, image storage, PDF extraction

**Goal:** All database schema changes land, Storage buckets created, system recipe images extracted from PDFs and uploaded. No UI changes yet.

---

### Schema changes

```sql
-- recipes
alter table recipes add column if not exists image_url         text;
alter table recipes add column if not exists image_thumb_url   text;
alter table recipes add column if not exists moderation_status text not null default 'approved'
  check (moderation_status in ('approved', 'pending_review', 'rejected'));
alter table recipes add column if not exists deleted_at        timestamptz;

-- profiles
create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text not null,
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "profiles_select" on profiles for select to authenticated using (true);
create policy "profiles_update" on profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- auto-create profile on sign-up (trigger on auth.users INSERT)
-- username: joao_c from Google full_name, user_a81f for magic link
-- display_name: from full_name or email prefix
-- avatar_url: from Google picture claim

-- user_recipe_interactions
create table user_recipe_interactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  uuid not null references recipes(id) on delete cascade,
  type       text not null check (type in ('like', 'save', 'hide')),
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id, type)
);
alter table user_recipe_interactions enable row level security;
create policy "interactions_select" on user_recipe_interactions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "interactions_insert" on user_recipe_interactions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "interactions_delete" on user_recipe_interactions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- recipe_reports
create table recipe_reports (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);
alter table recipe_reports enable row level security;
create policy "reports_insert" on recipe_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ingredients nutrition columns
alter table ingredients
  add column if not exists calories_per_100g numeric,
  add column if not exists protein_per_100g  numeric,
  add column if not exists carbs_per_100g    numeric,
  add column if not exists fat_per_100g      numeric;
```

### RLS on recipes (update existing policy)
- System recipes (`owner_id IS NULL`): visible to all authenticated, regardless of `moderation_status`
- User recipes (`owner_id = user_id`): always visible to owner
- User public recipes (`visibility = 'public'`): visible only when `moderation_status = 'approved'`
- Soft-deleted recipes: excluded from all queries (`deleted_at IS NULL`)

### Storage buckets
- Create `recipe-images` (public)
- Create `recipe-images-pending` (private)
- Storage layout: `{bucketName}/{recipeId}/hero.jpg` and `{recipeId}/thumb.jpg`

### Image pipeline (Edge Function: `moderate-recipe-image`)
```
Client uploads hero + thumb to recipe-images-pending
  → Storage webhook triggers Edge Function
  → Sightengine scan on hero
  → score > 0.85 → delete both files, set moderation_status = 'rejected'
  → score ≤ 0.85 → move both to recipe-images (public)
                    set moderation_status = 'pending_review'
  → trust_level = 1 (from app_metadata) → auto-set moderation_status = 'approved'
```

### PDF image extraction script
```bash
pdfimages -j cookbook.pdf output-dir/
```
Script: `scripts/extract-cookbook-images.ts`
- Extracts images from Cooking Abs PDF (116 recipes) and Joe x Fitness PDF (~50 recipes)
- Resizes to hero (1200px, 85%) + thumb (400×400px, 80%) using `@filencloud/browser-image-compression`
- Uploads both variants to `recipe-images` bucket (bypasses moderation — system images are pre-approved)
- Updates `recipes.image_url` and `recipes.image_thumb_url`
- Idempotent — skips recipes that already have `image_url` set

### Nutrition seed script
Script: `scripts/seed-ingredient-nutrition.ts`
- Downloads USDA FoodData Central Foundation Foods + SR Legacy datasets (free CSV)
- Matches against existing `ingredients` rows by name
- Populates `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`
- Idempotent — skips rows already populated

### Verify before moving on (13a)
- All schema changes applied without errors
- `profiles`, `user_recipe_interactions`, `recipe_reports` tables exist with correct RLS
- Storage buckets `recipe-images` and `recipe-images-pending` created
- `moderate-recipe-image` Edge Function deployed and reachable
- PDF extraction script runs to completion; spot-check 5 recipes have `image_url` populated
- Nutrition seed script runs; spot-check `chicken` and `rice` rows have non-null `calories_per_100g`

---

### What to do next — Session 13b (recipe creation form)

---

## Session 13b — Recipe creation form

**Goal:** Users can create their own recipes. FAB on the library tab opens a full-page creation form. On save, navigate to the new recipe's detail page.

---

### Entry point
- FAB: `+` button fixed bottom-right of library tab, above the bottom nav (`z-20`, `right-4 bottom-20`)
- Tapping navigates to `/app/library/create` (new route, full page — not a modal)
- FAB hidden on `/app/library/create` itself

### Form layout (`/app/library/create`)
Single page, collapsible sections. Header: back chevron + "New recipe" title + "Save" button (disabled until required fields filled).

**Required fields (always visible, above the fold):**
- Recipe name (text input)
- Proteins (multi-select chip row from existing slug list — min 1 required)
- Ingredients section (always expanded — min 1 required)
- Steps section (always expanded — min 1 required)

**Optional sections (collapsed by default, tap header to expand):**
- Image (upload picker + preview)
- Time — "Total time (min)" number input
- Tags (taxonomy sections: Method, Cuisine, Diet, Meal Type, Context — multi-select chips)
- Macros (see below)
- Publish toggle — "Share with community" (default OFF)

**Servings:** always visible below recipe name. Number input, default 1. Required.

### Ingredient rows
Each row: `[ingredient combobox] [qty input] [unit selector] [× remove]`
- Combobox searches `ingredients` table; shows top 5 matches as dropdown
- Selecting a match sets `ingredient_id` and auto-fills default unit
- No match → free text; `ingredient_id = null`; included in Haiku estimation batch
- "Add ingredient" button appends a new empty row

### Step rows
Each row: numbered label + textarea
- "Add step" button appends a new row; steps auto-numbered
- No drag-to-reorder in v1

### Macros section
- Shows 4 number inputs: Calories, Protein, Carbs, Fat (all optional)
- "Estimate macros" button — calls Claude Haiku once for all free-text ingredients; populates inputs with estimates; user can edit before saving
- Matched USDA ingredients contribute automatically; only unmatched go to Haiku
- Macro calculation: `macros_total = true` always for user-created recipes (totals / servings for per-serving display)

### Publish toggle
- "Share with community" toggle (default OFF)
- When ON: saving submits to moderation queue (`moderation_status = 'pending_review'`)
- After creation, owner can tap "Make public" on detail page at any time
- Username confirmation sheet on first publish: "Your recipe will be published as **[username]** — want to change this?" with edit field

### Save behaviour
- Recipe saved as `visibility = 'private'` first regardless of toggle
- If toggle ON: also sets `visibility = 'public'` + triggers moderation flow
- On success: navigate to `/app/library/:recipeId`

### Edit flow (from detail page)
- "Edit" button visible only to recipe owner on detail page
- Navigates to `/app/library/:recipeId/edit` — same form, pre-populated
- Saving a public recipe re-sets `moderation_status = 'pending_review'`; recipe hidden from public library during re-moderation; owner's private copy always accessible

### i18n
- Recipe name, ingredient names, step text stored in `recipe_translations`, `recipe_ingredient_translations`, `recipe_step_translations` with `language = current i18n language`

### Verify before moving on (13b)
- FAB visible on library, hidden on create form
- Required field validation prevents saving with empty name/proteins/ingredients/steps
- Ingredient combobox shows matches from DB; free text accepted when no match
- "Estimate macros" calls Haiku and populates inputs correctly
- Saved recipe appears in library under "Mine" chip, private by default
- Publish toggle submits to moderation; recipe not visible in main library until approved
- Username confirmation sheet appears on first publish attempt
- Navigating to detail page after save shows the new recipe correctly
- Edit form pre-populates and re-triggers moderation for public recipes

---

### What to do next — Session 13c (card redesign, likes/saves, profiles, Popular sort)

---

## Session 13c — Card redesign, likes/saves, profiles, Popular sort

**Goal:** Redesign the recipe card to show thumbnails, likes, and creator info. Add like/save interactions. Add profile pages. Add "Popular" sort and "Mine"/"Saved" mode chips to the library.

---

### Redesigned recipe card

```
┌──────────────────────────────────────────┐
│ [img] Frango Teriyaki           P/Cal ↑  │
│       ⏱ 20min  🟢 Chicken               │
│       ♥ 124    by João                  │  ← only for public user recipes
│                                          │
│  Cal    Pro    Carbs    Fat              │
│  450    42g    28g      14g             │
└──────────────────────────────────────────┘
```

- Thumbnail: 72×72px square left side, `rounded-xl object-cover`. Fallback = protein-coloured gradient placeholder
- Like + creator row: hidden when like count = 0, recipe is private, or recipe is system
- Creator row: not rendered at all for system recipes
- No-macro state: macro grid hidden; space filled by up to 2 rows of tags; `P/Cal` badge hidden
- Card height: `min-height` set to prevent layout shift across states
- 3–4 cards visible per screen

### Likes
- Heart icon on recipe detail page. Toggling calls insert/delete on `user_recipe_interactions` type `'like'`
- Like count shown on card (hidden when 0 or system recipe)
- Works on ALL recipes — system and user-created
- Like count column: materialised via a `like_count` column on `recipes` updated by a Postgres trigger on `user_recipe_interactions` insert/delete (avoids COUNT() on every card render)

### Saves
- Bookmark icon on recipe detail page. Toggling calls insert/delete type `'save'`
- Private — no count shown publicly
- Accessible via "Saved" mode chip in library

### Hide
- `type = 'hide'` in `user_recipe_interactions` — no UI in v1; feeds future recommendation filtering

### Library mode chips
- Two chips at the start of the filter chip row: `Saved` and `Mine`
- Mode toggles — change the dataset, not the filters. Full search + tag filtering applies within each mode
- `Mine`: `owner_id = current user` (private + public, excludes `deleted_at IS NOT NULL`)
- `Saved`: joined to `user_recipe_interactions` type `'save'` for current user

### Moderation status badge (owner-only)
- Shown on recipe card and detail page header for the owner
- States: "Pending review" (yellow) / "Rejected" (red). No badge when approved

### Popular sort
- New sort option: "Popular" (by `like_count DESC`)
- Default sort for the main library when no filters active
- Added to existing sort sheet alongside P/Cal, Protein, Calories, Time

### Profile pages (`/app/profile/:username`)
- Route: `/app/profile/$username` — accessible by tapping creator name on any card
- Public content: display name, avatar, bio, grid of approved public recipes
- Empty state: "No recipes published yet"
- Settings → "Change username" links to profile edit sheet

### Verify before moving on (13c)
- Recipe cards show thumbnails; fallback gradient renders when no image
- Like button toggles correctly; like count updates in real time
- Save button toggles; recipe appears/disappears from "Saved" mode
- "Mine" chip shows only the current user's recipes (private + public)
- "Popular" sort orders by like count correctly
- Clicking creator name navigates to their profile page
- Moderation status badge visible to owner only; hidden for other users
- `like_count` column updates via trigger — no N+1 COUNT() queries

---

### What to do next — Session 12 (cook history calendar)

---

## Session 12 — Cook history calendar on Plan tab

**Goal:** Add a calendar icon to the top-right of the Plan tab that opens a bottom sheet showing the user's cook history as a weekly strip + scrollable log.

**Data source:** `cook_log` table, `fetchCookLog()` server function. No schema changes needed.

---

### 1. Plan tab header change (`src/routes/app/plan/index.tsx`)

Add a `CalendarCheck` (or `CalendarDays`) icon button to the top-right of the Plan header, alongside any existing icons. On tap: open a Vaul bottom sheet.

---

### 2. CookHistorySheet component

New component (inline or separate file). Fetches cook log via `useQuery({ queryKey: ['cook-log'], queryFn: fetchCookLog })`.

**Layout:**

```
┌─────────────────────────────────┐
│  Cook History          [← week] │
│                                 │
│  M   T   W   T   F   S   S     │
│  ●   ●   ○   ●   ○   ○   ○     │
│                                 │
│  3 times this week              │
├─────────────────────────────────┤
│  Thursday, May 22               │
│  ┌──────────────────────────┐   │
│  │ Frango Teriyaki          │   │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

**Weekly strip:**
- 7 columns (Mon–Sun), label + dot
- Green filled dot (`bg-[#16A34A]`) = at least one entry on that day
- Empty dot = no entries
- Week state managed with `useState(weekOffset)` — 0 = current week, -1 = last week, etc.
- `← week` button decrements offset; hide or disable when no older entries exist

**Scrollable log:**
- Group `cook_log` entries by local date
- For each group: date heading + recipe name chips/cards
- Most recent first
- Only show entries in the currently selected week

**i18n keys to add:**
```json
"cookHistory": {
  "title": "Cook History",
  "timesThisWeek_one": "{{count}} time this week",
  "timesThisWeek_other": "{{count}} times this week",
  "nothingYet": "Nothing cooked yet — tap \"I Cooked This\" on any recipe"
}
```

---

### Verify before moving on

- Calendar icon visible on Plan tab header
- Tapping opens sheet; weekly strip shows correct days
- Days with cook log entries show green dots
- Previous week navigation works
- Sheet shows recipe names grouped by day
- Works in both PT and EN

---

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

---

## Session 17 — Recipe creation improvements, protein expansion, library UX simplification, cooking companion polish

**Source:** User testing feedback (May 2026) — girlfriend's review + user observations.

---

### A. Recipe creation — relaxed validation

**Steps not required.** Remove the `validationSteps` check in `create.tsx`. A recipe without steps is valid (e.g. a sauce, a raw prep, a simple mix). The steps section remains optional — collapse it by default if no steps exist.

**Proteins not required.** Remove the `validationProteins` check. Change the label from "Proteínas (mín. 1)" to "Proteínas". Recipes with no main protein source (yogurt sauce, chocolate syrup, calda de caramelo) are valid.

Update i18n keys:
- Remove `create.validationProteins` (or change text to "Select at least one protein for better filtering")
- Update `create.proteinsLabel` to remove the "(mín. 1)" suffix

---

### B. Revised protein slug list (19 slugs, locked)

Replace the current 16-slug list with the following 19, based on Portuguese market research and fitness meal-prep usage. Remove `clams`, `squid`, and the generic `fish` catch-all. Add `sardine`, `hake`, `sea-bass`, `mackerel`, `octopus`, `lamb`. Rename the PT label for `beef` from "Carne" (ambiguous) to "Carne de Vaca".

| Slug | PT label | EN label | Tier |
|---|---|---|---|
| `chicken` | Frango | Chicken | 1 — default visible |
| `beef` | Carne de Vaca | Beef | 1 — default visible |
| `pork` | Porco | Pork | 1 — default visible |
| `salmon` | Salmão | Salmon | 1 — default visible |
| `tuna` | Atum | Tuna | 1 — default visible |
| `cod` | Bacalhau | Cod | 1 — default visible |
| `eggs` | Ovos | Eggs | 1 — default visible |
| `shrimp` | Camarão | Shrimp | 1 — default visible |
| `turkey` | Peru | Turkey | 2 — behind Ver mais |
| `lamb` | Borrego | Lamb | 2 — behind Ver mais |
| `sardine` | Sardinha | Sardines | 2 — behind Ver mais |
| `hake` | Pescada | Hake | 2 — behind Ver mais |
| `sea-bream` | Dourada | Sea bream | 2 — behind Ver mais |
| `sea-bass` | Robalo | Sea bass | 2 — behind Ver mais |
| `mackerel` | Carapau | Mackerel | 2 — behind Ver mais |
| `octopus` | Polvo | Octopus | 2 — behind Ver mais |
| `tofu` | Tofu | Tofu | 2 — behind Ver mais |
| `legumes` | Leguminosas | Legumes | 2 — behind Ver mais |
| `whey` | Whey | Whey | 2 — behind Ver mais |

**Remove from locale files and DB:** `clams`, `squid`, `fish` (generic catch-all — replaced by specific slugs above).

**Show more / Show less toggle** (both in `create.tsx` protein picker and in FilterSheet):
- Show Tier 1 (8 chips) by default
- `aria-expanded` on the toggle button; "Ver mais" / "Ver menos" label
- State: local `useState(expanded)`, not persisted
- Search field above the chip grid filters all 19 regardless of expanded/collapsed state
- If typed text matches nothing → inline `+ Adicionar "[texto]"` row appears (one tap, no form — custom protein saved to recipe only, logged for analytics)

---

### C. Custom proteins

Allow users to add a protein that's not in the system list.

**Schema:**
```sql
create table user_proteins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  slug         text not null,
  display_name text not null,
  language     text not null default 'pt',
  created_at   timestamptz not null default now(),
  unique (user_id, slug)
);
alter table user_proteins enable row level security;
create policy "user_proteins_all" on user_proteins for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

**UX in the protein picker (create form):**
- Below the protein chip grid, a small text input: "Adicionar proteína…"
- On submit (Enter or + button): slug = lowercase kebab-case of input, display_name = input as-is
- Inserted into `user_proteins`; chip immediately appears in the picker as selected
- Custom proteins appear in a "Os meus" section separate from system proteins
- In `filterKey` / query: union system slugs + user slugs when filtering library

**Server function:** `createUserProtein({ displayName, language })` in `src/lib/supabase/recipe-queries.ts`.
**Query:** `fetchUserProteins()` — returns `UserProtein[]` for current user.

---

### D. Custom tags in recipe creation

The `create.tsx` tag section only shows system tags. Add free-text entry for custom tags.

**UX:**
- Below the system tag sections, a text input: "Adicionar tag…"
- On Enter / + button: tag slug = lowercase kebab-case, added to the recipe's `tags[]` array
- Custom tags rendered as chips with an × to remove, in a "Os meus tags" subsection
- Custom tags NOT stored in a separate table — stored directly in `recipes.tags[]` like system tags
- In FilterSheet: if current user has recipes with custom tags, show them in a "Os meus tags" section (filtered to tags not in locale files)

---

### E. Library UX simplification — one filter row

**Goal:** Reduce two filter rows to one.

#### E1. Mode selector → compact popover

Replace the horizontal mode chip row (`Todas · Minhas · Guardadas · Oficiais`) with a single button that shows the current selection and opens a dropdown/popover.

- Default appearance: `[Todas ▾]` — a compact pill button showing the current mode
- Tapping opens a dropdown (Radix `Popover` or a simple absolute-positioned div):
  - `○ Todas` — exclusive; selecting it deselects all others
  - `○ Minhas` — multi-selectable with Guardadas/Oficiais
  - `○ Guardadas` — multi-selectable
  - `○ Oficiais` — multi-selectable

- **Multi-select logic:** when `Minhas + Guardadas` are both active, the query returns the union (mine OR saved). Update `LibraryMode` type and `fetchLibrary` to accept `modes: LibraryMode[]` instead of `mode: LibraryMode`. Union is handled server-side: fetch mine IDs + saved IDs, deduplicate, filter.

- Button label when multiple: `Minhas + Guardadas` (concatenated), truncated to 20 chars with ellipsis if needed.

- Close on outside click, close on selection.

#### E2. Remove Proteína / Tempo / Calorias chips

Delete the three category chip buttons. Users access protein/time/cal filters via the Filtros button.

#### E3. Filtros button — icon only

Remove the "Filtros" text label from the filter button. Keep only the `SlidersHorizontal` icon + the active count badge (green dot when filters active).

#### E4. Single row result

The header area becomes: `[search bar]` on line 1, `[mode dropdown] [spacer] [Filtros icon]` on line 2. Two rows total instead of three.

**Note:** `sheetSection` state and the per-section scroll behaviour in FilterSheet can stay — the sheet is now only opened via the Filtros button, always opening to the top.

---

### F. Cooking companion — deferred to Session 18

The cooking companion is being fully redesigned as a drawer-based mode on the recipe detail page rather than a separate full-screen experience. See Session 18 for the complete spec.

The only change applied in Session 17: **replace the horizontal step slide animation with a vertical one** (next step slides in from below, previous from above — consistent with the vertical sequence of the step list).

```css
@keyframes slide-in-up   { from { opacity: 0; transform: translateY(24px); }  to { opacity: 1; transform: translateY(0); } }
@keyframes slide-in-down { from { opacity: 0; transform: translateY(-24px); } to { opacity: 1; transform: translateY(0); } }
```

Classes: `.step-enter-forward` → `slide-in-up`, `.step-enter-back` → `slide-in-down`. Wrapped in `@media (prefers-reduced-motion: no-preference)`.

---

### G. Bug: Plan multiplier — unnecessary re-renders

When changing `portion_multiplier` on one plan item card, all other cards re-render due to shared state or unstable references.

**Fix:** Enable the React Compiler (see Section J) — it handles this automatically across the entire app. Do not add manual `React.memo` or `useCallback`; that is redundant once the compiler is running. Additionally, move per-item multiplier state to the item card itself (local `useState` for the UI control, with a debounced mutation) so the state change is strictly local.

---

### H. Bug: "Created by" not showing on own recipes

Recipe detail page should show `by [username]` below the recipe name for user-created recipes (both own and others'). Currently missing on own recipes.

**Investigation steps:**
1. Check `profiles` table — does a row exist for the current user? The auto-create trigger may not have run for existing users.
2. Check `fetchRecipeById` — does it join to `profiles`? Add `profiles!recipes_owner_id_fkey(username, display_name)` to the select.
3. Check the render condition — is `recipe.owner_id` null for own recipes (shouldn't be)?
4. Fix: ensure the profile row is created on sign-in if missing (`upsert on conflict do nothing`). Show `by {profile.display_name ?? profile.username}` whenever `owner_id IS NOT NULL`.

---

### I. Save icon — larger tap target

Increase the bookmark icon size on recipe cards from `w-6 h-6` (Bookmark size 14) to `w-8 h-8` (Bookmark size 18). The current size is too small for one-handed mobile use.

---

### J. React 19 adoptions

The app is on React 19.2 but uses none of its new capabilities. Apply the following — all are low-risk, high-value, and do not conflict with TanStack Query.

#### J1. React Compiler (resolves Section G)

```bash
pnpm add babel-plugin-react-compiler
```

```ts
// vite.config.ts
viteReact({ babel: { plugins: ['babel-plugin-react-compiler'] } })
```

Run `npx react-compiler-healthcheck` first and fix any Rules of Hooks violations before enabling. Once the compiler is running, remove any existing `useMemo` / `useCallback` / `React.memo` that exist purely for render performance (keep ones at interop boundaries with non-React consumers).

**Do not use `useOptimistic` or `useActionState`** — known incompatibility with TanStack Query's `useSyncExternalStore` internals causes a `2→3→2` flash bug. Stay on TanStack Query's `onMutate` / `queryClient.setQueryData` optimistic pattern.

#### J2. `useDeferredValue` on the recipe search input

In `index.tsx`, pipe the search input through `useDeferredValue` before it becomes a query key:

```tsx
const deferredQ = useDeferredValue(localQ)
// use deferredQ in the queryKey instead of localQ
```

Pair with `placeholderData: keepPreviousData` already on the infinite query. Result: the list doesn't stutter on every keystroke; React renders the new list when it has capacity.

#### J3. `preconnect` to Supabase

In `src/routes/__root.tsx`, add to the root `<head>`:

```tsx
import { preconnect } from 'react-dom'
// inside component, before first render:
preconnect('https://kgvycfrvxzkfhvuazzle.supabase.co')
```

This tells the browser to establish the TCP+TLS connection to Supabase before any JS fetch runs. Free latency reduction on initial load, one line.

#### J4. `<Activity>` for bottom tab state preservation

Wrap each bottom tab's content in `<Activity mode={activeTab === 'x' ? 'visible' : 'hidden'}>` in `src/routes/app.tsx`. This keeps filter state, scroll position, and open sheets alive when the user switches tabs, instead of unmounting and remounting. TanStack Query pauses background refetches for hidden tabs automatically (effects are suspended).

---

### Verify before moving on

- Creating a recipe without steps succeeds
- Creating a recipe without proteins succeeds; recipe still appears in library
- All 8 Tier 1 proteins visible by default; "Ver mais" shows all 19; "Ver menos" collapses back
- `beef` displays as "Carne de Vaca" in PT; `clams`/`squid`/`fish` no longer appear anywhere
- Typing a protein not in the list → inline "+ Adicionar" row → saves to recipe
- Custom tags can be typed and saved to a recipe; not visible to other users
- Library header: search bar on row 1; mode dropdown + filtros icon on row 2 (two rows total)
- Mode dropdown opens on tap; Todas is exclusive; Minhas+Guardadas can be co-selected
- Filtros button shows icon + active count only (no label text)
- Cooking companion: Next step slides in from below, Previous from above (vertical only — full redesign in Session 18)
- Changing one plan item's multiplier does not flash/re-render other cards (React Compiler running)
- `npx react-compiler-healthcheck` passes with no violations
- Search input response feels instant; list updates are deferred (no stutter on fast typing)
- Switching tabs preserves library filter state and scroll position
- "by [username]" appears on own recipes in recipe detail page
- Bookmark icon on recipe card is visibly larger and easier to tap

---

## Session 18 — Cooking companion redesign

**Source:** User testing feedback (May 2026) — cooking mode is unused because the recipe detail page is preferred. Goal: make the recipe detail page itself the cooking companion, so users never have to choose between focus and safety.

**Core insight:** Every existing cooking companion forces a choice between *focus* (one step, full screen) and *safety* (see all ingredients and steps at once). The solution is not a better step-by-step mode — it is transforming the recipe detail page in place, so both are available simultaneously.

---

### 1. Concept: one screen, two states

The existing full-screen cooking companion (`CookingMode` component) is **replaced entirely**. The recipe detail page gains a "Cozinhar" toggle. Tapping it does not navigate anywhere — it transforms the page in place:

- Hero image and non-cooking metadata collapse upward, freeing screen space
- Ingredient list stays fully visible and scrollable (the whole point)
- A **persistent bottom drawer** slides up in peek state showing the current step, step counter, navigation arrows, and timer
- Expanding the drawer to full screen gives focus mode for users who want it
- Toggling off cooking mode reverses everything — page restores exactly as it was

The recipe detail page IS the pre-cook screen. No separate "prepare to cook" flow needed.

---

### 2. What happens to each element when cooking mode activates

**Hidden (collapse animation):**
- Hero image — collapses height to 0, fades out simultaneously
- Tags, P/Cal badge, macro grid — fade out with slight upward drift, staggered 30ms apart
- Like / save / edit / "by [username]" buttons — fade out

**Stays visible:**
- Recipe name — scales down slightly and locks as a compact sticky header (View Transitions API shared element)
- Servings + multiplier control — critical for scaling quantities mid-cook; stays interactive
- Full ingredient list — fully scrollable; ingredients dim progressively as steps are completed
- Bottom drawer (new) — slides up from below in peek state

**On toggle off:** exact reverse sequence. Drawer slides down first, then metadata fades in, then hero expands. Scroll position preserved.

---

### 3. Bottom drawer — states and content

**Peek state (default):**
```
────────────────────────────────
  ▔▔▔▔  (drag handle)
  Passo 4 / 11  ●●●●○○○○○○○  ⏱ 2:34 · P3
  Junta o frango e salteia em lume alto…  (truncated)
  [← Anterior]              [Próximo →]
────────────────────────────────
```

**Expanded state (tap or drag up):**
```
────────────────────────────────
  Passo 4 / 11
  ─────────────────────────────
  Junta o frango previamente marinado
  e salteia em lume alto durante 3-4
  minutos até dourar de cada lado.
  Deixa repousar **2 minutos**.   ← tappable timer trigger
  ─────────────────────────────
  [← Anterior]              [Próximo →]
────────────────────────────────
```

Tapping outside or dragging down collapses back to peek. The ingredient list above remains visible and scrollable in peek state.

---

### 4. Timer — redesigned

**Inline time references as tap targets:**
Step text is parsed for time references ("2 minutos", "30 segundos", "deixa repousar 10 min"). These render as tappable green underlined text. Tapping starts a timer for that duration. No manual input needed for steps with explicit times.

**Persistent timer badge (cross-step):**
When a timer is running, a compact badge appears at the top of the drawer in both peek and expanded states:
```
⏱ 2:34 · Passo 3
```
This directly solves the "which step is this timer from" problem. Multiple timers stack as multiple badges. Tapping a badge expands its detail (remaining time, which step, pause/reset).

**Timer completion:**
- Web Audio API beep (existing)
- Concentric ring pulse animation radiates from the badge: `transform: scale(1→2)` + `opacity: 1→0`, 600ms, one cycle only

**Remove:** the current manual minute +/- controls. They are replaced by inline tap targets. A fallback manual input (number field) appears only if the step has no detectable time reference.

---

### 5. Ingredient dimming as steps advance

When the user advances past a step, ingredients that appear in that step's text (matched via the same text-matching heuristic from the plan discussion — not Claude, not a join table) are dimmed to `opacity: 0.4` with a 200ms ease transition. Not struck through — just muted. Remaining ingredients stay full opacity and feel more prominent by contrast.

This is best-effort — ingredients that can't be matched to any step stay full opacity throughout. Graceful degradation, never misleading.

---

### 6. Animation system — complete spec

All animations use `transform` and `opacity` only (compositor-accelerated), except the hero height collapse which touches layout but runs only once per mode toggle. All wrapped in `@media (prefers-reduced-motion: no-preference)`.

#### Cooking mode toggle (enter)
| Element | Animation | Duration | Easing |
|---|---|---|---|
| Hero image | `opacity: 1→0` + `height: Xpx→0` simultaneously | 300ms | ease-out |
| Tags / badges / buttons | `opacity: 1→0` + `translateY: 0→-8px`, staggered 30ms apart | 200ms | ease-out |
| Recipe name | View Transitions shared element — scales down and repositions to compact header | 280ms | ease-in-out |
| Bottom drawer | `translateY: 100%→0` with spring overshoot | 350ms | spring (cubic-bezier(0.34, 1.56, 0.64, 1)) |

#### Cooking mode toggle (exit) — reverse order
Drawer slides down first (200ms), then metadata fades in (200ms), then hero expands (300ms).

#### Step navigation
| Element | Animation | Duration |
|---|---|---|
| Step text (next) | `translateY: 24px→0` + `opacity: 0→1` | 220ms ease |
| Step text (previous) | `translateY: -24px→0` + `opacity: 0→1` | 220ms ease |
| Step counter digits | Odometer roll — digits translate vertically like a mechanical counter | 180ms ease-in-out |
| Progress bar | `scaleX` grows proportionally | 200ms ease |
| Ingredient dimming | `opacity: 1→0.4` on matched ingredients | 200ms ease |

#### Drawer expand / collapse
| State | Animation |
|---|---|
| Peek → full | Height spring with slight overshoot; step counter fades out as full step text fades in (cross-fade, not sequential) |
| Full → peek | Step text fades out first, then height springs down |
| Drag handle | Subtle width pulse on first appearance to signal draggability |

#### Timer
| Event | Animation |
|---|---|
| Inline time reference tap | Text flashes green background via `::after` pseudo-element, 300ms |
| Countdown ring | `stroke-dashoffset` animates continuously — SVG circle, pure CSS |
| Timer complete | Concentric ring pulse: `scale(1→2)` + `opacity(1→0)`, 600ms, one cycle |
| Badge appearance | Slides in from right: `translateX(20px→0)` + `opacity: 0→1`, 200ms |

#### View Transitions API (recipe name shared element)
Use `view-transition-name` on the recipe name element. The browser handles the shared element interpolation between the full-size name position and the compact sticky header position. Degrades to instant transition on unsupported browsers (~5% of users).

```css
.recipe-title { view-transition-name: recipe-title; }
```

```ts
document.startViewTransition(() => {
  setCookingMode(true)
})
```

---

### 7. Open decision

**Multiplier lock during cooking:** when the user is mid-cook and changes the serving multiplier, should ingredient quantities update live in the list, or should the multiplier be locked once cooking starts to avoid confusion mid-step?

Options:
- **Lock it** — safe, predictable, show a "locked" icon with a tap-to-unlock confirmation
- **Live update** — flexible, but quantities changing while you're halfway through a step is disorienting
- **Recommendation:** lock by default with a clear unlock gesture. Cooking is execution, not planning.

This decision must be made before implementation.

---

### 8. What is removed

- `CookingMode` component (`$recipeId.tsx`) — deleted entirely
- `isCooking` state and all conditional rendering around it
- The "Cozinhar" button that entered the old full-screen mode (replaced by the new toggle)
- Manual timer minute +/- controls (replaced by inline tap targets)
- "Sair" / exit button (no longer needed — toggle on the main page exits)
- The `cooking.*` i18n keys that no longer apply: `exit`, `exitLabel`, `prevStepLabel`, `nextStepLabel`, `stepDotLabel` — audit and remove unused keys

---

### Verify before moving on

- Tapping "Cozinhar" collapses hero and metadata with staggered animation; drawer slides up
- Ingredient list remains fully scrollable while drawer is in peek state
- Advancing steps slides text vertically; step counter digits roll like an odometer
- Ingredients dim progressively as steps advance (best-effort text match)
- Time references in step text are tappable and start timers
- Timer badge shows step attribution ("⏱ 2:34 · Passo 3") and persists across step navigation
- Multiple simultaneous timers stack as separate badges
- Timer completion triggers ring pulse animation and audio beep
- Drawer expands to full screen on tap/drag; collapses back to peek
- Toggling cooking mode off restores the page exactly (scroll position, hero, metadata)
- Recipe name shared element transition runs smoothly in Chrome/Safari 18+; instant fallback elsewhere
- All animations absent when "Reduce Motion" is enabled
- Multiplier control behaviour matches the locked/unlocked decision

---

## Session 19 — Image upload for user-created recipes

**Goal:** User-created recipes can have a photo. Private recipes only — no moderation pipeline needed yet.

**Prerequisites:** `pnpm add @filencloud/browser-image-compression` (if not already installed).

---

### 1. Storage

Use the existing `recipe-images` public bucket. Path: `{recipeId}/hero.jpg` and `{recipeId}/thumb.jpg`. UUID-based paths provide sufficient obscurity for private recipe images in v1.

### 2. Image upload UI (create.tsx + edit.tsx)

In the optional Image section that already exists in both forms:

- File input (`accept="image/*"`) that opens the native camera/gallery picker on mobile
- On file selected: client-side compress with `@filencloud/browser-image-compression`:
  - Hero: max 1200px wide, JPEG 85%
  - Thumb: 400×400 cover crop, JPEG 80%
- Show a preview of the compressed image before saving
- Upload both variants to Storage on form save (after the recipe row is created, so `recipeId` is available)
- Update `recipes.image_url` and `recipes.image_thumb_url` with the public CDN URLs
- On edit: show existing image with a "Remove" option; re-upload if changed

### 3. Storage RLS

Add a policy to `recipe-images` that allows authenticated users to upload to their own recipe paths:
```sql
-- In Supabase dashboard → Storage → recipe-images → Policies
-- INSERT: authenticated users can upload to any path (recipe ownership enforced by app logic)
-- SELECT: public (already set for public bucket)
```

### Verify before moving on

- Creating a recipe with a photo shows the thumbnail on the recipe card and detail page
- Editing a recipe replaces the photo correctly
- Removing the photo clears `image_url` and `image_thumb_url` (falls back to protein gradient)
- Existing recipes without images still show gradient thumbnails

---

## Session 20 — Public recipe visibility gate

**Goal:** "Share with community" actually gates the recipe behind moderation instead of publishing it instantly.

**No Edge Function required.** Admin approval is a manual SQL update in the Supabase dashboard for now.

---

### 1. Fix the create/edit mutation

In `createRecipe` (and `updateRecipe`) server functions, when `visibility = 'public'`, explicitly set `moderation_status = 'pending_review'`. Do not rely on the DB default (which is `'approved'`).

```ts
// in the INSERT / UPDATE payload:
moderation_status: visibility === 'public' ? 'pending_review' : 'approved',
```

### 2. RLS check

Verify the existing recipes SELECT policy already excludes `pending_review` public recipes from other users' queries. The Session 13a spec says: "User public recipes (`visibility = 'public'`): visible only when `moderation_status = 'approved'`". Confirm this is in the live policy — if not, update it.

### 3. Owner badge on their own pending recipes

In `RecipeCard` and the detail page, if `recipe.owner_id === currentUserId` and `recipe.moderation_status === 'pending_review'`, show a yellow "Em revisão" badge. If `rejected`, show a red "Rejeitada" badge with a "Ver motivo" that shows a generic explanation (no per-recipe rejection reason in v1).

### 4. Admin approval workflow

No UI needed. Admin approves a recipe by running in Supabase SQL editor:
```sql
UPDATE recipes SET moderation_status = 'approved' WHERE id = '<recipeId>';
```

Document this in a `docs/admin.md` file so it's findable.

### Verify before moving on

- Creating a recipe with "Share with community" ON → recipe visible to owner only, shows "Em revisão" badge
- Recipe does NOT appear in the main library for other users until approved
- Running the SQL approval → recipe appears in library immediately
- Existing system recipes and already-approved user recipes unaffected

---

## Session 21 — Data quality: ingredient aliases + nutrition

**Goal:** Better ingredient search (aliases) and populate nutrition data for the ingredients table.

---

### 1. Ingredient aliases

Check if `aliases text[]` column exists on the `ingredients` table:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ingredients' AND column_name = 'aliases';
```

If missing, add it:
```sql
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ingredients_aliases_gin ON ingredients USING gin(aliases);
```

Then run the existing script: `npx tsx scripts/generate-ingredient-aliases.ts`

Update the ingredient autocomplete query in `searchIngredients` (in `src/lib/supabase/recipe-queries.ts`) to also match against aliases:
```ts
// current: .ilike('name', `%${q}%`)
// updated: check name OR any alias
.or(`name.ilike.%${q}%,aliases.cs.{${q}}`)
// or via RPC if the OR syntax is awkward
```

### 2. Ingredient nutrition seed

Write `scripts/seed-ingredient-nutrition.ts`:

1. Download USDA FoodData Central SR Legacy CSV from `https://fdc.nal.usda.gov/download-datasets.html` — save to `scripts/usda-data/` (add to `.gitignore`)
2. Parse `food.csv` + `food_nutrient.csv` to build a lookup `{ foodName: { calories, protein_g, carbs_g, fat_g } }` per 100g (nutrient IDs: 1008=calories, 1003=protein, 1005=carbs, 1004=fat)
3. For each row in `ingredients` table: fuzzy name match (exact first, then case-insensitive, then strip parentheticals)
4. On match: `UPDATE ingredients SET calories_per_100g = ..., protein_per_100g = ..., ...`
5. Idempotent: skip rows where `calories_per_100g IS NOT NULL`
6. Log matched count + unmatched names

Run with: `npx tsx scripts/seed-ingredient-nutrition.ts`

### Verify before moving on

- `SELECT COUNT(*) FROM ingredients WHERE aliases != '{}'` returns > 0
- Typing a synonym in the ingredient search on the create form returns the right ingredient
- `SELECT COUNT(*) FROM ingredients WHERE calories_per_100g IS NOT NULL` returns a majority of rows

---

## Known bugs + features backlog (updated Session 17)

### Bugs — remaining open

#### 15. Ingredient aliases
- Add `aliases text[]` column (GIN indexed) to `ingredients` table
- Write `scripts/generate-ingredient-aliases.ts`: runs all 184 ingredient names through Claude Haiku with a strict prompt that only accepts true synonyms (same ingredient, different name — no substitutes, no similar-but-different items). Outputs aliases directly to DB with no manual approval step.
- Update ingredient autocomplete query: check `name ILIKE %term%` first, then `term ILIKE ANY(aliases)` as fallback

---

### Resolved (Sessions 16–17)

- ✅ #1 Rogue divider after first ingredient
- ✅ #2 Shopping list group cards stuck dark in light mode
- ✅ #3 Estimate macros button — implemented in create.tsx (`estimateMutation` calling `estimateMacros` server fn)
- ✅ #4 Ingredient qty + unit fields — implemented in create.tsx (`IngredientRow` component)
- ✅ #5 Recipe creation FAB too low (hidden behind bottom nav)
- ✅ #6 "See More" on filter tags does nothing
- ✅ #7 "Mine" filter stale after recipe creation
- ✅ #8 "Created by" not showing on own recipes
- ✅ #9 P/Cal "0" badge when no macros
- ✅ #10 Optional ingredients duplicate label
- ✅ #11 Protein-coloured muted pastel thumbnails
- ✅ #12 Save (bookmark) button on recipe card
- ✅ #13 Popular + Most Cooked sort options
- ✅ #14 "Curated" mode chip in library (now Oficiais, multi-selectable)

---

## Session 15 — Cookbook image extraction + ingredient nutrition

**Goal:** Populate recipe images for all 211 system recipes from the two cookbook PDFs, deploy the moderation Edge Function, and seed ingredient nutrition data from USDA. No UI changes.

**Prerequisites:**
- `pdfimages` installed locally (`brew install poppler`)
- PDFs at: `~/Downloads/EBOOK PORTUGUES.pdf` (Cooking Abs, 116 recipes) and `~/Downloads/Joe x Fitness  COOKBOOK (2).pdf` (Joe x Fitness, 50 recipes)
- `SUPABASE_SERVICE_ROLE_KEY` already in `.env.local`
- `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` added to `.env.local` (get from sightengine.com)

**Install before starting:**
```bash
pnpm add @filencloud/browser-image-compression sharp
```

---

### 1. Cookbook image extraction script (`scripts/extract-cookbook-images.ts`)

The script must:

1. Use `pdfimages -j "<pdf_path>" <output_dir>` (via Node `child_process.execSync`) to extract JPEG images from each PDF into a temp dir.
2. For each extracted image, determine which recipe it belongs to. Strategy: the script has a hardcoded JSON map of `{ pdfImageIndex: recipeId }` — generate this map by running a dry-run first that prints image filenames and dimensions so you can visually match them to recipe names. Cooking Abs images are embedded 1-per-recipe in order; Joe x Fitness similarly.
3. For each matched image:
   - Resize to **hero**: 1200px wide, maintain aspect ratio, JPEG 85% — using `sharp`
   - Resize to **thumb**: 400×400px cover crop, JPEG 80% — using `sharp`
   - Upload both to `recipe-images` bucket at `{recipeId}/hero.jpg` and `{recipeId}/thumb.jpg` (public bucket, bypasses moderation — system images pre-approved)
   - Update `recipes.image_url` and `recipes.image_thumb_url` with the public CDN URL
4. Idempotent: skip recipes that already have `image_url` set.
5. Log progress. On failure for a recipe, log and continue (don't abort the whole run).
6. Refuse to run if `NODE_ENV=production`.

**Note on matching:** run the script once with `--dry-run` flag that just lists extracted images (index, filename, dimensions in px) without uploading anything. Use that output to build the index map.

---

### 2. Moderation Edge Function (`supabase/functions/moderate-recipe-image/index.ts`)

Deploy via `supabase functions deploy moderate-recipe-image`.

The function is triggered by a Storage webhook on `recipe-images-pending` INSERT events. It:

1. Receives the Storage webhook payload (bucket, object path).
2. Downloads the hero image from `recipe-images-pending`.
3. Calls Sightengine API (nudity + violence check). Uses `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` from Deno env.
4. If score > 0.85 on any category → delete both files from pending, set `moderation_status = 'rejected'` on the recipe.
5. If score ≤ 0.85:
   - Move both hero + thumb from `recipe-images-pending` to `recipe-images`
   - Set `moderation_status = 'pending_review'`
   - Check `app_metadata.trust_level` for the recipe owner — if `trust_level >= 1` (after 3 previously approved recipes), auto-set `moderation_status = 'approved'`
6. Recipe `id` is extracted from the Storage path: `{recipeId}/hero.jpg`.

Configure the Storage webhook in Supabase dashboard: Storage → Webhooks → `recipe-images-pending` INSERT → point to the deployed function URL.

---

### 3. Ingredient nutrition seed script (`scripts/seed-ingredient-nutrition.ts`)

1. Download USDA FoodData Central SR Legacy CSV from: `https://fdc.nal.usda.gov/download-datasets.html` (the "Foundation Foods" or "SR Legacy" CSV zip — free, no API key needed). Save to `scripts/usda-data/` (gitignored).
2. Parse `food.csv` and `nutrient.csv` / `food_nutrient.csv` from the zip to build a lookup: `{ foodName: { calories, protein_g, carbs_g, fat_g } }` per 100g.
3. For each row in the `ingredients` table (fetched via service role), attempt a fuzzy name match against the USDA lookup (exact match first, then case-insensitive, then strip trailing parenthetical qualifiers).
4. On match: update `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`.
5. Log: matched count, unmatched names (so you can manually fix).
6. Idempotent: skip rows where `calories_per_100g IS NOT NULL`.

---

### Verify before moving on

- `pdfimages` dry-run lists all images from both PDFs
- After full run: `SELECT COUNT(*) FROM recipes WHERE image_url IS NOT NULL AND owner_id IS NULL` → 211
- Spot-check 5 recipes: hero and thumb URLs load in browser, thumbnails render correctly on recipe cards
- `moderate-recipe-image` Edge Function deployed (`supabase functions list` shows it)
- Storage webhook configured in dashboard for `recipe-images-pending` INSERT
- After running nutrition script: `SELECT COUNT(*) FROM ingredients WHERE calories_per_100g IS NOT NULL` → majority of 184 rows populated
- Spot-check: `chicken breast` and `brown rice` have non-null macros
