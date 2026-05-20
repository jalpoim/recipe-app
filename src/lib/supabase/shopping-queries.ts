import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import type { ShoppingCheckState } from '../../types/db'

function makeClient() {
  return createServerClient<Database>(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
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
