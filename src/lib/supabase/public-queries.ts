import { createServerFn } from "@tanstack/react-start";
import type { Recipe, RecipeIngredient, RecipeStep } from "../../types/db";
import { getLang, makeClient } from "./client-server";

// Read-only recipe shape served on the PUBLIC (unauthenticated) recipe page.
// Only the fields needed for rendering + SEO structured data are exposed.
export type PublicRecipe = Pick<
  Recipe,
  | "id"
  | "name"
  | "name_language"
  | "time_min"
  | "servings"
  | "macros_total"
  | "calories"
  | "protein"
  | "carbs"
  | "fat"
  | "proteins"
  | "tags"
  | "image_url"
  | "image_thumb_url"
  | "source_url"
  | "like_count"
  | "cook_count"
  | "created_at"
> & {
  recipe_ingredients: Pick<
    RecipeIngredient,
    "id" | "name" | "raw_text" | "unit" | "quantity" | "position" | "is_optional" | "section_label"
  >[];
  recipe_steps: Pick<RecipeStep, "id" | "text" | "position">[];
  author_display_name: string | null;
  author_username: string | null;
};

const PUBLIC_RECIPE_FIELDS =
  "id, name, name_language, time_min, servings, macros_total, calories, protein, carbs, fat, proteins, tags, image_url, image_thumb_url, source_url, like_count, cook_count, created_at";
const PUBLIC_INGREDIENT_FIELDS =
  "id, name, raw_text, unit, quantity, position, is_optional, section_label";
const PUBLIC_STEP_FIELDS = "id, text, position";

// Fetch a single recipe for the public page. Visibility is filtered explicitly
// (defense in depth on top of RLS): only `system` and `public`+approved recipes
// that are not soft-deleted are ever returned — never private/household/pending,
// even to an authenticated owner viewing the public URL. Returns null on miss so
// the route renders a 404 (never leaks the existence of a private recipe).
export const fetchPublicRecipe = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<PublicRecipe | null> => {
    const supabase = makeClient();
    const lang = getLang();

    // owner_id is selected only to resolve author attribution; it is stripped
    // before the row is returned to the client.
    const { data, error } = await supabase
      .from("recipes")
      .select(
        `${PUBLIC_RECIPE_FIELDS}, owner_id, recipe_ingredients(${PUBLIC_INGREDIENT_FIELDS}), recipe_steps(${PUBLIC_STEP_FIELDS})`,
      )
      .eq("id", id)
      .is("deleted_at", null)
      .or("visibility.eq.system,and(visibility.eq.public,moderation_status.eq.approved)")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const row = data as unknown as PublicRecipe & { owner_id: string | null };
    row.recipe_ingredients.sort((a, b) => a.position - b.position);
    row.recipe_steps.sort((a, b) => a.position - b.position);

    // Author attribution via the public-safe view (never the base profiles table).
    if (row.owner_id) {
      const { data: profile } = await supabase
        .from("public_profiles")
        .select("display_name, username")
        .eq("user_id", row.owner_id)
        .maybeSingle();
      row.author_display_name = profile?.display_name ?? null;
      row.author_username = profile?.username ?? null;
    } else {
      row.author_display_name = null;
      row.author_username = null;
    }

    if (lang === "pt") return stripOwner(row);

    // Translate name / ingredients / steps to the active language; fall back to PT.
    const ingIds = row.recipe_ingredients.map((i) => i.id);
    const stepIds = row.recipe_steps.map((s) => s.id);

    const [recipeTrans, ingTrans, stepTrans] = await Promise.all([
      supabase
        .from("recipe_translations")
        .select("name")
        .eq("recipe_id", id)
        .eq("language", lang)
        .maybeSingle(),
      supabase
        .from("recipe_ingredient_translations")
        .select("ingredient_id, name, unit, raw_text, section_label")
        .in("ingredient_id", ingIds)
        .eq("language", lang),
      supabase
        .from("recipe_step_translations")
        .select("step_id, text")
        .in("step_id", stepIds)
        .eq("language", lang),
    ]);

    const ingMap = new Map(ingTrans.data?.map((t) => [t.ingredient_id, t]) ?? []);
    const stepMap = new Map(stepTrans.data?.map((t) => [t.step_id, t.text]) ?? []);

    return stripOwner({
      ...row,
      name: recipeTrans.data?.name ?? row.name,
      recipe_ingredients: row.recipe_ingredients.map((ing) => {
        const t = ingMap.get(ing.id);
        return t
          ? {
              ...ing,
              name: t.name,
              unit: t.unit,
              raw_text: t.raw_text,
              section_label: t.section_label ?? ing.section_label,
            }
          : ing;
      }),
      recipe_steps: row.recipe_steps.map((s) => ({
        ...s,
        text: stepMap.get(s.id) ?? s.text,
      })),
    });
  });

// owner_id was only needed to resolve the author; do not ship it to the client.
function stripOwner(row: PublicRecipe & { owner_id?: string | null }): PublicRecipe {
  const { owner_id: _omit, ...rest } = row;
  return rest;
}
