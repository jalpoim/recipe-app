import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import type { Plan, PlanItem, PlanItemWithRecipe, ActivePlanWithCount, RecipeIngredient } from '../../types/db'

function makeClient() {
  return createServerClient<Database>(
    (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string,
    (import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY) as string,
    {
      cookies: {
        getAll() {
          const cookies = getCookies()
          return Object.entries(cookies).map(([name, value]) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            setCookie(name, value, options as Parameters<typeof setCookie>[2])
          )
        },
      },
    },
  )
}

// GET: active plan with item count — household-aware
async function getPlanItemCount(supabase: ReturnType<typeof makeClient>, planId: string): Promise<number> {
  const { count } = await supabase
    .from('plan_items')
    .select('*', { count: 'exact', head: true })
    .eq('plan_id', planId)
  return count ?? 0
}

export const fetchActivePlanWithCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActivePlanWithCount | null> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    // Check household first
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (membership) {
      const { data: plan } = await supabase
        .from('plans')
        .select('*')
        .eq('household_id', membership.household_id)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!plan) return null
      const item_count = await getPlanItemCount(supabase, plan.id)
      return { ...plan, item_count }
    }

    const { data: plan } = await supabase
      .from('plans')
      .select('*')
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!plan) return null
    const item_count = await getPlanItemCount(supabase, plan.id)
    return { ...plan, item_count }
  },
)

// POST: get or create active plan — household-aware
export const ensureActivePlan = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Plan> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Check for household membership first
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (membership) {
      const { data: householdPlan } = await supabase
        .from('plans')
        .select('*')
        .eq('household_id', membership.household_id)
        .is('archived_at', null)
        .maybeSingle()
      if (householdPlan) return householdPlan

      const { data: newPlan, error } = await supabase
        .from('plans')
        .insert({ owner_id: user.id, household_id: membership.household_id, name: 'Current plan' })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return newPlan
    }

    // Personal plan fallback
    const { data: existing } = await supabase
      .from('plans')
      .select('*')
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .is('household_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) return existing

    const { data: newPlan, error } = await supabase
      .from('plans')
      .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })
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
        supabase.from('recipes').select('*').in('id', recipeIds),
        supabase.from('recipe_ingredients').select('*').in('recipe_id', recipeIds),
      ])
    if (recipeErr) throw new Error(recipeErr.message)
    if (ingErr) throw new Error(ingErr.message)

    const ingByRecipe = new Map<string, RecipeIngredient[]>()
    for (const ing of ingredients ?? []) {
      const list = ingByRecipe.get(ing.recipe_id) ?? []
      list.push(ing)
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
    })
  })

// POST: add recipe to the current user's active plan
export const addRecipeToPlan = createServerFn({ method: 'POST' })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }): Promise<PlanItem> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Get or create plan — household-aware
    let planId: string
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (membership) {
      const { data: householdPlan } = await supabase
        .from('plans')
        .select('id')
        .eq('household_id', membership.household_id)
        .is('archived_at', null)
        .maybeSingle()
      if (householdPlan) {
        planId = householdPlan.id
      } else {
        const { data: newPlan, error } = await supabase
          .from('plans')
          .insert({ owner_id: user.id, household_id: membership.household_id, name: 'Current plan' })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        planId = newPlan.id
      }
    } else {
      const { data: existing } = await supabase
        .from('plans')
        .select('id')
        .eq('owner_id', user.id)
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
          .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        planId = newPlan.id
      }
    }

    // Max position
    const { data: maxRow } = await supabase
      .from('plan_items')
      .select('position')
      .eq('plan_id', planId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const position = maxRow ? maxRow.position + 1 : 0

    const { data: item, error } = await supabase
      .from('plan_items')
      .insert({ plan_id: planId, recipe_id: recipeId, position, portion_multiplier: 1 })
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

// POST: replace one plan item with a different recipe
export const replacePlanItem = createServerFn({ method: 'POST' })
  .inputValidator((input: { planItemId: string; newRecipeId: string }) => input)
  .handler(async ({ data }): Promise<PlanItem> => {
    const supabase = makeClient()

    const { data: old, error: fetchErr } = await supabase
      .from('plan_items')
      .select('position, plan_id')
      .eq('id', data.planItemId)
      .single()
    if (fetchErr) throw new Error(fetchErr.message)

    await supabase.from('plan_items').delete().eq('id', data.planItemId)

    const { data: item, error } = await supabase
      .from('plan_items')
      .insert({
        plan_id: old.plan_id,
        recipe_id: data.newRecipeId,
        position: old.position,
        portion_multiplier: 1,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return item
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Fetch the plan to get household_id before archiving
    const { data: plan } = await supabase
      .from('plans')
      .select('household_id')
      .eq('id', planId)
      .maybeSingle()

    // Fetch all plan items before archiving so we can log them
    const { data: items } = await supabase
      .from('plan_items')
      .select('recipe_id')
      .eq('plan_id', planId)

    await supabase
      .from('plans')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', planId)

    // Auto-log all plan items as cooked (source = 'planned')
    if (items && items.length > 0) {
      await supabase.from('cook_log').insert(
        items.map((item) => ({
          user_id: user.id,
          recipe_id: item.recipe_id,
          household_id: plan?.household_id ?? null,
          source: 'planned' as const,
          cooked_at: new Date().toISOString(),
        })),
      )
    }

    const { data, error } = await supabase
      .from('plans')
      .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  })
