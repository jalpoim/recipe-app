import { describe, it, expect } from "vitest";
import type { FlavorProfile } from "./supabase/flavor-profile-queries";
import {
  selectPlanRecipes,
  defaultSuggestionCount,
  type GeneratorRecipe,
  type GeneratorSignals,
  type Repertoire,
  type SelectedRecipe,
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

// Most tests only care about the selected ids; reason codes have a dedicated block.
function ids(out: SelectedRecipe[]): string[] {
  return out.map((s) => s.id);
}

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
    const out = ids(
      selectPlanRecipes(
        [...familiar, ...novel],
        signals({ cookStyle: "meal_prepper", familiarRecipeIds: fam }),
        10,
        rng(),
      ),
    );
    expect(out).toHaveLength(10);
    expect(out.filter((id) => fam.has(id))).toHaveLength(8);
  });
});

// ─── §5.2 / §9.2 — variety caps ───────────────────────────────────────────────
describe("variety caps (§9.2)", () => {
  it("explorer: cuisine cap ≤2 even when one cuisine dominates the pool", () => {
    const italian = Array.from({ length: 6 }, (_, i) =>
      recipe(`it${i}`, { cuisine_tags: ["italian"], popularity_score: 100 }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      recipe(`f${i}`, { cuisine_tags: [`c${i}`], popularity_score: 10 }),
    );
    const out = ids(
      selectPlanRecipes(
        [...italian, ...fillers],
        signals({ cookStyle: "explorer" }),
        6,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [...italian, ...fillers],
        signals({ cookStyle: "optimizer" }),
        6,
        rng(),
      ),
    );
    const italianIds = new Set(italian.map((r) => r.id));
    expect(out.filter((id) => italianIds.has(id)).length).toBeLessThanOrEqual(3);
  });

  it("protein cap ≤2 even when one protein dominates", () => {
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
    const out = ids(
      selectPlanRecipes(
        [...chicken, ...fillers],
        signals({ cookStyle: "optimizer" }),
        6,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [offProfile, onProfile],
        signals({
          flavorProfile: fp({ cuisineBreakdown: [{ cuisine: "japanese", pct: 80 }] }),
        }),
        1,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [noMatch, match],
        signals({ flavorProfile: fp({ topFlavorNotes: ["garlic", "citrus"] }) }),
        1,
        rng(),
      ),
    );
    expect(out).toEqual(["m"]);
  });
});

// ─── §5.5 / §3.6 — cold-start ─────────────────────────────────────────────────
describe("cold-start (§3.6)", () => {
  it("null flavor profile → popularity-led, fills N, respects uniqueness", () => {
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
    const out = ids(
      selectPlanRecipes(
        [...losers, ...winners],
        signals({ flavorProfile: null }),
        5,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [...familiar, ...novel],
        signals({ cookStyle: "meal_prepper", familiarRecipeIds: fam }),
        5,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        pool,
        signals({ excludeRecipeIds: new Set(["r0", "r1"]) }),
        3,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [stale, goTo],
        signals({
          cookStyle: "meal_prepper",
          familiarRecipeIds: new Set(["goto", "stale"]),
          repertoire,
        }),
        1,
        rng(),
      ),
    );
    expect(out).toEqual(["goto"]);
  });

  it("repertoire boost applies to FAMILIAR recipes only", () => {
    const cooked = recipe("cooked", { cuisine_tags: ["a"], popularity_score: 0 });
    const popular = recipe("popular", { cuisine_tags: ["b"], popularity_score: 100 });
    const repertoire: Repertoire = new Map([
      ["cooked", { cookCount: 5, daysSinceLastCook: 0 }],
    ]);
    const out = ids(
      selectPlanRecipes(
        [cooked, popular],
        signals({ familiarRecipeIds: new Set(), repertoire }), // cooked NOT in familiar set
        1,
        rng(),
      ),
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
    const out = ids(
      selectPlanRecipes(
        [r1, r2, r3],
        signals({ exploredProteins: ["chicken"] }),
        2,
        rng(),
      ),
    );
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(["r1", "r2"]));
    expect(out).not.toContain("r3");
  });
});

// ─── §10.2 / F12a — "why this" reason codes ───────────────────────────────────
describe("reason codes (F12a)", () => {
  const reasonOf = (out: SelectedRecipe[], id: string) =>
    out.find((s) => s.id === id)?.reason;

  it("familiar recipes are tagged 'repertoire'", () => {
    const r = recipe("r", { cuisine_tags: ["italian"], popularity_score: 50 });
    const out = selectPlanRecipes(
      [r],
      signals({ familiarRecipeIds: new Set(["r"]) }),
      1,
      rng(),
    );
    expect(reasonOf(out, "r")).toBe("repertoire");
  });

  it("a novel pick matching the top cuisine is 'top_cuisine'", () => {
    const r = recipe("r", { cuisine_tags: ["japanese"], popularity_score: 50 });
    const out = selectPlanRecipes(
      [r],
      signals({
        flavorProfile: fp({ cuisineBreakdown: [{ cuisine: "japanese", pct: 80 }] }),
      }),
      1,
      rng(),
    );
    expect(reasonOf(out, "r")).toBe("top_cuisine");
  });

  it("a novel pick matching top flavours (no cuisine match) is 'flavor_match'", () => {
    const r = recipe("r", {
      cuisine_tags: ["mexican"],
      flavor_notes: ["garlic"],
      popularity_score: 50,
    });
    const out = selectPlanRecipes(
      [r],
      signals({
        flavorProfile: fp({
          cuisineBreakdown: [{ cuisine: "japanese", pct: 80 }], // no overlap
          topFlavorNotes: ["garlic"],
        }),
      }),
      1,
      rng(),
    );
    expect(reasonOf(out, "r")).toBe("flavor_match");
  });

  it("cold-start picks (null profile) are 'popular'", () => {
    const r = recipe("r", { cuisine_tags: ["italian"], popularity_score: 50 });
    const out = selectPlanRecipes([r], signals({ flavorProfile: null }), 1, rng());
    expect(reasonOf(out, "r")).toBe("popular");
  });

  it("a novel pick with a warm profile but no taste match is 'novel'", () => {
    const r = recipe("r", { cuisine_tags: ["mexican"], popularity_score: 50 });
    const out = selectPlanRecipes(
      [r],
      signals({
        flavorProfile: fp({
          cuisineBreakdown: [{ cuisine: "japanese", pct: 80 }],
          topFlavorNotes: ["citrus"],
        }),
      }),
      1,
      rng(),
    );
    expect(reasonOf(out, "r")).toBe("novel");
  });
});

// ─── §11 / F13 — intent layer ─────────────────────────────────────────────────
describe("intent: protein targets (§11.4.1)", () => {
  it("honours a protein-family minimum even against more-popular other proteins", () => {
    const poultry = [0, 1].map((i) =>
      recipe(`ch${i}`, { proteins: ["chicken"], cuisine_tags: [`pc${i}`], popularity_score: 1 }),
    );
    const beef = [0, 1, 2, 3].map((i) =>
      recipe(`bf${i}`, { proteins: ["beef"], cuisine_tags: [`bc${i}`], popularity_score: 100 }),
    );
    const out = ids(
      selectPlanRecipes([...beef, ...poultry], signals(), 4, rng(), {
        proteinTargets: [{ family: "poultry", count: 2 }],
      }),
    );
    const poultryIds = new Set(poultry.map((r) => r.id));
    expect(out.filter((id) => poultryIds.has(id)).length).toBeGreaterThanOrEqual(2);
  });

  it("a protein target overrides the ≤2 protein cap", () => {
    const chicken = [0, 1, 2, 3].map((i) =>
      recipe(`ch${i}`, { proteins: ["chicken"], cuisine_tags: [`c${i}`], popularity_score: 50 }),
    );
    const out = ids(
      selectPlanRecipes(chicken, signals(), 4, rng(), {
        proteinTargets: [{ family: "poultry", count: 3 }],
      }),
    );
    expect(out.filter((id) => id.startsWith("ch")).length).toBeGreaterThanOrEqual(3);
  });

  it("tags intent-filled picks with the intent_protein reason", () => {
    const r = recipe("r", { proteins: ["salmon"], cuisine_tags: ["x"], popularity_score: 10 });
    const out = selectPlanRecipes([r], signals(), 1, rng(), {
      proteinTargets: [{ family: "fish", count: 1 }],
    });
    expect(out.find((s) => s.id === "r")?.reason).toBe("intent_protein");
  });
});

describe("intent: max time (§11.4.4)", () => {
  it("drops recipes over the time cap", () => {
    const pool = [10, 20, 40, 50].map((tmin, i) =>
      recipe(`r${i}`, { time_min: tmin, cuisine_tags: [`c${i}`], proteins: [`p${i}`], popularity_score: 50 }),
    );
    const out = ids(selectPlanRecipes(pool, signals(), 4, rng(), { maxTime: 30 }));
    expect(out).toEqual(expect.arrayContaining(["r0", "r1"]));
    expect(out).not.toContain("r2");
    expect(out).not.toContain("r3");
  });
});

describe("intent: variety dial (§11.4.2)", () => {
  it("'similar' yields more familiar picks than 'surprise'", () => {
    const familiar = uncappedPool("fam", 5);
    const novel = uncappedPool("nov", 5);
    const fam = new Set(familiar.map((r) => r.id));
    const pool = [...familiar, ...novel];
    const similar = ids(
      selectPlanRecipes(pool, signals({ familiarRecipeIds: fam }), 5, rng(), { variety: "similar" }),
    ).filter((id) => fam.has(id)).length;
    const surprise = ids(
      selectPlanRecipes(pool, signals({ familiarRecipeIds: fam }), 5, rng(), { variety: "surprise" }),
    ).filter((id) => fam.has(id)).length;
    expect(similar).toBeGreaterThan(surprise);
  });
});

describe("intent: leftover coverage (§11.4.3)", () => {
  it("guarantees a pick from a coverage group, even at low popularity", () => {
    const leftover = recipe("lo", { cuisine_tags: ["x"], proteins: ["p"], popularity_score: 1 });
    const others = uncappedPool("o", 5).map((r) => ({ ...r, popularity_score: 100 }));
    const out = ids(
      selectPlanRecipes([leftover, ...others], signals(), 3, rng(), {
        coverageGroups: [{ label: "couve", recipeIds: ["lo"] }],
      }),
    );
    expect(out).toContain("lo");
  });
});

describe("intent: avoid cuisines (§11.4)", () => {
  it("soft-penalises an avoided cuisine so an equal non-avoided recipe wins", () => {
    const avoided = recipe("av", { cuisine_tags: ["mexican"], popularity_score: 50 });
    const ok = recipe("ok", { cuisine_tags: ["italian"], popularity_score: 50 });
    const out = ids(
      selectPlanRecipes([avoided, ok], signals({ avoidCuisines: ["mexican"] }), 1, rng()),
    );
    expect(out).toEqual(["ok"]);
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
