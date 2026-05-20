/**
 * Refines one or more recipes in system-recipes.json using Claude Haiku.
 * Much cheaper than full regeneration — only sends the targeted recipe(s).
 * Updates the JSON in place. Re-run seed-system-recipes.ts after to apply to DB.
 *
 * Usage:
 *   # Refine a specific recipe by name
 *   npx tsx scripts/refine-system-recipes.ts --recipe "Frango Tikka Masala Fit" --instruction "reduce carbs to under 30g per serving and simplify the steps"
 *
 *   # Refine all recipes matching a pattern
 *   npx tsx scripts/refine-system-recipes.ts --match "frango" --instruction "make steps more concise, max 5 steps"
 *
 *   # Refine all recipes (use sparingly — runs one API call per recipe)
 *   npx tsx scripts/refine-system-recipes.ts --all --instruction "ensure every step has exact quantities, no vague amounts"
 *
 * Requires: ANTHROPIC_API_KEY in .env.local
 * system-recipes.json must exist (run generate-system-recipes.ts first).
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const anthropicKey = process.env.ANTHROPIC_API_KEY
if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local')
  process.exit(1)
}

const anthropic = new Anthropic({ apiKey: anthropicKey })

const JSON_PATH = path.resolve(process.cwd(), 'scripts/system-recipes.json')

if (!fs.existsSync(JSON_PATH)) {
  console.error('system-recipes.json not found. Run generate-system-recipes.ts first.')
  process.exit(1)
}

// ---- CLI args -------------------------------------------------------------

const args = process.argv.slice(2)

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null
}

const recipeName = getArg('--recipe')
const matchPattern = getArg('--match')
const instruction = getArg('--instruction')
const refineAll = args.includes('--all')

if (!instruction) {
  console.error('--instruction is required. Describe what to change.')
  console.error('Example: --recipe "Frango Tikka Masala Fit" --instruction "reduce carbs to 25g per serving"')
  process.exit(1)
}

if (!recipeName && !matchPattern && !refineAll) {
  console.error('Specify --recipe <name>, --match <pattern>, or --all')
  process.exit(1)
}

// ---- Types ----------------------------------------------------------------

type GeneratedRecipe = {
  name: string
  cuisine?: string
  time_min: number
  servings: number
  calories: number
  protein: number
  carbs: number
  fat: number
  proteins: string[]
  tags: string[]
  ingredients: {
    raw_text: string
    quantity: number | null
    unit: string | null
    name: string
    category: string
    is_pantry: boolean
  }[]
  steps: string[]
}

// ---- Tool schema ----------------------------------------------------------

const REFINE_TOOL: Anthropic.Tool = {
  name: 'submit_refined_recipe',
  description: 'Submit the refined recipe.',
  input_schema: {
    type: 'object' as const,
    required: ['recipe'],
    properties: {
      recipe: {
        type: 'object',
        required: ['name', 'time_min', 'servings', 'calories', 'protein', 'carbs', 'fat', 'proteins', 'tags', 'ingredients', 'steps'],
        properties: {
          name: { type: 'string' },
          time_min: { type: 'number' },
          servings: { type: 'number' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          proteins: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              required: ['raw_text', 'quantity', 'unit', 'name', 'category', 'is_pantry'],
              properties: {
                raw_text: { type: 'string' },
                quantity: { type: ['number', 'null'] },
                unit: { type: ['string', 'null'] },
                name: { type: 'string' },
                category: { type: 'string', enum: ['Talho/Peixaria', 'Frutas/Legumes', 'Lacticínios', 'Mercearia', 'Outros'] },
                is_pantry: { type: 'boolean' },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// ---- Validation -----------------------------------------------------------

function validateMacros(r: GeneratedRecipe): string | null {
  const computed = r.protein * 4 + r.carbs * 4 + r.fat * 9
  const deviation = Math.abs(computed - r.calories) / r.calories
  if (deviation > 0.20) {
    return `Macro mismatch: computed ${Math.round(computed)} kcal vs stated ${r.calories} kcal (${Math.round(deviation * 100)}% off)`
  }
  return null
}

// ---- Refinement -----------------------------------------------------------

async function refineRecipe(recipe: GeneratedRecipe, instruction: string): Promise<GeneratedRecipe | null> {
  const prompt = `Refine this meal prep recipe according to the instruction below.
Only change what the instruction asks. Keep everything else identical — same language (Portuguese), same structure, same field names.

Instruction: ${instruction}

Current recipe:
${JSON.stringify(recipe, null, 2)}

Important:
- Macros are TOTALS for all servings combined. Recalculate if you change ingredients.
- protein × 4 + carbs × 4 + fat × 9 must equal calories within 15%
- All ingredient quantities must be numbers (null only for genuinely unmeasurable items)
- Steps must be in Portuguese, actionable, specific

Use the submit_refined_recipe tool with the updated recipe.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      tools: [REFINE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_refined_recipe' },
      messages: [{ role: 'user', content: prompt }],
    })

    const toolUse = response.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No tool use in response')

    const { recipe: refined } = toolUse.input as { recipe: GeneratedRecipe }

    // Preserve cuisine field if present
    if (recipe.cuisine && !refined.cuisine) refined.cuisine = recipe.cuisine

    return refined
  } catch (err) {
    console.error(`  Failed: ${err}`)
    return null
  }
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const recipes: GeneratedRecipe[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'))

  // Select targets
  let targets: GeneratedRecipe[]
  if (recipeName) {
    targets = recipes.filter((r) => r.name.toLowerCase() === recipeName.toLowerCase())
    if (targets.length === 0) {
      console.error(`No recipe found with name: "${recipeName}"`)
      console.error('Available names:')
      recipes.forEach((r) => console.error(`  - ${r.name}`))
      process.exit(1)
    }
  } else if (matchPattern) {
    targets = recipes.filter((r) => r.name.toLowerCase().includes(matchPattern.toLowerCase()))
    if (targets.length === 0) {
      console.error(`No recipes matched pattern: "${matchPattern}"`)
      process.exit(1)
    }
  } else {
    targets = recipes
  }

  console.log(`\nRefining ${targets.length} recipe(s) with instruction: "${instruction}"`)
  console.log('Model: claude-haiku-4-5-20251001\n')

  let refined = 0
  let failed = 0

  for (const recipe of targets) {
    process.stdout.write(`  ${recipe.name}... `)
    const result = await refineRecipe(recipe, instruction!)

    if (!result) {
      console.log('FAILED')
      failed++
      continue
    }

    const macroError = validateMacros(result)
    if (macroError) {
      console.log(`INVALID — ${macroError}`)
      failed++
      continue
    }

    // Patch in place
    const idx = recipes.findIndex((r) => r.name === recipe.name)
    recipes[idx] = result
    refined++
    console.log(`✓ (${result.calories} kcal, ${result.protein}g P)`)
  }

  if (refined > 0) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(recipes, null, 2), 'utf-8')
    console.log(`\n✅ ${refined} refined, ${failed} failed. system-recipes.json updated.`)
    console.log('\nTo apply to the database, delete the existing system recipes by name and re-run:')
    console.log('  npx tsx scripts/seed-system-recipes.ts')
  } else {
    console.log(`\n❌ All ${failed} refinements failed. JSON unchanged.`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
