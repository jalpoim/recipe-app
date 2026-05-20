/**
 * Generates 25 high-quality starter recipes using Claude API.
 * Writes to scripts/system-recipes.json for review before seeding.
 *
 * Usage:
 *   npx tsx scripts/generate-system-recipes.ts
 *
 * After reviewing the JSON, run:
 *   npx tsx scripts/seed-system-recipes.ts
 *
 * Requires: ANTHROPIC_API_KEY in .env.local
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

const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/system-recipes.json')

// ---- Types ----------------------------------------------------------------

type Category = 'Talho/Peixaria' | 'Frutas/Legumes' | 'Lacticínios' | 'Mercearia' | 'Outros'
type ProteinSlug = 'chicken' | 'beef' | 'salmon' | 'tuna' | 'eggs' | 'legumes' | 'turkey' | 'pork' | 'cod'

type GeneratedIngredient = {
  raw_text: string
  quantity: number | null
  unit: string | null
  name: string
  category: Category
  is_pantry: boolean
}

type GeneratedRecipe = {
  name: string
  cuisine: string
  time_min: number
  servings: number
  calories: number
  protein: number
  carbs: number
  fat: number
  proteins: ProteinSlug[]
  tags: string[]
  ingredients: GeneratedIngredient[]
  steps: string[]
}

// ---- Tool schema ----------------------------------------------------------

const RECIPE_TOOL: Anthropic.Tool = {
  name: 'submit_recipes',
  description: 'Submit the generated recipes as structured data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'cuisine', 'time_min', 'servings', 'calories', 'protein', 'carbs', 'fat', 'proteins', 'tags', 'ingredients', 'steps'],
          properties: {
            name: { type: 'string', description: 'Recipe name in Portuguese' },
            cuisine: { type: 'string', enum: ['portuguese', 'indian', 'international', 'neutral'] },
            time_min: { type: 'number', description: 'Total cook + prep time in minutes' },
            servings: { type: 'number', description: 'Number of servings this recipe makes' },
            calories: { type: 'number', description: 'Total calories for all servings combined' },
            protein: { type: 'number', description: 'Total protein in grams for all servings' },
            carbs: { type: 'number', description: 'Total carbohydrates in grams for all servings' },
            fat: { type: 'number', description: 'Total fat in grams for all servings' },
            proteins: {
              type: 'array',
              items: { type: 'string', enum: ['chicken', 'beef', 'salmon', 'tuna', 'eggs', 'legumes', 'turkey', 'pork', 'cod'] },
              description: 'Protein slugs — English identifiers only',
            },
            tags: { type: 'array', items: { type: 'string' }, description: 'Short lowercase Portuguese tags' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                required: ['raw_text', 'quantity', 'unit', 'name', 'category', 'is_pantry'],
                properties: {
                  raw_text: { type: 'string', description: 'Full ingredient line, e.g. "200g peito de frango"' },
                  quantity: { type: ['number', 'null'], description: 'Numeric amount, null only for genuinely unmeasurable items' },
                  unit: { type: ['string', 'null'], description: 'Unit string (g, ml, colher sopa, etc.) or null' },
                  name: { type: 'string', description: 'Ingredient name in Portuguese' },
                  category: { type: 'string', enum: ['Talho/Peixaria', 'Frutas/Legumes', 'Lacticínios', 'Mercearia', 'Outros'] },
                  is_pantry: { type: 'boolean', description: 'True if this is a pantry staple (olive oil, salt, spices, etc.)' },
                },
              },
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Cooking steps in Portuguese. 4–7 steps, each one actionable and specific.',
            },
          },
        },
      },
    },
    required: ['recipes'],
  },
}

// ---- Batches --------------------------------------------------------------

type Batch = { cuisine: string; count: number; targets: string }

const BATCHES: Batch[] = [
  {
    cuisine: 'Portuguese',
    count: 8,
    targets: `
- Frango assado com batata-doce (chicken + sweet potato, oven-roasted, ~35 min)
- Bacalhau com grão e espinafres (cod + chickpeas + spinach, stovetop, ~25 min)
- Açorda de camarão fit (shrimp bread soup, high protein, ~20 min)
- Caldo verde com chouriço (kale soup with chorizo, ~30 min)
- Peito de frango marinado com arroz de coentros (chicken + coriander rice, ~30 min)
- Ovos mexidos com farinheira e legumes (scrambled eggs with farinheira sausage, ~15 min)
- Atum com feijão verde e ovo cozido (tuna + green beans + boiled egg, cold bowl, ~15 min)
- Bifana magra no forno com courgette (lean pork bifana, oven, ~30 min)`,
  },
  {
    cuisine: 'Indian',
    count: 5,
    targets: `
- Dal de lentilhas vermelhas com espinafres (red lentil dal + spinach, ~25 min)
- Frango tikka masala fit (lighter tikka masala with yogurt, ~35 min)
- Chana masala (spiced chickpeas, vegan, ~30 min)
- Frango saag (chicken in spiced spinach sauce, ~35 min)
- Arroz de frango biryani simplificado (simplified chicken biryani, ~40 min)`,
  },
  {
    cuisine: 'International',
    count: 8,
    targets: `
- Tigela de salmão teriyaki com arroz e brócolo (salmon teriyaki bowl, ~25 min)
- Shakshuka de tomate e pimento (eggs poached in tomato sauce, ~20 min)
- Tacos de frango com guacamole simples (chicken tacos, ~25 min)
- Pad thai de frango com ovos (chicken pad thai, ~25 min)
- Tigela mediterrânea de frango (Greek-style chicken bowl with tzatziki, ~30 min)
- Burrito bowl de carne picada (beef burrito bowl with black beans, ~30 min)
- Salmão com puré de couve-flor e alcaparras (salmon + cauliflower mash, ~25 min)
- Frango com curry verde tailandês e arroz jasmim (Thai green curry + jasmine rice, ~30 min)`,
  },
  {
    cuisine: 'Neutral/Base',
    count: 4,
    targets: `
- Tigela de ovos escalfados com abacate e torrada de centeio (poached eggs + avocado + rye toast, ~15 min)
- Aveia de proteína com banana e manteiga de amendoim (protein oats + banana + peanut butter, ~10 min)
- Iogurte grego com granola e frutos vermelhos (Greek yogurt bowl, ~5 min, high protein snack)
- Frango grelhado com arroz integral e legumes salteados (basic grilled chicken meal prep base, ~30 min)`,
  },
]

// ---- Validation -----------------------------------------------------------

function validateMacros(r: GeneratedRecipe): { valid: boolean; error?: string } {
  const computed = r.protein * 4 + r.carbs * 4 + r.fat * 9
  const deviation = Math.abs(computed - r.calories) / r.calories
  if (deviation > 0.20) {
    return { valid: false, error: `Macro mismatch: computed ${Math.round(computed)} kcal vs stated ${r.calories} kcal (${Math.round(deviation * 100)}% off)` }
  }
  if (r.ingredients.length < 4) return { valid: false, error: 'Too few ingredients (< 4)' }
  if (r.steps.length < 3) return { valid: false, error: 'Too few steps (< 3)' }
  if (r.proteins.length === 0) return { valid: false, error: 'No protein slug' }
  if (r.servings < 1) return { valid: false, error: 'servings must be >= 1' }
  return { valid: true }
}

// ---- Generation -----------------------------------------------------------

const SYSTEM_PROMPT = `You are a professional nutritionist and recipe developer specialising in high-protein meal prep.
You create recipes for Portuguese-speaking users who want to eat well and hit their protein targets.

Rules for every recipe:
- Names in Portuguese (natural, not translated-sounding)
- All ingredient quantities as real numbers (grams, ml, tablespoons). Null only for literally unmeasurable items like "sal q.b."
- Ingredient names as you'd find them on a Portuguese supermarket shelf (e.g. "peito de frango", "salmão", "grão-de-bico")
- Macros are TOTALS for all servings combined (macros_total = true). Calculate accurately: protein × 4 + carbs × 4 + fat × 9 ≈ calories (within 15%)
- Steps are in Portuguese, actionable, specific. No "season to taste" — use actual amounts. 4–7 steps.
- Tags: short lowercase Portuguese words, useful for filtering (e.g. "forno", "uma-frigideira", "sem-glúten", "vegetariano", "peixe", "alto-proteíno", "rápido")
- is_pantry = true for: olive oil, salt, black pepper, common spices, vinegar, soy sauce, honey — things users are expected to already have
- Categories: Talho/Peixaria (meat/fish), Frutas/Legumes (produce), Lacticínios (dairy/eggs), Mercearia (dry goods/sauces), Outros
- Protein slugs must be from this list: chicken, beef, salmon, tuna, eggs, legumes, turkey, pork, cod`

async function generateBatch(batch: Batch, attempt = 1): Promise<GeneratedRecipe[]> {
  console.log(`\n  Generating ${batch.count} ${batch.cuisine} recipes...`)

  const userPrompt = `Generate exactly ${batch.count} ${batch.cuisine} meal-prep recipes.

Target recipes:
${batch.targets}

Requirements:
- Each recipe should serve 2–4 people (meal prep quantities)
- Protein per serving: aim for 25–45g
- Mix of cooking times: some quick (≤20 min), some moderate (20–40 min)
- Be specific with quantities — no guessing
- Accurate macro calculations — double-check that protein×4 + carbs×4 + fat×9 ≈ calories

Use the submit_recipes tool with all ${batch.count} recipes.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      tools: [RECIPE_TOOL],
      tool_choice: { type: 'any' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const toolUse = response.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No tool use in response')

    const { recipes } = toolUse.input as { recipes: GeneratedRecipe[] }
    if (!Array.isArray(recipes) || recipes.length === 0) throw new Error('Empty recipes array')

    return recipes
  } catch (err) {
    if (attempt < 2) {
      console.warn(`  Retrying batch (${batch.cuisine})...`)
      await new Promise((r) => setTimeout(r, 3000))
      return generateBatch(batch, 2)
    }
    throw err
  }
}

// ---- Main -----------------------------------------------------------------

async function main() {
  if (fs.existsSync(OUTPUT_PATH)) {
    console.log(`\n⚠️  ${OUTPUT_PATH} already exists.`)
    console.log('Delete it and re-run to regenerate, or run seed-system-recipes.ts to seed the existing file.\n')
    process.exit(0)
  }

  console.log('Generating 25 starter recipes with Claude...')
  console.log('Model: claude-sonnet-4-6\n')

  const allRecipes: GeneratedRecipe[] = []
  let totalValid = 0
  let totalInvalid = 0

  for (const batch of BATCHES) {
    const recipes = await generateBatch(batch)

    for (const recipe of recipes) {
      const { valid, error } = validateMacros(recipe)
      if (valid) {
        allRecipes.push(recipe)
        totalValid++
        console.log(`  ✓ ${recipe.name} (${recipe.calories} kcal, ${recipe.protein}g P, ${recipe.time_min} min)`)
      } else {
        totalInvalid++
        console.warn(`  ✗ ${recipe.name} — ${error}`)
      }
    }

    // Pause between batches
    if (BATCHES.indexOf(batch) < BATCHES.length - 1) {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allRecipes, null, 2), 'utf-8')

  console.log(`\n✅ Done. ${totalValid} valid, ${totalInvalid} failed validation.`)
  console.log(`📄 Written to scripts/system-recipes.json`)
  console.log(`\nReview the file, then run:\n  npx tsx scripts/seed-system-recipes.ts`)

  if (totalInvalid > 0) {
    console.log(`\n⚠️  ${totalInvalid} recipe(s) failed macro validation — fix them manually in the JSON before seeding.`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
