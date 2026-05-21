/**
 * Seeds recipes.json into Supabase as private recipes owned by a specific user.
 * These come from paid cookbooks — visibility is 'private', NOT 'system'.
 *
 * Required env vars:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — bypasses RLS
 *   SEED_USER_ID                — UUID of the Supabase auth user who will own these recipes
 *
 * Usage:
 *   pnpm dlx dotenv-cli -e .env.local -- npx tsx scripts/seed-recipes.ts
 *
 * The SEED_USER_ID and SUPABASE_SERVICE_ROLE_KEY must be in .env.local or passed directly.
 * The script is idempotent: recipes with the same name owned by SEED_USER_ID are skipped.
 * The script refuses to run if NODE_ENV=production.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/db'
import recipes from './recipes.json'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run seed script in production.')
  process.exit(1)
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

const url = requireEnv('VITE_SUPABASE_URL')
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const userId = requireEnv('SEED_USER_ID')

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false },
})

type RecipeJson = {
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  time_min: number
  servings: number
  proteins: string[]
  tags: string[]
  ingredients: {
    raw_text: string
    quantity: number | null
    unit: string | null
    name: string | null
    category: string | null
    is_pantry: boolean
  }[]
  steps: string[]
}

async function seed() {
  const data = recipes as RecipeJson[]

  // Fetch existing recipe names owned by this user to skip duplicates
  const { data: existing, error: fetchErr } = await supabase
    .from('recipes')
    .select('name')
    .eq('owner_id', userId)
    .eq('visibility', 'private')

  if (fetchErr) {
    console.error('Failed to fetch existing recipes:', fetchErr.message)
    process.exit(1)
  }

  const existingNames = new Set((existing ?? []).map((r) => r.name))

  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const recipe of data) {
    if (existingNames.has(recipe.name)) {
      console.log(`  SKIP  ${recipe.name}`)
      skipped++
      continue
    }

    // Insert the recipe row
    const { data: inserted_recipe, error: recipeErr } = await supabase
      .from('recipes')
      .insert({
        owner_id: userId,
        visibility: 'private',
        name: recipe.name,
        time_min: recipe.time_min,
        servings: recipe.servings,
        macros_total: true,
        calories: recipe.calories,
        protein: recipe.protein,
        carbs: recipe.carbs,
        fat: recipe.fat,
        macros_source: 'manual',
        proteins: recipe.proteins,
        tags: recipe.tags,
      })
      .select('id')
      .single()

    if (recipeErr || !inserted_recipe) {
      console.error(`  FAIL  ${recipe.name}: ${recipeErr?.message}`)
      failed++
      continue
    }

    const recipeId = inserted_recipe.id

    // Insert ingredients
    if (recipe.ingredients.length > 0) {
      const { error: ingErr } = await supabase.from('recipe_ingredients').insert(
        recipe.ingredients.map((ing, i) => ({
          recipe_id: recipeId,
          position: i,
          raw_text: ing.raw_text,
          quantity: ing.quantity,
          unit: ing.unit,
          name: ing.name,
          category: ing.category,
          is_pantry: ing.is_pantry,
        })),
      )

      if (ingErr) {
        console.error(`  FAIL  ${recipe.name} (ingredients): ${ingErr.message}`)
        // Recipe was already inserted — note it but continue
        failed++
        continue
      }
    }

    // Insert steps
    if (recipe.steps.length > 0) {
      const { error: stepsErr } = await supabase.from('recipe_steps').insert(
        recipe.steps.map((text, i) => ({
          recipe_id: recipeId,
          position: i,
          text,
        })),
      )

      if (stepsErr) {
        console.error(`  FAIL  ${recipe.name} (steps): ${stepsErr.message}`)
        failed++
        continue
      }
    }

    console.log(`  OK    ${recipe.name}  (${recipe.ingredients.length} ingredients, ${recipe.steps.length} steps)`)
    inserted++
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped, ${failed} failed.`)

  if (failed > 0) process.exit(1)
}

seed()
