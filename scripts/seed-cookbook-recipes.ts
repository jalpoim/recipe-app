/**
 * Seeds cookbook-recipes.json into Supabase as private recipes owned by you.
 * Then generates English translations for each recipe.
 *
 * Usage:
 *   npx tsx scripts/seed-cookbook-recipes.ts [--owner-id <uuid>]
 *
 * If --owner-id is not given, the script will print your user ID and ask you to re-run with it.
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 * Run import-cookbook-pdf.ts first to produce cookbook-recipes.json.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!

if (!url || !serviceKey || !anthropicKey) {
  console.error('Missing env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

const INPUT_PATH = path.resolve(process.cwd(), 'scripts/cookbook-recipes.json')

// Parse --owner-id flag
const ownerIdFlag = process.argv.indexOf('--owner-id')
const ownerId: string | null = ownerIdFlag !== -1 ? (process.argv[ownerIdFlag + 1] ?? null) : null

type ExtractedIngredient = {
  raw_text: string
  quantity: number | null
  unit: string | null
  name: string
  category: string
  is_pantry: boolean
}

type ExtractedRecipe = {
  name: string
  time_min: number
  servings: number
  calories: number
  protein: number
  carbs: number
  fat: number
  macros_total: boolean
  proteins: string[]
  tags: string[]
  ingredients: ExtractedIngredient[]
  steps: string[]
}

// ---- Translation ----------------------------------------------------------

type TranslationResponse = {
  name: string
  ingredients: Array<{ index: number; name: string | null; unit: string | null; raw_text: string }>
  steps: Array<{ index: number; text: string }>
}

async function translateRecipe(recipe: ExtractedRecipe, attempt = 1): Promise<TranslationResponse | null> {
  const payload = {
    name: recipe.name,
    ingredients: recipe.ingredients.map((i, idx) => ({ index: idx, name: i.name, unit: i.unit, raw_text: i.raw_text })),
    steps: recipe.steps.map((s, idx) => ({ index: idx, text: s })),
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Translate the following recipe from Portuguese to English. Return ONLY valid JSON matching this shape exactly:
{
  "name": "...",
  "ingredients": [{ "index": 0, "name": "...", "unit": "...", "raw_text": "..." }],
  "steps": [{ "index": 0, "text": "..." }]
}

Rules:
- Keep numeric values (quantities) unchanged
- Translate units naturally (colher sopa → tbsp, colher chá → tsp, etc.)
- "name" may be null if the ingredient has no clean English name
- Return all ingredients and steps with the same index values

Recipe:
${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    return JSON.parse(jsonMatch[0]) as TranslationResponse
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      return translateRecipe(recipe, attempt + 1)
    }
    console.warn(`  Translation failed after 3 attempts: ${(err as Error).message}`)
    return null
  }
}

// ---- Main -----------------------------------------------------------------

async function main() {
  // If no owner-id, list users and bail
  if (!ownerId) {
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 10 })
    console.log('\nUsers in your project:')
    for (const u of users?.users ?? []) {
      console.log(`  ${u.id}  ${u.email}`)
    }
    console.log('\nRe-run with:')
    console.log('  npx tsx scripts/seed-cookbook-recipes.ts --owner-id <your-uuid>')
    process.exit(0)
  }

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Not found: ${INPUT_PATH}`)
    console.error('Run import-cookbook-pdf.ts first.')
    process.exit(1)
  }

  const recipes: ExtractedRecipe[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'))
  console.log(`Loaded ${recipes.length} recipes from cookbook-recipes.json`)

  let inserted = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]
    process.stdout.write(`[${i + 1}/${recipes.length}] ${recipe.name}… `)

    // Skip if already exists for this owner
    const { data: existing } = await supabase
      .from('recipes')
      .select('id')
      .eq('owner_id', ownerId)
      .ilike('name', recipe.name)
      .maybeSingle()

    if (existing) {
      console.log('skipped (already exists)')
      skipped++
      continue
    }

    // Insert recipe
    const { data: newRecipe, error: recipeErr } = await supabase
      .from('recipes')
      .insert({
        owner_id: ownerId,
        visibility: 'private',
        name: recipe.name,
        time_min: recipe.time_min,
        servings: recipe.servings,
        calories: recipe.calories,
        protein: recipe.protein,
        carbs: recipe.carbs,
        fat: recipe.fat,
        macros_total: recipe.macros_total,
        macros_source: 'manual',
        proteins: recipe.proteins,
        tags: recipe.tags,
        user_tags: [],
      })
      .select('id')
      .single()

    if (recipeErr || !newRecipe) {
      console.log(`FAILED (recipe insert: ${recipeErr?.message})`)
      failed++
      continue
    }

    const recipeId = newRecipe.id

    // Insert ingredients
    if (recipe.ingredients.length > 0) {
      const { error: ingErr } = await supabase.from('recipe_ingredients').insert(
        recipe.ingredients.map((ing, idx) => ({
          recipe_id: recipeId,
          position: idx,
          raw_text: ing.raw_text,
          quantity: ing.quantity,
          unit: ing.unit,
          name: ing.name,
          category: ing.category,
          is_pantry: ing.is_pantry,
        })),
      )
      if (ingErr) console.warn(`  Ingredient insert warning: ${ingErr.message}`)
    }

    // Insert steps
    if (recipe.steps.length > 0) {
      const { error: stepErr } = await supabase.from('recipe_steps').insert(
        recipe.steps.map((text, idx) => ({
          recipe_id: recipeId,
          position: idx,
          text,
        })),
      )
      if (stepErr) console.warn(`  Step insert warning: ${stepErr.message}`)
    }

    // Insert Portuguese translation entry (source language)
    await supabase.from('recipe_translations').upsert({ recipe_id: recipeId, language: 'pt', name: recipe.name })

    // Translate to English
    const translation = await translateRecipe(recipe)
    if (translation) {
      await supabase
        .from('recipe_translations')
        .upsert({ recipe_id: recipeId, language: 'en', name: translation.name })

      // Fetch inserted ingredients to get their IDs
      const { data: ingRows } = await supabase
        .from('recipe_ingredients')
        .select('id, position')
        .eq('recipe_id', recipeId)
        .order('position')

      if (ingRows && translation.ingredients.length > 0) {
        for (const t of translation.ingredients) {
          const ing = ingRows[t.index]
          if (!ing) continue
          await supabase.from('recipe_ingredient_translations').upsert({
            ingredient_id: ing.id,
            language: 'en',
            name: t.name,
            unit: t.unit,
            raw_text: t.raw_text,
          })
        }
      }

      // Fetch inserted steps to get their IDs
      const { data: stepRows } = await supabase
        .from('recipe_steps')
        .select('id, position')
        .eq('recipe_id', recipeId)
        .order('position')

      if (stepRows && translation.steps.length > 0) {
        for (const t of translation.steps) {
          const step = stepRows[t.index]
          if (!step) continue
          await supabase.from('recipe_step_translations').upsert({
            step_id: step.id,
            language: 'en',
            text: t.text,
          })
        }
      }
    }

    console.log('done')
    inserted++
  }

  console.log(`\nFinished: ${inserted} inserted, ${skipped} skipped, ${failed} failed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
