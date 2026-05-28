import { createServerFn } from "@tanstack/react-start";
import type { CookLog, UserCookProfile } from "../../types/db";
import { getLang, makeClient } from "./client-server";

export type CookSummary = {
  countThisMonth: number;
  countLastMonth: number;
  topProtein: string | null;
  mostCookedRecipe: { id: string; name: string; count: number } | null;
  masteredRecipes: { id: string; name: string }[];
  cuisinesThisMonth: string[];
  firstTimeCuisine: { cuisine: string; recipeName: string; recipeId: string } | null;
};

export type CookLogWithRecipe = CookLog & { recipe_name: string };

// POST: log a recipe as cooked
export const logRecipeCooked = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { recipeId: string; source: "planned" | "manual" }) => input,
  )
  .handler(async ({ data }): Promise<CookLog> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const user = session.user;
    const householdId =
      (user.app_metadata?.household_id as string | undefined) ?? null;

    const { data: row, error } = await supabase
      .from("cook_log")
      .insert({
        user_id: user.id,
        recipe_id: data.recipeId,
        household_id: householdId,
        source: data.source,
        cooked_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    _recomputeProfileForUser(supabase, user.id).catch(() => {});

    // Award +8 creator points when cooking someone else's recipe
    supabase
      .from("recipes")
      .select("owner_id")
      .eq("id", data.recipeId)
      .maybeSingle()
      .then(({ data: recipe }) => {
        if (recipe?.owner_id && recipe.owner_id !== user.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void (supabase as any).rpc("increment_creator_points", { p_user_id: recipe.owner_id, p_points: 8 });
        }
      })
      .then(undefined, () => {});

    return row;
  });

// POST: rate a cook log entry
export const rateCookLogEntry = createServerFn({ method: "POST" })
  .inputValidator((input: { cookLogId: string; rating: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const { error } = await supabase
      .from("cook_log")
      .update({ rating: data.rating })
      .eq("id", data.cookLogId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// POST: delete a cook log entry (undo)
export const deleteCookLogEntry = createServerFn({ method: "POST" })
  .inputValidator((input: { cookLogId: string }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("cook_log")
      .delete()
      .eq("id", data.cookLogId)
      .eq("user_id", session.user.id);
    if (error) throw new Error(error.message);
    _recomputeProfileForUser(supabase, session.user.id).catch(() => {});
    return { ok: true };
  });

// GET: fetch cook log for current user (most recent first, limit 50)
export const fetchCookLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<CookLogWithRecipe[]> => {
    const supabase = makeClient();
    const lang = getLang();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];
    const user = session.user;

    const { data, error } = await (supabase
      .from("cook_log")
      .select("*, recipes(id, name)")
      .eq("user_id", user.id)
      .order("cooked_at", { ascending: false })
      .limit(50) as unknown as Promise<{
      data:
        | (CookLog & { recipes: { id: string; name: string } | null })[]
        | null;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);

    const rows = data ?? [];

    if (lang !== "pt" && rows.length > 0) {
      const recipeIds = rows
        .map((r) => r.recipes?.id)
        .filter((id): id is string => !!id);
      const { data: trans } = await supabase
        .from("recipe_translations")
        .select("recipe_id, name")
        .in("recipe_id", recipeIds)
        .eq("language", lang);
      const transMap = new Map((trans ?? []).map((t) => [t.recipe_id, t.name]));
      return rows.map((row) => ({
        ...row,
        recipe_name:
          (row.recipes?.id ? transMap.get(row.recipes.id) : undefined) ??
          row.recipes?.name ??
          "",
      }));
    }

    return rows.map((row) => ({
      ...row,
      recipe_name: row.recipes?.name ?? "",
    }));
  },
);

// GET: count distinct recipes ever cooked (for tier gating)
export const getDistinctCookedCount = createServerFn({ method: "GET" }).handler(
  async (): Promise<number> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return 0;
    // supabase-js doesn't support COUNT DISTINCT; deduplicate in JS instead
    const { data } = await supabase
      .from("cook_log")
      .select("recipe_id")
      .eq("user_id", session.user.id);
    if (!data) return 0;
    return new Set(data.map((r) => r.recipe_id)).size;
  },
);

// GET: monthly cook summary for profile
export const getCookSummaryThisMonth = createServerFn({
  method: "GET",
}).handler(async (): Promise<CookSummary> => {
  const supabase = makeClient();
  const lang = getLang();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { countThisMonth: 0, countLastMonth: 0, topProtein: null, mostCookedRecipe: null, masteredRecipes: [], cuisinesThisMonth: [], firstTimeCuisine: null };
  }
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = startOfMonth;

  // Fetch this month's cook log with recipe data
  const { data: thisMonthRows } = await supabase
    .from("cook_log")
    .select("recipe_id, recipes(id, name, proteins, cuisine_tags)")
    .eq("user_id", session.user.id)
    .gte("cooked_at", startOfMonth) as unknown as {
    data:
      | {
          recipe_id: string;
          recipes: {
            id: string;
            name: string;
            proteins: string[];
            cuisine_tags: string[];
          } | null;
        }[]
      | null;
  };

  // Fetch last month count
  const { data: lastMonthRows } = await supabase
    .from("cook_log")
    .select("id")
    .eq("user_id", session.user.id)
    .gte("cooked_at", startOfLastMonth)
    .lt("cooked_at", endOfLastMonth);

  const countThisMonth = (thisMonthRows ?? []).length;
  const countLastMonth = (lastMonthRows ?? []).length;

  // All-time aggregates: single fetch covers signature dish, top protein, first-time cuisine
  const { data: allCooks } = await supabase
    .from("cook_log")
    .select("recipe_id, cooked_at, recipes(id, name, proteins, cuisine_tags)")
    .eq("user_id", session.user.id)
    .order("cooked_at", { ascending: true }) as unknown as {
    data:
      | {
          recipe_id: string;
          cooked_at: string;
          recipes: {
            id: string;
            name: string;
            proteins: string[];
            cuisine_tags: string[];
          } | null;
        }[]
      | null;
  };

  const allTimeCounts = new Map<string, { id: string; name: string; count: number }>();
  const allTimeProteinCounts = new Map<string, number>();
  const cuisineFirstSeen = new Map<string, { date: string; recipeName: string; recipeId: string }>();

  for (const row of allCooks ?? []) {
    const r = row.recipes;
    if (!r) continue;
    const existing = allTimeCounts.get(row.recipe_id);
    if (existing) {
      existing.count++;
    } else {
      allTimeCounts.set(row.recipe_id, { id: r.id, name: r.name, count: 1 });
    }
    for (const p of r.proteins ?? []) {
      allTimeProteinCounts.set(p, (allTimeProteinCounts.get(p) ?? 0) + 1);
    }
    for (const c of r.cuisine_tags ?? []) {
      if (!cuisineFirstSeen.has(c)) {
        cuisineFirstSeen.set(c, { date: row.cooked_at, recipeName: r.name, recipeId: r.id });
      }
    }
  }

  const masteredRecipes = [...allTimeCounts.values()]
    .filter((r) => r.count >= 3)
    .map(({ id, name }) => ({ id, name }));

  const topRecipeEntry = allTimeCounts.size > 0
    ? [...allTimeCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0]
    : null;
  let mostCookedRecipe = topRecipeEntry
    ? { id: topRecipeEntry[0], name: topRecipeEntry[1].name, count: topRecipeEntry[1].count }
    : null;

  const topProtein = allTimeProteinCounts.size > 0
    ? [...allTimeProteinCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Cuisine tried for the first time most recently — always present once any cuisine-tagged recipe is cooked
  const mostRecentCuisineEntry = cuisineFirstSeen.size > 0
    ? [...cuisineFirstSeen.entries()].sort((a, b) => b[1].date.localeCompare(a[1].date))[0]
    : null;
  const firstTimeCuisine = mostRecentCuisineEntry
    ? { cuisine: mostRecentCuisineEntry[0], recipeName: mostRecentCuisineEntry[1].recipeName, recipeId: mostRecentCuisineEntry[1].recipeId }
    : null;

  // Cuisines this month (used for monthly activity tracking)
  const cuisinesSet = new Set<string>();
  for (const row of thisMonthRows ?? []) {
    for (const c of (row.recipes as { cuisine_tags?: string[] } | null)?.cuisine_tags ?? []) {
      cuisinesSet.add(c);
    }
  }
  const cuisinesThisMonth = [...cuisinesSet];

  // Handle translations for recipe names if not PT
  if (lang !== "pt" && (mostCookedRecipe || masteredRecipes.length > 0)) {
    const idsToTranslate = [
      ...(mostCookedRecipe ? [mostCookedRecipe.id] : []),
      ...masteredRecipes.map((r) => r.id),
    ];
    if (idsToTranslate.length > 0) {
      const { data: trans } = await supabase
        .from("recipe_translations")
        .select("recipe_id, name")
        .in("recipe_id", idsToTranslate)
        .eq("language", lang);
      const transMap = new Map((trans ?? []).map((t) => [t.recipe_id, t.name]));
      if (mostCookedRecipe && transMap.has(mostCookedRecipe.id)) {
        mostCookedRecipe.name = transMap.get(mostCookedRecipe.id)!;
      }
      for (const r of masteredRecipes) {
        if (transMap.has(r.id)) r.name = transMap.get(r.id)!;
      }
    }
  }

  return {
    countThisMonth,
    countLastMonth,
    topProtein,
    mostCookedRecipe,
    masteredRecipes,
    cuisinesThisMonth,
    firstTimeCuisine,
  };
});

// GET: saves/likes summary for browser tier
export const getSavesSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ topCuisine: string | null; topProtein: string | null }> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { topCuisine: null, topProtein: null };

    const { data } = await supabase
      .from("user_recipe_interactions")
      .select("recipe_id, type, recipes(proteins, cuisine_tags)")
      .eq("user_id", session.user.id)
      .in("type", ["like", "save"]) as unknown as {
      data:
        | {
            recipe_id: string;
            type: string;
            recipes: { proteins: string[]; cuisine_tags: string[] } | null;
          }[]
        | null;
    };

    const proteinCounts = new Map<string, number>();
    const cuisineCounts = new Map<string, number>();
    for (const row of data ?? []) {
      for (const p of row.recipes?.proteins ?? []) {
        proteinCounts.set(p, (proteinCounts.get(p) ?? 0) + 1);
      }
      for (const c of row.recipes?.cuisine_tags ?? []) {
        cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
      }
    }
    const topProtein =
      proteinCounts.size > 0
        ? [...proteinCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;
    const topCuisine =
      cuisineCounts.size > 0
        ? [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;
    return { topProtein, topCuisine };
  },
);

// GET: read cached cook profile for current user
export const getCookProfile = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserCookProfile | null> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    const { data } = await supabase
      .from("user_cook_profile")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();
    return data ?? null;
  },
);

// Internal helper — shared by logRecipeCooked and recomputeCookProfile
async function _recomputeProfileForUser(
  supabase: ReturnType<typeof makeClient>,
  uid: string,
): Promise<UserCookProfile> {
    // Fetch all cook log entries with recipe details for this user
    const { data: logs, error: logsError } = await supabase
      .from("cook_log")
      .select(
        "recipe_id, recipes(cuisine_tags, proteins, time_min, calories, protein, servings, macros_total, dietary_flags, cooking_method)",
      )
      .eq("user_id", uid) as unknown as {
      data:
        | {
            recipe_id: string;
            recipes: {
              cuisine_tags: string[];
              proteins: string[];
              time_min: number | null;
              calories: number | null;
              protein: number | null;
              servings: number;
              macros_total: boolean;
              dietary_flags: string[];
              cooking_method: string | null;
            } | null;
          }[]
        | null;
      error: { message: string } | null;
    };
    if (logsError) throw new Error(logsError.message);
    const rows = logs ?? [];

    // ── Explorer axis ──────────────────────────────────────────────────────────
    // +5 per first cuisine cooked, +3 per first protein cooked, +0.5 per new recipe
    const seenCuisines = new Set<string>();
    const seenProteins = new Set<string>();
    const seenRecipes = new Set<string>();
    let explorerScore = 0;

    for (const row of rows) {
      const r = row.recipes;
      if (!r) continue;
      for (const c of r.cuisine_tags ?? []) {
        if (!seenCuisines.has(c)) {
          seenCuisines.add(c);
          explorerScore += 5;
        }
      }
      for (const p of r.proteins ?? []) {
        if (!seenProteins.has(p)) {
          seenProteins.add(p);
          explorerScore += 3;
        }
      }
      if (!seenRecipes.has(row.recipe_id)) {
        seenRecipes.add(row.recipe_id);
        explorerScore += 0.5;
      }
    }

    // ── Optimizer axis ─────────────────────────────────────────────────────────
    // % of cooked recipes (with macro data) where (protein*4)/calories >= 0.25
    let optimizerTotal = 0;
    let optimizerMet = 0;
    for (const row of rows) {
      const r = row.recipes;
      if (!r || r.calories == null || r.protein == null) continue;
      const servings = r.servings || 1;
      const calPerServing = r.macros_total ? r.calories / servings : r.calories;
      const protPerServing = r.macros_total ? r.protein / servings : r.protein;
      if (calPerServing <= 0) continue;
      optimizerTotal++;
      if ((protPerServing * 4) / calPerServing >= 0.25) optimizerMet++;
    }
    const optimizerScore =
      optimizerTotal > 0
        ? Math.round((optimizerMet / optimizerTotal) * 100)
        : 0;

    // ── Swift axis ─────────────────────────────────────────────────────────────
    // % of cooked recipes (with time data) where time_min <= 30
    let swiftTotal = 0;
    let swiftMet = 0;
    for (const row of rows) {
      const r = row.recipes;
      if (!r || r.time_min == null) continue;
      swiftTotal++;
      if (r.time_min <= 30) swiftMet++;
    }
    const swiftScore =
      swiftTotal > 0 ? Math.round((swiftMet / swiftTotal) * 100) : 0;

    // ── Planner axis ───────────────────────────────────────────────────────────
    // Approximation without plan data: each log from source='planned' in a unique week
    // Full planner scoring (weeks with active plan + 3 cooks) requires plan join —
    // simplified here to planned-source logs as a reasonable proxy
    const plannerScore = 0; // updated via plan-aware recompute (Phase 2)

    // ── Specialty badge ─────────────────────────────────────────────────────────
    // Hierarchy: cuisine (≥5 cooks) → dietary pattern → cooking method → protein
    const cuisineCounts = new Map<string, number>();
    const dietaryFlagCounts = new Map<string, number>();
    const cookingMethodCounts = new Map<string, number>();
    const proteinCounts = new Map<string, number>();
    const MIN_BADGE_THRESHOLD = 5;

    for (const row of rows) {
      const r = row.recipes;
      if (!r) continue;
      for (const c of r.cuisine_tags ?? []) {
        cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
      }
      for (const f of r.dietary_flags ?? []) {
        dietaryFlagCounts.set(f, (dietaryFlagCounts.get(f) ?? 0) + 1);
      }
      if (r.cooking_method) {
        cookingMethodCounts.set(
          r.cooking_method,
          (cookingMethodCounts.get(r.cooking_method) ?? 0) + 1,
        );
      }
      for (const p of r.proteins ?? []) {
        proteinCounts.set(p, (proteinCounts.get(p) ?? 0) + 1);
      }
    }

    let specialtyBadgeKey: string | null = null;

    // 1. Cuisine wins first
    const topCuisine = [...cuisineCounts.entries()]
      .filter(([, n]) => n >= MIN_BADGE_THRESHOLD)
      .sort((a, b) => b[1] - a[1])[0];
    if (topCuisine) {
      specialtyBadgeKey = `cuisine:${topCuisine[0]}`;
    } else {
      // 2. Dietary pattern
      const topDietary = [...dietaryFlagCounts.entries()]
        .filter(([, n]) => n >= MIN_BADGE_THRESHOLD)
        .sort((a, b) => b[1] - a[1])[0];
      if (topDietary) {
        specialtyBadgeKey = `dietary:${topDietary[0]}`;
      } else {
        // 3. Cooking method
        const topMethod = [...cookingMethodCounts.entries()]
          .filter(([, n]) => n >= MIN_BADGE_THRESHOLD)
          .sort((a, b) => b[1] - a[1])[0];
        if (topMethod) {
          specialtyBadgeKey = `method:${topMethod[0]}`;
        } else {
          // 4. Protein (last resort)
          const topProtein = [...proteinCounts.entries()]
            .filter(([, n]) => n >= MIN_BADGE_THRESHOLD)
            .sort((a, b) => b[1] - a[1])[0];
          if (topProtein) {
            specialtyBadgeKey = `protein:${topProtein[0]}`;
          }
        }
      }
    }

    // ── Upsert into user_cook_profile ─────────────────────────────────────────
    const profileData = {
      user_id: uid,
      explorer_score: explorerScore,
      optimizer_score: optimizerScore,
      planner_score: plannerScore,
      swift_score: swiftScore,
      specialty_badge_key: specialtyBadgeKey,
      lifetime_cook_count: rows.length,
      explored_cuisines: [...seenCuisines],
      explored_proteins: [...seenProteins],
      last_computed_at: new Date().toISOString(),
    };

    const { data: upserted, error: upsertError } = await supabase
      .from("user_cook_profile")
      .upsert(profileData, { onConflict: "user_id" })
      .select()
      .single();
    if (upsertError) throw new Error(upsertError.message);
    return upserted;
}

// POST: recompute all axis scores from cook_log — pure SQL aggregates, no AI
export const recomputeCookProfile = createServerFn({ method: "POST" }).handler(
  async (): Promise<UserCookProfile> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return _recomputeProfileForUser(supabase, session.user.id);
  },
);

// GET: fetch cook counts per recipe for the current user — DB GROUP BY via RPC
export const fetchRecipeCookCounts = createServerFn({ method: "GET" })
  .inputValidator((recipeIds: string[]) => recipeIds)
  .handler(
    async ({
      data: recipeIds,
    }): Promise<{ recipe_id: string; count: number }[]> => {
      if (recipeIds.length === 0) return [];
      const supabase = makeClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return [];

      const { data, error } = await supabase.rpc("get_recipe_cook_counts", {
        p_user_id: session.user.id,
        p_recipe_ids: recipeIds,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: { recipe_id: string; count: number }) => ({
        recipe_id: row.recipe_id,
        count: Number(row.count),
      }));
    },
  );
