// Deterministic recipe-level signal derivation from a recipe's linked ingredient
// signals + steps. Pure (no DB/app deps) so it can run anywhere. Mirrors the logic in
// scripts/derive-recipe-signals.ts (the batch backfill); keep the two in sync.
//
// Scope: flavor_notes, dietary_flags (best-effort, from linked ingredients), cooking_method.
// cuisine_tags is intentionally NOT derived here — it needs name+steps + AI (see the
// derive-recipe-signals backfill); we don't put an AI call on the recipe-save critical path.

export const CANONICAL_FLAVORS = [
  "sweet", "sour", "salty", "bitter", "umami", "smoky", "earthy", "fresh", "rich", "nutty", "aromatic",
] as const;

// recipe.proteins slugs that block vegetarian (meat/poultry) / vegan+vegetarian (aquatic).
const MEAT = new Set(["beef", "pork", "lamb", "veal", "chicken", "turkey", "duck", "game"]);
const AQUATIC = new Set(["fish", "salmon", "tuna", "cod", "seafood", "shrimp", "shellfish"]);

export type IngredientSignal = {
  flavor_notes: string[] | null;
  contains_allergens: string[] | null;
};

export function deriveRecipeFlavorNotes(ings: IngredientSignal[]): string[] {
  const counts = new Map<string, number>();
  for (const i of ings)
    for (const f of i.flavor_notes ?? [])
      if ((CANONICAL_FLAVORS as readonly string[]).includes(f))
        counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
}

export function deriveRecipeDietaryFlags(
  ings: IngredientSignal[],
  proteins: string[],
): string[] {
  const contains = new Set<string>();
  for (const i of ings) for (const a of i.contains_allergens ?? []) contains.add(a);
  const flags: string[] = [];
  if (!contains.has("gluten")) flags.push("gluten-free");
  if (!contains.has("dairy")) flags.push("dairy-free");
  if (!contains.has("soy")) flags.push("soy-free");
  if (!contains.has("peanut") && !contains.has("tree_nut")) flags.push("nut-free");
  const hasMeat = proteins.some((p) => MEAT.has(p));
  const hasAquatic =
    proteins.some((p) => AQUATIC.has(p)) || contains.has("fish") || contains.has("shellfish");
  const vegetarian = !hasMeat && !hasAquatic;
  const vegan = vegetarian && !contains.has("dairy") && !contains.has("egg");
  if (vegan) flags.push("vegan");
  if (vegetarian) flags.push("vegetarian");
  return flags;
}

export function deriveCookingMethod(stepTexts: string[]): string | null {
  const s = stepTexts.join(" ").toLowerCase();
  if (/air ?fryer/.test(s)) return "air-fry";
  if (/grelh|grill/.test(s)) return "grill";
  if (/forno|assad|bake|roast/.test(s)) return "bake";
  if (/vapor|steam/.test(s)) return "steam";
  if (/lento|slow|panela de press/.test(s)) return "slow-cook";
  if (/frita|fry|frito|frigideira|saltea|refoga/.test(s)) return "fry";
  return null;
}
