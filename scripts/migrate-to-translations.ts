/**
 * Migrates existing Portuguese recipe content into translation tables.
 * Run AFTER applying the 20260520000000_translation_tables.sql migration.
 * Safe to re-run — uses ON CONFLICT DO NOTHING.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

async function migrate() {
  console.log('Fetching all recipes...')
  const { data: recipes, error: recipeError } = await supabase
    .from('recipes')
    .select('id, name')

  if (recipeError) throw recipeError
  console.log(`Found ${recipes.length} recipes`)

  // Migrate recipe names
  const recipeTranslations = recipes.map((r) => ({
    recipe_id: r.id,
    language: 'pt',
    name: r.name,
  }))

  const { error: rtError } = await supabase
    .from('recipe_translations')
    .upsert(recipeTranslations, { onConflict: 'recipe_id,language', ignoreDuplicates: true })

  if (rtError) throw rtError
  console.log(`✓ Migrated ${recipeTranslations.length} recipe names → recipe_translations`)

  // Migrate ingredients
  console.log('Fetching all ingredients...')
  const { data: ingredients, error: ingError } = await supabase
    .from('recipe_ingredients')
    .select('id, name, unit, raw_text')

  if (ingError) throw ingError

  const ingTranslations = ingredients.map((i) => ({
    ingredient_id: i.id,
    language: 'pt',
    name: i.name,
    unit: i.unit,
    raw_text: i.raw_text,
  }))

  // Batch insert in chunks of 500
  for (let i = 0; i < ingTranslations.length; i += 500) {
    const chunk = ingTranslations.slice(i, i + 500)
    const { error } = await supabase
      .from('recipe_ingredient_translations')
      .upsert(chunk, { onConflict: 'ingredient_id,language', ignoreDuplicates: true })
    if (error) throw error
    console.log(`  ✓ Ingredients batch ${Math.floor(i / 500) + 1} (${chunk.length} rows)`)
  }
  console.log(`✓ Migrated ${ingTranslations.length} ingredients → recipe_ingredient_translations`)

  // Migrate steps
  console.log('Fetching all steps...')
  const { data: steps, error: stepError } = await supabase
    .from('recipe_steps')
    .select('id, text')

  if (stepError) throw stepError

  const stepTranslations = steps.map((s) => ({
    step_id: s.id,
    language: 'pt',
    text: s.text,
  }))

  for (let i = 0; i < stepTranslations.length; i += 500) {
    const chunk = stepTranslations.slice(i, i + 500)
    const { error } = await supabase
      .from('recipe_step_translations')
      .upsert(chunk, { onConflict: 'step_id,language', ignoreDuplicates: true })
    if (error) throw error
    console.log(`  ✓ Steps batch ${Math.floor(i / 500) + 1} (${chunk.length} rows)`)
  }
  console.log(`✓ Migrated ${stepTranslations.length} steps → recipe_step_translations`)

  console.log('\n✅ Migration complete. Run translate-recipes.ts next to generate English translations.')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
