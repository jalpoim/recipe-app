import { createServerFn } from '@tanstack/react-start'
import type { CookLog } from '../../types/db'
import { makeClient } from './client-server'

export type CookLogWithRecipe = CookLog & { recipe_name: string }

// POST: log a recipe as cooked
export const logRecipeCooked = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { recipeId: string; source: 'planned' | 'manual' }) => input,
  )
  .handler(async ({ data }): Promise<CookLog> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const user = session.user
    const householdId = (user.app_metadata?.household_id as string | undefined) ?? null

    const { data: row, error } = await supabase
      .from('cook_log')
      .insert({
        user_id: user.id,
        recipe_id: data.recipeId,
        household_id: householdId,
        source: data.source,
        cooked_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return row
  })

// POST: rate a cook log entry
export const rateCookLogEntry = createServerFn({ method: 'POST' })
  .inputValidator((input: { cookLogId: string; rating: number }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { error } = await supabase
      .from('cook_log')
      .update({ rating: data.rating })
      .eq('id', data.cookLogId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: delete a cook log entry (undo)
export const deleteCookLogEntry = createServerFn({ method: 'POST' })
  .inputValidator((input: { cookLogId: string }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const { error } = await supabase
      .from('cook_log')
      .delete()
      .eq('id', data.cookLogId)
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// GET: fetch cook log for current user (most recent first, limit 50)
export const fetchCookLog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CookLogWithRecipe[]> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return []
    const user = session.user

    const { data, error } = await (supabase
      .from('cook_log')
      .select('*, recipes(name)')
      .eq('user_id', user.id)
      .order('cooked_at', { ascending: false })
      .limit(50) as unknown as Promise<{ data: (CookLog & { recipes: { name: string } | null })[] | null; error: { message: string } | null }>)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({
      ...row,
      recipe_name: row.recipes?.name ?? '',
    }))
  },
)

// GET: fetch cook counts per recipe for the current user — DB GROUP BY via RPC
export const fetchRecipeCookCounts = createServerFn({ method: 'GET' })
  .inputValidator((recipeIds: string[]) => recipeIds)
  .handler(async ({ data: recipeIds }): Promise<{ recipe_id: string; count: number }[]> => {
    if (recipeIds.length === 0) return []
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return []

    const { data, error } = await supabase.rpc('get_recipe_cook_counts', {
      p_user_id: session.user.id,
      p_recipe_ids: recipeIds,
    })
    if (error) throw new Error(error.message)
    return (data ?? []).map((row: { recipe_id: string; count: number }) => ({
      recipe_id: row.recipe_id,
      count: Number(row.count),
    }))
  })
