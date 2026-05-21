import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database, CookLog } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'

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

// POST: log a recipe as cooked
export const logRecipeCooked = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { recipeId: string; source: 'planned' | 'manual'; householdId?: string | null }) =>
      input,
  )
  .handler(async ({ data }): Promise<CookLog> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: row, error } = await supabase
      .from('cook_log')
      .insert({
        user_id: user.id,
        recipe_id: data.recipeId,
        household_id: data.householdId ?? null,
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

// GET: fetch cook log for current user (most recent first, limit 50)
export const fetchCookLog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CookLog[]> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('cook_log')
      .select('*')
      .eq('user_id', user.id)
      .order('cooked_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    return data ?? []
  },
)

// GET: fetch cook counts per recipe
export const fetchRecipeCookCounts = createServerFn({ method: 'GET' })
  .inputValidator((recipeIds: string[]) => recipeIds)
  .handler(async ({ data: recipeIds }): Promise<{ recipe_id: string; count: number }[]> => {
    if (recipeIds.length === 0) return []
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('cook_log')
      .select('recipe_id')
      .in('recipe_id', recipeIds)
    if (error) throw new Error(error.message)

    const counts: Record<string, number> = {}
    for (const row of data ?? []) {
      counts[row.recipe_id] = (counts[row.recipe_id] ?? 0) + 1
    }
    return Object.entries(counts).map(([recipe_id, count]) => ({ recipe_id, count }))
  })
