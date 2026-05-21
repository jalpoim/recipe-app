import { createServerFn } from '@tanstack/react-start'
import type { ShoppingCheckState } from '../../types/db'
import { makeClient } from './client-server'

// GET: all check rows for a plan
export const fetchShoppingChecks = createServerFn({ method: 'GET' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }): Promise<ShoppingCheckState[]> => {
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('shopping_check_state')
      .select('*')
      .eq('plan_id', planId)
    if (error) throw new Error(error.message)
    return (data ?? []) as ShoppingCheckState[]
  })

// POST: upsert a check row
export const upsertCheck = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      planId: string
      itemKey: string
      isChecked: boolean
      label?: string
      category?: string
    }) => input,
  )
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const row: Record<string, unknown> = {
      plan_id: data.planId,
      item_key: data.itemKey,
      is_checked: data.isChecked,
      updated_at: new Date().toISOString(),
    }
    if (data.label !== undefined) row.label = data.label
    if (data.category !== undefined) row.category = data.category

    const { error } = await supabase
      .from('shopping_check_state')
      .upsert(row as never, { onConflict: 'plan_id,item_key' })
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: add a custom shopping item
export const addCustomShoppingItem = createServerFn({ method: 'POST' })
  .inputValidator((input: { planId: string; label: string; category: string }) => input)
  .handler(async ({ data }): Promise<ShoppingCheckState> => {
    const supabase = makeClient()
    const itemKey = `custom:${crypto.randomUUID()}`
    const { data: row, error } = await supabase
      .from('shopping_check_state')
      .insert({
        plan_id: data.planId,
        item_key: itemKey,
        is_checked: false,
        label: data.label,
        category: data.category,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return row as ShoppingCheckState
  })

// POST: clear all non-custom check rows for a plan
export const clearNonCustomChecks = createServerFn({ method: 'POST' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('shopping_check_state')
      .delete()
      .eq('plan_id', planId)
      .not('item_key', 'like', 'custom:%')
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: delete a single custom item by key
export const deleteCustomShoppingItem = createServerFn({ method: 'POST' })
  .inputValidator((input: { planId: string; itemKey: string }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('shopping_check_state')
      .delete()
      .eq('plan_id', data.planId)
      .eq('item_key', data.itemKey)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: delete all custom items for a plan
export const clearCustomItems = createServerFn({ method: 'POST' })
  .inputValidator((planId: string) => planId)
  .handler(async ({ data: planId }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('shopping_check_state')
      .delete()
      .eq('plan_id', planId)
      .like('item_key', 'custom:%')
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// GET: fetch all category overrides for the current user
export const fetchCategoryOverrides = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ ingredient_name: string; category: string }[]> => {
    const supabase = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('user_category_overrides')
      .select('ingredient_name, category')
    if (error) throw new Error(error.message)
    return (data ?? []) as { ingredient_name: string; category: string }[]
  })

// POST: upsert a single category override
export const upsertCategoryOverride = createServerFn({ method: 'POST' })
  .inputValidator((input: { ingredientName: string; category: string }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('user_category_overrides')
      .upsert(
        {
          user_id: session.user.id,
          ingredient_name: data.ingredientName,
          category: data.category,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,ingredient_name' },
      )
    if (error) throw new Error(error.message)
    return { ok: true }
  })
