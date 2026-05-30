import { createServerFn } from '@tanstack/react-start'
import { makeClient } from './client-server'
import type { DietaryMode, CookStyle } from '../../types/db'
import type { Profile, PublicProfile } from '../../types/db'
import type { MeasurementUnit } from '../detect-locale'

export const fetchMyProfile = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Profile | null> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  },
)

export const fetchProfileByUsername = createServerFn({ method: 'GET' })
  .inputValidator((username: string) => username)
  .handler(async ({ data: username }): Promise<PublicProfile | null> => {
    const supabase = makeClient()
    // Read from the public-safe view, not the base table — the base table's
    // RLS restricts SELECT to the user's own row, and email/dietary/flavor data
    // must never be exposed across users or to anon.
    const { data, error } = await supabase
      .from('public_profiles')
      .select('user_id, username, display_name, avatar_url, bio')
      .eq('username', username)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data as PublicProfile | null
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .inputValidator((input: { displayName: string; bio: string | null }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: data.displayName, bio: data.bio })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const saveMeasurementUnit = createServerFn({ method: 'POST' })
  .inputValidator((unit: MeasurementUnit) => unit)
  .handler(async ({ data: unit }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({ measurement_unit: unit })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const saveDietaryPreferences = createServerFn({ method: 'POST' })
  .inputValidator((input: { dietaryMode: DietaryMode; intolerances: string[] }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({ dietary_mode: data.dietaryMode, intolerances: data.intolerances })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const completeOnboarding = createServerFn({ method: 'POST' })
  .inputValidator((input: { measurementUnit: MeasurementUnit; dietaryMode: DietaryMode; intolerances: string[]; cookStyle: CookStyle | null; heatPreference: number | null }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({
        measurement_unit: data.measurementUnit,
        dietary_mode: data.dietaryMode,
        intolerances: data.intolerances,
        cook_style: data.cookStyle,
        // heat_preference not yet in generated types — cast required
        ...({ heat_preference: data.heatPreference } as object),
        onboarding_completed: true,
      })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const fetchIngredientExclusions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return []

    const { data } = await supabase
      .from('user_ingredient_exclusions')
      .select('ingredient_id')
      .eq('user_id', session.user.id)
    return (data ?? []).map(r => r.ingredient_id)
  },
)

export const upsertIngredientExclusion = createServerFn({ method: 'POST' })
  .inputValidator((ingredientId: string) => ingredientId)
  .handler(async ({ data: ingredientId }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('user_ingredient_exclusions')
      .upsert({ user_id: session.user.id, ingredient_id: ingredientId })
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const removeIngredientExclusion = createServerFn({ method: 'POST' })
  .inputValidator((ingredientId: string) => ingredientId)
  .handler(async ({ data: ingredientId }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('user_ingredient_exclusions')
      .delete()
      .eq('user_id', session.user.id)
      .eq('ingredient_id', ingredientId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const reportTagCorrection = createServerFn({ method: 'POST' })
  .inputValidator((input: { recipeId: string; tag: string }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('tag_correction_reports')
      .insert({ recipe_id: data.recipeId, tag: data.tag, reported_by: session.user.id })
    if (error) throw new Error(error.message)
    return { ok: true }
  })
