import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import type {
  Plan,
  PlanItem,
  PlanItemWithRecipe,
  ActivePlanWithCount,
  RecipeIngredient,
} from "../../types/db";
import { getLang, makeClient } from "./client-server";
import { _computeFlavorProfile } from "./flavor-profile-queries";
import {
  computeRecipeExclusions,
  dietaryFlagsForProfile,
} from "./dietary-filter";
import {
  selectPlanRecipes,
  defaultSuggestionCount,
  type GeneratorRecipe,
  type Repertoire,
  type ReasonCode,
} from "../plan-generator";

// Result of suggestPlan: the inserted items plus the "why this" reason per recipe
// (F12a). Reasons are returned transiently for the UI to caption the new cards —
// not persisted (see plan-generator-spec §10.7 Q3).
export type SuggestPlanResult = {
  items: PlanItem[];
  reasons: Record<string, ReasonCode>;
};

// Service client for the household dietary-union read (§9.7): a member's profile
// and ingredient exclusions are RLS-locked to their own row, so reading the
// partner's dietary constraints requires service-role. Used only for that read.
function makeServiceClient() {
  const url = process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Resolve the caller's active plan id, creating the plan if missing. Household-
// aware: a household shares one plan; otherwise the user's newest personal plan.
// Extracted from addRecipeToPlan so the single-add, batch-add, and generate paths
// all resolve plan context identically.
async function resolveActivePlanId(
  supabase: ReturnType<typeof makeClient>,
  session: Session,
): Promise<string> {
  const householdId =
    (session.user.app_metadata?.household_id as string | undefined) ?? null;

  if (householdId) {
    const { data: householdPlan } = await supabase
      .from("plans")
      .select("id")
      .eq("household_id", householdId)
      .is("archived_at", null)
      .maybeSingle();
    if (householdPlan) return householdPlan.id;

    const { data: newPlan, error } = await supabase
      .from("plans")
      .insert({
        owner_id: session.user.id,
        household_id: householdId,
        name: "Current plan",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return newPlan.id;
  }

  const { data: existing } = await supabase
    .from("plans")
    .select("id")
    .eq("owner_id", session.user.id)
    .is("archived_at", null)
    .is("household_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: newPlan, error } = await supabase
    .from("plans")
    .insert({
      owner_id: session.user.id,
      name: "Current plan",
      default_multiplier: 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return newPlan.id;
}

// GET: active plan with item count — single RPC call, no sequential queries
export const fetchActivePlanWithCount = createServerFn({
  method: "GET",
}).handler(async (): Promise<ActivePlanWithCount | null> => {
  const supabase = makeClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const householdId =
    (session.user.app_metadata?.household_id as string | undefined) ?? null;

  const { data, error } = await supabase
    .rpc("get_active_plan", {
      p_user_id: session.user.id,
      p_household_id: householdId ?? undefined,
    })
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as ActivePlanWithCount;
});

// POST: get or create active plan — household-aware
export const ensureActivePlan = createServerFn({ method: "POST" }).handler(
  async (): Promise<Plan> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const householdId =
      (session.user.app_metadata?.household_id as string | undefined) ?? null;

    if (householdId) {
      const { data: householdPlan } = await supabase
        .from("plans")
        .select("*")
        .eq("household_id", householdId)
        .is("archived_at", null)
        .maybeSingle();
      if (householdPlan) return householdPlan;

      const { data: newPlan, error } = await supabase
        .from("plans")
        .insert({
          owner_id: session.user.id,
          household_id: householdId,
          name: "Current plan",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return newPlan;
    }

    // Personal plan fallback
    const { data: existing } = await supabase
      .from("plans")
      .select("*")
      .eq("owner_id", session.user.id)
      .is("archived_at", null)
      .is("household_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) return existing;

    const { data: newPlan, error } = await supabase
      .from("plans")
      .insert({
        owner_id: session.user.id,
        name: "Current plan",
        default_multiplier: 1,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return newPlan;
  },
);

// GET: plan items with recipe + ingredients
export const fetchPlanItems = createServerFn({ method: "GET" })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<PlanItemWithRecipe[]> => {
    const supabase = makeClient();
    const lang = getLang();

    const { data: items, error } = await supabase
      .from("plan_items")
      .select("*")
      .eq("plan_id", planId)
      .order("position");
    if (error) throw new Error(error.message);
    if (!items || items.length === 0) return [];

    const recipeIds = [...new Set(items.map((i) => i.recipe_id))];

    const [
      { data: recipes, error: recipeErr },
      { data: ingredients, error: ingErr },
    ] = await Promise.all([
      supabase
        .from("recipes")
        .select(
          "id, name, time_min, servings, macros_total, calories, protein, carbs, fat, proteins, tags, pcal_ratio, image_thumb_url",
        )
        .in("id", recipeIds),
      supabase
        .from("recipe_ingredients")
        .select(
          "id, recipe_id, name, raw_text, unit, quantity, category, position, is_pantry, ingredient_id",
        )
        .in("recipe_id", recipeIds),
    ]);
    if (recipeErr) throw new Error(recipeErr.message);
    if (ingErr) throw new Error(ingErr.message);

    // Resolve category for rows that don't have one stored:
    // 1. Via ingredient_id → ingredients.category (canonical source of truth)
    // 2. Fallback: exact PT name match against ingredient_translations → ingredients.category
    const uncategorised = (ingredients ?? []).filter((i) => !i.category);

    const SLUG_TO_PT: Record<string, string> = {
      meat: "Talho/Peixaria",
      produce: "Frutas/Legumes",
      dairy: "Lacticínios",
      grains: "Mercearia",
      other: "Outros",
    };

    const categoryById = new Map<string, string>();
    const categoryByName = new Map<string, string>();

    if (uncategorised.length > 0) {
      const ingredientIds = [
        ...new Set(
          uncategorised
            .map((i) => i.ingredient_id)
            .filter((id): id is string => !!id),
        ),
      ];
      const nameOnlyRows = uncategorised.filter((i) => !i.ingredient_id);
      const lookupNames = [
        ...new Set(
          nameOnlyRows
            .map((i) => (i.name ?? i.raw_text ?? "").trim())
            .filter((n) => n.length > 0),
        ),
      ];

      await Promise.all([
        ingredientIds.length > 0
          ? supabase
              .from("ingredients")
              .select("id, category")
              .in("id", ingredientIds)
              .not("category", "is", null)
              .then(({ data }) => {
                for (const row of data ?? []) {
                  if (row.category)
                    categoryById.set(
                      row.id,
                      SLUG_TO_PT[row.category] ?? row.category,
                    );
                }
              })
          : Promise.resolve(),

        lookupNames.length > 0
          ? supabase
              .from("ingredient_translations")
              .select("name, ingredient_id, ingredients(id, category)")
              .eq("language", "pt")
              .or(lookupNames.map((n) => `name.ilike.${n}`).join(","))
              .then(({ data }) => {
                for (const row of data ?? []) {
                  const cat = (
                    row.ingredients as {
                      id: string;
                      category: string | null;
                    } | null
                  )?.category;
                  if (cat)
                    categoryByName.set(
                      row.name.toLowerCase(),
                      SLUG_TO_PT[cat] ?? cat,
                    );
                }
              })
          : Promise.resolve(),
      ]);
    }

    const patchedIngredients = (ingredients ?? []).map((ing) => {
      if (ing.category) return ing;
      if (ing.ingredient_id) {
        const cat = categoryById.get(ing.ingredient_id);
        if (cat) return { ...ing, category: cat };
      }
      const lookupName = (ing.name ?? ing.raw_text ?? "").trim().toLowerCase();
      const cat = categoryByName.get(lookupName);
      return cat ? { ...ing, category: cat } : ing;
    });

    const ingByRecipe = new Map<string, RecipeIngredient[]>();
    for (const ing of patchedIngredients) {
      const list = ingByRecipe.get(ing.recipe_id) ?? [];
      list.push(ing as RecipeIngredient);
      ingByRecipe.set(ing.recipe_id, list);
    }

    let translatedRecipeNames = new Map<string, string>();
    let translatedIngredients = new Map<
      string,
      { name: string | null; unit: string | null; raw_text: string | null }
    >();

    if (lang !== "pt") {
      const ingIds = patchedIngredients.map((i) => i.id);
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
      translatedRecipeNames = new Map(
        (recipeTransResult.data ?? []).map((t) => [t.recipe_id, t.name]),
      );
      translatedIngredients = new Map(
        (ingTransResult.data ?? []).map((t) => [t.ingredient_id, t]),
      );
    }

    const recipeMap = new Map(
      (recipes ?? []).map((r) => [
        r.id,
        {
          ...r,
          name: translatedRecipeNames.get(r.id) ?? r.name,
          recipe_ingredients: (ingByRecipe.get(r.id) ?? []).map((ing) => {
            const t = translatedIngredients.get(ing.id);
            return t
              ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text }
              : ing;
          }),
        },
      ]),
    );

    return items.map((item) => {
      const recipe = recipeMap.get(item.recipe_id);
      if (!recipe) throw new Error(`Recipe ${item.recipe_id} not found`);
      return { ...item, recipe };
    }) as PlanItemWithRecipe[];
  });

// POST: add recipe to the current user's active plan
export const addRecipeToPlan = createServerFn({ method: "POST" })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }): Promise<PlanItem> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const planId = await resolveActivePlanId(supabase, session);

    // Look up user preference + recipe default in parallel
    const [{ data: maxRow }, { data: pref }, { data: recipeRow }] =
      await Promise.all([
        supabase
          .from("plan_items")
          .select("position")
          .eq("plan_id", planId)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("user_recipe_preferences")
          .select("preferred_servings")
          .eq("user_id", session.user.id)
          .eq("recipe_id", recipeId)
          .maybeSingle(),
        supabase
          .from("recipes")
          .select("servings")
          .eq("id", recipeId)
          .maybeSingle(),
      ]);

    const position = maxRow ? maxRow.position + 1 : 0;
    const servings = pref?.preferred_servings ?? recipeRow?.servings ?? 1;

    const { data: item, error } = await supabase
      .from("plan_items")
      .insert({
        plan_id: planId,
        recipe_id: recipeId,
        position,
        portion_multiplier: servings,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return item;
  });

// GET: single plan item
export const fetchPlanItem = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<PlanItem | null> => {
    const supabase = makeClient();
    const { data, error } = await supabase
      .from("plan_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

// POST: update a plan item's portion multiplier
export const updatePlanItemMultiplier = createServerFn({ method: "POST" })
  .inputValidator((input: { planItemId: string; multiplier: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const { error } = await supabase
      .from("plan_items")
      .update({ portion_multiplier: data.multiplier })
      .eq("id", data.planItemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// POST: remove a plan item
export const removePlanItem = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = makeClient();
    const { error } = await supabase.from("plan_items").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// POST: remove several plan items in one atomic round-trip (§9.9). Wired to the
// "Sugerir plano" Undo so undoing a generated batch is a single DELETE, not N
// sequential ones. Deletes by id (safe under a concurrent household edit).
export const removePlanItems = createServerFn({ method: "POST" })
  .inputValidator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    if (ids.length === 0) return { ok: true };
    const supabase = makeClient();
    const { error } = await supabase.from("plan_items").delete().in("id", ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Shared batch-insert: append recipeIds (in order) to the resolved active plan.
// Resolves each recipe's preferred/default servings with set-based IN(...) lookups
// — one query for user_recipe_preferences, one for recipes — not per-recipe (§9.9).
async function insertRecipesIntoPlan(
  supabase: ReturnType<typeof makeClient>,
  session: Session,
  recipeIds: string[],
): Promise<PlanItem[]> {
  if (recipeIds.length === 0) return [];
  const planId = await resolveActivePlanId(supabase, session);

  const [{ data: maxRow }, { data: prefs }, { data: recipes }] =
    await Promise.all([
      supabase
        .from("plan_items")
        .select("position")
        .eq("plan_id", planId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("user_recipe_preferences")
        .select("recipe_id, preferred_servings")
        .eq("user_id", session.user.id)
        .in("recipe_id", recipeIds),
      supabase.from("recipes").select("id, servings").in("id", recipeIds),
    ]);

  const prefById = new Map(
    (prefs ?? []).map((p) => [p.recipe_id, p.preferred_servings]),
  );
  const servingsById = new Map((recipes ?? []).map((r) => [r.id, r.servings]));
  const startPosition = maxRow ? maxRow.position + 1 : 0;

  const rows = recipeIds.map((recipeId, i) => ({
    plan_id: planId,
    recipe_id: recipeId,
    position: startPosition + i,
    portion_multiplier:
      prefById.get(recipeId) ?? servingsById.get(recipeId) ?? 1,
  }));

  const { data: items, error } = await supabase
    .from("plan_items")
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return items ?? [];
}

// POST: add several recipes to the active plan in one insert (§3.8 / §9.9).
export const addRecipesToPlan = createServerFn({ method: "POST" })
  .inputValidator((recipeIds: string[]) => recipeIds)
  .handler(async ({ data: recipeIds }): Promise<PlanItem[]> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return insertRecipesIntoPlan(supabase, session, recipeIds);
  });

// Gather the household dietary UNION (§9.7): a generated plan lands in the shared
// plan, so a recipe must pass BOTH members' dietary mode + intolerances + ingredient
// exclusions. Union of exclusion sets == "passes both". Returns the tapping user's
// own constraints when not in a household. Partner rows are RLS-locked → service read.
async function gatherDietaryUnion(
  supabase: ReturnType<typeof makeClient>,
  session: Session,
): Promise<{ excludedFlags: string[]; excludedIngredientIds: string[] }> {
  const uid = session.user.id;
  const householdId =
    (session.user.app_metadata?.household_id as string | undefined) ?? null;

  if (!householdId) {
    const [{ data: profile }, { data: exclusions }] = await Promise.all([
      supabase
        .from("profiles")
        .select("dietary_mode, intolerances")
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("user_ingredient_exclusions")
        .select("ingredient_id")
        .eq("user_id", uid),
    ]);
    return {
      excludedFlags: dietaryFlagsForProfile(
        profile?.dietary_mode ?? null,
        profile?.intolerances ?? [],
      ),
      excludedIngredientIds: (exclusions ?? []).map((e) => e.ingredient_id),
    };
  }

  // Household: union both members. household_members / profiles / exclusions are
  // each RLS-scoped to the caller's own row, so read them with the service client.
  const service = makeServiceClient();
  const { data: members } = await service
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId);
  const memberIds = [...new Set((members ?? []).map((m) => m.user_id))];
  if (memberIds.length === 0) memberIds.push(uid);

  const [{ data: profiles }, { data: exclusions }] = await Promise.all([
    service
      .from("profiles")
      .select("dietary_mode, intolerances")
      .in("user_id", memberIds),
    service
      .from("user_ingredient_exclusions")
      .select("ingredient_id")
      .in("user_id", memberIds),
  ]);

  const flags = new Set<string>();
  for (const p of profiles ?? []) {
    for (const f of dietaryFlagsForProfile(p.dietary_mode, p.intolerances ?? []))
      flags.add(f);
  }
  const ingIds = new Set<string>(
    (exclusions ?? []).map((e) => e.ingredient_id),
  );
  return {
    excludedFlags: [...flags],
    excludedIngredientIds: [...ingIds],
  };
}

// Candidate pool ceiling — bounded for performance; familiar recipes are always
// fetched too (below) so the repertoire half is complete regardless of this cap.
const CANDIDATE_POOL_LIMIT = 300;

const GENERATOR_RECIPE_FIELDS =
  "id, proteins, cuisine_tags, flavor_notes, time_min, pcal_ratio, servings, popularity_score";

// POST: generate an editable plan — pure SQL + deterministic scoring, no AI.
// Thin: gather signals → fetch hard-filtered candidates → selectPlanRecipes → insert.
// All judgement lives in the pure core (src/lib/plan-generator.ts).
export const suggestPlan = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { count: number; excludeRecipeIds?: string[] }) => input,
  )
  .handler(async ({ data: input }): Promise<SuggestPlanResult> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const uid = session.user.id;

    // ── Gather signals (tapping user's taste; household union for dietary §9.7) ──
    const [
      flavorProfile,
      { data: profile },
      { data: cookProfile },
      { data: cookRows },
      { data: interactions },
      { data: planItems },
      dietary,
    ] = await Promise.all([
      _computeFlavorProfile(supabase, uid),
      supabase.from("profiles").select("cook_style").eq("user_id", uid).maybeSingle(),
      supabase
        .from("user_cook_profile")
        .select("explored_proteins")
        .eq("user_id", uid)
        .maybeSingle(),
      supabase.from("cook_log").select("recipe_id, cooked_at").eq("user_id", uid),
      supabase
        .from("user_recipe_interactions")
        .select("recipe_id")
        .eq("user_id", uid)
        .in("type", ["like", "save"]),
      // Current plan items → exclude from suggestions (de-dupe in-plan).
      (async () => {
        const planId = await resolveActivePlanId(supabase, session);
        return supabase.from("plan_items").select("recipe_id").eq("plan_id", planId);
      })(),
      gatherDietaryUnion(supabase, session),
    ]);

    // Repertoire (§9.1): per-recipe cook count + days since last cook. Familiar =
    // cooked OR liked/saved.
    const repertoire: Repertoire = new Map();
    const familiarRecipeIds = new Set<string>();
    const now = Date.now();
    for (const row of cookRows ?? []) {
      familiarRecipeIds.add(row.recipe_id);
      const days = Math.max(
        0,
        (now - new Date(row.cooked_at).getTime()) / 86_400_000,
      );
      const entry = repertoire.get(row.recipe_id);
      if (entry) {
        entry.cookCount++;
        if (days < entry.daysSinceLastCook) entry.daysSinceLastCook = days;
      } else {
        repertoire.set(row.recipe_id, { cookCount: 1, daysSinceLastCook: days });
      }
    }
    for (const row of interactions ?? []) familiarRecipeIds.add(row.recipe_id);

    const excludeRecipeIds = new Set<string>([
      ...(planItems ?? []).map((p) => p.recipe_id),
      ...(input.excludeRecipeIds ?? []),
    ]);

    // ── Hard filters (§9.4 — applied first, unconditionally) ─────────────────
    const { excludedProteinSlugs, excludedRecipeIds } =
      await computeRecipeExclusions(
        supabase,
        dietary.excludedFlags,
        dietary.excludedIngredientIds,
      );
    // Hidden recipes are a hard exclude too.
    const { data: hidden } = await supabase
      .from("user_recipe_interactions")
      .select("recipe_id")
      .eq("user_id", uid)
      .eq("type", "hide");
    const hiddenIds = (hidden ?? []).map((h) => h.recipe_id);

    function applyHardFilters<T>(q: T): T {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = q as any;
      // deleted_at IS NULL AND moderation_status='approved' AND
      // (visibility IN ('system','public') OR owner_id = uid)  — §3.3.
      query = query
        .is("deleted_at", null)
        .eq("moderation_status", "approved")
        .or(`visibility.in.(system,public),owner_id.eq.${uid}`);
      if (excludedProteinSlugs.length > 0)
        query = query.not("proteins", "ov", `{${excludedProteinSlugs.join(",")}}`);
      const blockedIds = [...new Set([...excludedRecipeIds, ...hiddenIds])];
      if (blockedIds.length > 0)
        query = query.not("id", "in", `(${blockedIds.join(",")})`);
      return query as T;
    }

    // Bounded popularity-ordered pool + the complete familiar set (§3.3 / §9.4):
    // both pass the SAME hard filter, so the familiar override beats popularity
    // truncation but never the dietary/intolerance/hidden filter.
    const familiarIdList = [...familiarRecipeIds];
    const [{ data: popular }, familiarResult] = await Promise.all([
      applyHardFilters(
        supabase
          .from("recipes")
          .select(GENERATOR_RECIPE_FIELDS)
          .order("popularity_score", { ascending: false })
          .limit(CANDIDATE_POOL_LIMIT),
      ),
      familiarIdList.length > 0
        ? applyHardFilters(
            supabase
              .from("recipes")
              .select(GENERATOR_RECIPE_FIELDS)
              .in("id", familiarIdList),
          )
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const byId = new Map<string, GeneratorRecipe>();
    for (const r of [
      ...((popular ?? []) as GeneratorRecipe[]),
      ...(((familiarResult as { data: unknown[] }).data ?? []) as GeneratorRecipe[]),
    ]) {
      byId.set(r.id, r);
    }
    const candidates = [...byId.values()];

    const count =
      input.count > 0
        ? input.count
        : defaultSuggestionCount(profile?.cook_style ?? null);

    const selected = selectPlanRecipes(
      candidates,
      {
        flavorProfile,
        cookStyle: profile?.cook_style ?? null,
        exploredProteins: cookProfile?.explored_proteins ?? [],
        familiarRecipeIds,
        excludeRecipeIds,
        repertoire,
      },
      count,
    );

    const items = await insertRecipesIntoPlan(
      supabase,
      session,
      selected.map((s) => s.id),
    );
    const reasons: Record<string, ReasonCode> = {};
    for (const s of selected) reasons[s.id] = s.reason;
    return { items, reasons };
  });

// GET: preferred serving count for a recipe (null = never set)
export const fetchUserRecipePreference = createServerFn({ method: "GET" })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }): Promise<number | null> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    const { data } = await supabase
      .from("user_recipe_preferences")
      .select("preferred_servings")
      .eq("user_id", session.user.id)
      .eq("recipe_id", recipeId)
      .maybeSingle();
    return data?.preferred_servings ?? null;
  });

// POST: save preferred serving count for a recipe
export const upsertUserRecipePreference = createServerFn({ method: "POST" })
  .inputValidator((input: { recipeId: string; servings: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const { error } = await supabase.from("user_recipe_preferences").upsert(
      {
        user_id: session.user.id,
        recipe_id: data.recipeId,
        preferred_servings: data.servings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,recipe_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// POST: update default multiplier
export const updatePlanMultiplier = createServerFn({ method: "POST" })
  .inputValidator((input: { planId: string; multiplier: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient();
    const { error } = await supabase
      .from("plans")
      .update({ default_multiplier: data.multiplier })
      .eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// POST: archive current plan and create a fresh one
export const archiveAndCreatePlan = createServerFn({ method: "POST" })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<Plan> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const now = new Date().toISOString();

    // Fetch plan metadata and items in parallel before archiving
    const [{ data: plan }, { data: items }] = await Promise.all([
      supabase
        .from("plans")
        .select("household_id")
        .eq("id", planId)
        .maybeSingle(),
      supabase.from("plan_items").select("recipe_id").eq("plan_id", planId),
    ]);

    const householdId = plan?.household_id ?? null;

    // Archive and log cooked recipes in parallel
    await Promise.all([
      supabase.from("plans").update({ archived_at: now }).eq("id", planId),
      items && items.length > 0
        ? supabase.from("cook_log").insert(
            items.map((item) => ({
              user_id: session.user.id,
              recipe_id: item.recipe_id,
              household_id: householdId,
              source: "planned" as const,
              cooked_at: now,
            })),
          )
        : Promise.resolve(),
    ]);

    // Create replacement plan — preserve household context if applicable
    const { data, error } = await supabase
      .from("plans")
      .insert({
        owner_id: session.user.id,
        household_id: householdId,
        name: "Current plan",
        default_multiplier: 1,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  });
