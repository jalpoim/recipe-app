import { createServerFn } from '@tanstack/react-start'
import type { Recipe, RecipeIngredient, RecipeStep } from '../../types/db'
import { getCookies } from '@tanstack/react-start/server'
import { makeClient } from './client-server'

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

export type Sort = 'pcal' | 'protein' | 'calories' | 'time'

export type LibraryCursor = { value: number | null; id: string }

export type FetchLibraryInput = {
  limit: number
  cursor: LibraryCursor | null
  sort: Sort
  proteins: string[]
  maxCal: number | undefined
  maxTime: number | undefined
  tags: string[]
  ingredients: string[]
  q: string
}

export type FetchLibraryResult = {
  data: RecipeWithIngredients[]
  nextCursor: LibraryCursor | null
}

const RECIPE_FIELDS =
  'id, name, time_min, servings, macros_total, calories, protein, carbs, fat, proteins, tags, pcal_ratio, owner_id, visibility'

const INGREDIENT_FIELDS = 'id, recipe_id, name, raw_text, unit, position, is_pantry, is_optional, section_label'

const SORT_COL: Record<Sort, string> = {
  pcal: 'pcal_ratio',
  protein: 'protein',
  calories: 'calories',
  time: 'time_min',
}

// true = ascending, false = descending
const SORT_ASC: Record<Sort, boolean> = {
  pcal: false,
  protein: false,
  calories: true,
  time: true,
}

export const fetchLibrary = createServerFn({ method: 'GET' })
  .inputValidator((input: FetchLibraryInput) => input)
  .handler(async ({ data: input }): Promise<FetchLibraryResult> => {
    const supabase = makeClient()
    const lang = getLang()

    const { limit, cursor, sort, proteins, maxCal, maxTime, tags, ingredients, q } = input
    const sortCol = SORT_COL[sort]
    const ascending = SORT_ASC[sort]

    let query = supabase
      .from('recipes')
      .select(`${RECIPE_FIELDS}, recipe_ingredients(${INGREDIENT_FIELDS})`)

    // --- Server-side filters ---
    if (q) query = query.ilike('name', `%${q}%`)
    if (proteins.length > 0) query = query.overlaps('proteins', proteins)
    if (tags.length > 0) query = query.contains('tags', tags)
    if (maxCal !== undefined) query = query.lte('calories', maxCal)
    if (maxTime !== undefined) query = query.lte('time_min', maxTime)

    // --- Cursor WHERE clause ---
    if (cursor) {
      if (cursor.value === null) {
        // We're in the null section — sort field is null, paginate by id only
        query = query.is(sortCol, null).gt('id', cursor.id)
      } else if (ascending) {
        // ASC: next page = (col > val) OR (col = val AND id > lastId)
        query = query.or(
          `${sortCol}.gt.${cursor.value},and(${sortCol}.eq.${cursor.value},id.gt.${cursor.id})`,
        )
      } else {
        // DESC: next page = (col < val) OR (col = val AND id > lastId)
        query = query.or(
          `${sortCol}.lt.${cursor.value},and(${sortCol}.eq.${cursor.value},id.gt.${cursor.id})`,
        )
      }
    }

    // --- Order + limit ---
    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(limit)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    let recipes = (data ?? []) as unknown as RecipeWithIngredients[]

    // --- Client-side ingredient filter (post-fetch, small set) ---
    if (ingredients.length > 0) {
      recipes = recipes.filter((r) =>
        ingredients.every((ing) =>
          r.recipe_ingredients.some((ri) =>
            (ri.name ?? ri.raw_text ?? '').toLowerCase().includes(ing.toLowerCase()),
          ),
        ),
      )
    }

    // --- Translations ---
    if (lang !== 'pt' && recipes.length > 0) {
      const recipeIds = recipes.map((r) => r.id)
      const ingIds = recipes.flatMap((r) => r.recipe_ingredients.map((i) => i.id))

      const [recipeTransResult, ingTransResult] = await Promise.all([
        supabase
          .from('recipe_translations')
          .select('recipe_id, name')
          .in('recipe_id', recipeIds)
          .eq('language', lang),
        supabase
          .from('recipe_ingredient_translations')
          .select('ingredient_id, name, unit, raw_text')
          .in('ingredient_id', ingIds)
          .eq('language', lang),
      ])

      const recipeTransMap = new Map(
        recipeTransResult.data?.map((t) => [t.recipe_id, t.name]) ?? [],
      )
      const ingTransMap = new Map(ingTransResult.data?.map((t) => [t.ingredient_id, t]) ?? [])

      recipes = recipes.map((r) => ({
        ...r,
        name: recipeTransMap.get(r.id) ?? r.name,
        recipe_ingredients: r.recipe_ingredients.map((ing) => {
          const t = ingTransMap.get(ing.id)
          return t ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text } : ing
        }),
      })) as RecipeWithIngredients[]
    }

    // --- Next cursor ---
    const last = recipes[recipes.length - 1]
    const nextCursor: LibraryCursor | null =
      recipes.length < limit
        ? null
        : {
            value: last ? ((last as unknown as Record<string, number | null>)[sortCol] ?? null) : null,
            id: last?.id ?? '',
          }

    return { data: recipes, nextCursor }
  })

// GET: distinct proteins, tags, ingredient names — always from DB, never hardcoded
export const fetchLibraryMeta = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ proteins: string[]; tags: string[]; ingredients: string[] }> => {
    const supabase = makeClient()
    const { data, error } = await supabase.rpc('get_library_meta')
    if (error) throw new Error(error.message)
    return data as { proteins: string[]; tags: string[]; ingredients: string[] }
  },
)

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

    const recipe = data as unknown as RecipeDetail
    recipe.recipe_ingredients.sort((a, b) => a.position - b.position)
    recipe.recipe_steps.sort((a, b) => a.position - b.position)

    if (lang === 'pt') return recipe

    // Fetch translations in parallel
    const ingIds = recipe.recipe_ingredients.map((i) => i.id)
    const stepIds = recipe.recipe_steps.map((s) => s.id)

    const [recipeTransResult, ingTransResult, stepTransResult] = await Promise.all([
      supabase
        .from('recipe_translations')
        .select('name')
        .eq('recipe_id', id)
        .eq('language', lang)
        .maybeSingle(),
      supabase
        .from('recipe_ingredient_translations')
        .select('ingredient_id, name, unit, raw_text, section_label')
        .in('ingredient_id', ingIds)
        .eq('language', lang),
      supabase
        .from('recipe_step_translations')
        .select('step_id, text')
        .in('step_id', stepIds)
        .eq('language', lang),
    ])

    const recipeTrans = recipeTransResult.data
    const ingTrans = ingTransResult.data
    const stepTrans = stepTransResult.data

    const ingTransMap = new Map(ingTrans?.map((t) => [t.ingredient_id, t]) ?? [])
    const stepTransMap = new Map(stepTrans?.map((t) => [t.step_id, t.text]) ?? [])

    return {
      ...recipe,
      name: recipeTrans?.name ?? recipe.name,
      recipe_ingredients: recipe.recipe_ingredients.map((ing) => {
        const t = ingTransMap.get(ing.id)
        return t ? { ...ing, name: t.name, unit: t.unit, raw_text: t.raw_text, section_label: t.section_label ?? ing.section_label } : ing
      }),
      recipe_steps: recipe.recipe_steps.map((step) => ({
        ...step,
        text: stepTransMap.get(step.id) ?? step.text,
      })),
    } as RecipeDetail
  })
