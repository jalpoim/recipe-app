import { createServerFn } from "@tanstack/react-start";
import { makeClient } from "./client-server";
import type {
  RecipeIngredientInsert,
  RecipeStepInsert,
  UserProtein,
} from "../../types/db";

export type IngredientRow = {
  position: number;
  rawText: string;
  quantity: number | null;
  unit: string | null;
  name: string | null;
  isOptional: boolean;
  ingredientId?: string | null;
  category?: string | null;
  dietaryFlags?: string[] | null;
  caloriesPer100g?: number | null;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
};

export type StepRow = {
  position: number;
  text: string;
  timerSeconds: number | null;
};

export type CreateRecipeInput = {
  name: string;
  servings: number;
  timeMin: number | null;
  proteins: string[];
  tags: string[];
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  visibility: "private" | "public";
  ingredients: IngredientRow[];
  steps: StepRow[];
  lang: string;
  imageUrl?: string | null;
  sourceUrl?: string | null;
};

export type UpdateRecipeInput = CreateRecipeInput & { recipeId: string };

export const createRecipe = createServerFn({ method: "POST" })
  .inputValidator((input: CreateRecipeInput) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const hasMacros = data.calories != null || data.protein != null;
    const modStatus =
      data.visibility === "public" ? "pending_review" : "approved";

    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({
        name: data.name,
        name_language: data.lang,
        servings: data.servings,
        time_min: data.timeMin,
        proteins: data.proteins,
        tags: data.tags,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        macros_total: hasMacros,
        macros_source: hasMacros ? "manual" : null,
        visibility: data.visibility,
        moderation_status: modStatus,
        owner_id: session.user.id,
        image_url: data.imageUrl ?? null,
        source_url: data.sourceUrl ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const recipeId = recipe.id;

    // Insert ingredients
    if (data.ingredients.length > 0) {
      const ingRows: RecipeIngredientInsert[] = data.ingredients.map((ing) => ({
        recipe_id: recipeId,
        position: ing.position,
        raw_text: ing.rawText,
        quantity: ing.quantity,
        unit: ing.unit,
        name: ing.name,
        is_optional: ing.isOptional,
        ingredient_id: ing.ingredientId ?? null,
        category: ing.category ?? null,
      }));
      const { error: ingErr } = await supabase
        .from("recipe_ingredients")
        .insert(ingRows);
      if (ingErr) throw new Error(ingErr.message);
    }

    // Insert steps
    if (data.steps.length > 0) {
      const stepRows: RecipeStepInsert[] = data.steps.map((s) => ({
        recipe_id: recipeId,
        position: s.position,
        text: s.text,
        timer_seconds: s.timerSeconds,
      }));
      const { error: stepErr } = await supabase
        .from("recipe_steps")
        .insert(stepRows);
      if (stepErr) throw new Error(stepErr.message);
    }

    return { id: recipeId };
  });

export const updateRecipe = createServerFn({ method: "POST" })
  .inputValidator((input: UpdateRecipeInput) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const hasMacros = data.calories != null || data.protein != null;
    const modStatus =
      data.visibility === "public" ? "pending_review" : "approved";

    const { error } = await supabase
      .from("recipes")
      .update({
        name: data.name,
        name_language: data.lang,
        servings: data.servings,
        time_min: data.timeMin,
        proteins: data.proteins,
        tags: data.tags,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        macros_total: hasMacros,
        macros_source: hasMacros ? "manual" : null,
        visibility: data.visibility,
        moderation_status: modStatus,
        image_url: data.imageUrl ?? null,
        source_url: data.sourceUrl ?? null,
      })
      .eq("id", data.recipeId)
      .eq("owner_id", session.user.id);
    if (error) throw new Error(error.message);

    // Replace ingredients + steps
    await supabase
      .from("recipe_ingredients")
      .delete()
      .eq("recipe_id", data.recipeId);
    await supabase.from("recipe_steps").delete().eq("recipe_id", data.recipeId);

    if (data.ingredients.length > 0) {
      await supabase.from("recipe_ingredients").insert(
        data.ingredients.map((ing) => ({
          recipe_id: data.recipeId,
          position: ing.position,
          raw_text: ing.rawText,
          quantity: ing.quantity,
          unit: ing.unit,
          name: ing.name,
          is_optional: ing.isOptional,
          ingredient_id: ing.ingredientId ?? null,
          category: ing.category ?? null,
        })),
      );
    }

    if (data.steps.length > 0) {
      await supabase.from("recipe_steps").insert(
        data.steps.map((s) => ({
          recipe_id: data.recipeId,
          position: s.position,
          text: s.text,
          timer_seconds: s.timerSeconds,
        })),
      );
    }

    return { id: data.recipeId };
  });

export const deleteRecipe = createServerFn({ method: "POST" })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }) => {
    const supabase = makeClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error } = await supabase
      .from("recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", recipeId)
      .eq("owner_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchIngredients = createServerFn({ method: "GET" })
  .inputValidator((input: { q: string; lang: string }) => input)
  .handler(async ({ data: { q, lang } }) => {
    const supabase = makeClient();

    // Fuzzy search via pg_trgm — scoped to user's language + English canonical
    const { data: fuzzy } = await supabase.rpc("search_ingredients_fuzzy", {
      search_term: q,
      result_limit: 10,
      lang,
    });

    const ids = (fuzzy ?? []).map((r) => r.id);
    if (ids.length === 0) return [];

    // Fetch ingredient metadata + display name in user's language
    const [metaResult, translationsResult] = await Promise.all([
      supabase
        .from("ingredients")
        .select(
          "id, default_unit, category, dietary_flags, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g",
        )
        .in("id", ids),
      supabase
        .from("ingredient_translations")
        .select("ingredient_id, name")
        .in("ingredient_id", ids)
        .eq("language", lang),
    ]);

    const metaById = new Map((metaResult.data ?? []).map((r) => [r.id, r]));
    const displayNameById = new Map(
      (translationsResult.data ?? []).map((r) => [r.ingredient_id, r.name]),
    );

    return (fuzzy ?? []).map((r) => {
      const meta = metaById.get(r.id);
      return {
        id: r.id,
        name: displayNameById.get(r.id) ?? r.name,
        similarity: r.similarity as number,
        default_unit: meta?.default_unit ?? null,
        category: meta?.category ?? null,
        dietary_flags: meta?.dietary_flags ?? null,
        calories_per_100g: meta?.calories_per_100g ?? null,
        protein_per_100g: meta?.protein_per_100g ?? null,
        carbs_per_100g: meta?.carbs_per_100g ?? null,
        fat_per_100g: meta?.fat_per_100g ?? null,
      };
    });
  });

export type EstimateMacrosInput = {
  name: string;
  ingredients: string[];
  servings: number;
};

export type EstimateMacrosResult = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export const estimateMacros = createServerFn({ method: "POST" })
  .inputValidator((input: EstimateMacrosInput) => input)
  .handler(async ({ data }): Promise<EstimateMacrosResult> => {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const prompt = `You are a nutrition expert. Estimate the macros per serving for this recipe.

Recipe: ${data.name}
Servings: ${data.servings}
Ingredients:
${data.ingredients.map((i, n) => `${n + 1}. ${i}`).join("\n")}

Respond with ONLY a JSON object (no markdown, no explanation):
{"calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>}

Values should be per serving, rounded to the nearest integer. Use 0 if truly zero.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 128,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok)
      throw new Error(`Anthropic API error: ${response.status}`);
    const json = (await response.json()) as {
      content: Array<{ text: string }>;
    };
    const text = json.content?.[0]?.text?.trim() ?? "{}";

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        calories:
          typeof parsed.calories === "number"
            ? Math.round(parsed.calories)
            : null,
        protein:
          typeof parsed.protein === "number"
            ? Math.round(parsed.protein)
            : null,
        carbs:
          typeof parsed.carbs === "number" ? Math.round(parsed.carbs) : null,
        fat: typeof parsed.fat === "number" ? Math.round(parsed.fat) : null,
      };
    } catch {
      throw new Error("Failed to parse macro estimate response");
    }
  });

export type { UserProtein };

export const fetchUserProteins = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserProtein[]> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase
      .from("user_proteins")
      .select("id, slug, display_name, language")
      .eq("user_id", session.user.id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as UserProtein[];
  },
);

export const createUserProtein = createServerFn({ method: "POST" })
  .inputValidator((input: { displayName: string; language: string }) => input)
  .handler(async ({ data }): Promise<UserProtein> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const slug = data.displayName.trim().toLowerCase().replace(/\s+/g, "-");
    const { data: row, error } = await supabase
      .from("user_proteins")
      .upsert(
        {
          user_id: session.user.id,
          slug,
          display_name: data.displayName.trim(),
          language: data.language,
        },
        { onConflict: "user_id,slug", ignoreDuplicates: false },
      )
      .select("id, slug, display_name, language")
      .single();
    if (error) throw new Error(error.message);
    return row as UserProtein;
  });

export const deleteUserProtein = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("user_proteins")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ParsedRecipeImport = {
  name: string | null;
  servings: number | null;
  timeMin: number | null;
  ingredients: string[];
  steps: string[];
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  imageUrl: string | null;
  sourceUrl: string;
};

function parseIsoDuration(iso: string): number | null {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  return h * 60 + m || null;
}

function parseServings(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val);
  const n = parseInt(s.replace(/\D.*$/, ""), 10);
  return isNaN(n) ? null : n;
}

function parseNumericNutrition(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function mapSchemaToRecipe(
  schema: Record<string, unknown>,
  url: string,
): ParsedRecipeImport {
  const name = typeof schema.name === "string" ? schema.name.trim() : null;

  const servings = parseServings(schema.recipeYield ?? schema.yield);

  let timeMin: number | null = null;
  if (schema.totalTime) {
    timeMin = parseIsoDuration(String(schema.totalTime));
  }
  if (timeMin == null && (schema.cookTime || schema.prepTime)) {
    const cook = schema.cookTime
      ? (parseIsoDuration(String(schema.cookTime)) ?? 0)
      : 0;
    const prep = schema.prepTime
      ? (parseIsoDuration(String(schema.prepTime)) ?? 0)
      : 0;
    timeMin = cook + prep || null;
  }

  const ingredients: string[] = Array.isArray(schema.recipeIngredient)
    ? (schema.recipeIngredient as unknown[])
        .map((i) => String(i).trim())
        .filter(Boolean)
    : [];

  const steps: string[] = [];
  if (Array.isArray(schema.recipeInstructions)) {
    for (const step of schema.recipeInstructions as unknown[]) {
      if (typeof step === "string") {
        steps.push(step.trim());
      } else if (step && typeof step === "object") {
        const s = step as Record<string, unknown>;
        const text = s.text ?? s.name;
        if (typeof text === "string" && text.trim()) steps.push(text.trim());
      }
    }
  }

  let imageUrl: string | null = null;
  if (typeof schema.image === "string") {
    imageUrl = schema.image;
  } else if (Array.isArray(schema.image) && schema.image.length > 0) {
    const img = schema.image[0];
    imageUrl =
      typeof img === "string"
        ? img
        : (((img as Record<string, unknown>)?.url as string) ?? null);
  } else if (schema.image && typeof schema.image === "object") {
    imageUrl =
      ((schema.image as Record<string, unknown>).url as string) ?? null;
  }

  const nutrition = schema.nutrition as Record<string, unknown> | undefined;
  const calories = parseNumericNutrition(
    nutrition?.calories ?? nutrition?.["schema:calories"],
  );
  const protein = parseNumericNutrition(
    nutrition?.proteinContent ?? nutrition?.["schema:proteinContent"],
  );
  const carbs = parseNumericNutrition(
    nutrition?.carbohydrateContent ?? nutrition?.["schema:carbohydrateContent"],
  );
  const fat = parseNumericNutrition(
    nutrition?.fatContent ?? nutrition?.["schema:fatContent"],
  );

  return {
    name,
    servings,
    timeMin,
    ingredients,
    steps,
    calories,
    protein,
    carbs,
    fat,
    imageUrl,
    sourceUrl: url,
  };
}

export const parseRecipeUrl = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => input)
  .handler(async ({ data }): Promise<ParsedRecipeImport | null> => {
    let html: string;
    try {
      const res = await fetch(data.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RecipeImporter/1.0)",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      throw new Error(`fetch_failed: ${(err as Error).message}`);
    }

    const jsonLdPattern =
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1]) as unknown;
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== "object") continue;
          const schema = candidate as Record<string, unknown>;
          const type = schema["@type"];
          const isRecipe =
            type === "Recipe" ||
            (Array.isArray(type) && (type as string[]).includes("Recipe"));
          if (isRecipe) return mapSchemaToRecipe(schema, data.url);
          // Handle @graph wrapper
          if (Array.isArray(schema["@graph"])) {
            for (const node of schema["@graph"] as unknown[]) {
              if (node && typeof node === "object") {
                const n = node as Record<string, unknown>;
                const nt = n["@type"];
                if (
                  nt === "Recipe" ||
                  (Array.isArray(nt) && (nt as string[]).includes("Recipe"))
                ) {
                  return mapSchemaToRecipe(n, data.url);
                }
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  });
