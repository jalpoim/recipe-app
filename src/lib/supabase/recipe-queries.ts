import { createServerFn } from '@tanstack/react-start'
import { makeClient } from './client-server'
import type { RecipeIngredientInsert, RecipeStepInsert } from '../../types/db'

export type IngredientRow = {
  position: number
  rawText: string
  quantity: number | null
  unit: string | null
  name: string | null
  isOptional: boolean
}

export type StepRow = {
  position: number
  text: string
  timerSeconds: number | null
}

export type CreateRecipeInput = {
  name: string
  servings: number
  timeMin: number | null
  proteins: string[]
  tags: string[]
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  visibility: 'private' | 'public'
  ingredients: IngredientRow[]
  steps: StepRow[]
  lang: string
}

export type UpdateRecipeInput = CreateRecipeInput & { recipeId: string }

export const createRecipe = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateRecipeInput) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const hasMacros = data.calories != null || data.protein != null
    const modStatus = data.visibility === 'public' ? 'pending_review' : 'approved'

    const { data: recipe, error } = await supabase
      .from('recipes')
      .insert({
        name: data.name,
        servings: data.servings,
        time_min: data.timeMin,
        proteins: data.proteins,
        tags: data.tags,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        macros_total: hasMacros,
        macros_source: hasMacros ? 'manual' : null,
        visibility: data.visibility,
        moderation_status: modStatus,
        owner_id: session.user.id,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    const recipeId = recipe.id

    // Insert ingredients
    if (data.ingredients.length > 0) {
      const ingRows: RecipeIngredientInsert[] = data.ingredients.map((ing) => ({
        recipe_id: recipeId,
        position: ing.position,
        raw_text: ing.rawText,
        quantity: ing.quantity,
        unit: ing.unit,
        name: ing.name,
        is_optional: ing.isOptional,
      }))
      const { error: ingErr } = await supabase.from('recipe_ingredients').insert(ingRows)
      if (ingErr) throw new Error(ingErr.message)
    }

    // Insert steps
    if (data.steps.length > 0) {
      const stepRows: RecipeStepInsert[] = data.steps.map((s) => ({
        recipe_id: recipeId,
        position: s.position,
        text: s.text,
        timer_seconds: s.timerSeconds,
      }))
      const { error: stepErr } = await supabase.from('recipe_steps').insert(stepRows)
      if (stepErr) throw new Error(stepErr.message)
    }

    // Insert translations if not PT
    if (data.lang !== 'pt') {
      await supabase.from('recipe_translations').insert({ recipe_id: recipeId, language: data.lang, name: data.name })
    }

    return { id: recipeId }
  })

export const updateRecipe = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateRecipeInput) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const hasMacros = data.calories != null || data.protein != null
    const modStatus = data.visibility === 'public' ? 'pending_review' : 'approved'

    const { error } = await supabase
      .from('recipes')
      .update({
        name: data.name,
        servings: data.servings,
        time_min: data.timeMin,
        proteins: data.proteins,
        tags: data.tags,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        macros_total: hasMacros,
        macros_source: hasMacros ? 'manual' : null,
        visibility: data.visibility,
        moderation_status: modStatus,
      })
      .eq('id', data.recipeId)
      .eq('owner_id', session.user.id)
    if (error) throw new Error(error.message)

    // Replace ingredients + steps
    await supabase.from('recipe_ingredients').delete().eq('recipe_id', data.recipeId)
    await supabase.from('recipe_steps').delete().eq('recipe_id', data.recipeId)

    if (data.ingredients.length > 0) {
      await supabase.from('recipe_ingredients').insert(
        data.ingredients.map((ing) => ({
          recipe_id: data.recipeId,
          position: ing.position,
          raw_text: ing.rawText,
          quantity: ing.quantity,
          unit: ing.unit,
          name: ing.name,
          is_optional: ing.isOptional,
        }))
      )
    }

    if (data.steps.length > 0) {
      await supabase.from('recipe_steps').insert(
        data.steps.map((s) => ({
          recipe_id: data.recipeId,
          position: s.position,
          text: s.text,
          timer_seconds: s.timerSeconds,
        }))
      )
    }

    return { id: data.recipeId }
  })

export const deleteRecipe = createServerFn({ method: 'POST' })
  .inputValidator((recipeId: string) => recipeId)
  .handler(async ({ data: recipeId }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('recipes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', recipeId)
      .eq('owner_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const searchIngredients = createServerFn({ method: 'GET' })
  .inputValidator((q: string) => q)
  .handler(async ({ data: q }) => {
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, default_unit, category')
      .ilike('name', `%${q}%`)
      .limit(8)
    if (error) throw new Error(error.message)
    return data ?? []
  })
