/**
 * Recipe-level signal derivation (Tier-1 deterministic + Tier-2 Haiku cuisine).
 *
 * Populates recipes.cuisine_tags / flavor_notes / dietary_flags / cooking_method from
 * their linked, re-audited ingredients (+ name/steps for cuisine). Allergen *filtering*
 * already works via the ingredient join; these recipe-level fields power the
 * flavor-identity profile (cuisine badges, signature, Explorer axis) and recipe display.
 *
 * - flavor_notes / dietary_flags / cooking_method: DETERMINISTIC (free) from ingredients+steps.
 * - cuisine_tags: HAIKU from name + ingredient names + steps (ingredient-vote is an unreliable
 *   prior — "Caldo Verde"→american failure). Validated 9/9: language≠cuisine, EMPTY for generic.
 *
 * Gated: default = READ-ONLY sample. WRITE=1 = write sample. WRITE=1 FULL=1 = write all system recipes.
 * Run: npx tsx scripts/derive-recipe-signals.ts
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"] ?? "";
const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 10;
const WRITE = process.env["WRITE"] === "1";
const FULL = process.env["FULL"] === "1";

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error("Missing env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CANONICAL_CUISINES = [
  "portuguese","italian","japanese","mexican","indian","thai","chinese","french","greek",
  "moroccan","korean","spanish","middle-eastern","american","brazilian","vietnamese","turkish","german",
];
const CANONICAL_FLAVORS = ["sweet","sour","salty","bitter","umami","smoky","earthy","fresh","rich","nutty","aromatic"];
// recipe.proteins slugs that imply meat/poultry (block vegetarian) and aquatic (block vegan/veg)
const MEAT = new Set(["beef","pork","lamb","veal","chicken","turkey","duck","game"]);
const AQUATIC = new Set(["fish","salmon","tuna","cod","seafood","shrimp","shellfish"]);

type Ing = { name: string | null; flavor_notes: string[]; contains_allergens: string[] };
type Recipe = {
  id: string; name: string; proteins: string[]; cuisine_tags: string[];
  recipe_ingredients: { name: string | null; ingredients: Ing | null }[];
  recipe_steps: { text: string; position: number }[];
};

// ── Tier-1 deterministic derivation ────────────────────────────────────────
function deriveFlavors(ings: Ing[]): string[] {
  const counts = new Map<string, number>();
  for (const i of ings) for (const f of i.flavor_notes ?? [])
    if (CANONICAL_FLAVORS.includes(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
}

function deriveDietary(ings: Ing[], proteins: string[]): string[] {
  const contains = new Set<string>();
  for (const i of ings) for (const a of i.contains_allergens ?? []) contains.add(a);
  const flags: string[] = [];
  if (!contains.has("gluten")) flags.push("gluten-free");
  if (!contains.has("dairy")) flags.push("dairy-free");
  if (!contains.has("soy")) flags.push("soy-free");
  if (!contains.has("peanut") && !contains.has("tree_nut")) flags.push("nut-free");
  const hasMeat = proteins.some((p) => MEAT.has(p));
  const hasAquatic = proteins.some((p) => AQUATIC.has(p)) || contains.has("fish") || contains.has("shellfish");
  const vegetarian = !hasMeat && !hasAquatic;
  const vegan = vegetarian && !contains.has("dairy") && !contains.has("egg");
  if (vegan) flags.push("vegan");
  if (vegetarian) flags.push("vegetarian");
  return flags;
}

function deriveCookingMethod(steps: string[]): string | null {
  const s = steps.join(" ").toLowerCase();
  if (/air ?fryer/.test(s)) return "air-fry";
  if (/grelh|grill/.test(s)) return "grill";
  if (/forno|assad|bake|roast/.test(s)) return "bake";
  if (/vapor|steam/.test(s)) return "steam";
  if (/frita|fry|frito/.test(s)) return "fry";
  if (/lento|slow|panela de press/.test(s)) return "slow-cook";
  if (/frigideira|saltea|refoga|fog/.test(s)) return "fry";
  return null;
}

// ── Tier-2 Haiku cuisine (name + ingredients + steps) ───────────────────────
function stripFences(raw: string): string {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return s.trim();
}
async function classifyCuisine(r: Recipe): Promise<string[]> {
  const ings = r.recipe_ingredients.map((ri) => ri.name ?? ri.ingredients?.name).filter(Boolean);
  const steps = [...r.recipe_steps].sort((a, b) => a.position - b.position).map((s) => s.text);
  const prompt = `Classify this recipe's cuisine.

Allowed slugs (ONLY these): ${CANONICAL_CUISINES.join(", ")}

RULES:
- The recipe is written in Portuguese because that is the app's interface language. This is NOT evidence of Portuguese cuisine. Judge ONLY by culinary tradition (signature ingredients + technique in the steps).
- Tag a cuisine ONLY when a signature ingredient or technique in THIS recipe justifies it. Up to 2, prefer fewer, no padding.
- If the dish is generic / international (plain grilled protein + veg, smoothie, basic salad/eggs), return an EMPTY array. When unsure, empty.

Recipe name: ${r.name}
Ingredients:
${ings.map((i) => `- ${i}`).join("\n")}
Steps:
${steps.map((s, n) => `${n + 1}. ${s}`).join("\n") || "(none)"}

Respond with ONLY JSON: {"cuisine_tags":["slug", ...]}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 80,
      system: [{ type: "text", text: "You are a precise culinary cuisine classifier.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const j = (await res.json()) as { content: Array<{ text: string }> };
  const tags = JSON.parse(stripFences(j.content?.[0]?.text ?? "{}")).cuisine_tags as string[];
  return (tags ?? []).filter((t) => CANONICAL_CUISINES.includes(t)).slice(0, 2);
}

const SELECT = "id, name, proteins, cuisine_tags, recipe_ingredients(name, ingredients(name, flavor_notes, contains_allergens)), recipe_steps(text, position)";

async function fetchRecipes(): Promise<Recipe[]> {
  if (!FULL) {
    // Sample: a few iconic + generic recipes by name for read-only validation.
    const { data } = await supabase.from("recipes").select(SELECT)
      .eq("visibility", "system").is("deleted_at", null)
      .or("name.ilike.%caldo verde%,name.ilike.%shakshuka%,name.ilike.%chana%,name.ilike.%frango grelhado%,name.ilike.%bibimbap%,name.ilike.%panqueca%")
      .limit(10);
    return (data ?? []) as unknown as Recipe[];
  }
  const PAGE = 500; const out: Recipe[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase.from("recipes").select(SELECT)
      .eq("visibility", "system").is("deleted_at", null).order("name").range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as unknown as Recipe[]));
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  if (FULL && !WRITE) { console.error("REFUSING: FULL requires WRITE=1."); process.exit(1); }
  const mode = FULL ? "FULL WRITE" : WRITE ? "SAMPLE WRITE" : "SAMPLE READ-ONLY";
  console.log(`Recipe derivation — ${mode}\n`);
  const recipes = await fetchRecipes();
  console.log(`Loaded ${recipes.length} recipes.\n`);
  let updated = 0, failed = 0;

  for (let i = 0; i < recipes.length; i += BATCH_SIZE) {
    const batch = recipes.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (r) => {
      const ings = r.recipe_ingredients.map((ri) => ri.ingredients).filter(Boolean) as Ing[];
      const flavor_notes = deriveFlavors(ings);
      const dietary_flags = deriveDietary(ings, r.proteins ?? []);
      const cooking_method = deriveCookingMethod(r.recipe_steps.map((s) => s.text));
      let cuisine_tags: string[];
      try { cuisine_tags = await classifyCuisine(r); }
      catch (e) { console.warn(`cuisine fail ${r.name}: ${(e as Error).message}`); failed++; cuisine_tags = r.cuisine_tags ?? []; }

      if (WRITE) {
        const { error } = await supabase.from("recipes")
          .update({ cuisine_tags, flavor_notes, dietary_flags, cooking_method }).eq("id", r.id);
        if (error) { console.warn(`update fail ${r.name}: ${error.message}`); failed++; }
        else updated++;
      }
      if (!FULL) {
        console.log("─".repeat(70));
        console.log(`${r.name}`);
        console.log(`  cuisine_tags (was ${JSON.stringify(r.cuisine_tags)}) -> ${JSON.stringify(cuisine_tags)}`);
        console.log(`  flavor_notes  -> ${JSON.stringify(flavor_notes)}`);
        console.log(`  dietary_flags -> ${JSON.stringify(dietary_flags)}`);
        console.log(`  cooking_method-> ${cooking_method}`);
      }
    }));
    if (i + BATCH_SIZE < recipes.length) await new Promise((res) => setTimeout(res, 500));
    if (FULL) console.log(`  …${Math.min(i + BATCH_SIZE, recipes.length)}/${recipes.length}`);
  }
  console.log(`\n${mode} complete. ${WRITE ? `updated=${updated}, failed=${failed}` : "no writes"}.`);
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
