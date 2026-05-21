import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database, UserRecipeInteraction } from '../../types/db'
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

// POST: upsert an interaction (like, save, or hide)
export const upsertInteraction = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; type: 'like' | 'save' | 'hide' }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { error } = await supabase.from('user_recipe_interactions').upsert(
      {
        user_id: user.id,
        recipe_id: data.recipeId,
        type: data.type,
      },
      { onConflict: 'user_id,recipe_id,type' },
    )
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// POST: remove an interaction
export const removeInteraction = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; type: 'like' | 'save' | 'hide' }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('user_recipe_interactions')
      .delete()
      .eq('user_id', user.id)
      .eq('recipe_id', data.recipeId)
      .eq('type', data.type)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// GET: fetch all interactions for current user
export const fetchInteractions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UserRecipeInteraction[]> => {
    const supabase = makeClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('user_recipe_interactions')
      .select('*')
      .eq('user_id', user.id)
    if (error) throw new Error(error.message)
    return data ?? []
  },
)
