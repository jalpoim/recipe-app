import { describe, it, expect } from "vitest";
import type { FlavorProfile } from "./supabase/flavor-profile-queries";
import {
  selectPlanRecipes,
  defaultSuggestionCount,
  type GeneratorRecipe,
  type GeneratorSignals,
  type Repertoire,
} from "./plan-generator";

// ─── Deterministic rng (mulberry32) ──────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = () => mulberry32(12345);

// ─── Builders ─────────────────────────────────────────────────────────────────
function recipe(
  id: string,
  o: Partial<GeneratorRecipe> = {},
): GeneratorRecipe {
  return {
    id,
    proteins: [],
    cuisine_tags: [],
    flavor_notes: [],
    time_min: null,
    pcal_ratio: null,
    servings: 1,
    popularity_score: 0,
    ...o,
  };
}

function signals(o: Partial<GeneratorSignals> = {}): GeneratorSignals {
  return {
    flavorProfile: null,
    cookStyle: null,
    exploredProteins: [],
    familiarRecipeIds: new Set<string>(),
    excludeRecipeIds: new Set<string>(),
    repertoire: new Map() as Repertoire,
    ...o,
  };
}

function fp(o: Partial<FlavorProfile> = {}): FlavorProfile {
  return {
    signatureIngredient: null,
    signatureIngredientPlatformMultiple: 0,
    topFlavorNotes: [],
    avgHeatLevel: 0,
    cuisineBreakdown: [],
    topProtein: null,
    proteinVarietyCount: 0,
    avgCookingTimeMin: null,
    platformAvgCookingTimeMin: null,
    distinctCuisines: 0,
    platformAvgCuisines: null,
    lifetimeCookCount: 0,
    ...o,
  };
}

// Pool of recipes each with a unique cuisine + protein so the variety caps never
// bind — isolates whatever behaviour a test is actually probing.
function uncappedPool(prefix: string, n: number): GeneratorRecipe[] {
  return Array.from({ length: n }, (_, i) =>
    recipe(`${prefix}${i}`, {
      cuisine_tags: [`${prefix}-cuisine-${i}`],
      proteins: [`${prefix}-protein-${i}`],
      popularity_score: 50,
    }),
  );
}

// ─── §5.1 / §9 — persona familiar:novel ratio ────────────────────────────────
describe("familiar:novel ratio (§3.2)", () => {
  it("meal_prepper N=10 → 8 familiar / 2 novel when both pools are large", () => {
    const familiar = uncappedPool("fam", 8);
    const novel = uncappedPool("nov", 10);
    const fam = new Set(familiar.map((r) => r.id));
    const out = selectPlanRecipes(
      [...familiar, ...novel],
      signals({ cookStyle: "meal_prepper", familiarRecipeIds: fam }),
      10,
      rng(),
    );
    expect(out).toHaveLength(10);
    expect(out.filter((id) => fam.has(id))).toHaveLength(8);
  });
});

// ─── §5.2 / §9.2 — variety caps ───────────────────────────────────────────────
describe("variety caps (§9.2)", () => {
  it("explorer: cuisine cap ≤2 even when one cuisine dominates the pool", () => {
    // 6 italian (popular → would all be picked first) + 6 distinct-cuisine fillers.
    const italian = Array.from({ length: 6 }, (_, i) =>
      recipe(`it${i}`, { cuisine_tags: ["italian"], popularity_score: 100 }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      recipe(`f${i}`, { cuisine_tags: [`c${i}`], popularity_score: 10 }),
    );
    const out = selectPlanRecipes(
      [...italian, ...fillers],
      signals({ cookStyle: "explorer" }),
      6,
      rng(),
    );
    expect(out).toHaveLength(6);
    const italianIds = new Set(italian.map((r) => r.id));
    expect(out.filter((id) => italianIds.has(id)).length).toBeLessThanOrEqual(2);
  });

  it("non-explorer: cuisine cap ≤3", () => {
    const italian = Array.from({ length: 6 }, (_, i) =>
      recipe(`it${i}`, { cuisine_tags: ["italian"], popularity_score: 100 }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      recipe(`f${i}`, { cuisine_tags: [`c${i}`], popularity_score: 10 }),
    );
    const out = selectPlanRecipes(
      [...italian, ...fillers],
      signals({ cookStyle: "optimizer" }),
      6,
      rng(),
    );
    const italianIds = new Set(italian.map((r) => r.id));
    expect(out.filter((id) => italianIds.has(id)).length).toBeLessThanOrEqual(3);
  });

  it("protein cap ≤2 even when one protein dominates", () => {
    // 6 chicken across distinct cuisines + 6 distinct-protein fillers.
    const chicken = Array.from({ length: 6 }, (_, i) =>
      recipe(`ch${i}`, {
        proteins: ["chicken"],
        cuisine_tags: [`chc${i}`],
        popularity_score: 100,
      }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      recipe(`f${i}`, {
        proteins: [`p${i}`],
        cuisine_tags: [`fc${i}`],
        popularity_score: 10,
      }),
    );
    const out = selectPlanRecipes(
      [...chicken, ...fillers],
      signals({ cookStyle: "optimizer" }),
      6,
      rng(),
    );
    const chickenIds = new Set(chicken.map((r) => r.id));
    expect(out.filter((id) => chickenIds.has(id)).length).toBeLessThanOrEqual(2);
  });
});

// ─── §5.3 — cuisine affinity ──────────────────────────────────────────────────
describe("cuisine affinity (§3.4)", () => {
  it("a recipe in the user's top cuisine outranks an equally-popular off-profile one", () => {
    const onProfile = recipe("on", {
      cuisine_tags: ["japanese"],
      popularity_score: 100,
    });
    const offProfile = recipe("off", {
      cuisine_tags: ["mexican"],
      popularity_score: 100,
    });
    const out = selectPlanRecipes(
      [offProfile, onProfile],
      signals({
        flavorProfile: fp({ cuisineBreakdown: [{ cuisine: "japanese", pct: 80 }] }),
      }),
      1,
      rng(),
    );
    expect(out).toEqual(["on"]);
  });
});

// ─── §5.4 — flavor affinity ───────────────────────────────────────────────────
describe("flavor affinity (§3.4)", () => {
  it("a recipe matching topFlavorNotes is preferred among ties", () => {
    const match = recipe("m", {
      flavor_notes: ["garlic", "citrus"],
      popularity_score: 100,
    });
    const noMatch = recipe("nm", {
      flavor_notes: ["sweet"],
      popularity_score: 100,
    });
    const out = selectPlanRecipes(
      [noMatch, match],
      signals({ flavorProfile: fp({ topFlavorNotes: ["garlic", "citrus"] }) }),
      1,
      rng(),
    );
    expect(out).toEqual(["m"]);
  });
});

// ─── §5.5 / §3.6 — cold-start ─────────────────────────────────────────────────
describe("cold-start (§3.6)", () => {
  it("null flavor profile → popularity-led, fills N, respects uniqueness", () => {
    // Five clear winners (high popularity) + three losers, distinct cuisine/protein.
    const winners = [1000, 990, 980, 970, 960].map((p, i) =>
      recipe(`w${i}`, {
        popularity_score: p,
        cuisine_tags: [`wc${i}`],
        proteins: [`wp${i}`],
      }),
    );
    const losers = [10, 9, 8].map((p, i) =>
      recipe(`l${i}`, {
        popularity_score: p,
        cuisine_tags: [`lc${i}`],
        proteins: [`lp${i}`],
      }),
    );
    const out = selectPlanRecipes(
      [...losers, ...winners],
      signals({ flavorProfile: null }),
      5,
      rng(),
    );
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBe(5); // no duplicates
    expect(new Set(out)).toEqual(new Set(winners.map((r) => r.id)));
  });
});

// ─── §5.6 — pool shortfall redistribution ─────────────────────────────────────
describe("pool shortfall (§3.5)", () => {
  it("fewer familiar than quota → shortfall redistributed; no dupes/excluded", () => {
    const familiar = uncappedPool("fam", 1); // quota would be 4 (meal_prepper)
    const novel = uncappedPool("nov", 6);
    const fam = new Set(familiar.map((r) => r.id));
    const out = selectPlanRecipes(
      [...familiar, ...novel],
      signals({ cookStyle: "meal_prepper", familiarRecipeIds: fam }),
      5,
      rng(),
    );
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBe(5);
    expect(out).toContain("fam0");
  });
});

// ─── §5.7 — exclusions ────────────────────────────────────────────────────────
describe("exclusions (§9.3)", () => {
  it("ids in excludeRecipeIds never appear, even when most popular", () => {
    const pool = uncappedPool("r", 6).map((r, i) => ({
      ...r,
      popularity_score: 1000 - i, // r0,r1 would be top picks
    }));
    const out = selectPlanRecipes(
      pool,
      signals({ excludeRecipeIds: new Set(["r0", "r1"]) }),
      3,
      rng(),
    );
    expect(out).toHaveLength(3);
    expect(out).not.toContain("r0");
    expect(out).not.toContain("r1");
  });
});

// ─── §9.1 — repertoireScore is the differentiator ─────────────────────────────
describe("repertoireScore (§9.1)", () => {
  it("a frequently + recently cooked familiar recipe beats a stale one", () => {
    const goTo = recipe("goto", { cuisine_tags: ["italian"], popularity_score: 50 });
    const stale = recipe("stale", { cuisine_tags: ["italian"], popularity_score: 50 });
    const repertoire: Repertoire = new Map([
      ["goto", { cookCount: 5, daysSinceLastCook: 0 }], // freq 1 · recency 1 = 1
      ["stale", { cookCount: 1, daysSinceLastCook: 200 }], // recency 0 → 0
    ]);
    const out = selectPlanRecipes(
      [stale, goTo],
      signals({
        cookStyle: "meal_prepper",
        familiarRecipeIds: new Set(["goto", "stale"]),
        repertoire,
      }),
      1,
      rng(),
    );
    expect(out).toEqual(["goto"]);
  });

  it("repertoire boost applies to FAMILIAR recipes only", () => {
    // Same repertoire data, but the recipe is NOT familiar → no boost, so the
    // higher-popularity novel recipe wins.
    const cooked = recipe("cooked", { cuisine_tags: ["a"], popularity_score: 0 });
    const popular = recipe("popular", { cuisine_tags: ["b"], popularity_score: 100 });
    const repertoire: Repertoire = new Map([
      ["cooked", { cookCount: 5, daysSinceLastCook: 0 }],
    ]);
    const out = selectPlanRecipes(
      [cooked, popular],
      signals({ familiarRecipeIds: new Set(), repertoire }), // cooked NOT in familiar set
      1,
      rng(),
    );
    expect(out).toEqual(["popular"]);
  });
});

// ─── §9.5 — persona-adaptive default count ────────────────────────────────────
describe("defaultSuggestionCount (§9.5)", () => {
  it("maps personas to first-tap counts", () => {
    expect(defaultSuggestionCount("meal_prepper")).toBe(4);
    expect(defaultSuggestionCount("time_crunched")).toBe(4);
    expect(defaultSuggestionCount("explorer")).toBe(6);
    expect(defaultSuggestionCount("optimizer")).toBe(5);
    expect(defaultSuggestionCount("dietary")).toBe(5);
    expect(defaultSuggestionCount(null)).toBe(5);
  });
});

// ─── §9.6 — protein spread via cap only, not stacked into MMR ──────────────────
describe("protein de-duplication (§9.6)", () => {
  it("two same-protein recipes can both be picked (MMR doesn't penalise protein)", () => {
    // r1/r2 share protein 'chicken' but differ in cuisine; r3 shares r1's cuisine.
    // Cuisine-only MMR penalises r3 (cuisine clash), not r2 (protein clash) — so
    // both chicken recipes are selected. If protein were still in sim(), r2 would
    // be penalised too and r3 could sneak in.
    const r1 = recipe("r1", {
      proteins: ["chicken"],
      cuisine_tags: ["italian"],
      popularity_score: 100,
    });
    const r2 = recipe("r2", {
      proteins: ["chicken"],
      cuisine_tags: ["mexican"],
      popularity_score: 100,
    });
    const r3 = recipe("r3", {
      proteins: ["beef"],
      cuisine_tags: ["italian"],
      popularity_score: 50,
    });
    const out = selectPlanRecipes(
      [r1, r2, r3],
      signals({ exploredProteins: ["chicken"] }),
      2,
      rng(),
    );
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(["r1", "r2"]));
    expect(out).not.toContain("r3");
  });
});

// ─── Guards ───────────────────────────────────────────────────────────────────
describe("guards", () => {
  it("count ≤ 0 returns empty", () => {
    expect(selectPlanRecipes(uncappedPool("r", 3), signals(), 0, rng())).toEqual([]);
  });
  it("empty candidate pool returns empty", () => {
    expect(selectPlanRecipes([], signals(), 5, rng())).toEqual([]);
  });
  it("returns fewer than count when the pool is too small", () => {
    const out = selectPlanRecipes(uncappedPool("r", 2), signals(), 5, rng());
    expect(out).toHaveLength(2);
  });
});
