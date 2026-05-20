import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import type { Plan, PlanItem, PlanItemWithRecipe, ActivePlanWithCount } from '../../types/db'

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

// GET: active plan with item count (used as TanStack Query queryFn)
export const fetchActivePlanWithCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActivePlanWithCount | null> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('plans')
      .select('*, plan_items(id)')
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!data) return null
    const { plan_items, ...plan } = data as typeof data & { plan_items: { id: string }[] }
    return { ...plan, item_count: plan_items?.length ?? 0 } as ActivePlanWithCount
  },
)

// POST: get or create active plan (used in route loader only)
export const ensureActivePlan = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Plan> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: existing } = await supabase
      .from('plans')
      .select('*')
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) return existing as Plan

    const { data, error } = await supabase
      .from('plans')
      .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as Plan
  },
)

// GET: plan items with recipe + ingredients
export const fetchPlanItems = createServerFn({ method: 'GET' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<PlanItemWithRecipe[]> => {
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('plan_items')
      .select('*, recipe:recipes(*, recipe_ingredients(*))')
      .eq('plan_id', planId)
      .order('position')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as PlanItemWithRecipe[]
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

    // Get or create plan
    let planId: string
    const { data: existing } = await supabase
      .from('plans')
      .select('id')
      .eq('owner_id', user.id)
      .is('archived_at', null)
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
    return item as PlanItem
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
    return (data ?? null) as PlanItem | null
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
    return item as PlanItem
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

    await supabase
      .from('plans')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', planId)

    const { data, error } = await supabase
      .from('plans')
      .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as Plan
  })
