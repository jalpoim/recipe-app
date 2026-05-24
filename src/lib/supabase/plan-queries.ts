import { createServerFn } from '@tanstack/react-start'
import type { Plan, PlanItem, PlanItemWithRecipe, ActivePlanWithCount, RecipeIngredient } from '../../types/db'
import { makeClient } from './client-server'

// GET: active plan with item count — single RPC call, no sequential queries
export const fetchActivePlanWithCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActivePlanWithCount | null> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null

    const householdId = (session.user.app_metadata?.household_id as string | undefined) ?? null

    const { data, error } = await supabase
      .rpc('get_active_plan', {
        p_user_id: session.user.id,
        p_household_id: householdId ?? undefined,
      })
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return data as ActivePlanWithCount
  },
)

// POST: get or create active plan — household-aware
export const ensureActivePlan = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Plan> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const householdId = (session.user.app_metadata?.household_id as string | undefined) ?? null

    if (householdId) {
      const { data: householdPlan } = await supabase
        .from('plans')
        .select('*')
        .eq('household_id', householdId)
        .is('archived_at', null)
        .maybeSingle()
      if (householdPlan) return householdPlan

      const { data: newPlan, error } = await supabase
        .from('plans')
        .insert({ owner_id: session.user.id, household_id: householdId, name: 'Current plan' })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return newPlan
    }

    // Personal plan fallback
    const { data: existing } = await supabase
      .from('plans')
      .select('*')
      .eq('owner_id', session.user.id)
      .is('archived_at', null)
      .is('household_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) return existing

    const { data: newPlan, error } = await supabase
      .from('plans')
      .insert({ owner_id: session.user.id, name: 'Current plan', default_multiplier: 1 })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return newPlan
  },
)

// GET: plan items with recipe + ingredients
export const fetchPlanItems = createServerFn({ method: 'GET' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<PlanItemWithRecipe[]> => {
    const supabase = makeClient()

    const { data: items, error } = await supabase
      .from('plan_items')
      .select('*')
      .eq('plan_id', planId)
      .order('position')
    if (error) throw new Error(error.message)
    if (!items || items.length === 0) return []

    const recipeIds = [...new Set(items.map((i) => i.recipe_id))]

    const [{ data: recipes, error: recipeErr }, { data: ingredients, error: ingErr }] =
      await Promise.all([
        supabase
          .from('recipes')
          .select('id, name, time_min, servings, macros_total, calories, protein, carbs, fat, proteins, tags, pcal_ratio')
          .in('id', recipeIds),
        supabase
          .from('recipe_ingredients')
          .select('id, recipe_id, name, raw_text, unit, quantity, category, position, is_pantry')
          .in('recipe_id', recipeIds),
      ])
    if (recipeErr) throw new Error(recipeErr.message)
    if (ingErr) throw new Error(ingErr.message)

    const ingByRecipe = new Map<string, RecipeIngredient[]>()
    for (const ing of ingredients ?? []) {
      const list = ingByRecipe.get(ing.recipe_id) ?? []
      list.push(ing as RecipeIngredient)
      ingByRecipe.set(ing.recipe_id, list)
    }

    const recipeMap = new Map(
      (recipes ?? []).map((r) => [
        r.id,
        { ...r, recipe_ingredients: ingByRecipe.get(r.id) ?? [] },
      ]),
    )

    return items.map((item) => {
      const recipe = recipeMap.get(item.recipe_id)
      if (!recipe) throw new Error(`Recipe ${item.recipe_id} not found`)
      return { ...item, recipe }
    }) as PlanItemWithRecipe[]
  })

// POST: add recipe to the current user's active plan
export const addRecipeToPlan = createServerFn({ method: 'POST' })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }): Promise<PlanItem> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const householdId = (session.user.app_metadata?.household_id as string | undefined) ?? null

    let planId: string

    if (householdId) {
      const { data: householdPlan } = await supabase
        .from('plans')
        .select('id')
        .eq('household_id', householdId)
        .is('archived_at', null)
        .maybeSingle()
      if (householdPlan) {
        planId = householdPlan.id
      } else {
        const { data: newPlan, error } = await supabase
          .from('plans')
          .insert({ owner_id: session.user.id, household_id: householdId, name: 'Current plan' })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        planId = newPlan.id
      }
    } else {
      const { data: existing } = await supabase
        .from('plans')
        .select('id')
        .eq('owner_id', session.user.id)
        .is('archived_at', null)
        .is('household_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        planId = existing.id
      } else {
        const { data: newPlan, error } = await supabase
          .from('plans')
          .insert({ owner_id: session.user.id, name: 'Current plan', default_multiplier: 1 })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        planId = newPlan.id
      }
    }

    // Look up user preference + recipe default in parallel
    const [{ data: maxRow }, { data: pref }, { data: recipeRow }] = await Promise.all([
      supabase.from('plan_items').select('position').eq('plan_id', planId).order('position', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('user_recipe_preferences').select('preferred_servings').eq('user_id', session.user.id).eq('recipe_id', recipeId).maybeSingle(),
      supabase.from('recipes').select('servings').eq('id', recipeId).maybeSingle(),
    ])

    const position = maxRow ? maxRow.position + 1 : 0
    const servings = pref?.preferred_servings ?? recipeRow?.servings ?? 1

    const { data: item, error } = await supabase
      .from('plan_items')
      .insert({ plan_id: planId, recipe_id: recipeId, position, portion_multiplier: servings })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return item
  })

// GET: single plan item
export const fetchPlanItem = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<PlanItem | null> => {
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('plan_items')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  })

// POST: update a plan item's portion multiplier
export const updatePlanItemMultiplier = createServerFn({ method: 'POST' })
  .inputValidator((input: { planItemId: string; multiplier: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('plan_items')
      .update({ portion_multiplier: data.multiplier })
      .eq('id', data.planItemId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: remove a plan item
export const removePlanItem = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = makeClient()
    const { error } = await supabase.from('plan_items').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// GET: preferred serving count for a recipe (null = never set)
export const fetchUserRecipePreference = createServerFn({ method: 'GET' })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }): Promise<number | null> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const { data } = await supabase
      .from('user_recipe_preferences')
      .select('preferred_servings')
      .eq('user_id', session.user.id)
      .eq('recipe_id', recipeId)
      .maybeSingle()
    return data?.preferred_servings ?? null
  })

// POST: save preferred serving count for a recipe
export const upsertUserRecipePreference = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; servings: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const { error } = await supabase
      .from('user_recipe_preferences')
      .upsert(
        { user_id: session.user.id, recipe_id: data.recipeId, preferred_servings: data.servings, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,recipe_id' },
      )
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: update default multiplier
export const updatePlanMultiplier = createServerFn({ method: 'POST' })
  .inputValidator((input: { planId: string; multiplier: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('plans')
      .update({ default_multiplier: data.multiplier })
      .eq('id', data.planId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: archive current plan and create a fresh one
export const archiveAndCreatePlan = createServerFn({ method: 'POST' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<Plan> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const now = new Date().toISOString()

    // Fetch plan metadata and items in parallel before archiving
    const [{ data: plan }, { data: items }] = await Promise.all([
      supabase.from('plans').select('household_id').eq('id', planId).maybeSingle(),
      supabase.from('plan_items').select('recipe_id').eq('plan_id', planId),
    ])

    const householdId = plan?.household_id ?? null

    // Archive and log cooked recipes in parallel
    await Promise.all([
      supabase.from('plans').update({ archived_at: now }).eq('id', planId),
      items && items.length > 0
        ? supabase.from('cook_log').insert(
            items.map((item) => ({
              user_id: session.user.id,
              recipe_id: item.recipe_id,
              household_id: householdId,
              source: 'planned' as const,
              cooked_at: now,
            })),
          )
        : Promise.resolve(),
    ])

    // Create replacement plan — preserve household context if applicable
    const { data, error } = await supabase
      .from('plans')
      .insert({
        owner_id: session.user.id,
        household_id: householdId,
        name: 'Current plan',
        default_multiplier: 1,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  })
