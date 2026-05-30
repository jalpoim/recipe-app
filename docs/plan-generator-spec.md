# Spec: "Sugerir Plano" Generator + Favourites Quick-Add (F10 + F11)

**Status:** Ready to build. This is an implementation spec for another agent. No AI calls — pure SQL + deterministic scoring.
**Branch:** continue on `claude/meal-prep-app-review-u7xkE` (or a feature branch off it).
**Source of decisions:** `docs/meal-prep-gamification-review.md` Findings 10 & 11 (persona-tuned familiar:novel blend, repertoire-vs-novelty research). Read those first.

---

## 0. Why this exists (the differentiator)

A meal-planning AI gives *generic* recipes. This feature gives the user **their own repertoire + calibrated, taste-matched novelty** — something an LLM can't do because it doesn't know what the user actually cooks and likes. Two surfaces:

- **F11 — Favourites quick-add:** a single button on the plan that opens a bottom sheet of the user's **most-cooked** recipes for one-tap add. Fast path to "add the meals I always make".
- **F10 — Sugerir plano:** a button that builds a full editable week, blending familiar favourites with novelty, weighted by the user's **flavor profile, favourite cuisines (with enforced variety), persona, dietary constraints, and protein spread**.

Both produce **fully editable** plan items — a starting point, never a lock-in.

---

## 1. Data sources (all already exist)

| Signal | Where | Notes |
|---|---|---|
| Flavor profile | `getUserFlavorProfile()` / `_computeFlavorProfile()` in `src/lib/supabase/flavor-profile-queries.ts:78` | Returns `FlavorProfile`: `cuisineBreakdown[{cuisine,pct}]`, `topFlavorNotes[]`, `avgHeatLevel`, `topProtein`, `avgCookingTimeMin`, `signatureIngredient`, `proteinVarietyCount`. **Returns `null` if < 5 cooks** → cold-start. |
| Persona | `profiles.cook_style` — `'optimizer'|'time_crunched'|'explorer'|'dietary'|'meal_prepper'|null` | Drives familiar:novel ratio + nudges. |
| Dietary | `profiles.dietary_mode` (`none/vegetarian/vegan/pescatarian`), `profiles.intolerances text[]`, `user_ingredient_exclusions`, `user_recipe_interactions` `type='hide'` | **Hard filters.** Reuse the library's existing dietary/intolerance/exclusion/hidden filtering — do NOT reinvent (see `src/routes/app/library/index.tsx` + its query fn). |
| Repertoire (familiar) | `cook_log` (`user_id`, `recipe_id`, `cooked_at`), `user_recipe_interactions` `type IN ('like','save')` | "Familiar" = cooked before OR liked/saved. Recency from `cooked_at`. |
| Candidate recipes | `recipes` | Filter: `deleted_at IS NULL`, `moderation_status='approved'`, `visibility IN ('system','public') OR owner_id = uid`. Fields: `proteins[]`, `cuisine_tags[]`, `flavor_notes[]`, `dietary_flags[]`, `time_min`, `pcal_ratio`, `popularity_score`, `cook_count`, `image_thumb_url`. |
| Most-cooked (for F11) | `cook_log` GROUP BY `recipe_id` | Pattern already in `getCookSummaryThisMonth` (`cook-log-queries.ts:294`). |
| Plan context | `addRecipeToPlan` (`plan-queries.ts:278`) already resolves household/personal plan + creates plan if missing | Reuse this resolution for batch insert. |
| Recipe name translations | existing recipe-fetch join (see `fetchPlanItems` in `plan-queries.ts`) | Active lang with `'pt'` fallback. Reuse the same join; don't hand-roll. |

**No schema migration is required for the core feature.** (Optional later: a `plan_items.source` column to tag generated items — not needed for v1.)

---

## 2. Feature F11 — Favourites quick-add

### 2.1 Server function
Add to `src/lib/supabase/cook-log-queries.ts`:

```ts
export type TopCookedRecipe = {
  id: string;
  name: string;              // translated, pt fallback
  imageThumbUrl: string | null;
  cookCount: number;         // lifetime count for this user
  timeMin: number | null;
  calories: number | null;   // per-serving (respect macros_total)
};

export const fetchTopCookedRecipes = createServerFn({ method: "GET" })
  .inputValidator((limit: number) => limit)            // default 12 at call site
  .handler(async ({ data: limit }): Promise<TopCookedRecipe[]> => { ... });
```

Logic: session guard → fetch this user's `cook_log` rows (join `recipes` for name/thumb/time/macros) → aggregate count by `recipe_id` → drop recipes with `deleted_at` → sort by count desc, tiebreak most-recent `cooked_at` → take `limit` → translate names (reuse existing pattern). Return `[]` for users with no cooks.

### 2.2 UI
- **Button:** in the plan header (`src/routes/app/plan.tsx` ~line 599–615, alongside the cook-history button). Label `t("plan.quickAdd")` ("Os teus favoritos"), icon e.g. `Heart` or `Star` (lucide). Hide/disable if the user has zero cooks.
- **Bottom sheet:** new component `FavouritesSheet` in `plan.tsx` (or `src/components/`). **Copy the Vaul pattern verbatim** from `CookHistorySheet` (`plan.tsx:274`) — `Drawer.Root/Portal/Overlay/Content`, drag handle, header with close, scroll region `maxHeight:"80dvh"`. Theme via existing `[data-theme="dark"]` CSS (no `dark:` prefix).
- **Rows:** thumbnail (reuse `PlanItemCard`'s thumb + protein-gradient fallback), name, `cookCount` badge ("cozinhado 7×"), and a `+` add button on the right.
- **Add behaviour:** call existing `addRecipeToPlan({ data: recipeId })`. Optimistic: append to `["plan-items", planId]` cache; on settle invalidate `["plan-items", planId]` + `["active-plan"]`. Show the existing `addedToast`. Keep the sheet open so the user can add several; mark already-added rows with a check / disable.
- **Query:** `useQuery({ queryKey: ["top-cooked"], queryFn: () => fetchTopCookedRecipes({ data: 12 }), enabled: sheetOpen, staleTime: 5*60_000 })`.
- **Empty state:** if no cooks, show a friendly line pointing to the library (`t("plan.quickAddEmpty")`).

### 2.3 i18n (add to `pt/common.json` and `en/common.json` under `plan`)
`quickAdd`, `quickAddTitle`, `quickAddEmpty`, `cookedNTimes_one/_other` (`"cozinhado {{count}}×"`), `addAll` (optional).

---

## 3. Feature F10 — Sugerir plano (the generator)

### 3.1 Design principles
1. **Pure, testable core.** Put all scoring/selection in a new pure module `src/lib/plan-generator.ts` (no I/O, no React) so it can be unit-tested like `cook-profile.ts`. The server fn only does I/O (fetch signals + candidates, then call the pure core, then batch-insert).
2. **Familiar + novelty, persona-tuned** (Finding 10). Familiar = repertoire (cooked/liked/saved). Novel = taste-matched recipes not yet cooked.
3. **Variety is enforced, not hoped for** — hard caps + MMR-style diversity penalty so favourite-cuisine affinity can't produce a monotone week.
4. **Editable output.** Insert as normal plan items; the user swaps/removes freely afterwards.
5. **Fresh on repeat.** Seeded RNG jitter so "Sugerir mais" yields a different-but-still-good set.

### 3.2 Persona → familiar:novel ratio (from Finding 10)
| `cook_style` | familiar : novel |
|---|---|
| `explorer` | 50 : 50 |
| `optimizer` | 70 : 30 |
| `dietary` | 70 : 30 |
| `meal_prepper` | 80 : 20 |
| `time_crunched` | 85 : 15 |
| `null` / cold-start | popularity-led (see §3.6) |

For `N` requested items: `familiarCount = round(N * familiarRatio)`, `novelCount = N - familiarCount`.

### 3.3 Candidate pool (server-side fetch, bounded)
Fetch recipes passing **hard filters**:
- `deleted_at IS NULL`, `moderation_status = 'approved'`
- `visibility IN ('system','public') OR owner_id = uid`
- dietary mode + intolerances + `user_ingredient_exclusions` + `user_recipe_interactions.type='hide'` → **excluded** (reuse library filter logic)

Bound the set for performance (e.g. cap a few hundred, ordered by `popularity_score desc`, but **also** always include every recipe in the user's `cook_log`/likes/saves regardless of popularity so the familiar pool is complete). Pass candidates + user signals to the pure core.

Dietary mapping (if not already centralised): `vegan` → `dietary_flags` ∋ `vegan`; `vegetarian` → ∋ `vegetarian` or `vegan`; `pescatarian` → `proteins` ⊆ {fish, seafood, plant, none} (exclude `chicken/beef/pork/lamb/turkey`); intolerance → exclude recipes whose ingredients carry the matching `dietary_flags`/ingredient.

### 3.4 Per-recipe taste score (pure)
Each component normalised to `[0,1]`:
- **cuisineScore** = (max `pct` among the recipe's `cuisine_tags` that appear in `flavorProfile.cuisineBreakdown`) / 100. (0 if none / cold-start.)
- **flavorScore** = `|recipe.flavor_notes ∩ topFlavorNotes| / max(1, |topFlavorNotes|)`, plus heat alignment bonus: if `avgHeatLevel >= 1` and recipe is spicy (flavor_notes ∋ `spicy`), `+0.2` (clamp ≤1).
- **proteinScore** = `1` if recipe shares `topProtein` or any `explored_proteins`, else `0.4` (mild — variety handles the rest).
- **popularityScore** = min-max normalised `popularity_score` across the candidate pool.
- **personaNudge** (0–~0.15): `optimizer` → scaled `pcal_ratio`; `time_crunched`/swift-leaning → `time_min <= 30 ? full : decay`; `meal_prepper` → favour higher `servings`; else 0.
- **jitter** = `±0.05 * rng()` (seedable).

`baseScore = 0.35·cuisine + 0.30·flavor + 0.10·protein + 0.15·popularity + personaNudge + jitter`.

(Weights live in a named const so they're tunable; document them inline.)

### 3.5 Selection with enforced variety (MMR + caps)
Split candidates into **FAMILIAR** (in cook_log OR liked/saved) and **NOVEL** (rest). Then for each pool, greedily select with a diversity penalty:

```
finalScore(c) = baseScore(c) − λ · maxSim(c, alreadySelected)
sim(a,b) = 0.6·(sharesAnyCuisineTag ? 1 : 0) + 0.4·(sharesPrimaryProtein ? 1 : 0)
λ = 0.4
```
Plus **hard caps** across the whole selection: ≤ 2 recipes per cuisine and ≤ 2 per primary protein (relax the cap only if the pool can't otherwise fill N). This is what guarantees the "favourite cuisines **while keeping variety**" requirement.

Fill `familiarCount` from FAMILIAR via MMR, `novelCount` from NOVEL via MMR. If a pool is short, redistribute the shortfall to the other pool; if both are short, top up from the popularity-ordered remainder ignoring the familiar/novel boundary. De-dupe against recipes already in the current plan.

### 3.6 Cold-start (no flavor profile / `< 5` cooks)
`cuisineScore`/`flavorScore` are 0, so selection is driven by `popularityScore` + `personaNudge` + dietary filter + variety caps. Everything is "novel". This degrades gracefully and still respects persona + dietary. As the user cooks, the familiar pool fills and the persona ratio takes over automatically.

### 3.7 Pure module API (`src/lib/plan-generator.ts`)
```ts
export type GeneratorRecipe = {            // minimal projection the core needs
  id: string; proteins: string[]; cuisine_tags: string[]; flavor_notes: string[];
  time_min: number | null; pcal_ratio: number | null; servings: number;
  popularity_score: number;
};
export type GeneratorSignals = {
  flavorProfile: FlavorProfile | null;
  cookStyle: string | null;
  exploredProteins: string[];
  familiarRecipeIds: Set<string>;          // cooked OR liked/saved
  excludeRecipeIds: Set<string>;           // already in current plan
};
export function selectPlanRecipes(
  candidates: GeneratorRecipe[],
  signals: GeneratorSignals,
  count: number,
  rng: () => number = Math.random,         // inject for deterministic tests
): string[];                                // ordered recipe ids
```
Keep `FlavorProfile` import type-only from `flavor-profile-queries.ts`.

### 3.8 Server functions (`src/lib/supabase/plan-queries.ts`)
1. **Batch insert** (new):
```ts
export const addRecipesToPlan = createServerFn({ method: "POST" })
  .inputValidator((recipeIds: string[]) => recipeIds)
  .handler(async ({ data }): Promise<PlanItem[]> => { ... });
```
Resolve plan context exactly like `addRecipeToPlan` (reuse/extract the shared helper). Compute starting `position = maxPosition + 1` once, insert all items in a single `.insert([...])` with incrementing positions and each recipe's default/preferred multiplier. Return inserted items.

2. **Generate** (new):
```ts
export const suggestPlan = createServerFn({ method: "POST" })
  .inputValidator((count: number) => count)            // default 6 at call site
  .handler(async ({ data: count }): Promise<PlanItem[]> => {
    // session guard → gather signals (flavor profile, profile.cook_style/dietary,
    //   explored_proteins, cook_log+likes/saves → familiarRecipeIds, current plan ids)
    // → fetch bounded candidate pool (hard-filtered) → selectPlanRecipes(...)
    //   → addRecipesToPlan logic (batch insert) → return items
  });
```
Keep `suggestPlan` thin: gather → `selectPlanRecipes` → insert. All judgement lives in the pure core.

### 3.9 UI
- **Button:** "Sugerir plano" on the **empty-plan state** (`plan.tsx:624`), primary accent (`bg-[#16A34A]` / accent green per theme). On a **non-empty** plan, a secondary "Sugerir mais" button in the header. Both call `suggestPlan`.
- **Flow (recommended): direct insert + undo.** On tap: show inline loading on the button → `suggestPlan({ data: 6 })` → invalidate `["plan-items", planId]` + `["active-plan"]` → success toast `t("plan.suggestDone", {count})` with an **Undo** action that removes exactly the inserted item ids (mirror the existing cook-undo toast pattern in `$recipeId.tsx`). This matches the app's optimistic+undo conventions and the "starting point" philosophy.
  - *Alternative if preferred later:* a preview sheet listing suggestions with per-row keep/remove before inserting. Not required for v1.
- **Empty result / too few candidates:** if the generator returns fewer than requested (sparse catalog for a strict dietary mode), insert what it found and toast `t("plan.suggestPartial")`; if zero, toast `t("plan.suggestNone")` pointing to the library.
- Disable the button while the plan is at a sane max (e.g. ≥ 14 items) to avoid runaway.

### 3.10 i18n (add under `plan`)
`suggest`, `suggestMore`, `suggesting` (loading), `suggestDone` (`"{{count}} receitas adicionadas"`), `suggestUndo`, `suggestPartial`, `suggestNone`.

---

## 4. New / changed files

| File | Change |
|---|---|
| `src/lib/plan-generator.ts` | **new** — pure scoring + MMR selection (§3.4–3.7) |
| `src/lib/plan-generator.test.ts` | **new** — see §5 |
| `src/lib/supabase/cook-log-queries.ts` | add `fetchTopCookedRecipes` (§2.1) |
| `src/lib/supabase/plan-queries.ts` | add `addRecipesToPlan` + `suggestPlan`; extract shared plan-context resolver (§3.8) |
| `src/routes/app/plan.tsx` | add quick-add button + `FavouritesSheet`; add "Sugerir plano/mais" button + handler (§2.2, §3.9) |
| `src/i18n/locales/pt/common.json`, `.../en/common.json` | new keys (§2.3, §3.10) |

No migration. No AI. No new dependency (Vaul already installed).

---

## 5. Tests (`src/lib/plan-generator.test.ts`, Vitest — pure core)

Run with a **seeded rng** for determinism. Cover:
1. **Familiar:novel ratio** honoured per persona (e.g. `meal_prepper` N=10 → 8 familiar / 2 novel when both pools are large enough).
2. **Variety caps** — given a candidate pool dominated by one cuisine, the result has ≤ 2 of that cuisine.
3. **Cuisine affinity** — a recipe in the user's top cuisine outranks an equally-popular off-profile recipe.
4. **Flavor affinity** — recipe matching `topFlavorNotes` is preferred among ties.
5. **Cold-start** — `flavorProfile = null` → selection falls back to popularity, still respects caps, fills N.
6. **Pool shortfall** — fewer familiar than quota → shortfall redistributed; never returns duplicates or excluded/in-plan ids.
7. **Exclusions** — ids in `excludeRecipeIds` never appear.

(The server fns and UI are integration-tested manually via the `/run` or `webapp-testing` skill; the pure core is the unit-tested heart.)

---

## 6. Build sequence (suggested order)

1. **Pure core first (TDD):** write `plan-generator.ts` + tests (§3.4–3.7, §5). Get all tests green. This is the risky part — do it in isolation.
2. **F11 server fn** `fetchTopCookedRecipes` + verify with a quick query.
3. **F11 UI:** quick-add button + `FavouritesSheet` (copy Vaul pattern). Manually verify add → plan.
4. **F10 server fns:** `addRecipesToPlan` (test batch insert), then `suggestPlan` wiring the pure core.
5. **F10 UI:** empty-state + header buttons, loading, success+undo toast, partial/none cases.
6. **i18n** keys for pt + en.
7. **Manual verification** (use the `verify`/`run` skill): cold-start user, rich-profile user, strict-dietary user, household plan, repeat "Sugerir mais" gives fresh sets.
8. Typecheck (`npx tsc --noEmit`), run tests, commit per logical unit, push.

---

## 7. Acceptance criteria

- Quick-add: one button → sheet of most-cooked → one-tap add lands in the plan; sheet supports adding several; empty state for new users.
- Sugercir plano: one tap fills an editable week that (a) respects dietary hard filters, (b) leans on the user's favourite cuisines/flavours, (c) never exceeds the variety caps, (d) blends familiar + novel per persona ratio, (e) works for a brand-new user via popularity, (f) gives a different set on repeat, (g) is fully editable after.
- All pure-core tests green; `tsc` clean; no migration; no AI call.

---

## 8. Open choices (sensible defaults chosen; flag if you disagree)

- **Direct insert + undo** over preview sheet (chosen — matches app conventions). 
- **N = 6** default suggestion size (a week's dinners-ish); quick-add shows **12** most-cooked.
- Scoring **weights** in §3.4 are first-pass; tune with real data. They live in a named const for easy adjustment.
- Variety caps **≤ 2 per cuisine / per protein**; relax only to reach N.
