import { createServerFn } from "@tanstack/react-start";
import type { CookLog } from "../../types/db";
import { getLang, makeClient } from "./client-server";

export type CookSummary = {
  countThisMonth: number;
  countLastMonth: number;
  topProtein: string | null;
  mostCookedRecipe: { name: string; count: number } | null;
  masteredRecipes: { id: string; name: string }[];
  cuisinesThisMonth: string[];
  firstTimeCuisine: string | null;
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
    return {
      countThisMonth: 0,
      countLastMonth: 0,
      topProtein: null,
      mostCookedRecipe: null,
      masteredRecipes: [],
      cuisinesThisMonth: [],
      firstTimeCuisine: null,
    };
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

  // Top protein this month
  const proteinCounts = new Map<string, number>();
  for (const row of thisMonthRows ?? []) {
    for (const p of row.recipes?.proteins ?? []) {
      proteinCounts.set(p, (proteinCounts.get(p) ?? 0) + 1);
    }
  }
  const topProtein =
    proteinCounts.size > 0
      ? [...proteinCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

  // Most cooked recipe this month
  const recipeCounts = new Map<string, { name: string; count: number }>();
  for (const row of thisMonthRows ?? []) {
    if (!row.recipes) continue;
    const existing = recipeCounts.get(row.recipe_id);
    if (existing) {
      existing.count++;
    } else {
      recipeCounts.set(row.recipe_id, { name: row.recipes.name, count: 1 });
    }
  }
  const mostCookedEntry =
    recipeCounts.size > 0
      ? [...recipeCounts.values()].sort((a, b) => b.count - a.count)[0]
      : null;
  const mostCookedRecipe = mostCookedEntry ?? null;

  // Mastered recipes (cooked ≥ 3× all time)
  const { data: allCooks } = await supabase
    .from("cook_log")
    .select("recipe_id, recipes(id, name)")
    .eq("user_id", session.user.id) as unknown as {
    data:
      | { recipe_id: string; recipes: { id: string; name: string } | null }[]
      | null;
  };
  const allTimeCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const row of allCooks ?? []) {
    if (!row.recipes) continue;
    const existing = allTimeCounts.get(row.recipe_id);
    if (existing) {
      existing.count++;
    } else {
      allTimeCounts.set(row.recipe_id, { id: row.recipes.id, name: row.recipes.name, count: 1 });
    }
  }
  const masteredRecipes = [...allTimeCounts.values()]
    .filter((r) => r.count >= 3)
    .map(({ id, name }) => ({ id, name }));

  // Handle translations for recipe names if not PT
  if (lang !== "pt" && (mostCookedRecipe || masteredRecipes.length > 0)) {
    const idsToTranslate = [
      ...(mostCookedEntry ? [recipeCounts.keys().next().value as string] : []),
      ...masteredRecipes.map((r) => r.id),
    ];
    if (idsToTranslate.length > 0) {
      const { data: trans } = await supabase
        .from("recipe_translations")
        .select("recipe_id, name")
        .in("recipe_id", idsToTranslate)
        .eq("language", lang);
      const transMap = new Map((trans ?? []).map((t) => [t.recipe_id, t.name]));
      if (mostCookedRecipe) {
        const topId = [...recipeCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0]?.[0];
        if (topId && transMap.has(topId)) mostCookedRecipe.name = transMap.get(topId)!;
      }
      for (const r of masteredRecipes) {
        if (transMap.has(r.id)) r.name = transMap.get(r.id)!;
      }
    }
  }

  // Cuisines this month
  const cuisinesSet = new Set<string>();
  for (const row of thisMonthRows ?? []) {
    for (const c of row.recipes?.cuisine_tags ?? []) {
      cuisinesSet.add(c);
    }
  }
  const cuisinesThisMonth = [...cuisinesSet];

  // First-time cuisine this month (not in any previous cook log)
  const { data: prevCooks } = await supabase
    .from("cook_log")
    .select("recipes(cuisine_tags)")
    .eq("user_id", session.user.id)
    .lt("cooked_at", startOfMonth) as unknown as {
    data: { recipes: { cuisine_tags: string[] } | null }[] | null;
  };
  const prevCuisines = new Set<string>();
  for (const row of prevCooks ?? []) {
    for (const c of row.recipes?.cuisine_tags ?? []) {
      prevCuisines.add(c);
    }
  }
  const firstTimeCuisine =
    cuisinesThisMonth.find((c) => !prevCuisines.has(c)) ?? null;

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
