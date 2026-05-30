import { createServerFn } from "@tanstack/react-start";
import type { Recipe, RecipeIngredient, RecipeStep } from "../../types/db";
import { getLang, makeClient } from "./client-server";

export type RecipeWithIngredients = Recipe & {
  recipe_ingredients: RecipeIngredient[];
};

export type RecipeDetail = Recipe & {
  recipe_ingredients: RecipeIngredient[];
  recipe_steps: RecipeStep[];
  author_display_name: string | null;
  author_username: string | null;
};

export type Sort =
  | "pcal"
  | "protein"
  | "calories"
  | "time"
  | "popular"
  | "cooked";
export type LibraryMode = "all" | "mine" | "saved" | "curated";

export type LibraryCursor = { value: number | null; id: string };

export type FetchLibraryInput = {
  limit: number;
  cursor: LibraryCursor | null;
  sort: Sort;
  modes: LibraryMode[];
  proteins: string[];
  maxCal: number | undefined;
  maxTime: number | undefined;
  tags: string[];
  ingredients: string[];
  q: string;
  lang?: string;
  excludedFlags?: string[];
  excludedIngredientIds?: string[];
};

export type FetchLibraryResult = {
  data: RecipeWithIngredients[];
  nextCursor: LibraryCursor | null;
};

const RECIPE_FIELDS =
  "id, name, name_language, time_min, servings, macros_total, calories, protein, carbs, fat, proteins, tags, pcal_ratio, owner_id, visibility, image_thumb_url, image_url, like_count, cook_count, save_count, is_featured, popularity_score, moderation_status, deleted_at, source_url";

const INGREDIENT_FIELDS =
  "id, recipe_id, ingredient_id, name, raw_text, unit, position, is_pantry, is_optional, section_label";

// Maps dietary exclusion flags → protein slugs on the recipes.proteins column.
// This is the primary exclusion mechanism because recipe_ingredients.ingredient_id
// is only populated for user-uploaded recipes, not system recipes.
const FLAG_TO_PROTEIN_SLUGS: Record<string, string[]> = {
  meat: ["beef", "pork", "lamb", "veal"],
  poultry: ["chicken", "turkey", "duck"],
  fish: ["tuna", "salmon", "fish"],
  shellfish: ["seafood"],
  dairy: ["whey"],
  egg: ["eggs"],
  honey: [],
};

// UI stores 'nuts'; contains_allergens uses 'tree_nut' and 'peanut'
const FLAG_ALIASES: Record<string, string[]> = {
  nuts: ["tree_nut", "peanut"],
};

const SORT_COL: Record<Sort, string> = {
  pcal: "pcal_ratio",
  protein: "protein",
  calories: "calories",
  time: "time_min",
  popular: "popularity_score",
  cooked: "cook_count",
};

// true = ascending, false = descending
const SORT_ASC: Record<Sort, boolean> = {
  pcal: false,
  protein: false,
  calories: true,
  time: true,
  popular: false,
  cooked: false,
};

export const fetchLibrary = createServerFn({ method: "GET" })
  .inputValidator((input: FetchLibraryInput) => input)
  .handler(async ({ data: input }): Promise<FetchLibraryResult> => {
    const supabase = makeClient();

    const {
      limit,
      cursor,
      sort,
      modes = [],
      proteins,
      maxCal,
      maxTime,
      tags,
      ingredients,
      q,
      excludedFlags = [],
      excludedIngredientIds = [],
    } = input;
    const lang = input.lang ?? getLang();
    const sortCol = SORT_COL[sort];
    const ascending = SORT_ASC[sort];

    // Filter out 'all' token — empty array means show everything
    const activeModes = modes.filter((m) => m !== "all");

    // Expand flag aliases (e.g. 'nuts' → ['tree_nut', 'peanut'])
    const expandedFlags = [
      ...new Set(
        excludedFlags.flatMap((f) => (FLAG_ALIASES[f] ? FLAG_ALIASES[f] : [f])),
      ),
    ];

    // --- Primary exclusion: proteins array (covers all system recipes) ---
    const excludedProteinSlugs = [
      ...new Set(expandedFlags.flatMap((f) => FLAG_TO_PROTEIN_SLUGS[f] ?? [])),
    ];

    // --- Ingredient-level exclusion via contains_allergens (positive containment tokens) ---
    // System-recipe ingredients are ~91% linked, so this is a primary path, not just a
    // supplement. expandedFlags are positive tokens (gluten/dairy/soy/egg/tree_nut/peanut),
    // matched against ingredients.contains_allergens (NOT the derived "-free" dietary_flags).
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

    // Get session for mode-specific filters
    let userId: string | null = null;
    let savedIds: string[] = [];
    if (activeModes.includes("mine") || activeModes.includes("saved")) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      userId = session.user.id;
      if (activeModes.includes("saved")) {
        const { data: savedRows } = await supabase
          .from("user_recipe_interactions")
          .select("recipe_id")
          .eq("user_id", userId)
          .eq("type", "save");
        savedIds = (savedRows ?? []).map((r) => r.recipe_id);
      }
    }

    // Build moderation visibility filter: system recipes, approved, and the authenticated
    // user's own recipes (any moderation status — they need to see their rejected ones).
    const moderationFilter = [
      "owner_id.is.null",
      "moderation_status.is.null",
      "moderation_status.eq.approved",
      ...(userId ? [`owner_id.eq.${userId}`] : []),
    ].join(",");

    let query = supabase
      .from("recipes")
      .select(`${RECIPE_FIELDS}, recipe_ingredients(${INGREDIENT_FIELDS})`)
      .is("deleted_at", null)
      .or(moderationFilter);

    // --- Mode filters (OR logic across selected modes) ---
    if (activeModes.length > 0) {
      const orParts: string[] = [];
      if (activeModes.includes("mine") && userId) {
        orParts.push(`owner_id.eq.${userId}`);
      }
      if (activeModes.includes("saved") && savedIds.length > 0) {
        orParts.push(`id.in.(${savedIds.join(",")})`);
      }
      if (activeModes.includes("curated")) {
        orParts.push("owner_id.is.null");
      }
      if (orParts.length === 0) return { data: [], nextCursor: null };
      query = query.or(orParts.join(","));
    }

    // --- Server-side filters ---
    if (q) {
      if (lang === "pt") {
        // Base name column is always Portuguese — search it directly
        query = query.ilike("name", `%${q}%`);
      } else {
        // Search the translation table for the active language, then OR with base name
        // (covers recipes that may lack a translation row)
        const { data: transMatches } = await supabase
          .from("recipe_translations")
          .select("recipe_id")
          .eq("language", lang)
          .ilike("name", `%${q}%`);
        const transIds = (transMatches ?? []).map((t) => t.recipe_id);
        if (transIds.length > 0) {
          query = query.or(`name.ilike.%${q}%,id.in.(${transIds.join(",")})`);
        } else {
          query = query.ilike("name", `%${q}%`);
        }
      }
    }
    // Language filter: only for default discovery browsing (no search, no mode filter).
    // Shows system recipes (name_language IS NULL) + recipes in the user's language.
    // Skipped for search (user explicitly typed a name), and for mode filters like
    // "mine" or "saved" where the user already scoped the set intentionally.
    if (!q && activeModes.length === 0) {
      query = query.or(`name_language.is.null,name_language.eq.${lang}`);
    }

    if (proteins.length > 0) query = query.overlaps("proteins", proteins);
    if (tags.length > 0) query = query.contains("tags", tags);
    if (maxCal !== undefined) query = query.lte("calories", maxCal);
    if (maxTime !== undefined) query = query.lte("time_min", maxTime);
    if (excludedRecipeIds.length > 0)
      query = query.not("id", "in", `(${excludedRecipeIds.join(",")})`);
    if (excludedProteinSlugs.length > 0)
      query = query.not(
        "proteins",
        "ov",
        `{${excludedProteinSlugs.join(",")}}`,
      );

    // --- Server-side ingredient filter ---
    // Pre-fetch recipe IDs so the filter applies before LIMIT (cursor-safe).
    // Searches PT names + raw_text on recipe_ingredients, and translations for non-PT users.
    if (ingredients.length > 0) {
      const lowered = ingredients.map((i) => i.toLowerCase());
      // term index → set of recipe ids that contain that term
      const perTerm: Set<string>[] = lowered.map(() => new Set<string>());

      // Single query for ALL terms (OR), then intersect in memory for AND logic.
      // Previously this fired 1–3 queries *per term* (an N+1); now it's a fixed
      // ≤3 queries regardless of how many ingredients are selected.
      const ptOr = ingredients
        .flatMap((ing) => [`name.ilike.%${ing}%`, `raw_text.ilike.%${ing}%`])
        .join(",");
      const { data: ptMatches } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id, name, raw_text")
        .or(ptOr);
      for (const row of ptMatches ?? []) {
        const hay = `${row.name ?? ""} ${row.raw_text ?? ""}`.toLowerCase();
        lowered.forEach((term, i) => {
          if (hay.includes(term)) perTerm[i].add(row.recipe_id);
        });
      }

      if (lang !== "pt") {
        const transOr = ingredients
          .map((ing) => `name.ilike.%${ing}%`)
          .join(",");
        const { data: transMatches } = await supabase
          .from("recipe_ingredient_translations")
          .select("ingredient_id, name")
          .eq("language", lang)
          .or(transOr);
        const transIds = (transMatches ?? []).map((t) => t.ingredient_id);
        if (transIds.length > 0) {
          const { data: riRows } = await supabase
            .from("recipe_ingredients")
            .select("id, recipe_id")
            .in("id", transIds);
          const idToRecipe = new Map(
            (riRows ?? []).map((r) => [r.id, r.recipe_id]),
          );
          for (const tm of transMatches ?? []) {
            const rid = idToRecipe.get(tm.ingredient_id);
            if (!rid) continue;
            const name = (tm.name ?? "").toLowerCase();
            lowered.forEach((term, i) => {
              if (name.includes(term)) perTerm[i].add(rid);
            });
          }
        }
      }

      // AND logic: recipe must match every ingredient term
      let matchingIds = perTerm[0] ?? new Set<string>();
      for (let i = 1; i < perTerm.length; i++) {
        matchingIds = new Set(
          [...matchingIds].filter((x) => perTerm[i].has(x)),
        );
      }
      if (matchingIds.size === 0) return { data: [], nextCursor: null };
      query = query.in("id", [...matchingIds]);
    }

    // --- Cursor WHERE clause ---
    if (cursor) {
      if (cursor.value === null) {
        // We're in the null section — sort field is null, paginate by id only
        query = query.is(sortCol, null).gt("id", cursor.id);
      } else if (ascending) {
        // ASC: next page = (col > val) OR (col = val AND id > lastId)
        query = query.or(
          `${sortCol}.gt.${cursor.value},and(${sortCol}.eq.${cursor.value},id.gt.${cursor.id})`,
        );
      } else {
        // DESC: next page = (col < val) OR (col = val AND id > lastId)
        query = query.or(
          `${sortCol}.lt.${cursor.value},and(${sortCol}.eq.${cursor.value},id.gt.${cursor.id})`,
        );
      }
    }

    // --- Order + limit ---
    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    let recipes = (data ?? []) as unknown as RecipeWithIngredients[];

    // --- Translations ---
    if (lang !== "pt" && recipes.length > 0) {
      const recipeIds = recipes.map((r) => r.id);
      const ingIds = recipes.flatMap((r) =>
        r.recipe_ingredients.map((i) => i.id),
      );

      const [recipeTransResult, ingTransResult] = await Promise.all([
        supabase
          .from("recipe_translations")
          .select("recipe_id, name")
          .in("recipe_id", recipeIds)
          .eq("language", lang),
        supabase
          .from("recipe_ingredient_translations")
          .select("ingredient_id, name, unit, raw_text")
          .in("ingredient_id", ingIds)
          .eq("language", lang),
      ]);

      const recipeTransMap = new Map(
        recipeTransResult.data?.map((t) => [t.recipe_id, t.name]) ?? [],
      );
      const ingTransMap = new Map(
        ingTransResult.data?.map((t) => [t.ingredient_id, t]) ?? [],
      );

      recipes = recipes.map((r) => ({
        ...r,
        name: recipeTransMap.get(r.id) ?? r.name,
        recipe_ingredients: r.recipe_ingredients.map((ing) => {
          const t = ingTransMap.get(ing.id);
          return t
            ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text }
            : ing;
        }),
      })) as RecipeWithIngredients[];
    }

    // --- Next cursor ---
    const last = recipes[recipes.length - 1];
    const nextCursor: LibraryCursor | null =
      recipes.length < limit
        ? null
        : {
            value: last
              ? ((last as unknown as Record<string, number | null>)[sortCol] ??
                null)
              : null,
            id: last?.id ?? "",
          };

    return { data: recipes, nextCursor };
  });

// GET: distinct proteins, tags, ingredient names — language-aware
export const fetchLibraryMeta = createServerFn({ method: "GET" })
  .inputValidator((input: { lang?: string }) => input)
  .handler(
    async ({
      data: input,
    }): Promise<{
      proteins: string[];
      tags: string[];
      ingredients: string[];
    }> => {
      const supabase = makeClient();
      const lang = input?.lang ?? getLang();
      const { data, error } = await supabase.rpc("get_library_meta", {
        lang,
      } as never);
      if (error) throw new Error(error.message);
      return data as {
        proteins: string[];
        tags: string[];
        ingredients: string[];
      };
    },
  );

export const fetchRecipeById = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = makeClient();
    const lang = getLang();

    const { data, error } = await supabase
      .from("recipes")
      .select("*, recipe_ingredients(*), recipe_steps(*)")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);

    const recipe = data as unknown as RecipeDetail;
    recipe.recipe_ingredients.sort((a, b) => a.position - b.position);
    recipe.recipe_steps.sort((a, b) => a.position - b.position);

    // Fetch author profile separately (no FK from recipes.owner_id → profiles.user_id)
    if (recipe.owner_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("user_id", recipe.owner_id)
        .maybeSingle();
      recipe.author_display_name = profile?.display_name ?? null;
      recipe.author_username = profile?.username ?? null;
    } else {
      recipe.author_display_name = null;
      recipe.author_username = null;
    }

    if (lang === "pt") return recipe;

    // Fetch translations in parallel
    const ingIds = recipe.recipe_ingredients.map((i) => i.id);
    const stepIds = recipe.recipe_steps.map((s) => s.id);

    const [recipeTransResult, ingTransResult, stepTransResult] =
      await Promise.all([
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

    const recipeTrans = recipeTransResult.data;
    const ingTrans = ingTransResult.data;
    const stepTrans = stepTransResult.data;

    const ingTransMap = new Map(
      ingTrans?.map((t) => [t.ingredient_id, t]) ?? [],
    );
    const stepTransMap = new Map(
      stepTrans?.map((t) => [t.step_id, t.text]) ?? [],
    );

    return {
      ...recipe,
      name: recipeTrans?.name ?? recipe.name,
      recipe_ingredients: recipe.recipe_ingredients.map((ing) => {
        const t = ingTransMap.get(ing.id);
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
      recipe_steps: recipe.recipe_steps.map((step) => ({
        ...step,
        text: stepTransMap.get(step.id) ?? step.text,
      })),
    } as RecipeDetail;
  });
