/**
 * Seeds system-recipes.json into Supabase as system recipes (visibility = 'system', owner_id = null).
 * These are shown to all users as the starter library.
 * Safe to re-run — skips recipes with the same name that already exist as system recipes.
 *
 * Usage:
 *   npx tsx scripts/seed-system-recipes.ts
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Run generate-system-recipes.ts first to produce system-recipes.json.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const INPUT_PATH = path.resolve(process.cwd(), 'scripts/system-recipes.json')

if (!fs.existsSync(INPUT_PATH)) {
  console.error(`system-recipes.json not found. Run generate-system-recipes.ts first.`)
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
})

type GeneratedIngredient = {
  raw_text: string
  quantity: number | null
  unit: string | null
  name: string
  category: string
  is_pantry: boolean
}

type GeneratedRecipe = {
  name: string
  time_min: number
  servings: number
  calories: number
  protein: number
  carbs: number
  fat: number
  proteins: string[]
  tags: string[]
  ingredients: GeneratedIngredient[]
  steps: string[]
}

async function seed() {
  const recipes = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8')) as GeneratedRecipe[]
  console.log(`Found ${recipes.length} recipes in system-recipes.json\n`)

  // Fetch existing system recipe names to skip duplicates
  const { data: existing, error: fetchErr } = await supabase
    .from('recipes')
    .select('name')
    .eq('visibility', 'system')
    .is('owner_id', null)

  if (fetchErr) {
    console.error('Failed to fetch existing system recipes:', fetchErr.message)
    process.exit(1)
  }

  const existingNames = new Set((existing ?? []).map((r) => r.name))

  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const recipe of recipes) {
    if (existingNames.has(recipe.name)) {
      console.log(`  SKIP  ${recipe.name}`)
      skipped++
      continue
    }

    // Insert recipe row
    const { data: row, error: recipeErr } = await supabase
      .from('recipes')
      .insert({
        owner_id: null,
        visibility: 'system',
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

    if (recipeErr || !row) {
      console.error(`  FAIL  ${recipe.name}: ${recipeErr?.message}`)
      failed++
      continue
    }

    const recipeId = row.id

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

    console.log(`  OK    ${recipe.name}  (${recipe.ingredients.length} ing, ${recipe.steps.length} steps)`)
    inserted++
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped, ${failed} failed.`)

  if (inserted > 0) {
    console.log('\nNext: run translate-recipes.ts to generate English translations for the new recipes.')
  }

  if (failed > 0) process.exit(1)
}

seed().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
