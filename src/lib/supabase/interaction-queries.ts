import { createServerFn } from '@tanstack/react-start'
import type { UserRecipeInteraction } from '../../types/db'
import { makeClient } from './client-server'

// POST: upsert an interaction (like, save, or hide)
export const upsertInteraction = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; type: 'like' | 'save' | 'hide' }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const user = session.user

    // Check if this is a new interaction (to avoid double-awarding on re-save)
    const { data: existing } = await supabase
      .from('user_recipe_interactions')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('recipe_id', data.recipeId)
      .eq('type', data.type)
      .maybeSingle()

    const { error } = await supabase.from('user_recipe_interactions').upsert(
      { user_id: user.id, recipe_id: data.recipeId, type: data.type },
      { onConflict: 'user_id,recipe_id,type' },
    )
    if (error) throw new Error(error.message)

    // Award +5 creator points when another user saves a recipe for the first time
    if (!existing && data.type === 'save') {
      void (async () => {
        const { data: recipe } = await supabase
          .from('recipes')
          .select('owner_id')
          .eq('id', data.recipeId)
          .maybeSingle()
        if (recipe?.owner_id && recipe.owner_id !== user.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc('increment_creator_points', { p_user_id: recipe.owner_id, p_points: 5 })
        }
      })().catch(() => {})
    }

    return { ok: true }
  })

// POST: remove an interaction
export const removeInteraction = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; type: 'like' | 'save' | 'hide' }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const user = session.user

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
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return []
    const user = session.user

    const { data, error } = await supabase
      .from('user_recipe_interactions')
      .select('*')
      .eq('user_id', user.id)
    if (error) throw new Error(error.message)
    return data ?? []
  },
)
