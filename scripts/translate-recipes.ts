/**
 * Translates all Portuguese recipe content to English using the Claude API.
 * Run AFTER migrate-to-translations.ts.
 * Safe to re-run — skips recipes that already have an 'en' translation.
 *
 * Usage: npx tsx scripts/translate-recipes.ts
 * Requires: ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!

if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
  console.error('Missing env vars. Need: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})
const anthropic = new Anthropic({ apiKey: anthropicKey })

type IngRow = { id: string; name: string | null; unit: string | null; raw_text: string }
type StepRow = { id: string; text: string }

type TranslationResponse = {
  name: string
  ingredients: Array<{ id: string; name: string | null; unit: string | null; raw_text: string }>
  steps: Array<{ id: string; text: string }>
}

async function translateRecipe(
  recipeId: string,
  recipeName: string,
  ingredients: IngRow[],
  steps: StepRow[],
  attempt = 1
): Promise<TranslationResponse | null> {
  const payload = {
    name: recipeName,
    ingredients: ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, raw_text: i.raw_text })),
    steps: steps.map((s) => ({ id: s.id, text: s.text })),
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Translate the following Portuguese recipe content to English. Return ONLY a valid JSON object with no extra text or markdown, matching this exact structure:
{
  "name": "<translated recipe name>",
  "ingredients": [{ "id": "<keep same id>", "name": "<translated name or null>", "unit": "<translated unit or null>", "raw_text": "<full translated ingredient line>" }],
  "steps": [{ "id": "<keep same id>", "text": "<translated step text>" }]
}

Rules:
- Keep all IDs unchanged
- Keep measurements and quantities unchanged (e.g. 200g stays 200g)
- Keep proper nouns and brand names unchanged
- Translate ingredient units to English (g→g, ml→ml, colher de sopa→tbsp, colher de chá→tsp, xícara→cup)
- Return null for name/unit if the original is null
- Recipe name: keep the original name if the dish is internationally recognized by that name (e.g. Kimchi Jeon, Bibimbap, Pad Thai, Bulgogi, Shakshuka). For regional dishes unknown outside their country, provide a descriptive English name.
- Recipe name: strip any internal developer labels like "(PT)", "(EN)", "(BR)" from the translated name — these are data annotations, not part of the dish name.
- Recipe name: avoid awkward word order. Prefer "Alentejo-Style Pork" over "Pork Alentejo Style". Modifiers go before nouns in English.
- Recipe name: use "Light" instead of "Fit" or "Fit version" — "Fit" is not natural English in this context.

Recipe to translate:
${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    return JSON.parse(jsonMatch[0]) as TranslationResponse
  } catch (err) {
    if (attempt < 2) {
      console.warn(`  Retry ${recipeId}...`)
      await new Promise((r) => setTimeout(r, 2000))
      return translateRecipe(recipeId, recipeName, ingredients, steps, 2)
    }
    console.error(`  Failed to translate ${recipeName}:`, err)
    return null
  }
}

async function main() {
  // Fetch all recipes
  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('id, name')
  if (rErr) throw rErr

  // Find which already have English translations
  const { data: existing, error: eErr } = await supabase
    .from('recipe_translations')
    .select('recipe_id')
    .eq('language', 'en')
  if (eErr) throw eErr

  const existingIds = new Set(existing?.map((r) => r.recipe_id) ?? [])
  const toTranslate = recipes.filter((r) => !existingIds.has(r.id))

  console.log(`${recipes.length} recipes total, ${existingIds.size} already translated, ${toTranslate.length} to do`)

  if (toTranslate.length === 0) {
    console.log('✅ All recipes already translated.')
    return
  }

  // Fetch all ingredients and steps for untranslated recipes
  const recipeIds = toTranslate.map((r) => r.id)

  const { data: allIngs, error: ingErr } = await supabase
    .from('recipe_ingredients')
    .select('id, recipe_id, name, unit, raw_text')
    .in('recipe_id', recipeIds)
  if (ingErr) throw ingErr

  const { data: allSteps, error: stepErr } = await supabase
    .from('recipe_steps')
    .select('id, recipe_id, text')
    .in('recipe_id', recipeIds)
  if (stepErr) throw stepErr

  const ingByRecipe = new Map<string, IngRow[]>()
  const stepsByRecipe = new Map<string, StepRow[]>()

  for (const ing of allIngs ?? []) {
    const arr = ingByRecipe.get(ing.recipe_id) ?? []
    arr.push(ing)
    ingByRecipe.set(ing.recipe_id, arr)
  }
  for (const step of allSteps ?? []) {
    const arr = stepsByRecipe.get(step.recipe_id) ?? []
    arr.push(step)
    stepsByRecipe.set(step.recipe_id, arr)
  }

  // Process in batches of 5
  const BATCH = 5
  let success = 0
  let failed = 0

  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH)
    console.log(`\nBatch ${Math.floor(i / BATCH) + 1}/${Math.ceil(toTranslate.length / BATCH)}`)

    await Promise.all(
      batch.map(async (recipe) => {
        const ings = ingByRecipe.get(recipe.id) ?? []
        const steps = stepsByRecipe.get(recipe.id) ?? []

        console.log(`  Translating: ${recipe.name}`)
        const result = await translateRecipe(recipe.id, recipe.name, ings, steps)

        if (!result) {
          failed++
          return
        }

        // Insert recipe name translation
        const { error: rtErr } = await supabase
          .from('recipe_translations')
          .upsert({ recipe_id: recipe.id, language: 'en', name: result.name }, { onConflict: 'recipe_id,language' })
        if (rtErr) { console.error(`  DB error (recipe name):`, rtErr); failed++; return }

        // Insert ingredient translations
        const ingRows = result.ingredients.map((ing) => ({
          ingredient_id: ing.id,
          language: 'en',
          name: ing.name,
          unit: ing.unit,
          raw_text: ing.raw_text,
        }))
        if (ingRows.length > 0) {
          const { error: itErr } = await supabase
            .from('recipe_ingredient_translations')
            .upsert(ingRows, { onConflict: 'ingredient_id,language' })
          if (itErr) { console.error(`  DB error (ingredients):`, itErr); failed++; return }
        }

        // Insert step translations
        const stepRows = result.steps.map((s) => ({
          step_id: s.id,
          language: 'en',
          text: s.text,
        }))
        if (stepRows.length > 0) {
          const { error: stErr } = await supabase
            .from('recipe_step_translations')
            .upsert(stepRows, { onConflict: 'step_id,language' })
          if (stErr) { console.error(`  DB error (steps):`, stErr); failed++; return }
        }

        console.log(`  ✓ ${recipe.name} → ${result.name}`)
        success++
      })
    )

    // Small pause between batches to be polite to the API
    if (i + BATCH < toTranslate.length) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  console.log(`\n✅ Done. ${success} translated, ${failed} failed.`)
  if (failed > 0) console.log('Re-run the script to retry failed recipes.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
