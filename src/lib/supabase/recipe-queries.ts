import { createServerFn } from "@tanstack/react-start";
import { makeClient } from "./client-server";
import type {
  RecipeIngredientInsert,
  RecipeStepInsert,
  UserProtein,
} from "../../types/db";
import {
  extractRecipeFromHtml,
  type ParsedRecipeImport,
} from "../parse-recipe-url";

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

    // Award creator points: +3 for original creation, +0.5 for import
    const creatorPoints = data.sourceUrl ? 0.5 : 3;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any).rpc("increment_creator_points", { p_user_id: session.user.id, p_points: creatorPoints });

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

    const supabase = makeClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const today = new Date().toISOString().split("T")[0]!;
    const { data: usage } = await supabase
      .from("daily_ai_usage")
      .select("macro_calls")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();
    const currentCalls = usage?.macro_calls ?? 0;
    if (currentCalls >= 10) throw new Error("RATE_LIMIT_EXCEEDED");

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
      const result = {
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
      await supabase.from("daily_ai_usage").upsert({
        user_id: user.id,
        date: today,
        macro_calls: currentCalls + 1,
      });
      return result;
    } catch (e) {
      if (e instanceof Error && e.message === "RATE_LIMIT_EXCEEDED") throw e;
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

export type { ParsedRecipeImport };

export const parseRecipeUrl = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => input)
  .handler(async ({ data }): Promise<ParsedRecipeImport | null> => {
    let html: string;
    try {
      const res = await fetch(data.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,pt;q=0.8",
          "Cache-Control": "max-age=0",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      throw new Error(`fetch_failed: ${(err as Error).message}`);
    }
    return extractRecipeFromHtml(html, data.url);
  });
