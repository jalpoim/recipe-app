import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import type { Recipe, RecipeIngredient, RecipeStep } from '../../types/db'

// Local types for translation query results (tables created by migration 20260520000000)
type RecipeTrans = { recipe_id: string; name: string }
type IngTrans = { ingredient_id: string; name: string | null; unit: string | null; raw_text: string }
type StepTrans = { step_id: string; text: string }

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
    }
  )
}

function getLang(): string {
  const cookies = getCookies()
  const lang = cookies['i18n_lang'] ?? 'pt'
  return ['pt', 'en'].includes(lang) ? lang : 'pt'
}

export type RecipeWithIngredients = Recipe & {
  recipe_ingredients: RecipeIngredient[]
}

export type RecipeDetail = Recipe & {
  recipe_ingredients: RecipeIngredient[]
  recipe_steps: RecipeStep[]
}

export const fetchLibrary = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = makeClient()
  const lang = getLang()

  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .order('name')
  if (error) throw new Error(error.message)

  const recipes = (data ?? []) as RecipeWithIngredients[]

  if (lang === 'pt') return recipes

  // Fetch recipe name translations
  const recipeIds = recipes.map((r) => r.id)
  const { data: recipeTrans } = await supabase
    .from('recipe_translations')
    .select('recipe_id, name')
    .in('recipe_id', recipeIds)
    .eq('language', lang) as unknown as { data: RecipeTrans[] | null }

  const recipeTransMap = new Map(recipeTrans?.map((t) => [t.recipe_id, t.name]) ?? [])

  // Fetch ingredient translations
  const ingIds = recipes.flatMap((r) => r.recipe_ingredients.map((i) => i.id))
  const { data: ingTrans } = await supabase
    .from('recipe_ingredient_translations')
    .select('ingredient_id, name, unit, raw_text')
    .in('ingredient_id', ingIds)
    .eq('language', lang) as unknown as { data: IngTrans[] | null }

  const ingTransMap = new Map(ingTrans?.map((t) => [t.ingredient_id, t]) ?? [])

  return recipes.map((r) => ({
    ...r,
    name: recipeTransMap.get(r.id) ?? r.name,
    recipe_ingredients: r.recipe_ingredients.map((ing) => {
      const t = ingTransMap.get(ing.id)
      return t ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text } : ing
    }),
  })) as RecipeWithIngredients[]
})

export const fetchRecipeById = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = makeClient()
    const lang = getLang()

    const { data, error } = await supabase
      .from('recipes')
      .select('*, recipe_ingredients(*), recipe_steps(*)')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)

    const recipe = data as RecipeDetail
    recipe.recipe_ingredients.sort((a, b) => a.position - b.position)
    recipe.recipe_steps.sort((a, b) => a.position - b.position)

    if (lang === 'pt') return recipe

    // Fetch translations in parallel
    const ingIds = recipe.recipe_ingredients.map((i) => i.id)
    const stepIds = recipe.recipe_steps.map((s) => s.id)

    const [{ data: recipeTrans }, { data: ingTrans }, { data: stepTrans }] = await Promise.all([
      supabase
        .from('recipe_translations')
        .select('name')
        .eq('recipe_id', id)
        .eq('language', lang)
        .maybeSingle() as unknown as Promise<{ data: Pick<RecipeTrans, 'name'> | null }>,
      supabase
        .from('recipe_ingredient_translations')
        .select('ingredient_id, name, unit, raw_text')
        .in('ingredient_id', ingIds)
        .eq('language', lang) as unknown as Promise<{ data: IngTrans[] | null }>,
      supabase
        .from('recipe_step_translations')
        .select('step_id, text')
        .in('step_id', stepIds)
        .eq('language', lang) as unknown as Promise<{ data: StepTrans[] | null }>,
    ])

    const ingTransMap = new Map(ingTrans?.map((t) => [t.ingredient_id, t]) ?? [])
    const stepTransMap = new Map(stepTrans?.map((t) => [t.step_id, t.text]) ?? [])

    return {
      ...recipe,
      name: recipeTrans?.name ?? recipe.name,
      recipe_ingredients: recipe.recipe_ingredients.map((ing) => {
        const t = ingTransMap.get(ing.id)
        return t ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text } : ing
      }),
      recipe_steps: recipe.recipe_steps.map((step) => ({
        ...step,
        text: stepTransMap.get(step.id) ?? step.text,
      })),
    } as RecipeDetail
  })
