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

> **Several of the choices in §8 were revised in §9 below — §9 overrides this section where they conflict.**

---

## 9. Grill amendments (authoritative — overrides earlier sections on conflict)

These nine amendments came out of a design grill on 2026-05-30. Where they conflict with §3–§8, **§9 wins**. Rationale is summarised inline so the implementing agent understands *why*, not just *what*.

### 9.1 Add a `repertoireScore` — the actual differentiator (revises §3.4–§3.5)
Binary FAMILIAR-set membership wasn't enough: the spec named `cooked_at` ("Recency from `cooked_at`") but **never used it in any formula**, so a recipe cooked weekly and one cooked once eight months ago ranked identically. The whole "your own repertoire" promise (§0) was missing from the math.

- Add `repertoireScore = min(1, cookCount / 5) · recencyDecay(daysSinceLastCook)` (e.g. exponential or linear decay over ~90 days; tune in the named weights const).
- Fold it into `baseScore` **for FAMILIAR recipes only**, at weight **≥ 0.25**, so go-to meals float to the top of the familiar half.
- Reuse the most-cooked aggregation built for F11 (§2.1) — same `cook_log` GROUP BY signal.

### 9.2 Loosen the cuisine cap (revises §3.5)
A hard `≤ 2/cuisine` with N=6 forced **3+ cuisines into every week**, actively diluting the "lean on favourite cuisines" promise (§0, AC 7b) for focused cooks. MMR (λ=0.4) already provides the *smooth* diversity gradient, so the hard cap was double-enforcing.

- **Cuisine cap = `≤ 3` by default; tighten to `≤ 2` only for `explorer`.**
- **Protein cap stays `≤ 2`.**
- Keep MMR for the smooth penalty; the cap is just the backstop. Relax caps before returning a partial result (unchanged from §3.5).

### 9.3 Real repeat-freshness, not jitter (revises §3.1, §3.4)
`±0.05` jitter cannot reorder a focused user's top picks (their score gaps exceed 0.1), so "Sugerir mais" after an undo would return near-identical sets. Jitter "freshness" was theatre.

- Keep a **client-side "recently suggested ids" set** (last 1–2 batches) and pass it into `suggestPlan` as **additional excludes**.
- Jitter stays a small **tiebreaker only** — not the freshness engine.
- This composes with the in-plan dedupe already in §3.5.

### 9.4 Dietary precedence is explicit and unconditional (revises §3.3)
The "**also** always include every cook_log/liked/saved recipe regardless of popularity" line could be misread as bypassing dietary filters — a real hazard for a user who recently went vegetarian/vegan or added an intolerance but still has the old recipes in `cook_log`.

- **Hard filters (dietary mode, intolerances, exclusions, hidden) apply first and unconditionally.** The familiar override only beats the **popularity/pool-size truncation**, never the hard filter: `candidatePool = hardFilter(allRecipes); familiarInPool = candidatePool ∩ familiarIds`.
- **Intolerances are a safety filter — never relaxed**, not even to reach N.

### 9.5 Count = Model C, incremental (revises §3.9, §8)
A fixed N=6 over-serves batch-cookers (the defining meal-prep behaviour is cook-once-eat-several, encoded by `portion_multiplier`, not 6 distinct dinners), and an upfront numeric picker asks users to choose a count before they've seen any output. Chosen model:

- **First tap** generates a **persona-adaptive default**: `meal_prepper`/`time_crunched` → **4**, others → **5**, `explorer` → **6** (derived from the same persona table as §3.2).
- **"Sugerir mais" adds +3 per tap**, excluding in-plan items **and** the recent-suggestion set (§9.3).
- Everything stays fully editable/removable; the ≥14 ceiling remains the runaway guard. **No upfront numeric picker.**

### 9.6 Keep protein weak, but de-duplicate the protein-spread mechanisms (revises §3.4–§3.5)
For a protein-first app, three mechanisms were stacking into a net *anti-protein* bias: weak `proteinScore` (0.06 effective spread), the `≤2` protein cap, **and** the protein term in MMR `sim()`.

- Keep `proteinScore` at weight **0.10** (the familiar pool + `repertoireScore` from §9.1 already surfaces the user's dominant proteins).
- Protein **spread** is handled by the `≤2` cap **alone**.
- **Drop (or halve) the `0.4·sharesPrimaryProtein` term in MMR `sim()`** so cap + MMR + score don't compound.

### 9.7 Household: union dietary, tapper's taste (new — §3 was silent on households)
Every generator signal is per-individual, but output lands in the **shared household plan**. A shared plan must never suggest food a member can't eat.

- **Dietary/intolerance hard filters = the UNION of both household members.** A recipe must pass *both* members' filters to be eligible. (Read both members' `profiles` via `household_id` — confirm `household-queries.ts` exposes member profiles or add a query.)
- **Taste signals (repertoire / flavor / persona / explored proteins) come from the tapping user** for v1.
- Full taste-blend (merge both repertoires, alternate familiar picks) is deferred to v2.

### 9.8 F11 mirrors the library, not the generator (new)
F11 is a **manual, deliberate pick from your own history** — the same gesture as adding from the library, which is *not* dietary-filtered by the partner. Hiding your own go-to recipe from "your favourites" would also be confusing.

- **F11 shows the tapping user's most-cooked, unfiltered by the partner's diet.**
- The dietary **union (§9.7) is exclusive to the F10 automated generator**, where the user isn't vetting each pick.

### 9.9 Atomic undo + symmetric API + set-based lookups (revises §3.8–§3.9)
`removePlanItem` is single-id, so undoing a generated week = N sequential, non-atomic deletes. The batch insert is also asymmetric and N+1-prone.

- Add a batch **`removePlanItems(ids: string[])`** (`.delete().in("id", ids)`) — one round-trip, atomic at the DB; wire **Undo** to it. Delete **by id** (safe under a concurrent household edit).
- In the batch **insert**, resolve each recipe's `portion_multiplier`/`preferred_servings` with **set-based `IN (...)` lookups** (one query for `user_recipe_preferences WHERE recipe_id IN (...)`, one for `recipes WHERE id IN (...)`) — **not** per-recipe queries. (Postgres best-practice: avoid per-row round-trips.)

### 9.10 Verified data facts (no action — corrections to §1 assumptions)
- All recipe columns §1/§3.3 name exist (`popularity_score`, `cook_count`, `pcal_ratio`, `flavor_notes`, `dietary_flags`, `cuisine_tags`, `image_thumb_url`, `moderation_status`, `visibility`, `proteins`). ✅
- **`explored_proteins` lives on `user_cook_profile`**, not the flavor profile. So §3.8 "gather signals" spans **`profiles` (cook_style/dietary_mode/intolerances) + `user_cook_profile` (explored_proteins) + computed flavor profile + both members' `profiles` (§9.7)** — heavier than the one bullet implies.
- `profiles.cook_style` is populated in onboarding and already trusted (library default sort); null only for pre-onboarding users → cold-start path. ✅
- Plan is a flat ordered `plan_items` list (no day slots); `portion_multiplier` is the batch-size knob — reinforces the smaller persona-adaptive N in §9.5. ✅

### 9.11 Pre-launch data check (not a design decision)
Validate **cold-start catalog coverage for strict diets** with a count query before launch: a brand-new vegan user's first "Sugerir plano" depends on enough `approved` vegan recipes across cuisines. §3.5's "relax caps before partial" self-heals variety, but a genuinely thin catalog still yields `suggestPartial` on a first impression.

---

## 10. F12 — "Why this" transparency + cold-start taste seed (PROPOSED — grill before build)

**Status:** `proposed`. Captures two decided directions (2026-05-31). Pressure-test with `grill-me` before implementing; open questions are flagged in §10.7.

### 10.0 Problem
Two distinct gaps, both about *perception* and *cold-start quality*, not selection math:
1. **"Feels random."** The generator returns instantly with no rationale, so even a well-tailored plan reads as arbitrary. The user's own profile page shows rich identity data, but it's disconnected from the suggestion moment.
2. **Cold-start has no taste signal.** A brand-new user (and, arguably, a user with only 5–10 cooks) gets popularity-led suggestions that don't feel personal. Meal prep is **low-frequency** (a few cooks/week), so implicit learning is slow and cold start lasts *weeks*, not minutes — unlike high-frequency feeds (TikTok) that can rely on behaviour alone.

### 10.1 Research basis (why this shape)
- **Explanations raise trust + acceptance** (~19% acceptance lift with reasons); "because you…" makes logic legible. [Transparency in recommenders (CHI'02)](https://dlnext.acm.org/doi/10.1145/506443.506619) · [Explainable rec review](http://eprints.bournemouth.ac.uk/34805/1/Personalising_Explainable_Recommendation.pdf)
- **Operational transparency / "labor illusion":** visible effort increases perceived value even at equal output. [Buell & Norton (HBS)](https://www.hbs.edu/faculty/Pages/item.aspx?num=40158)
- **Attribute-level explicit elicitation is the standard cold-start fix;** hybrid (explicit at onboarding → implicit takes over) wins. [Attribute-aware elicitation](https://arxiv.org/html/2510.27342v1) · [Cold-start survey](https://www.mdpi.com/2076-3417/11/20/9608)
- **Say/do gap is worst in food:** stated preferences are aspirational and weakly predict cooking behaviour → treat the seed as a **decaying prior**, not ground truth. [Say/do gap](https://cloud.army/why-stated-preferences-fail-the-saydo-gap-in-market/) · [Meal-preference DCE](https://pmc.ncbi.nlm.nih.gov/articles/PMC7708905/)
- **Data-as-identity drives loyalty** (Spotify Wrapped; Yummly taste profile + "the more you save/rate, the better it gets"). [Yummly taste prefs](https://help.yummly.com/hc/en-us/articles/203454410-Taste-Preferences)

### 10.2 F12a — "Why this" reason tags (highest ROI; no new data)
The pure core already *decides why* each recipe is picked; today it discards that and returns bare ids. Surface it.
- Extend the core to return a **reason per recipe** instead of just an id: `selectPlanRecipes(...) → { id: string; reason: ReasonCode }[]`. `ReasonCode ∈ { repertoire, top_protein, top_cuisine, flavor_match, novel, popular }`, derived from which term dominated that recipe's `baseScore` (familiar+repertoire → `repertoire`; cuisine/flavor dominant → `top_cuisine`/`flavor_match`; novel pool → `novel`; cold-start/popularity → `popular`).
- `suggestPlan` returns the reason alongside each inserted `PlanItem` (e.g. a parallel `{ recipeId → reason }` map; do **not** require a schema column — keep it transient unless §10.7 decides to persist).
- **UI:** a small caption on each generated plan item card (or a one-time post-generate review), e.g. `t("plan.reason.repertoire")` → "Do teu repertório", `reason.top_cuisine` with the cuisine label → "Cozinha japonesa — a tua favorita", `reason.novel` → "Nova para ti", `reason.popular` → "Popular agora". No emojis; theme via `[data-theme]`.
- **Optional amplifier (F12a'):** brief operational-transparency sequence on the generate action ("A ver as tuas receitas cozinhadas… a juntar a tua cozinha favorita… a manter variedade") — labor illusion. Keep ≤ ~1s; respect reduced-motion.

### 10.3 F12b — Just-in-time taste seed (cold-start elicitation)
- **Trigger (JIT, not onboarding):** the **first** "Sugerir plano" tap by a cold-start user (computed `flavorProfile === null`, i.e. < 5 cooks) opens a **one-screen, recognition-based** picker before generating: *"Para começar, o que te apetece?"* — tap a few favourite **cuisines** (canonical slugs, labels via i18next `proteins.*`/`cuisines.*`), optional favourite **flavour notes**, optional **avoid**. **Skippable** ("Surpreende-me" → falls back to pure popularity). Asked at the moment of intent so it reads as part of the payoff, not an onboarding tax (onboarding already collects persona, dietary, intolerances, heat — do **not** add there).
- **Stored** as a prior on the user: proposed `profiles.taste_seed jsonb` = `{ cuisines: string[], flavor_notes: string[], avoid: string[], set_at: timestamptz }` (RLS already self-scoped on `profiles`). Single-screen, re-editable later from the profile page (v2).
- Frame the benefit (privacy paradox): "para te sugerirmos refeições que vais mesmo cozinhar" — never framed as data collection.

### 10.4 F12c — Decaying prior in the generator
- When computed `flavorProfile === null` (< 5 cooks) **and** a `taste_seed` exists, build a **synthetic `FlavorProfile`** from the seed: `cuisineBreakdown` = even split over seeded cuisines (e.g. each pct = round(100/n)); `topFlavorNotes` = seeded flavour notes; `topProtein = null`; `avgHeatLevel` from onboarding `heat_preference` if present. Feed this to `selectPlanRecipes` so day-one suggestions are tailored.
- **Decay (revealed > stated):** once the **computed** profile exists (≥ 5 cooks) it takes over; the seed is no longer consulted for scoring. v1 = **hard handoff at the 5-cook threshold** (the point where `_computeFlavorProfile` stops returning null). v2 (optional) = soft blend over cooks 5→~10. Seed never overrides **hard dietary filters** (those remain the §9.4 union, unconditional).
- `avoid` from the seed maps into the existing exclusion path (treat as soft de-prioritisation, NOT a hard filter — it's a stated dislike, not an allergy; a low score, not a ban) — confirm in grill (§10.7).

### 10.5 F12d — Per-plan contextual nudge (optional, v2-leaning)
- An optional one-tap "tune this week" on the generate action: proteins / max-time / "surpreende-me". Captures **current intent/context** (a better, say/do-gap-free signal than abstract taste) as a **transient** filter for that one generation — not stored. Mirrors Yummly's day/season context. Lower priority than F12a–c.

### 10.6 Files (anticipated)
| File | Change |
|---|---|
| `src/lib/plan-generator.ts` | return `{id, reason}[]`; accept an optional `seedProfile` / consume synthetic profile; reason derivation |
| `src/lib/plan-generator.test.ts` | reason-code cases; seed-as-prior + decay handoff cases |
| `src/lib/supabase/plan-queries.ts` | build synthetic profile from `taste_seed` when computed is null; thread reasons through `suggestPlan` |
| `profiles.taste_seed jsonb` | new column (migration) — store the seed |
| `src/routes/app/plan.tsx` | JIT taste-seed sheet; reason captions; optional contextual nudge |
| i18n pt + en | `plan.reason.*`, taste-seed screen copy, contextual nudge copy |

### 10.7 Open questions (resolve in grill)
1. **Decay shape:** hard handoff at 5 cooks (v1) vs soft blend 5→10 — is the hard cliff acceptable, or does a user who answered the quiz feel a jarring shift once behaviour kicks in?
2. **`avoid` semantics:** soft de-prioritisation vs hard exclude. (Allergy/intolerance stays hard via existing path; `avoid` is a *taste* dislike — leaning soft.)
3. **Persist reasons?** Transient map (simplest) vs a `plan_items.source/reason` column (enables showing "why" later on the plan, survives reload). Spec §3.3 already floated an optional `plan_items.source` column.
4. **Seed scope for households:** seed is per-tapping-user (taste = tapper, §9.7) — confirm we don't union seeds.
5. **Re-elicitation:** can the user edit the seed later (profile page), and does editing it re-activate it as a prior even after the 5-cook handoff? (Leaning: editing sets a fresh prior that blends briefly.)
6. **Reason granularity:** per-recipe caption vs one summary line for the batch ("Do teu repertório + 1 nova"). Per-recipe is more legible but busier on the plan list.
