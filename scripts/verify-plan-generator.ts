// One-off manual verification of the F10 pipeline against real production data.
// Replicates suggestPlan's signal-gathering + candidate fetch with a service client
// and runs the pure core, so we exercise the real DB filters without browser auth.
// Run: npx tsx scripts/verify-plan-generator.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import {
  selectPlanRecipes,
  type GeneratorRecipe,
  type Repertoire,
} from "../src/lib/plan-generator";
import type { FlavorProfile } from "../src/lib/supabase/flavor-profile-queries";

const db = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const RICH_USER = "dd8ec600-bc81-4657-a0d3-23eb00524b23";
const FIELDS =
  "id, proteins, cuisine_tags, flavor_notes, time_min, pcal_ratio, servings, popularity_score";

async function candidatePool(excludeProteins: string[]): Promise<GeneratorRecipe[]> {
  let q = db
    .from("recipes")
    .select(FIELDS)
    .is("deleted_at", null)
    .eq("moderation_status", "approved")
    .in("visibility", ["system", "public"])
    // Meals only (F13) — exclude desserts/snacks/drinks/sides.
    .or("course.is.null,course.not.in.(dessert,snack,drink,side)")
    .order("popularity_score", { ascending: false })
    .limit(300);
  if (excludeProteins.length > 0)
    q = q.not("proteins", "ov", `{${excludeProteins.join(",")}}`);
  const { data } = await q;
  return (data ?? []) as GeneratorRecipe[];
}

async function gatherSignals(userId: string) {
  const [{ data: cooks }, { data: inter }, { data: cp }] = await Promise.all([
    db.from("cook_log").select("recipe_id, cooked_at").eq("user_id", userId),
    db
      .from("user_recipe_interactions")
      .select("recipe_id")
      .eq("user_id", userId)
      .in("type", ["like", "save"]),
    db
      .from("user_cook_profile")
      .select("explored_proteins")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const repertoire: Repertoire = new Map();
  const familiar = new Set<string>();
  const now = Date.now();
  for (const r of cooks ?? []) {
    familiar.add(r.recipe_id);
    const days = (now - new Date(r.cooked_at).getTime()) / 86_400_000;
    const e = repertoire.get(r.recipe_id);
    if (e) {
      e.cookCount++;
      if (days < e.daysSinceLastCook) e.daysSinceLastCook = days;
    } else repertoire.set(r.recipe_id, { cookCount: 1, daysSinceLastCook: days });
  }
  for (const r of inter ?? []) familiar.add(r.recipe_id);
  return { repertoire, familiar, exploredProteins: cp?.explored_proteins ?? [] };
}

// Simplified flavor profile from cooked recipes (cuisine mix + top flavor notes).
async function computeFlavorProfile(userId: string): Promise<FlavorProfile | null> {
  const { data } = await db
    .from("cook_log")
    .select("recipe_id, recipes(cuisine_tags, proteins, flavor_notes)")
    .eq("user_id", userId);
  const distinct = new Map<string, { cuisine_tags: string[]; proteins: string[]; flavor_notes: string[] }>();
  for (const row of (data ?? []) as any[]) {
    if (row.recipes && !distinct.has(row.recipe_id)) distinct.set(row.recipe_id, row.recipes);
  }
  if (distinct.size < 5) return null;
  const recipes = [...distinct.values()];
  const cuisineN = new Map<string, number>();
  const flavorN = new Map<string, number>();
  const proteinN = new Map<string, number>();
  for (const r of recipes) {
    for (const c of r.cuisine_tags ?? []) cuisineN.set(c, (cuisineN.get(c) ?? 0) + 1);
    for (const f of r.flavor_notes ?? []) flavorN.set(f, (flavorN.get(f) ?? 0) + 1);
    for (const p of r.proteins ?? []) proteinN.set(p, (proteinN.get(p) ?? 0) + 1);
  }
  const cuisineBreakdown = [...cuisineN.entries()]
    .map(([cuisine, n]) => ({ cuisine, pct: Math.round((n / recipes.length) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  const topFlavorNotes = [...flavorN.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
  const topProtein = [...proteinN.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    signatureIngredient: null, signatureIngredientPlatformMultiple: 0,
    topFlavorNotes, avgHeatLevel: 0, cuisineBreakdown, topProtein,
    proteinVarietyCount: proteinN.size, avgCookingTimeMin: null,
    platformAvgCookingTimeMin: null, distinctCuisines: cuisineN.size,
    platformAvgCuisines: null, lifetimeCookCount: recipes.length,
  };
}

async function nameOf(ids: string[]): Promise<Map<string, { name: string; cuisine_tags: string[]; proteins: string[] }>> {
  const { data } = await db.from("recipes").select("id, name, cuisine_tags, proteins").in("id", ids);
  return new Map((data ?? []).map((r: any) => [r.id, r]));
}

function report(label: string, ids: string[], familiar: Set<string>, meta: Map<string, any>) {
  const cuisineCount = new Map<string, number>();
  const proteinCount = new Map<string, number>();
  let fam = 0;
  console.log(`\n=== ${label} → ${ids.length} recipes ===`);
  for (const id of ids) {
    const m = meta.get(id);
    if (familiar.has(id)) fam++;
    for (const c of m?.cuisine_tags ?? []) cuisineCount.set(c, (cuisineCount.get(c) ?? 0) + 1);
    const pp = m?.proteins?.[0];
    if (pp) proteinCount.set(pp, (proteinCount.get(pp) ?? 0) + 1);
    console.log(`  • ${m?.name} [${(m?.cuisine_tags ?? []).join(",") || "—"}] {${(m?.proteins ?? []).join(",") || "—"}}${familiar.has(id) ? "  (familiar)" : ""}`);
  }
  const maxCuisine = Math.max(0, ...cuisineCount.values());
  const maxProtein = Math.max(0, ...proteinCount.values());
  console.log(`  familiar=${fam}/${ids.length}  unique=${new Set(ids).size === ids.length}  maxPerCuisine=${maxCuisine}  maxPerProtein=${maxProtein}`);
}

async function main() {
  // 1. Rich-profile user (optimizer).
  const sig = await gatherSignals(RICH_USER);
  const fp = await computeFlavorProfile(RICH_USER);
  const pool = await candidatePool([]);
  console.log(`pool=${pool.length} familiar=${sig.familiar.size} flavorProfile=${fp ? "computed" : "null"} topCuisines=${fp?.cuisineBreakdown.slice(0, 3).map((c) => `${c.cuisine}:${c.pct}`).join(",")}`);

  const rich = selectPlanRecipes(pool, {
    flavorProfile: fp, cookStyle: "optimizer", exploredProteins: sig.exploredProteins,
    familiarRecipeIds: sig.familiar, excludeRecipeIds: new Set(), repertoire: sig.repertoire,
  }, 5).map((s) => s.id);
  const meta = await nameOf(pool.map((r) => r.id));
  report("RICH (optimizer, N=5)", rich, sig.familiar, meta);

  // 2. Repeat "Sugerir mais" (+3) excluding the first batch → must be a fresh set.
  const more = selectPlanRecipes(pool, {
    flavorProfile: fp, cookStyle: "optimizer", exploredProteins: sig.exploredProteins,
    familiarRecipeIds: sig.familiar, excludeRecipeIds: new Set(rich), repertoire: sig.repertoire,
  }, 3).map((s) => s.id);
  report("SUGERIR MAIS (+3, excluding batch 1)", more, sig.familiar, meta);
  const overlap = more.filter((id) => rich.includes(id));
  console.log(`  freshness: overlap with batch 1 = ${overlap.length} (expect 0)`);

  // 3. Cold-start: no familiar, null flavor profile, explorer.
  const cold = selectPlanRecipes(pool, {
    flavorProfile: null, cookStyle: "explorer", exploredProteins: [],
    familiarRecipeIds: new Set(), excludeRecipeIds: new Set(), repertoire: new Map(),
  }, 6).map((s) => s.id);
  report("COLD-START (explorer, N=6, ≤2/cuisine)", cold, new Set(), meta);

  // 4. Strict dietary: vegan protein exclusion applied to the candidate fetch.
  const veganExcl = ["beef","pork","lamb","veal","chicken","turkey","duck","tuna","salmon","fish","seafood","whey","eggs"];
  const veganPool = await candidatePool(veganExcl);
  const veganMeta = await nameOf(veganPool.map((r) => r.id));
  const vegan = selectPlanRecipes(veganPool, {
    flavorProfile: null, cookStyle: "dietary", exploredProteins: [],
    familiarRecipeIds: new Set(), excludeRecipeIds: new Set(), repertoire: new Map(),
  }, 5).map((s) => s.id);
  report("VEGAN (dietary, N=5)", vegan, new Set(), veganMeta);
  const leaked = vegan.flatMap((id) => veganMeta.get(id)?.proteins ?? []).filter((p: string) => veganExcl.includes(p));
  console.log(`  dietary safety: excluded proteins leaked = ${leaked.length} (expect 0)  poolSize=${veganPool.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
