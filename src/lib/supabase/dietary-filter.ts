import type { DietaryMode } from "../../types/db";
import type { makeClient } from "./client-server";

// ─── Shared dietary / allergen exclusion logic ───────────────────────────────
// Single source of truth for turning a user's dietary mode + intolerances +
// ingredient exclusions into the recipe-level filters the library and the plan
// generator both apply. Previously this lived split across queries.ts (the
// FLAG_* maps + the inline allergen lookup) and library/index.tsx (DIETARY_FLAGS);
// fetchLibrary and suggestPlan now share it so the two can never drift.

// Dietary mode → the exclusion flags it implies (was DIETARY_FLAGS in library/index.tsx).
export const DIETARY_FLAGS: Record<DietaryMode, string[]> = {
  none: [],
  vegetarian: ["meat", "poultry", "fish", "shellfish"],
  vegan: ["meat", "poultry", "fish", "shellfish", "dairy", "egg", "honey"],
  pescatarian: ["meat", "poultry"],
};

// Maps dietary exclusion flags → protein slugs on recipes.proteins. This is the
// primary exclusion mechanism because recipe_ingredients.ingredient_id is only
// populated for user-uploaded recipes, not system recipes.
export const FLAG_TO_PROTEIN_SLUGS: Record<string, string[]> = {
  meat: ["beef", "pork", "lamb", "veal"],
  poultry: ["chicken", "turkey", "duck"],
  fish: ["tuna", "salmon", "fish"],
  shellfish: ["seafood"],
  dairy: ["whey"],
  egg: ["eggs"],
  honey: [],
};

// UI stores 'nuts'; contains_allergens uses 'tree_nut' and 'peanut'.
export const FLAG_ALIASES: Record<string, string[]> = {
  nuts: ["tree_nut", "peanut"],
};

// Combine a profile's dietary mode + intolerances into the deduped exclusion-flag
// set the filters consume.
export function dietaryFlagsForProfile(
  mode: DietaryMode | string | null,
  intolerances: string[],
): string[] {
  const modeFlags = DIETARY_FLAGS[(mode ?? "none") as DietaryMode] ?? [];
  return [...new Set([...modeFlags, ...intolerances])];
}

export type RecipeExclusions = {
  excludedProteinSlugs: string[];
  excludedRecipeIds: string[];
};

// Resolve the protein slugs and recipe ids to exclude for a set of dietary flags
// + explicit ingredient exclusions. Two bounded queries (ingredients overlap →
// recipe_ingredients lookup); no per-recipe round-trips. Behaviour-identical to
// the block formerly inlined in fetchLibrary.
export async function computeRecipeExclusions(
  supabase: ReturnType<typeof makeClient>,
  excludedFlags: string[],
  excludedIngredientIds: string[],
): Promise<RecipeExclusions> {
  // Expand flag aliases (e.g. 'nuts' → ['tree_nut', 'peanut']).
  const expandedFlags = [
    ...new Set(
      excludedFlags.flatMap((f) => (FLAG_ALIASES[f] ? FLAG_ALIASES[f] : [f])),
    ),
  ];

  // Primary exclusion: proteins array (covers all system recipes).
  const excludedProteinSlugs = [
    ...new Set(expandedFlags.flatMap((f) => FLAG_TO_PROTEIN_SLUGS[f] ?? [])),
  ];

  // Ingredient-level exclusion via contains_allergens (positive containment tokens).
  let excludedRecipeIds: string[] = [];
  if (expandedFlags.length > 0 || excludedIngredientIds.length > 0) {
    let flaggedIngIds: string[] = [];
    if (expandedFlags.length > 0) {
      const { data: flaggedIngs } = await supabase
        .from("ingredients")
        .select("id")
        .overlaps("contains_allergens", expandedFlags);
      flaggedIngIds = (flaggedIngs ?? []).map((i) => i.id);
    }
    const allExcludedIngIds = [
      ...new Set([...flaggedIngIds, ...excludedIngredientIds]),
    ];
    if (allExcludedIngIds.length > 0) {
      const { data: excludedRis } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id")
        .in("ingredient_id", allExcludedIngIds);
      excludedRecipeIds = [
        ...new Set((excludedRis ?? []).map((r) => r.recipe_id)),
      ];
    }
  }

  return { excludedProteinSlugs, excludedRecipeIds };
}
