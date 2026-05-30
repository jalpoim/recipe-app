# Meal-Prep & Gamification Review — Findings & Action Plan

**Reviewer lens:** meal-prep + gamification expert
**Date started:** 2026-05-29
**Branch:** `claude/meal-prep-app-review-u7xkE`
**Status:** Living document — reviewed finding-by-finding. Decisions captured inline as they are made.

## How to read this

Each finding has:
- **Severity** — 🔴 breaks the premise · 🟠 high-risk · 🟡 smaller gap · 🟢 strength
- **Where** — concrete `file:line` anchors
- **Decision** — the product call (captured from review session; "PENDING" if not yet made)
- **Action** — the actionable fix, scoped enough to implement
- **Status** — `decided` / `pending-decision` / `done`

---

## Finding 1 — Strategic tension: "tool, not app" vs. a full identity engine

**Severity:** 🟠 (direction-setting)
**Where:** `docs/meal-prep-app-v1-plan.md:7` ("tool, not an app… No daily engagement loop, no notifications, no streaks") vs. the entire `docs/flavor-identity-spec.md`.

**Problem:** The v1 plan locks a decision against gamification. You've since built a five-ladder persona system, specialty + cuisine badges, a creator track, level-up overlays, and AI narratives. The two docs now contradict each other, and a future session can't tell which is authoritative.

**Decision:** ✅ **Fully embrace it.** Gamification / cooking identity is now a core product pillar, not a garnish. Invest in making the loop work well.

**Action:**
1. Add a dated "Direction change" entry to `docs/meal-prep-app-v1-plan.md` explicitly superseding the "no gamification / tool not app" stance, linking to `flavor-identity-spec.md` as the authoritative source for the identity system.
2. Update `CLAUDE.md` "Architectural decisions (locked)" to add an entry: *"Cooking identity / gamification is a core pillar (Flavor Identity). The original 'tool not app, no engagement loop' stance is superseded."*
3. Because it's now a pillar, the engine must actually work — Findings 2–4 below are no longer optional polish; they are correctness requirements for a shipped pillar.

**Status:** `decided`

---

## Finding 2 — 🔴 Primary-title selection is mathematically broken

**Severity:** 🔴 (breaks the core "five identities" premise)
**Where:** `src/routes/app/me.tsx:72-80` (`getPrimaryAxis`) — sorts by **raw score**. Axis scales are incommensurable:
- `explorer_score` — unbounded (`+5`/cuisine, `+3`/protein, `+0.5`/recipe) — `cook-log-queries.ts:479-490`
- `planner_score` — unbounded (`plannedCount + trips·2 + weeks·3`) — `cook-log-queries.ts:552`
- `optimizer_score` — **capped at 100** (percentage) — `cook-log-queries.ts:508-511`
- `swift_score` — **capped at 100** (percentage) — `cook-log-queries.ts:523-524`

**Problem:** Any active user blows past 100 on Explorer from bonuses alone (6 cuisines = 30 + proteins + 0.5/recipe). The two percentage axes then **can never win**. A disciplined Macro Optimizer gets mislabeled "Explorer." The "whichever axis is highest wins your title" differentiator collapses into "Explorer or Planner, always."

**Decision:** ✅ **All four axes must be equally winnable** based on genuine behavior.

**Action:** Replace raw-score comparison in `getPrimaryAxis` with a **normalized** comparison so every axis is on the same 0–1 footing:
1. Compute each axis's **level** via the existing `getAxisLevel` (`me.tsx:59-70`).
2. Compute **fractional progress to the next level** within that axis's own thresholds.
3. Sort by `(level, fractionalProgress)` descending; the winner is the primary title.
4. Define a deterministic tiebreaker for exact ties (e.g. fixed axis priority order) so the title doesn't flicker between equal axes on recompute.
5. Add a unit-style check: a synthetic user who is 100% optimizer (all cooks high-protein) and has cooked, say, 8 distinct recipes across 3 cuisines should resolve to **Optimizer**, not Explorer. This is the regression that proves the fix.

> Note: keep the stored raw scores as-is (they're still correct per-axis); only the *comparison* across axes changes. This is a contained ~15–20 line edit in `me.tsx` plus a shared helper if `getPrimaryAxis` is reused elsewhere.

**Status:** ✅ `done` — shipped on `claude/meal-prep-app-review-u7xkE`. Implemented as a shared module `src/lib/cook-profile.ts` (rank = `level + fractionalProgress`, deterministic tie-break with Explorer demoted from default winner), wired into both `me.tsx` and `$recipeId.tsx` (removing the duplicate). Regression covered in `src/lib/cook-profile.test.ts` (8 tests, all pass) — including the canonical case where a higher *raw* score (explorer 96) loses to a higher *level* (optimizer 95 = L5).

**Severity:** 🔴 (the named core behavior is structurally under-rewarded)
**Where:** `lifetime_cook_count = rows.length` (`cook-log-queries.ts:626`); Explorer rewards *distinct* recipes (`:488-490`); Planner "meal-prep week" needs ≥3 planned cooks/week (`:549-550`).

**Problem:** A meal prepper cooks once and eats 5×. But one batch cook = **1 cook + 0.5 Explorer**, while five different small meals = **5 cooks + much higher Explorer**, more likely to unlock everything. Combined with Finding 2's unbounded Explorer, the system tells your best meal-prep users they're mediocre. The incentive gradient points *away* from meal prep.

**Decision:** ✅ **Just fix incentives** — do **not** model leftovers/portions now (bigger build deferred to roadmap). Stop the scoring from penalizing batch cookers.

**Action:**
1. After Finding 2's normalization lands, verify the Planner axis is genuinely reachable as a primary title for someone who plans + shops + batch-cooks (it currently loses to Explorer on raw scale). Normalization largely addresses this — confirm with a synthetic "pure meal-prepper" user.
2. Reduce the variety bias's dominance: the Explorer one-time bonuses (`+5`/cuisine, `+3`/protein) are fine as *Explorer-axis* signals but must not leak into making Explorer the default winner for everyone — that's handled by Finding 2's per-axis normalization. No change to Explorer formula itself.
3. **Roadmap note (not now):** model "cook once, eat N" via a `servings_cooked` / leftover concept so a batch cook can count proportionally. Capture as a future spec item in `flavor-identity-spec.md`; do not build in this pass.

**Status:** `decided` (incentive fix in scope; leftover modeling = roadmap)

---

## Finding 4 — 🟠 Entire engine hinges on self-reported "mark as cooked"

**Severity:** 🟠 (adoption risk — low logging → empty profiles → feature looks dead)
**Where:** All axes/badges/counters derive from `cook_log` (`cook-log-queries.ts` `logRecipeCooked` :66). Logging today is a manual tap on the recipe detail page.

**Problem:** The natural moment to log is *while/after cooking* — phone not in hand. If logging adoption is low, every profile is empty, which is the worst outcome for a paid feature.

**Decision:** ✅ Provide explicit, undoable "mark as cooked" entry points (no passive "did you cook this?" nags). Three entry points:
1. **End of cooking session** — button on the cooking companion's final step.
2. **Plan page** — a quick-access "mark as cooked" button directly on each plan item, for users who don't open the step-by-step flow.
3. **Recipe card** — the existing button handles ad-hoc / off-plan cooks.

**Cooked-state UX:** once a plan item is marked cooked, the card **collapses to just its title + a "cooked" marker**, and is **expandable** if the user wants to see the recipe again. All marks are **undoable**.

**Action:**
1. Add a one-tap "Marcar como cozinhada" / "Mark as cooked" on the cooking companion **final step**; calls `logRecipeCooked` with `source: "planned"` if the recipe came from the plan, else `"manual"`.
2. Add the same one-tap action to each **plan item** on the plan page (`source: "planned"`).
3. On success, collapse the plan item to title + cooked marker; keep it expandable to re-open the recipe.
4. Reuse the toast + `[Anular]` undo pattern (`flavor-identity-spec.md:314`); marks are reversible.
5. Idempotency: require an explicit tap (no auto-log), debounce, and dedupe re-marks of the same recipe within a short window so one batch ≠ many cooks.
6. Explicitly **out of scope:** passive plan-tab prompts asking "did you cook this?" — we chose explicit buttons + the cooking-flow moment to protect the "not a naggy app" feel.

### Anti-exploitation (raised in review)

**Framing:** there is no leaderboard / prize, so faking one's *own* cook log only produces a hollow self-portrait — not worth policing, and policing would harm honest-logging UX. The scoring shape already resists self-inflation:
- Optimizer / Swift are **percentages** (`cook-log-queries.ts:508, 523`) — spamming one recipe can't move a %.
- Explorer rewards **distinct** recipes/cuisines (`:488-490`) — re-marking the same recipe yields nothing.
- Only `lifetime_cook_count` (`:626`) and Planner (`:552`) are raw-additive — and these are deliberately low-status "autobiography" numbers, not the title.

**The real surface = the Creator track**, because cooking confers value to *another* user's **public** profile (`/app/profile/$username`). Today `logRecipeCooked` awards **+8 creator points to the owner on every cook by anyone else, with no dedupe** (`cook-log-queries.ts:94-105`). A creator (via sockpuppets or a repeat-tapping friend) can farm Creator level.

**Defenses (creator-points-focused):**
1. Award the **+8 only once per distinct `(cooker, recipe)` pair** (or once/day) — count distinct cookers, not cook events.
2. Light global guard: dedupe re-marks of the same recipe within a short window for scoring + creator purposes (the collapse UX already discourages re-tapping).
3. **Sockpuppet farming via distinct fake accounts** is the residual risk. Full defense (account-age gates, requiring the cooker to have their own real cook history) is over-engineering pre-scale — **document as a known limitation; revisit if the Creator track becomes competitive / public-facing.**

**Decision (anti-exploit scope):** ✅ **Implement dedupe now** (#1 + the spirit of #2). Sockpuppet heuristics (#3) deferred as a documented known limitation.

**Implemented:** `logRecipeCooked` now awards the +8 creator points only on the cooker's **first** cook of a given recipe (distinct `(cooker, recipe)` pair) — `cook-log-queries.ts:94-117`. Repeat cooks of the same recipe by the same user award nothing, so a repeat-tapping friend or a creator's own re-cooks cannot farm Creator level. Sockpuppet farming via distinct accounts remains the residual, documented risk.

> The plan-page / cooking-session "mark as cooked" buttons + collapse-to-cooked UX (items 1–6 above) are **not yet implemented** — they remain a decided action for a later build pass.

**Status:** `decided` (UX, not yet built) · `done` (creator-points dedupe)

---

## Finding 5 — 🟡 Universal shopping incentive isn't implemented

**Severity:** 🟡
**Where:** Spec `flavor-identity-spec.md:384-388` says shopping completion gives `+0.5` to a **non-planner's highest axis**. Code only ever adds `shoppingTripCount·2` to `planner_score` (`cook-log-queries.ts:553`).

**Problem:** A pure Optimizer/Swift/Explorer gets **zero** reward for shopping through the app — the opposite of the stated "every user has a reason to complete shopping."

**Decision:** ✅ **Implement the spec** — every user gets a reason to complete shopping in-app.

**Action:** Add `+0.5` to the user's **highest (normalized) axis** for non-planners, keeping Planner's `+2`.
- **Sequencing:** depends on Finding 2 — "highest axis" must use the *normalized* comparison, not raw scores, or this re-introduces a scale skew. Build **after / together with** F2.
- Apply the `+0.5` to the resolved highest axis's stored score in `_recomputeProfileForUser` (the shopping completion count already exists via `cook_log_completions`, `cook-log-queries.ts:533-537`).
- Guard against the `+0.5` itself flipping which axis is "highest" on each recompute (compute the target axis from the pre-bonus scores).

**Status:** ✅ `done` — shipped on `claude/meal-prep-app-review-u7xkE`. `highestNonPlannerAxis()` (shared in `cook-profile.ts`, same normalized rank as F2) chooses the target from pre-bonus scores; `_recomputeProfileForUser` adds `+0.5 × shoppingTripCount` to it (percentage axes clamped at 100, planner keeps `+2`). Covered by tests.

---

## Finding 6 — 🟡 Badges depend on incomplete + buggy cuisine data

**Severity:** 🟡 (silent failure — badges never fire if data is sparse)
**Where:** Specialty badge needs ≥5 cooks of a `cuisine_tag` (`cook-log-queries.ts:561`); cuisine collection needs ≥3 (`me.tsx:425`). Data pipeline is draft: `docs/reaudit-test-report.md` is READ-ONLY/draft with a confirmed buckwheat→gluten net bug (`:173-182`) and incomplete `cuisine_signals` coverage.

**Problem:** Garbage-in: recipes without good `cuisine_tags` mean badges silently never appear. The data-quality pass is a hard prerequisite for the badge layer, not a follow-up.

**Decision:** ✅ **Fix data first (in progress).** The audit/enrichment script is currently running, so coverage + the buckwheat bug should be resolved shortly. Badge layer is treated as "live" once the audit completes and coverage is verified.

**Action:**
1. ✅ (in progress) Audit/enrichment script running — should close the coverage gap.
2. **Verify the buckwheat / `trigo sarraceno` net bug is actually fixed in the running script** before the full write run (`reaudit-test-report.md:182`) — if the running script is the old draft, the buckwheat exemption in the *first* gluten branch must be confirmed present, or all 8 buckwheat rows regress to "contains gluten."
3. After the run: verify cuisine-tag coverage clears ≥70% (`claude-code-implementation-plan.md` Step 4), then treat badges as live.

**Status:** `decided` · data fix `in-progress` (verify buckwheat fix landed)

---

## Finding 7 — 🟡 Celebration cadence is very sparse

**Severity:** 🟡
**Where:** Level-up overlay fires "max 4 times per user ever" (`flavor-identity-spec.md:243`); progress bar shows only inside a 2-second toast at ≥70% (`:280`).

**Problem:** For a weekly tool, a user may go months with no visible progression signal and forget the ladder exists. The cuisine collection is the only repeatable loop — and it's gated on Finding 6's data quality.

**Decision:** ✅ Keep the profile page restrained: **show the cuisine badges as the profile's repeatable loop**, and keep the ≥70% progress bar as a **post-action** reveal only (not an always-on profile element). Cuisine-collection tiers (bronze/silver/gold) are the primary repeatable celebration.

**Action:**
1. Profile page: cuisine badge collection is the visible progression surface; no always-on progress bar.
2. Keep the ≥70% progress bar firing after relevant actions (cook toast) as today.
3. Build out the bronze/silver/gold cuisine tiers (`flavor-identity-spec.md:310`) once F6 data lands.

**Additional gamification recommendations (expert view — depth over breadth):** see the "Gamification depth recommendations" section below. Headline: the biggest risk now is *over*-gamifying; the highest-leverage moves are (a) a once-a-year **Wrapped-style recap**, (b) surfacing **"weeks cooked this year"** as a never-reset counter (streak benefits, zero grief), and (c) making the **share card a first-class, beautiful artifact** for organic growth. Pending which of these to pursue.

**Status:** `decided` (profile cadence) · `pending-decision` (which extra ideas to pursue)

---

## Finding 8 — 🟡 Silent recompute failures

**Severity:** 🟡 (data integrity of a paid feature)
**Where:** `_recomputeProfileForUser(...).catch(() => {})` fire-and-forget (`cook-log-queries.ts:92,138`).

**Problem:** If recompute fails, the profile silently drifts from reality with no retry and no signal.

**Decision:** ✅ **Log + staleness flag.** Use `last_computed_at` (already a column) to detect drift. Monitoring approach (admin page vs. self-healing) — see recommendation below; final call pending.

**Action:**
1. Replace the empty `.catch(() => {})` (`cook-log-queries.ts:92,138`) with an error log so failures are observable in server logs.
2. **Self-heal (recommended primary fix):** on profile-page load, if the profile is stale — i.e. `max(cook_log.cooked_at) > last_computed_at`, or `last_computed_at IS NULL` while cooks exist — trigger a recompute. This auto-corrects drift without needing anyone to watch a dashboard.
3. **Admin visibility (optional):** extend the existing admin route (`src/routes/admin.tsx`, currently content moderation) with a small "profile health" panel listing stale profiles + a manual "recompute" button. For hard failures, optionally log to a tiny `profile_recompute_errors` table the panel can read.

**Recommendation:** prioritize #2 (self-healing) — for a paid pillar, a profile that fixes itself on next view beats a dashboard someone has to remember to check. The admin panel (#3) then becomes informational, not load-bearing.

### Cost & performance clarification (raised in review)

**Recompute is pure SQL — it does NOT cost AI** (`flavor-identity-spec.md:1148`). AI spend touching the profile is isolated to:
- the **flavor narrative** (`generateFlavorNarrative`), already throttled to **once per 30 days per user** (`me.tsx:574-577`) — this is the "once a month" cost; and
- recipe **tag inference** at creation time (separate Haiku flow).

So recompute frequency is decoupled from AI cost. The page stays fast because it reads the **cached `user_cook_profile` row**, not a live aggregation. Self-healing is therefore effectively free: read the cache instantly, and only when stale kick a **background, non-blocking** SQL recompute, then refetch. The chosen F7 features (weeks-cooked counter, share card) add **zero** AI cost.

**Decision (monitoring depth):** ✅ **Self-heal only** — recompute-on-read when stale (background, non-blocking) + error logging. No cron, no admin panel, no AI. Admin panel deferred (revisit only if drift becomes a real operational problem).

**Status:** `decided` (log + staleness + self-heal only)

---

## Finding 9 — 🟡 Persona ↔ product contradiction (macros)

**Severity:** 🟡
**Where:** "Macro Optimizer" persona wants macro confirmation (`flavor-identity-spec.md:35`) vs. plan forbids being "a calorie counter" (`meal-prep-app-v1-plan.md:16`).

**Problem:** The Optimizer persona is under-served without any macro feedback, but you don't want to become MyFitnessPal.

**Decision:** ✅ **Keep macros out.** Stay strictly "not a calorie counter." The Optimizer persona is served only through the gamification axis (Optimizer title/score), not a macro readout on the plan.

**Action:** No macro summary on the plan view. The "Macro Optimizer ↔ not a calorie counter" tension is resolved in favor of the product's no-tracking stance; the Optimizer axis title is the persona's reward.

**Status:** `decided` (no change to build — explicitly out of scope)

---

# Part 2 — Meal-Prep & Discovery Flow Deep Dive (2026-05-29)

**Lens:** a regular user trying to plan a week, vs. the realistic alternative of *asking ChatGPT for a meal plan + shopping list*.

**Competitive thesis.** AI produces a full week + list from one sentence, instantly. The app's *durable* edges over AI are: **verified stored macros** (not hallucinated), an **in-store checkbox shopping list** (per-recipe + global, pantry-excluded, shareable), correct **portion math**, and **week-over-week reuse**. Where the app currently *loses* to AI is **speed to a first usable week** — the plan starts as a blank canvas filled one recipe at a time. Most findings below attack that blank canvas.

### What's already strong (🟢 — do not regress)
- **Quick add-to-plan from the list** with a flying-thumbnail animation (`library/index.tsx:616-644, 1808+`) — adding is one tap, no need to open each recipe.
- **Fast discovery**: virtualized infinite list, debounced search, `preload="intent"`, chip strip (popular/quick/high-protein/proteins/tags) (`library/index.tsx`).
- **Shopping is genuinely better than AI**: per-recipe + global views, pantry exclusion, checkbox persistence, custom items, share/copy, "Concluir compras" trip completion, even dislike-detection on completion (`shopping.tsx`).
- **Trust**: macros are stored & per-serving math is correct (`plan.tsx:91-97`) — beats AI hallucination.
- **Context-aware recipe detail**: `?from=plan` flips the CTA to remove/replace (`$recipeId.tsx:1135-1172`).

---

## Finding 10 — 🔴 No "build my week for me" (the #1 gap vs AI)

**Severity:** 🔴 (this is the single biggest reason AI feels faster)
**Where:** Plan empty state dumps the user into the full library (`plan.tsx:624-634`); there is no generate/suggest path.

**Problem:** The plan starts empty and must be filled recipe-by-recipe. AI fills a week from one sentence. You already hold every signal needed to beat it — `cook_style`, `dietary_mode`/`intolerances`, `proteins`, stored macros, popularity. A one-tap **"Plano sugerido"** that pre-fills N persona-matched recipes would turn the blank canvas into an instant, editable week — faster *and* more trustworthy than AI.

**Decision:** ✅ **Build a persona-driven plan generator (no AI).** Leverage the new profile/identity signals — `cook_style` persona, signature dish, flavor profile, recently explored foods, most-liked flavors, dietary mode/intolerances — to recommend a full editable week. Pure SQL over existing data; no AI. Test it, then ship.

**Action:**
1. Server fn that selects N recipes weighted by: persona default sort, dietary filter, protein spread, and the user's `user_cook_profile` signals (liked flavor notes, explored/preferred cuisines, signature ingredient). Insert as editable plan items.
2. Surface as "Sugerir plano" on the empty plan (and as "Sugerir mais" on a non-empty plan).
3. Output is fully editable (swap/remove/adjust servings) — it's a starting point, not a lock-in.

**Familiar : novel blend — ✅ persona-tuned, automatic (decided).** The generator mixes the user's **repertoire/favourites** (most-liked, most-cooked, saved — familiar = fast + trustworthy) with a **controlled dose of taste-matched novelty** (recipes fitting their flavor profile / cuisines but not yet cooked — breaks the documented "rut," doubles as the Explorer / "Novo para mim" gamification moment). The ratio is set by persona, no user effort. This blend IS the differentiator vs AI (AI can't know the user's repertoire).

Starting ratios (tune with real usage data):

| Persona | Familiar : Novel | Rationale |
|---|---|---|
| Explorer (routine breaker) | ~50 : 50 | Novelty *is* the reward |
| Optimizer | ~70 : 30 | Proven macro-fit recipes + some new high-protein |
| Dietary | ~70 : 30 | "Variety within constraints" is the identity reward |
| Casual Meal Prepper | ~80 : 20 | Stability/control valued; light novelty |
| Time Crunched | ~85 : 15 | Least bandwidth for experimentation |
| null / new user | popularity-led | No repertoire yet — see cold-start |

**Cold-start (important):** a new user has no cook log / favourites, so the "familiar" pool is empty. For these users the generator leans on **popularity + onboarding persona + dietary** (familiar ≈ popular/highly-rated). As the user cooks and saves, the familiar pool fills and the persona ratio takes over naturally. The generator must degrade gracefully when the favourites pool is smaller than the familiar quota (top up from popular within persona/dietary).

**Status:** `decided` (build, no AI; persona-tuned blend + cold-start handling)

---

## Finding 11 — 🔴 No reuse across weeks (kills the weekly-tool retention thesis)

**Severity:** 🔴
**Where:** "Clear plan" archives + creates a fresh empty plan (`plan.tsx:580-592`, `archiveAndCreatePlan`). Archived plans exist but are never re-surfaced.

**Problem:** Meal prep is weekly and repetitive, but every Sunday the user rebuilds from zero. AI you'd just re-prompt. The app should one-tap **"Repetir semana passada"** (or save named templates) — archived plans already exist, so the data is right there. This is the second-biggest gap after Finding 10 and trivial to leverage.

**Decision:** ⚠️ **Do NOT build whole-plan repetition / templates** (insufficient evidence users want to repeat an identical week). **Instead: quick-add the user's most-liked / most-cooked recipes** so they can re-add favourites individually.

**Research note (verified 2026-05-29 via web search):**
- **Limited repertoire is well-supported.** People "know ~15 recipes by heart" (HelloFresh/OnePoll survey, studyfinds.org); home cooks draw "mostly from their personal recipe repertoire" (French NutriNet-Santé, PMC5288891 / PMC4589128); parents build "set meals" and resist variation (qualitative family-meals study, PMC4784502). → Re-adding **individual favourites** is the evidenced behaviour.
- **No evidence found that users want to replay an identical full week.** Confirms the decision to NOT build whole-plan repetition.
- **BUT variety is genuinely wanted AND a health win.** Meal planning correlates with *higher* food variety + better diet quality (PMC5288891); consumers "fall into a rut of planning the same meals over and over, and suggestions that incorporate variety would be welcomed," and will pay more for new flavours (Innova); variety disrupts sensory-specific satiety (BMC Public Health).

**Design conclusion (drives F10 too):** The repertoire/rut tension means the generator must be **mostly-familiar + a controlled dose of taste-matched novelty** — not "favourites again" (induces the rut) and not "all new" (loses trust/speed). The novel pick doubles as the Explorer / "Novo para mim" gamification moment. This is the core differentiator vs AI: **AI gives generic recipes; the app gives the user's own repertoire + smart, taste-profile-matched novelty.** See Finding 10 for the familiar:novel blend.

**Action:**
1. A "Os teus favoritos" quick-add row (on the empty plan and/or as a generator input) listing the user's most-liked / most-cooked / saved recipes for one-tap add.
2. Feed the same favourites signal into the Finding 10 generator's weighting.
3. No "repeat last week" button, no named templates — revisit only if research/usage data later supports whole-plan repetition.

**Status:** `decided` (favourites quick-add, not plan repetition) · research verification optional

---

## Finding 12 — 🟠 No sense of plan completeness ("is this enough food?")

**Severity:** 🟠
**Where:** Plan is a flat list with only an item count (`plan.tsx:600-613`); no total servings, no weekly target.

**Problem:** A meal prepper thinks in *meals covered* (e.g. 5 lunches + 5 dinners), not "recipes." There's no finish line, so the user never knows when the plan is "done." AI says "here are 5 dinners." Surfacing **total servings = Σ(servings × multiplier)** answers "cook once, eat N" (also addresses Finding 3's batch visibility) and, optionally, a **weekly meals target with progress** gives the blank plan a goal. Stays non-macro, so it respects F9's "not a calorie counter" stance.

**Decision:** ✅ **Target + progress.** Show total servings/meals covered AND a settable weekly meals target with a progress bar, giving the plan a finish line.

**Action:**
1. Compute total servings = Σ(`servings` × `portion_multiplier`) across plan items; render "X doses · ~Y refeições" on the plan header.
2. Add a settable weekly meals target (stored on profile or plan) with a progress bar toward it.
3. Stays non-macro — respects F9's "not a calorie counter" stance.

**Status:** `decided`

---

## Finding 13 — 🟡 Protein-first paradigm is muted; entry is library-first

**Severity:** 🟡 (dilutes the core differentiator)
**Where:** `/app` redirects straight to the library list (`app/index.tsx`); protein is just one chip among many (`library/index.tsx:235-265`). The plan empty state links to the unfiltered library (`plan.tsx:627-633`).

**Problem:** The product plan declares protein-first the *single entry point* to meal prep, with the library as the escape hatch (`meal-prep-app-v1-plan.md:20-24`). In practice the funnel is flattened into a filterable list and the opinion is barely felt. Not necessarily wrong — the list is excellent — but the differentiating *opinion* is muted, and the empty plan offers no guided start (worsening Finding 10's blank canvas).

**Decision:** ✅ **Pivot to persona-driven library-first** (formal, intentional). Onboarding captures persona + preferences; the library's **default sort and chip order already adapt to `cook_style`**. The guided protein-first funnel is NOT re-introduced. Update `meal-prep-app-v1-plan.md` to record this pivot.

**Verification of current state (confirmed in code):**
- ✅ **Default sort is already persona-based, NOT pcal-for-everyone** — `getPersonaSort` (`library/index.tsx:307-310`): optimizer→`pcal`, time_crunched→`time`, all others (explorer/meal_prepper/dietary/null)→`popular`. Matches the spec's persona→sort table.
- ✅ **Chip strip is already persona-reordered** (`library/index.tsx:1417-1432`): optimizer leads with `alto-proteina`, time_crunched with `rapido`, meal_prepper with `meal-prep`.

**Remaining fixes (small):**
1. ✅ **BUILT** — Sort-button highlight now compares against the persona default sort (`personaDefaultSort`) instead of hardcoded `pcal`, so non-optimizers no longer see it highlighted on first load.
2. ✅ **BUILT** — Explorer now leads with `em-alta` (popular). Dietary intentionally left on the time-aware default (no obvious dietary chip).

**Status:** ✅ `done` (both fixes shipped on `claude/meal-prep-app-review-u7xkE`). Persona sort + chip order confirmed already live; the two highlight/chip gaps are now closed. Plan-doc pivot note still TODO (low priority).

---

## Finding 14 — 🟡 Smaller flow friction (documented, low-debate)

**Severity:** 🟡
- **No "add more recipes" affordance on a non-empty plan** — once items exist, the only way to add is the bottom nav (`plan.tsx:635-695` has no add button). Add an "+ Adicionar receitas" link at the bottom of the list.
- **Onboarding doesn't seed a first plan** — right after the user states their persona (`onboarding.tsx`), the best activation moment, they land on an empty plan/library. Offer "Queres um plano para começar?" (ties to Finding 10).
- **"Cook from what I have"** — AI excels at "I have chicken + broccoli, what can I make?" The ingredient combobox (AND logic) covers this but is buried in the filter sheet. Consider surfacing an ingredient-led quick path. (Lower priority.)
- **No total active cook-time for the week** — meal preppers care about "can I cook it all Sunday in 2h." Summing `time_min` is cheap, non-macro, useful. (Lower priority.)
- **F2 bug is duplicated** — `_getPrimaryAxis` also lives in `$recipeId.tsx:81-89` with the same raw-score flaw; the F2 fix must touch both `me.tsx` and `$recipeId.tsx`.

**Status:** `documented` (mostly low-debate; implement alongside related findings)

---

## Gamification depth recommendations (expert view)

**Overarching principle: the biggest risk now is _over_-gamifying.** This is a calm, weekly, paid tool — its restraint is a feature. Do **not** add daily mechanics, visible point counters, leaderboards, or Duolingo-style nags. The right move is **depth on the few loops you have**, not more loops. In priority order:

1. **Annual / seasonal "Wrapped" recap (highest leverage).** Already on the roadmap (`flavor-identity-spec.md:305`). A once-a-year big narrative payoff is *perfectly* aligned with a weekly tool — it's a retention + re-activation beat that doesn't require daily engagement. Prioritize building it before adding any new in-app loop.
2. **Surface "weeks cooked this year" as a never-reset counter.** You already compute meal-prep weeks internally (`cook-log-queries.ts:549`). Showing it as an accumulating, never-lost stat gives the dopamine of a streak with **none of the grief** — a week off doesn't erase anything. This is the single best streak-substitute for this product.
3. **Make the share card a first-class, beautiful artifact.** `ShareCard` exists (`me.tsx:336`). For an identity app, shareable identity = the #1 organic growth lever. Invest in the visual (Wrapped-style) so users *want* to post it.
4. **Lean into the cuisine-collection tiers** (bronze/silver/gold) as the repeatable collectible loop (already decided in F7).

**Explicitly cautioned against:** visible XP/points, leaderboards, daily streaks, push-notification engagement loops, goal/quest systems that nag. Each would erode the "tool not nag" trust that makes this product calm.

**Decision (which to pursue):** ✅ **Weeks-cooked counter** + **first-class share card.** Annual Wrapped recap **not** selected for now (remains roadmap, not committed). Neither chosen feature incurs AI cost — the weeks-cooked counter is SQL (`cook-log-queries.ts:549`), and the share card reuses the already-generated narrative text.

## Strengths to preserve (🟢)

These are working and reflect genuine gamification literacy — do not regress them:

- **No raw XP shown, no streaks, never-reset lifetime counters** — avoids the demotivating streak-grief patterns; correct for a weekly cadence (`flavor-identity-spec.md:113-123, 537`).
- **Onboarding `cook_style` as Step 1 with a no-promises closing line** — intrinsic-motivation-correct (`flavor-identity-spec.md:93-97`).
- **70% goal-gradient rule** — right instinct (just too faint as surfaced today; see Finding 7).
- **Dynamic specialty badge + permanent cuisine collection** — smart two-speed "who you are now" vs. "what you've collected forever."
- **Containment-based allergen model with AI ∪ net union floor** — properly safety-conscious (`reaudit-test-report.md:22-24`).
- **Undo-on-log toast** — reduces the cost of a wrong cook log (`flavor-identity-spec.md:314`).

---

## Implementation order (recommended)

1. **Finding 2** (primary-title normalization) — highest leverage, contained, unblocks Findings 3 & 5.
2. **Finding 3** verification (confirm Planner/batch users reachable post-normalization).
3. **Finding 4** (mark-as-cooked at end of cooking session) — protects engine adoption.
4. **Finding 1** doc/plan updates — record the direction change.
5. Resolve pending decisions (5, 6, 7, 8, 9) in the next review rounds, then implement.

---

## Decisions resolved (all findings)

- [x] **F1** — Fully embrace gamification as a core pillar; update plan + `CLAUDE.md`.
- [x] **F2** — Normalize axis comparison so all four are equally winnable. ✅ **BUILT** (`src/lib/cook-profile.ts` + tests; wired into `me.tsx` & `$recipeId.tsx`).
- [x] **F3** — Fix incentives only; leftover/portion modeling = roadmap.
- [x] **F4** — Three mark-as-cooked entry points + collapse UX (build pending); creator-points dedupe **done**.
- [x] **F5** — Implement universal shopping `+0.5`-to-highest-axis. ✅ **BUILT** (`highestNonPlannerAxis` in `cook-profile.ts`, applied in `cook-log-queries.ts`).
- [x] **F6** — Fix data first; audit script in progress (verify buckwheat fix landed).
- [x] **F7** — Profile shows cuisine badges; progress bar stays post-action. Pursue **weeks-cooked counter** + **first-class share card**.
- [x] **F8** — Log + staleness + **self-heal only** (recompute-on-read, background, non-blocking). No admin panel.
- [x] **F9** — Keep macros out (strictly not a calorie counter).
- [x] **F10** — Build a persona-driven plan generator (no AI), leveraging cook-profile signals; editable output.
- [x] **F11** — No whole-plan repetition/templates; instead quick-add the user's most-liked/most-cooked recipes (research-verify optional).
- [x] **F12** — Total servings/meals + settable weekly target with progress bar (non-macro).
- [x] **F13** — Formal pivot to persona-driven library-first; persona sort + chip order already live; fix Sort-button highlight baseline + explorer/dietary chip gap.
- [x] **F14** — Documented small frictions (add-more button on non-empty plan, seed plan post-onboarding, surface "cook from what I have", F2 bug duplicated in `$recipeId.tsx`).

## Build backlog (decided, not yet implemented)

In recommended order:
1. **F2** — primary-title normalization (unblocks F3 verification + F5).
2. **F5** — universal shopping `+0.5` (after F2).
3. **F4 UX** — three mark-as-cooked entry points + collapse-to-cooked plan cards.
4. **F8** — error logging + self-heal-on-read for stale profiles.
5. **F7** — weeks-cooked counter + first-class share card.
6. **F1** — plan + `CLAUDE.md` direction-change entries.
7. **F6** — verify buckwheat fix + coverage post-audit; then build cuisine tiers.

**Already done:** F4 creator-points dedupe (`cook-log-queries.ts:94-117`).

### Part 2 build backlog (meal-prep & discovery)

1. **F10** — persona-driven plan generator (no AI) + "Sugerir plano" on empty/non-empty plan. *Highest-leverage vs AI.*
2. **F11** — "Os teus favoritos" quick-add (most-liked/most-cooked); feed into F10 weighting.
3. **F12** — total servings/meals + settable weekly target + progress bar.
4. **F13** — fix Sort-button highlight baseline (`library/index.tsx:1684`); consider Explorer leading chip; update plan doc with the library-first pivot.
5. **F14** — add-more button on non-empty plan; seed first plan post-onboarding (ties to F10); surface ingredient-led "cook from what I have"; sum weekly cook-time (optional).

**Note:** F10/F11/F12 all reinforce each other — the generator, the favourites quick-add, and the completeness target together turn the blank-canvas plan into a fast, goal-oriented week that beats AI on speed *and* trust.
