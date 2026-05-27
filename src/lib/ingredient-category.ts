import { useEffect, useRef } from "react";
import { searchIngredients } from "./supabase/recipe-queries";

export const INGREDIENT_CATEGORIES = [
  "Talho/Peixaria",
  "Frutas/Legumes",
  "Lacticínios",
  "Mercearia",
  "Outros",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const CATEGORY_SLUG_MAP: Record<string, IngredientCategory> = {
  meat: "Talho/Peixaria",
  produce: "Frutas/Legumes",
  dairy: "Lacticínios",
  grains: "Mercearia",
  other: "Outros",
};

/**
 * Returns the display label for an ingredient DB category slug.
 * Falls back to "Outros" for unknown slugs.
 */
export function categoryFromSlug(
  slug: string | null | undefined,
): IngredientCategory {
  return (slug && CATEGORY_SLUG_MAP[slug]) || "Outros";
}

/**
 * Resolves the best shopping category for a typed ingredient name.
 * Queries the ingredient DB with a debounce; invokes onChange whenever a
 * confident match is found. Only fires while `locked` is false (i.e. the
 * user has not manually overridden the category).
 *
 * @param label    - the current text input value
 * @param lang     - user's language ("pt" | "en")
 * @param locked   - when true, the hook does nothing (manual pick wins)
 * @param onChange - called with the resolved category
 * @param delay    - debounce in ms (default 350)
 */
export function useIngredientCategory(
  label: string,
  lang: string,
  locked: boolean,
  onChange: (cat: IngredientCategory) => void,
  delay = 350,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (locked || label.trim().length < 2) return;

    const id = setTimeout(async () => {
      try {
        const results = await searchIngredients({
          data: { q: label.trim(), lang },
        });
        if (!results.length) return;
        const top = results[0];
        if ((top.similarity as number) >= 0.25 && top.category) {
          const mapped = CATEGORY_SLUG_MAP[top.category];
          if (mapped) onChangeRef.current(mapped);
        }
      } catch {
        // silently ignore — caller's keyword fallback still applies
      }
    }, delay);

    return () => clearTimeout(id);
  }, [label, lang, locked, delay]);
}

/**
 * Resolves shopping categories for a batch of ingredient names in parallel.
 * Used after URL import to categorise all imported ingredients at once.
 * Returns null for names that don't match anything with sufficient confidence.
 */
export async function resolveIngredientCategoriesBatch(
  names: string[],
  lang: string,
): Promise<(IngredientCategory | null)[]> {
  return Promise.all(
    names.map(async (name) => {
      if (!name || name.trim().length < 2) return null;
      try {
        const results = await searchIngredients({
          data: { q: name.trim(), lang },
        });
        if (!results.length) return null;
        const top = results[0];
        if ((top.similarity as number) >= 0.25 && top.category) {
          return CATEGORY_SLUG_MAP[top.category] ?? null;
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
}
