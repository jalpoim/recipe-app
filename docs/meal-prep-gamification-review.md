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

**Status:** `decided`

---

## Finding 3 — 🔴 Mechanics reward the opposite of meal prep

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

**Decision:** PENDING — confirm in next round: implement the spec's `+0.5 to highest axis for non-planners`, or drop the universal-incentive idea and accept shopping only feeds Planner?

**Action (proposed, pending decision):** After Finding 2's normalization exists, add `+0.5` to whichever axis is currently the user's normalized highest (for non-planners), keeping Planner's `+2`. Caveat: this couples shopping into a normalized axis, so apply it carefully so it doesn't re-introduce a scale skew.

**Status:** `pending-decision`

---

## Finding 6 — 🟡 Badges depend on incomplete + buggy cuisine data

**Severity:** 🟡 (silent failure — badges never fire if data is sparse)
**Where:** Specialty badge needs ≥5 cooks of a `cuisine_tag` (`cook-log-queries.ts:561`); cuisine collection needs ≥3 (`me.tsx:425`). Data pipeline is draft: `docs/reaudit-test-report.md` is READ-ONLY/draft with a confirmed buckwheat→gluten net bug (`:173-182`) and incomplete `cuisine_signals` coverage.

**Problem:** Garbage-in: recipes without good `cuisine_tags` mean badges silently never appear. The data-quality pass is a hard prerequisite for the badge layer, not a follow-up.

**Decision:** PENDING — confirm sequencing: gate the badge layer on completing the ingredient re-audit + recipe re-derivation first?

**Action (proposed, pending decision):**
1. Fix the buckwheat / `trigo sarraceno` net bug in the first gluten branch before any full enrichment run (`reaudit-test-report.md:182`).
2. Run the enrichment + Tier-1 re-derivation, then verify cuisine-tag coverage clears the ≥70% bar (`claude-code-implementation-plan.md` Step 4).
3. Only then treat the badge layer as "live." Until coverage is healthy, badges are best-effort.

**Status:** `pending-decision`

---

## Finding 7 — 🟡 Celebration cadence is very sparse

**Severity:** 🟡
**Where:** Level-up overlay fires "max 4 times per user ever" (`flavor-identity-spec.md:243`); progress bar shows only inside a 2-second toast at ≥70% (`:280`).

**Problem:** For a weekly tool, a user may go months with no visible progression signal and forget the ladder exists. The cuisine collection is the only repeatable loop — and it's gated on Finding 6's data quality.

**Decision:** PENDING — now that gamification is a core pillar (Finding 1), do we want a richer, more frequent feedback loop?

**Action (proposed, pending decision):** Consider surfacing the ≥70% progress bar on the profile page (not only in the toast), and lean into the cuisine-collection tiers (bronze/silver/gold per `flavor-identity-spec.md:310`) as the primary repeatable celebration. Revisit after Finding 6.

**Status:** `pending-decision`

---

## Finding 8 — 🟡 Silent recompute failures

**Severity:** 🟡 (data integrity of a paid feature)
**Where:** `_recomputeProfileForUser(...).catch(() => {})` fire-and-forget (`cook-log-queries.ts:92,138`).

**Problem:** If recompute fails, the profile silently drifts from reality with no retry and no signal.

**Decision:** PENDING — acceptable to at least log/observe these failures?

**Action (proposed, pending decision):** Replace the empty `.catch(() => {})` with at least an error log (and consider a lightweight retry or a "stale profile" flag via `last_computed_at`). Low effort, meaningful for a paid pillar.

**Status:** `pending-decision`

---

## Finding 9 — 🟡 Persona ↔ product contradiction (macros)

**Severity:** 🟡
**Where:** "Macro Optimizer" persona wants macro confirmation (`flavor-identity-spec.md:35`) vs. plan forbids being "a calorie counter" (`meal-prep-app-v1-plan.md:16`).

**Problem:** The Optimizer persona is under-served without any macro feedback, but you don't want to become MyFitnessPal.

**Decision:** PENDING — add a per-plan weekly macro summary (read-only, no targets/warnings), or keep macros out of the plan view entirely?

**Action (proposed, pending decision):** A read-only weekly macro total on the plan view serves the Optimizer without daily-logging mechanics. Decide deliberately.

**Status:** `pending-decision`

---

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

## Pending decisions checklist (next rounds)

- [ ] **F5** — implement universal shopping `+0.5`-to-highest-axis, or drop it?
- [ ] **F6** — gate badge layer on completing the ingredient re-audit + re-derivation?
- [ ] **F7** — richer/more-frequent celebration loop now that gamification is a pillar?
- [ ] **F8** — add logging/retry to silent recompute failures?
- [ ] **F9** — read-only weekly macro summary on the plan view, yes/no?
