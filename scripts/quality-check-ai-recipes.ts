/**
 * Runs a data quality check on AI-generated system recipes using Claude Opus.
 * Checks: macro plausibility, ingredient completeness, step clarity.
 *
 * Usage:
 *   npx tsx scripts/quality-check-ai-recipes.ts
 *
 * Outputs: scripts/quality-check-results.json
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/quality-check-results.json')

// The 65 AI-generated recipe names (not from Joe x Fitness or Cooking Abs)
const JOE_X_FITNESS_NAMES = new Set([
  'Bulgogi KBBQ Meal Prep', 'Spicy BBQ Gochujang Chicken', 'Honey Sriracha Shrimp',
  'Chicken Katsu', 'Sesame Salmon', 'Kung Pao Chicken', 'Orange Chicken',
  'Kimchi Shrimp Fried Rice', 'Chicken Bulgogi Ssam', 'Vietnamese Shaken Beef',
  'Bulgogi Gimbap Wrap', 'Shrimp Rice Paper Noodles', 'Tunacado Sandwich',
  'Microwave Hot Pot', 'Korean-Inspired Omelette', 'Beef Pepper Rice', 'Spicy Tofu Bowl',
  'Salmon Sushi Bake', 'Fresh Shrimp Spring Rolls', 'Lox Cucumber Salad',
  'Dakjuk (Chicken Rice Porridge)', 'Chicken Yaki Udon', 'Rice Paper Shrimp Roll',
  'Tuna Salad Lettuce Wrap', 'Lazy Chicken Udon', 'Spring Roll Bowl', 'Korean Egg Bites',
  'Kimchi Jeon', 'Dakgalbi (Spicy Stir-Fried Chicken)', 'Rice Paper Scallion Pancake',
  'Napa Cabbage Shrimp Dumpling Rolls', 'Gyeranjjim (Korean Steamed Egg)', 'Egg Drop Soup',
  'Kimchi Tuna Melt', 'Beef Enoki Rolls', 'Mayak Eggs (Marinated Eggs)',
  'Eomuk Bokkeum (Fish Cake)', 'Ojingeochae Muchim (Spicy Squid)',
  'Myeolchi Bokkeum (Stir-Fried Anchovies)', 'Jangjorim (Soy Braised Beef)',
  'Gyeran-mari (Korean Rolled Omelette)', 'Sangchu Geotjeori (Spicy Salad)',
  'Japchae (Glass Noodle Stir Fry)', 'Oi-muchim (Spicy Cucumber)',
  'Sigeumchi-namul (Marinated Spinach)', 'Spicy Soondubu (Tofu Soup)',
  'Miyeokguk (Seaweed Beef Soup)', 'Kimchi Jjigae (Kimchi Beef Stew)',
  'Ddukguk (Beef Rice Cake Soup)', 'Muguk (Beef & Radish Soup)',
])

type QualityFlag = {
  field: 'macros' | 'ingredients' | 'steps' | 'overall'
  severity: 'warning' | 'error'
  message: string
}

type QualityResult = {
  id: string
  name: string
  verdict: 'ok' | 'flagged'
  flags: QualityFlag[]
  summary: string
}

type RecipeRow = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  servings: number
  time_min: number
  recipe_ingredients: Array<{ name: string; quantity: number | null; unit: string | null; raw_text: string }>
  recipe_steps: Array<{ text: string; position: number }>
}

const CHECK_TOOL: Anthropic.Tool = {
  name: 'submit_quality_check',
  description: 'Submit quality check results for a batch of recipes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'name', 'verdict', 'flags', 'summary'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            verdict: { type: 'string', enum: ['ok', 'flagged'] },
            flags: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'severity', 'message'],
                properties: {
                  field: { type: 'string', enum: ['macros', 'ingredients', 'steps', 'overall'] },
                  severity: { type: 'string', enum: ['warning', 'error'] },
                  message: { type: 'string' },
                },
              },
            },
            summary: { type: 'string', description: 'One sentence: why flagged, or "Looks good" if ok.' },
          },
        },
      },
    },
    required: ['results'],
  },
}

async function checkBatch(recipes: RecipeRow[]): Promise<QualityResult[]> {
  const payload = recipes.map((r) => ({
    id: r.id,
    name: r.name,
    macros_per_serving: {
      calories: r.calories,
      protein_g: r.protein,
      carbs_g: r.carbs,
      fat_g: r.fat,
      servings: r.servings,
    },
    time_min: r.time_min,
    ingredients: r.recipe_ingredients.map((i) => i.raw_text),
    steps: r.recipe_steps.sort((a, b) => a.position - b.position).map((s) => s.text),
  }))

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    tools: [CHECK_TOOL],
    tool_choice: { type: 'any' },
    messages: [{
      role: 'user',
      content: `You are a food scientist and nutritionist reviewing AI-generated recipes for data quality. Check each recipe for:

1. **Macros plausibility** — Do calories roughly match protein×4 + carbs×4 + fat×9? Are values realistic for the ingredients listed (e.g. 100g chicken ≈ 25g protein, not 60g)?
2. **Ingredient completeness** — Are quantities present for main ingredients? Are there obvious missing ingredients (e.g. steps reference an ingredient not in the list)?
3. **Step clarity** — Are steps coherent and complete? Are there contradictions, impossible instructions, or steps that reference undefined terms?
4. **Overall sense** — Does this recipe make sense as a real dish a person would cook and eat?

Be strict but fair. Flag real issues, not stylistic preferences. A warning is a minor concern; an error means the recipe is likely wrong or unusable.

Recipes to check:
${JSON.stringify(payload, null, 2)}`,
    }],
  })

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) return []
  return ((toolUse.input as { results: QualityResult[] }).results) ?? []
}

async function main() {
  // Fetch all system recipes with their ingredients and steps
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select(`
      id, name, calories, protein, carbs, fat, servings, time_min,
      recipe_ingredients(name, quantity, unit, raw_text),
      recipe_steps(text, position)
    `)
    .eq('visibility', 'system')

  if (error) throw new Error(error.message)

  // Filter to only the AI-generated ones (not Joe x Fitness)
  const aiRecipes = (recipes as RecipeRow[]).filter((r) => !JOE_X_FITNESS_NAMES.has(r.name))
  console.log(`Checking ${aiRecipes.length} AI-generated recipes with Opus…\n`)

  const allResults: QualityResult[] = []
  const BATCH = 5

  for (let i = 0; i < aiRecipes.length; i += BATCH) {
    const batch = aiRecipes.slice(i, i + BATCH)
    process.stdout.write(`  [${i + 1}–${Math.min(i + BATCH, aiRecipes.length)}/${aiRecipes.length}] `)

    try {
      const results = await checkBatch(batch)
      allResults.push(...results)
      const flagged = results.filter((r) => r.verdict === 'flagged').length
      console.log(`${flagged} flagged`)
    } catch (err) {
      console.log(`error: ${(err as Error).message}`)
    }

    await new Promise((r) => setTimeout(r, 500))
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allResults, null, 2))

  const flagged = allResults.filter((r) => r.verdict === 'flagged')
  const ok = allResults.filter((r) => r.verdict === 'ok')

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`✓ OK: ${ok.length}   ⚠ Flagged: ${flagged.length}`)
  console.log(`\nFlagged recipes:`)
  for (const r of flagged) {
    console.log(`\n  ${r.name}`)
    console.log(`  → ${r.summary}`)
    for (const f of r.flags) {
      console.log(`    [${f.severity.toUpperCase()}] ${f.field}: ${f.message}`)
    }
  }
  console.log(`\nFull results written to ${OUTPUT_PATH}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
