import type { FlavorProfile } from "./supabase/flavor-profile-queries";

// ─── Plan generator — pure scoring + MMR selection ───────────────────────────
// The deterministic heart of the "Sugerir plano" feature (F10). No I/O, no React:
// the server fn (suggestPlan in plan-queries.ts) gathers signals + a candidate
// pool, hands them here, and inserts whatever ids come back. Everything below is
// unit-tested in plan-generator.test.ts with a seeded rng.
//
// Spec: docs/plan-generator-spec.md §3.4–§3.7, as amended by §9 (authoritative).
// Where §9 conflicts with §3–§8, §9 wins; the relevant amendment is cited inline.

// Minimal recipe projection the core needs (a row from the candidate pool).
export type GeneratorRecipe = {
  id: string;
  proteins: string[];
  cuisine_tags: string[];
  flavor_notes: string[];
  time_min: number | null;
  pcal_ratio: number | null;
  servings: number;
  popularity_score: number;
};

// Per-recipe repertoire signal (§9.1): how many times THIS user has cooked the
// recipe, and how long ago the last cook was. Keyed by recipe id. Liked/saved-but-
// never-cooked recipes are "familiar" (in familiarRecipeIds) but carry no entry
// here, so their repertoireScore is 0 — they don't get the go-to-meal boost.
export type Repertoire = Map<
  string,
  { cookCount: number; daysSinceLastCook: number }
>;

export type GeneratorSignals = {
  flavorProfile: FlavorProfile | null; // null = cold-start (< 5 cooks)
  cookStyle: string | null; // persona — drives familiar:novel ratio + nudges
  exploredProteins: string[]; // from user_cook_profile (§9.10)
  familiarRecipeIds: Set<string>; // cooked OR liked/saved
  excludeRecipeIds: Set<string>; // already in plan + recently suggested (§9.3)
  repertoire: Repertoire; // §9.1 cook-frequency + recency
};

// ─── Tunable weights (first-pass; tune with real usage data) ─────────────────
// baseScore (§3.4) = cuisine·0.35 + flavor·0.30 + protein·0.10 + popularity·0.15
//                    + personaNudge + jitter, plus repertoire·0.25 for FAMILIAR
//                    recipes only (§9.1 — the actual differentiator).
export const WEIGHTS = {
  cuisine: 0.35,
  flavor: 0.3,
  protein: 0.1, // §9.6 — kept weak; protein spread comes from the ≤2 cap, not score
  popularity: 0.15,
  repertoire: 0.25, // §9.1 — folded in for FAMILIAR recipes only (≥0.25)
  personaNudgeMax: 0.15,
  jitter: 0.05, // §9.3 — tiebreaker only, never the freshness engine
} as const;

// MMR diversity penalty: finalScore = base − λ·maxSim(c, selected) (§3.5).
const MMR_LAMBDA = 0.4;

// Recency decays linearly over this window; an 8-month-old cook → 0 repertoire
// boost, so it ranks like a merely-saved recipe (§9.1 motivating example).
const RECENCY_WINDOW_DAYS = 90;

// Persona → familiar : novel ratio (Finding 10 / §3.2). Value = familiar share.
export const PERSONA_FAMILIAR_RATIO: Record<string, number> = {
  explorer: 0.5,
  optimizer: 0.7,
  dietary: 0.7,
  meal_prepper: 0.8,
  time_crunched: 0.85,
};

// Hard variety caps across the whole selection (§9.2). Cuisine cap is ≤3 by
// default and tightened to ≤2 only for explorers; protein cap is always ≤2.
// MMR provides the smooth gradient — the caps are just the backstop, relaxed
// before returning a partial result.
const PROTEIN_CAP = 2;
function cuisineCap(cookStyle: string | null): number {
  return cookStyle === "explorer" ? 2 : 3;
}

function familiarRatio(cookStyle: string | null): number {
  if (cookStyle && cookStyle in PERSONA_FAMILIAR_RATIO)
    return PERSONA_FAMILIAR_RATIO[cookStyle];
  // null / unknown persona: a sane familiar lean. True cold-start users have an
  // empty familiar pool, so this only matters for pre-onboarding users with cooks.
  return 0.7;
}

// Persona-adaptive first-tap default count (§9.5). "Sugerir mais" adds +3/tap
// (handled at the call site); there is no upfront numeric picker.
export function defaultSuggestionCount(cookStyle: string | null): number {
  if (cookStyle === "meal_prepper" || cookStyle === "time_crunched") return 4;
  if (cookStyle === "explorer") return 6;
  return 5;
}

// ─── Per-recipe component scores (each normalised to [0,1]) ──────────────────

function cuisineScore(r: GeneratorRecipe, fp: FlavorProfile | null): number {
  if (!fp || fp.cuisineBreakdown.length === 0) return 0;
  let max = 0;
  for (const tag of r.cuisine_tags) {
    const match = fp.cuisineBreakdown.find((c) => c.cuisine === tag);
    if (match && match.pct > max) max = match.pct;
  }
  return max / 100;
}

function flavorScore(r: GeneratorRecipe, fp: FlavorProfile | null): number {
  if (!fp || fp.topFlavorNotes.length === 0) return 0;
  const top = new Set(fp.topFlavorNotes);
  let overlap = 0;
  for (const note of r.flavor_notes) if (top.has(note)) overlap++;
  let score = overlap / Math.max(1, fp.topFlavorNotes.length);
  // Heat alignment: a spice-leaning cook gets a small bonus for spicy recipes.
  if (fp.avgHeatLevel >= 1 && r.flavor_notes.includes("spicy")) score += 0.2;
  return Math.min(1, score);
}

function proteinScore(r: GeneratorRecipe, signals: GeneratorSignals): number {
  const fp = signals.flavorProfile;
  const preferred = new Set(signals.exploredProteins);
  if (fp?.topProtein) preferred.add(fp.topProtein);
  if (preferred.size === 0) return 0.4; // cold-start — neutral, variety handles it
  for (const p of r.proteins) if (preferred.has(p)) return 1;
  return 0.4;
}

function personaNudge(r: GeneratorRecipe, cookStyle: string | null): number {
  const max = WEIGHTS.personaNudgeMax;
  switch (cookStyle) {
    case "optimizer":
      // Favour high protein-per-calorie recipes (pcal_ratio is ~0–1).
      return Math.min(1, Math.max(0, r.pcal_ratio ?? 0)) * max;
    case "time_crunched":
      // Full nudge for ≤30 min; linear decay to 0 at 60 min; none if unknown.
      if (r.time_min == null) return 0;
      if (r.time_min <= 30) return max;
      return max * Math.max(0, 1 - (r.time_min - 30) / 30);
    case "meal_prepper":
      // Favour batch-friendly recipes (more servings).
      return Math.min(1, r.servings / 6) * max;
    default:
      return 0;
  }
}

function repertoireScore(id: string, repertoire: Repertoire): number {
  const entry = repertoire.get(id);
  if (!entry) return 0;
  const freq = Math.min(1, entry.cookCount / 5);
  const recency = Math.max(0, 1 - entry.daysSinceLastCook / RECENCY_WINDOW_DAYS);
  return freq * recency;
}

// ─── Internal scored-candidate shape ─────────────────────────────────────────

type Scored = {
  recipe: GeneratorRecipe;
  base: number;
  familiar: boolean;
  primaryProtein: string | null;
};

// Min-max normalise popularity across the (excluded-filtered) candidate pool.
function popularityNormaliser(
  candidates: GeneratorRecipe[],
): (r: GeneratorRecipe) => number {
  let min = Infinity;
  let max = -Infinity;
  for (const c of candidates) {
    if (c.popularity_score < min) min = c.popularity_score;
    if (c.popularity_score > max) max = c.popularity_score;
  }
  const span = max - min;
  if (!isFinite(span) || span <= 0) return () => 0;
  return (r) => (r.popularity_score - min) / span;
}

// MMR similarity (§3.5 + §9.6): cuisine overlap only. The protein term from the
// original sim() is dropped so that cap + MMR + score don't compound into a net
// anti-protein bias — protein spread is the ≤2 cap's job alone (§9.6).
function sharesCuisine(a: GeneratorRecipe, b: GeneratorRecipe): boolean {
  if (a.cuisine_tags.length === 0 || b.cuisine_tags.length === 0) return false;
  const set = new Set(a.cuisine_tags);
  return b.cuisine_tags.some((t) => set.has(t));
}

function maxSim(r: GeneratorRecipe, selected: Scored[]): number {
  let max = 0;
  for (const s of selected) {
    if (sharesCuisine(r, s.recipe)) {
      max = 1;
      break;
    }
  }
  return max;
}

type Caps = {
  cuisine: Map<string, number>;
  protein: Map<string, number>;
  cuisineCap: number;
};

function withinCaps(r: GeneratorRecipe, primaryProtein: string | null, caps: Caps): boolean {
  for (const tag of r.cuisine_tags) {
    if ((caps.cuisine.get(tag) ?? 0) >= caps.cuisineCap) return false;
  }
  if (primaryProtein && (caps.protein.get(primaryProtein) ?? 0) >= PROTEIN_CAP)
    return false;
  return true;
}

function bumpCaps(s: Scored, caps: Caps): void {
  for (const tag of s.recipe.cuisine_tags) {
    caps.cuisine.set(tag, (caps.cuisine.get(tag) ?? 0) + 1);
  }
  if (s.primaryProtein) {
    caps.protein.set(s.primaryProtein, (caps.protein.get(s.primaryProtein) ?? 0) + 1);
  }
}

// Greedy MMR fill: repeatedly take the highest finalScore candidate from `pool`
// that respects the caps (unless enforceCaps is false), until `quota` is met or
// the pool is exhausted. Mutates `selected`, `caps`, and `taken`.
function greedyFill(
  pool: Scored[],
  quota: number,
  selected: Scored[],
  caps: Caps,
  taken: Set<string>,
  enforceCaps: boolean,
): void {
  let picked = 0;
  while (picked < quota) {
    let best: Scored | null = null;
    let bestScore = -Infinity;
    for (const cand of pool) {
      if (taken.has(cand.recipe.id)) continue;
      if (enforceCaps && !withinCaps(cand.recipe, cand.primaryProtein, caps))
        continue;
      const finalScore = cand.base - MMR_LAMBDA * maxSim(cand.recipe, selected);
      if (finalScore > bestScore) {
        bestScore = finalScore;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    taken.add(best.recipe.id);
    bumpCaps(best, caps);
    picked++;
  }
}

/**
 * Select up to `count` recipe ids for a generated plan.
 *
 * Pipeline (§3.5, amended by §9):
 *  1. Drop excluded recipes (in-plan + recently suggested — §9.3).
 *  2. Score every candidate; FAMILIAR recipes also get the repertoire boost (§9.1).
 *  3. Split FAMILIAR / NOVEL; fill familiarCount from FAMILIAR and novelCount from
 *     NOVEL via greedy MMR under the variety caps (§9.2).
 *  4. Redistribute any shortfall to the other pool; if still short, top up from the
 *     combined remainder ignoring the familiar/novel boundary.
 *  5. If caps blocked filling `count`, relax them and fill the rest (§3.5 / §9.2).
 *
 * @param rng inject a seeded rng for deterministic tests; defaults to Math.random.
 * @returns ordered recipe ids (selection order). Never includes excluded ids or
 *          duplicates; length ≤ count (fewer only when the pool is too small).
 */
export function selectPlanRecipes(
  candidates: GeneratorRecipe[],
  signals: GeneratorSignals,
  count: number,
  rng: () => number = Math.random,
): string[] {
  if (count <= 0) return [];

  const pool = candidates.filter((c) => !signals.excludeRecipeIds.has(c.id));
  if (pool.length === 0) return [];

  const normPopularity = popularityNormaliser(pool);
  const jitterOf = () => (rng() - 0.5) * 2 * WEIGHTS.jitter; // ±jitter tiebreaker

  const scored: Scored[] = pool.map((r) => {
    const familiar = signals.familiarRecipeIds.has(r.id);
    let base =
      WEIGHTS.cuisine * cuisineScore(r, signals.flavorProfile) +
      WEIGHTS.flavor * flavorScore(r, signals.flavorProfile) +
      WEIGHTS.protein * proteinScore(r, signals) +
      WEIGHTS.popularity * normPopularity(r) +
      personaNudge(r, signals.cookStyle) +
      jitterOf();
    if (familiar) base += WEIGHTS.repertoire * repertoireScore(r.id, signals.repertoire);
    return {
      recipe: r,
      base,
      familiar,
      primaryProtein: r.proteins[0] ?? null,
    };
  });

  const familiarPool = scored.filter((s) => s.familiar);
  const novelPool = scored.filter((s) => !s.familiar);

  const target = Math.min(count, pool.length);
  const familiarCount = Math.round(target * familiarRatio(signals.cookStyle));
  const novelCount = target - familiarCount;

  const selected: Scored[] = [];
  const taken = new Set<string>();
  const caps: Caps = {
    cuisine: new Map(),
    protein: new Map(),
    cuisineCap: cuisineCap(signals.cookStyle),
  };

  // Fill each pool to its quota under the caps.
  greedyFill(familiarPool, familiarCount, selected, caps, taken, true);
  greedyFill(novelPool, novelCount, selected, caps, taken, true);

  // Redistribute shortfall across the boundary (§3.5): whatever quota one pool
  // couldn't meet, the other tries to absorb. A single combined pass over the
  // remaining scored set, still under caps, covers both directions at once.
  if (selected.length < target) {
    greedyFill(scored, target - selected.length, selected, caps, taken, true);
  }

  // Last resort: caps blocked filling `count` (sparse / monotone pool) — relax
  // the caps and fill the rest so we still return a usable week (§3.5 / §9.2).
  if (selected.length < target) {
    greedyFill(scored, target - selected.length, selected, caps, taken, false);
  }

  return selected.map((s) => s.recipe.id);
}
