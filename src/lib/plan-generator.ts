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

// Why a recipe was picked, surfaced to the user as a "why this" caption (F12a,
// §10.2). Derived from which signal dominated the pick — see deriveReason.
export type ReasonCode =
  | "repertoire" // from your cooked/liked/saved history
  | "top_cuisine" // matches a cuisine you cook a lot
  | "flavor_match" // matches flavours you favour
  | "novel" // new-to-you (taste-adjacent but outside your usual)
  | "popular" // cold-start / popularity-led
  | "intent_protein" // filled to satisfy an explicit protein target (§11.4.1)
  | "intent_leftover"; // filled to use a leftover ingredient (§11.4.3)

export type SelectedRecipe = { id: string; reason: ReasonCode };

// ─── Intent layer (F13 §11) — explicit, per-plan, HARD constraints ───────────
// User-facing protein families → the protein slugs they cover (§11.4.1).
export type ProteinFamily =
  | "poultry"
  | "fish"
  | "seafood"
  | "red_meat"
  | "vegetarian"
  | "eggs";

export const PROTEIN_FAMILIES: Record<ProteinFamily, string[]> = {
  poultry: ["chicken", "turkey", "duck"],
  fish: ["fish", "salmon", "tuna"],
  seafood: ["seafood"],
  red_meat: ["beef", "pork", "lamb", "veal"],
  vegetarian: ["tofu", "legumes"],
  eggs: ["eggs"],
};

export type VarietyLevel = "similar" | "balanced" | "surprise";

export type PlanIntent = {
  // Hard minimums per protein family — these OVERRIDE the §9.2 protein cap.
  proteinTargets?: { family: ProteinFamily; count: number }[];
  variety?: VarietyLevel;
  maxTime?: number | null;
  // Leftover coverage groups (slice 3): each group is the set of candidate recipe
  // ids that use one wanted ingredient; the core guarantees ≥1 pick per group
  // where possible (best-effort coverage, §11.4.3). The server derives which
  // groups went uncovered from the returned ids (honest fallback). Resolved
  // server-side from the chosen ingredients.
  coverageGroups?: { label: string; recipeIds: string[] }[];
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

// The variety dial (§11.4.2) overrides the persona defaults for one generation.
// "similar" leans into the user's repertoire + favourite cuisines (more familiar,
// looser cuisine cap so a cohesive favourite can repeat, gentler diversity push);
// "surprise" pushes novelty + spread (more novel, tight cuisine cap, stronger MMR);
// "balanced"/unset keeps the persona behaviour.
function tuning(
  cookStyle: string | null,
  variety: VarietyLevel | undefined,
): { familiarRatio: number; cuisineCap: number; lambda: number } {
  const base = {
    familiarRatio: familiarRatio(cookStyle),
    cuisineCap: cuisineCap(cookStyle),
    lambda: MMR_LAMBDA,
  };
  if (variety === "similar")
    return {
      familiarRatio: Math.max(base.familiarRatio, 0.8),
      cuisineCap: 3,
      lambda: 0.2,
    };
  if (variety === "surprise")
    return { familiarRatio: Math.min(base.familiarRatio, 0.4), cuisineCap: 2, lambda: 0.6 };
  return base;
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

// The user-facing "why this" reason for a pick (F12a). Familiar recipes come from
// the user's own history; novel recipes are labelled by whichever taste signal
// earned them, or as plain discovery when there's no taste signal (cold-start).
function deriveReason(
  r: GeneratorRecipe,
  familiar: boolean,
  signals: GeneratorSignals,
): ReasonCode {
  if (familiar) return "repertoire";
  const fp = signals.flavorProfile;
  if (!fp) return "popular"; // cold-start: no taste model yet
  const cuisine = cuisineScore(r, fp);
  const flavor = flavorScore(r, fp);
  if (cuisine > 0 && cuisine >= flavor) return "top_cuisine";
  if (flavor > 0) return "flavor_match";
  return "novel"; // warm profile, but this pick is outside the usual cuisines/flavours
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

function withinCaps(
  r: GeneratorRecipe,
  primaryProtein: string | null,
  caps: Caps,
  enforceProtein: boolean,
): boolean {
  for (const tag of r.cuisine_tags) {
    if ((caps.cuisine.get(tag) ?? 0) >= caps.cuisineCap) return false;
  }
  // Protein cap is skipped while filling an explicit protein target — intent
  // overrides the §9.2 cap (§11.4.1).
  if (
    enforceProtein &&
    primaryProtein &&
    (caps.protein.get(primaryProtein) ?? 0) >= PROTEIN_CAP
  )
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

type FillOpts = {
  enforceCuisineCap: boolean;
  enforceProteinCap: boolean;
  lambda: number;
  // When set, picks made by this fill are tagged with this reason (unless already
  // tagged) — used to mark intent-driven slots (§11.4).
  tagReason?: ReasonCode;
  reasonById?: Map<string, ReasonCode>;
};

// Greedy MMR fill: repeatedly take the highest finalScore candidate from `pool`
// that respects the (optionally enforced) caps, until `quota` is met or the pool
// is exhausted. Mutates `selected`, `caps`, `taken`, and `reasonById`.
function greedyFill(
  pool: Scored[],
  quota: number,
  selected: Scored[],
  caps: Caps,
  taken: Set<string>,
  opts: FillOpts,
): void {
  let picked = 0;
  while (picked < quota) {
    let best: Scored | null = null;
    let bestScore = -Infinity;
    for (const cand of pool) {
      if (taken.has(cand.recipe.id)) continue;
      if (
        opts.enforceCuisineCap &&
        !withinCaps(cand.recipe, cand.primaryProtein, caps, opts.enforceProteinCap)
      )
        continue;
      const finalScore = cand.base - opts.lambda * maxSim(cand.recipe, selected);
      if (finalScore > bestScore) {
        bestScore = finalScore;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    taken.add(best.recipe.id);
    bumpCaps(best, caps);
    if (opts.tagReason && opts.reasonById && !opts.reasonById.has(best.recipe.id))
      opts.reasonById.set(best.recipe.id, opts.tagReason);
    picked++;
  }
}

/**
 * Select up to `count` recipe ids for a generated plan.
 *
 * Pipeline (§3.5 / §9, extended by the F13 intent layer §11):
 *  0. Apply the explicit HARD intent first: max-time filter, then reserve slots for
 *     protein-family targets (§11.4.1) and leftover coverage groups (§11.4.3).
 *     These honour the user's stated intent before any taste scoring.
 *  1. Drop excluded recipes (in-plan + recently suggested — §9.3).
 *  2. Score every candidate; FAMILIAR recipes also get the repertoire boost (§9.1).
 *  3. Variety dial (§11.4.2) tunes familiar:novel ratio, cuisine cap and MMR λ.
 *  4. Fill remaining slots FAMILIAR/NOVEL via greedy MMR under the caps; redistribute
 *     shortfall; relax caps as a last resort (§3.5 / §9.2).
 *
 * @param rng inject a seeded rng for deterministic tests; defaults to Math.random.
 * @returns ordered {id, reason}; never excluded ids or duplicates; length ≤ count.
 */
export function selectPlanRecipes(
  candidates: GeneratorRecipe[],
  signals: GeneratorSignals,
  count: number,
  rng: () => number = Math.random,
  intent: PlanIntent = {},
): SelectedRecipe[] {
  if (count <= 0) return [];

  // HARD: max-time filter is part of the explicit intent (§11.4.4).
  let pool = candidates.filter((c) => !signals.excludeRecipeIds.has(c.id));
  if (intent.maxTime != null) {
    const cap = intent.maxTime;
    pool = pool.filter((c) => c.time_min != null && c.time_min <= cap);
  }
  if (pool.length === 0) return [];

  const tune = tuning(signals.cookStyle, intent.variety);
  const normPopularity = popularityNormaliser(pool);
  const jitterOf = () => (rng() - 0.5) * 2 * WEIGHTS.jitter; // ±jitter tiebreaker

  const scoredById = new Map<string, Scored>();
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
    const s: Scored = { recipe: r, base, familiar, primaryProtein: r.proteins[0] ?? null };
    scoredById.set(r.id, s);
    return s;
  });

  const target = Math.min(count, pool.length);
  const selected: Scored[] = [];
  const taken = new Set<string>();
  const reasonById = new Map<string, ReasonCode>();
  const caps: Caps = {
    cuisine: new Map(),
    protein: new Map(),
    cuisineCap: tune.cuisineCap,
  };

  // ── 0a. Leftover coverage (§11.4.3): reserve ≥1 slot per group, best-effort.
  // Cuisine cap still applies; protein cap relaxed (a leftover may need a 3rd of a
  // protein). Uncovered groups are derived server-side from the returned ids.
  for (const group of intent.coverageGroups ?? []) {
    if (selected.length >= target) break;
    if (group.recipeIds.some((id) => taken.has(id))) continue; // already covered
    const groupPool = group.recipeIds
      .map((id) => scoredById.get(id))
      .filter((s): s is Scored => !!s);
    greedyFill(groupPool, 1, selected, caps, taken, {
      enforceCuisineCap: true,
      enforceProteinCap: false,
      lambda: tune.lambda,
      tagReason: "intent_leftover",
      reasonById,
    });
  }

  // ── 0b. Protein-family targets (§11.4.1): hard minimums that OVERRIDE the cap.
  for (const tgt of intent.proteinTargets ?? []) {
    if (selected.length >= target) break;
    const slugs = new Set(PROTEIN_FAMILIES[tgt.family] ?? []);
    const familyPool = scored.filter((s) =>
      s.recipe.proteins.some((p) => slugs.has(p)),
    );
    const want = Math.min(tgt.count, target - selected.length);
    greedyFill(familyPool, want, selected, caps, taken, {
      enforceCuisineCap: true,
      enforceProteinCap: false, // intent overrides the §9.2 protein cap
      lambda: tune.lambda,
      tagReason: "intent_protein",
      reasonById,
    });
  }

  // ── 1. Remaining slots: familiar/novel split via greedy MMR under the caps.
  const remaining = target - selected.length;
  if (remaining > 0) {
    const familiarPool = scored.filter((s) => s.familiar);
    const novelPool = scored.filter((s) => !s.familiar);
    const familiarCount = Math.round(remaining * tune.familiarRatio);
    const novelCount = remaining - familiarCount;
    const fillOpts: FillOpts = {
      enforceCuisineCap: true,
      enforceProteinCap: true,
      lambda: tune.lambda,
    };
    greedyFill(familiarPool, familiarCount, selected, caps, taken, fillOpts);
    greedyFill(novelPool, novelCount, selected, caps, taken, fillOpts);
    // Redistribute shortfall across the boundary (§3.5).
    if (selected.length < target) {
      greedyFill(scored, target - selected.length, selected, caps, taken, fillOpts);
    }
  }

  // ── 2. Last resort: relax caps to fill `count` from whatever remains (§3.5/§9.2).
  if (selected.length < target) {
    greedyFill(scored, target - selected.length, selected, caps, taken, {
      enforceCuisineCap: false,
      enforceProteinCap: false,
      lambda: tune.lambda,
    });
  }

  return selected.map((s) => ({
    id: s.recipe.id,
    reason:
      reasonById.get(s.recipe.id) ?? deriveReason(s.recipe, s.familiar, signals),
  }));
}
