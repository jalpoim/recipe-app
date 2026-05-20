# Meal Prep App — v1 Plan

## Product positioning

A meal prep planner built around a single opinion: **pick a protein, then a recipe**. The app exists to make Sunday-afternoon meal planning take 20 minutes instead of 2 hours by collapsing decision dimensions.

This is a **tool, not an app**. Users pick it up to plan, put it down, and reopen when it's time to plan again. No daily engagement loop, no notifications, no streaks. The price reflects that (subscription, ~€4-5/month).

### What it's for
- Gym people tracking macros and meal prepping weekly
- The Chlebowski/protein-first cooking audience
- People doing structured cuts/bulks for a defined period

### What it's not
- A calorie counter (don't compete with MyFitnessPal)
- A recipe discovery feed (don't compete with ReciMe/Instagram)
- A family meal planner with kid-friendly filters
- A daily logging or tracking app

## The opinion (and how to protect it)

Protein-first is the **only entry point** to the meal prep flow. Cuisine type, time, and other filters can refine *within* a protein selection but cannot replace it.

The Recipe Library is the escape hatch: users who want non-protein-first browsing (cheat weeks, cravings, ad-hoc cooking) use the library and can add recipes from there to a plan. This preserves the meal prep flow's discipline while accommodating users in non-disciplined modes.

## v1 scope

### Three core surfaces

1. **Meal Prep (primary)** — protein-first planner with shopping list
2. **Recipe Library (secondary)** — browse, filter, add to plan
3. **Recipe Detail / Cooking Companion** — view a recipe, optional step-by-step cooking mode

### Features in v1

**Meal Prep flow:**
- Build a plan by selecting protein → picking recipes (only one active plan per user)
- Adjust portions per recipe (multiplier 1–4)
- Replace recipes in plan
- Remove recipes from plan
- Reset plan when starting a new cycle
- Shopping list: "Por receita" view + "Lista global" (aggregated by supermarket category) view
- Shopping list checkboxes persist across sessions
- Pantry items auto-excluded from shopping list

**Recipe Library:**
- Browse with filters: ingredients, calories max, time max
- Sort: P/Cal ratio, protein, calories, fat, time
- Recipe detail with portion scaling
- "Add to meal prep plan" button

**Cooking companion (single recipe):**
- Step-by-step view of a recipe
- Larger text, clear current-step indicator
- Per-step timers where applicable
- No parallelization across multiple recipes

**Auth:**
- Individual accounts (email + magic link, or Google OAuth)
- One user, one active plan, one private library

### Features explicitly NOT in v1

- Household/multi-user accounts (deferred to v2, but schema must accommodate)
- Recipe sharing or plan sharing between users
- Recipe import from URLs or social media
- AI-assisted recipe parsing from pasted text
- OCR / photo-based recipe entry
- Macros auto-computed from ingredients (use stored macros only)
- Per-eater portion multipliers
- Plan history, archived plans, plan templates
- Multiple concurrent plans
- Cuisine-based filtering inside the meal prep flow
- Cost per meal / per gram of protein
- Cook history tracking
- Notifications, reminders, daily engagement features
- Macro target warnings
- Public recipe discovery, ratings, reviews, community features

## Architecture decisions (must commit before coding)

### Stack

- **Frontend framework:** TanStack Start (client-first model fits an interactive app; Vite dev experience; type-safe routing/loaders/server functions end-to-end)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Backend / DB / Auth:** Supabase (Postgres + auth + storage + RLS in one product)
- **Client data fetching:** TanStack Query (already bundled mental model with TanStack Start)
- **Validation:** Zod
- **Hosting:** Vercel or Netlify (TanStack Start deploys to either; Vercel is fine even without Next.js)

**Justification for not using Next.js:** This app is heavily interactive — portion sliders, expandable cards, filter sliders, checkbox lists, drag/tap interactions. Almost every component is client-state-driven. Next.js's RSC-first model would mean writing `"use client"` on nearly every file, fighting the framework's defaults. TanStack Start's client-first model with explicit server opt-in matches the app's actual shape.

### Database: relational, Postgres via Supabase

NoSQL is wrong for this app. Data is heavily relational (recipes → ingredients → macros; plans → items → recipes; users → households → plans). At hundreds-to-thousands of users, a single Postgres instance is more than enough. No sharding, no caching layer beyond what TanStack Query provides on the client, no read replicas.

### Data model (commit to these tables before writing code)

```
users                  -- handled by Supabase Auth
  id (uuid, pk)
  email
  created_at

households             -- nullable in v1, real in v2
  id (uuid, pk)
  name
  created_at

household_members      -- v2; create table now, empty in v1
  household_id (fk)
  user_id (fk)
  role
  joined_at

recipes
  id (uuid, pk)
  owner_id (fk users, nullable for system recipes)
  visibility ('private' | 'household' | 'system')
  name
  time_min (int)
  servings (int)              -- base servings (bs)
  macros_total (bool)         -- true if macros are for the whole recipe, not per serving
  calories (int)
  protein_g (numeric)
  carbs_g (numeric)
  fat_g (numeric)
  macros_source ('manual' | 'computed')  -- defer compute logic, but reserve the column
  tags (text[])
  created_at
  updated_at

recipe_ingredients
  id (uuid, pk)
  recipe_id (fk)
  position (int)
  raw_text (text)             -- "200g peito de frango"
  quantity (numeric, nullable)
  unit (text, nullable)        -- 'g', 'ml', 'unit', etc.
  name (text, nullable)        -- "peito de frango"
  category (text, nullable)    -- supermarket category for shopping list grouping
  is_pantry (bool)

recipe_steps
  id (uuid, pk)
  recipe_id (fk)
  position (int)
  text (text)
  timer_seconds (int, nullable)

plans
  id (uuid, pk)
  owner_id (fk users)
  household_id (fk, nullable, for v2)
  name (text)                  -- not surfaced in v1 UI; defaults to "Current plan"
  default_multiplier (int)     -- the 1-4 selector
  archived_at (timestamptz, nullable)  -- always null in v1; reserved for history
  created_at

plan_items
  id (uuid, pk)
  plan_id (fk)
  recipe_id (fk)
  position (int)
  assigned_protein (text)
  portion_multiplier (numeric)  -- per-recipe override
  added_at

shopping_check_state
  id (uuid, pk)
  plan_id (fk)
  item_key (text)              -- normalized ingredient name
  is_checked (bool)
  updated_at
```

### Key data model commitments

1. **Ingredients are parsed, not strings.** Store `quantity`, `unit`, `name` alongside `raw_text`. This unlocks future macro auto-compute and proper shopping list aggregation. Painful to retrofit, cheap to do upfront. Worth the cost.

2. **Recipes have an `owner_id` and `visibility` from day one.** System recipes (the starter library) have `owner_id = null` and `visibility = 'system'`. User recipes have `owner_id = user.id` and `visibility = 'private'`. Adds zero v1 UX complexity, makes v2 sharing free.

3. **Plans have `archived_at` and a `name` field from day one.** Both unused in v1 UI. Lets us add plan history and multiple plans later without migration.

4. **Households exist as a table but are empty in v1.** The `households` and `household_members` tables get created. `plans.household_id` exists but is always null in v1. v2 turns on the household join flow without any schema change.

5. **Macros are stored, not computed, in v1.** The `macros_source` column is reserved. Auto-compute pipeline (USDA + INSA TCA + Open Food Facts) is a v2 feature.

### Auth model

- Individual accounts only in v1
- Supabase Auth: email/magic link + Google OAuth
- Row-level security: users can only read/write their own recipes (where `owner_id = auth.uid()`), plus all `visibility = 'system'` recipes
- Plans: users can only read/write plans where `owner_id = auth.uid()`
- Write RLS policies once at the schema level; never repeat auth checks in app code

## Starter recipe library

The 90 curated recipes can NOT ship publicly (cookbook copyright). For v1:

- **Personal testing phase:** import the 90 recipes as `system` visibility for your own account only. This lets you test the app with realistic data without distributing copyrighted content.
- **Public launch:** write 20-30 original recipes yourself (you and your girlfriend cook daily — document what you actually make). Combine with any permissively-licensed sources. Target 40-60 recipes at public launch.

The starter library is small on purpose. Better to demonstrate the paradigm with 40 well-chosen recipes than dilute it with hundreds of mediocre ones.

## Build sequence

Each step is a discrete unit of work; ship one before starting the next.

1. **Schema + auth + project scaffolding.** Supabase project, TanStack Start scaffold, Tailwind, auth flow (sign up, sign in, sign out). Seed script that imports the 90 recipes from the existing artifact into the `recipes` / `recipe_ingredients` / `recipe_steps` tables.

2. **Recipe Library (read-only).** Browse, search, filter (ingredients, max calories, max time), sort, recipe detail with portion scaling. No add-to-plan yet.

3. **Meal Prep flow.** Build a plan, protein-first picker, add/replace/remove recipes, per-recipe portion multipliers, default multiplier. Reset plan.

4. **Shopping list.** Both views (per recipe / global). Checkbox persistence. Pantry exclusion.

5. **Cooking companion.** Step-by-step recipe view with bigger text and per-step timers.

6. **Polish + deploy.** Mobile responsive, basic error states, deploy to Vercel/Netlify.

Each step is ~1 weekend of focused work for a solo developer. Realistic v1 timeline: 4-6 weeks of evenings/weekends.

## What v1 success looks like

- You and your girlfriend use it instead of the current artifact for 4 consecutive weeks
- The daily-use experience (opening to view a recipe, checking off shopping items) is at least as good as the artifact
- You haven't had to make significant architectural changes during those 4 weeks

If those three are true, v1 is done. Move to v2 features. If they aren't, fix what's wrong before adding anything.

---

## Future versions (not for v1, do not build yet)

Listed only to confirm the v1 architecture accommodates them. Not prioritized.

- Household accounts + shared plans + per-eater portion multipliers
- Recipe entry via paste-text + LLM parsing
- Macro auto-compute from ingredients (USDA + INSA TCA + Open Food Facts)
- OCR / photo-based recipe import
- Plan history, archived plans, plan templates
- Recipe sharing via link
- URL/social import (likely via share extensions, native mobile)
- Cooking companion improvements (cook-day parallelization, if users ask)
- Subscription billing (Stripe)
- Public recipe browsing or creator-driven cookbooks (much later, separate strategic decision)

---

## Social layer — architecture decisions (build after v1)

Full social feature set is explicitly deferred. The three schema changes below must be made before the app has real users because they are painful to retrofit. Everything else can be added as new tables with no impact on existing data.

### Schema changes required as pre-conditions (do before public launch)

**1. `profiles` table**
Public-facing user identity. `auth.users` is private and not joinable from the public schema — every social query (recipe authorship, following, influencer pages) needs a joinable public row.

```sql
profiles (id → auth.users, username, display_name, avatar_url, bio, created_at)
```

Created automatically via trigger on `auth.users` insert. All existing `owner_id` references stay as-is — they already point at `auth.uid()`, which matches `profiles.id`.

**2. `visibility` enum — add `public` and `unlisted`**

Full set: `private` → `household` → `unlisted` → `public` → `system`

- `private`: owner only (draft, testing)
- `household`: household members (partner/family sharing)
- `unlisted`: anyone with the direct link (share before publishing)
- `public`: discoverable by everyone
- `system`: curated recipes shipped with the app (`owner_id = null`)

Same record throughout — publishing is a visibility toggle, not a copy.

**3. `household_id` on `recipes`**

Currently `visibility = 'household'` is implicit — it relies on the owner being in a household. If an owner leaves their household, their household recipes become orphaned. Stamping `household_id` at creation time makes the sharing relationship explicit and durable.

```sql
recipes.household_id (uuid, fk households, nullable)
```

### Tables that can be added at any time (no impact on existing schema)

```
saved_recipes      (user_id, recipe_id, saved_at)                          -- bookmark; PK: (user_id, recipe_id)
likes              (user_id, recipe_id, created_at)                        -- PK: (user_id, recipe_id)
ratings            (id, user_id, recipe_id, rating int 1-5, body text nullable, created_at)  -- unique (user_id, recipe_id); body null = stars only
follows            (follower_id, followed_id, created_at)                  -- PK: (follower_id, followed_id)
```

### Feed strategy

Fan-out on read (pull model) — query `follows → recipes` on demand. Correct choice until scale demands otherwise. Migrating to fan-out on write later is purely additive (add a `user_feed` table + background job, swap one query). The reverse migration is far harder, so starting with pull is the safer default.

### Deferred social features (not needed until explicitly building social)

- Cookbooks / recipe collections (superset of `saved_recipes`; add when users have enough saved recipes that organisation becomes a pain point)
- Comments on reviews
- Notifications
- Creator/influencer profiles (just a flag on `profiles`, no separate table needed)
- Public feed UI
