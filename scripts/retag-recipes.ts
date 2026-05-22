/**
 * AI-assisted recipe retagging to the canonical 47-tag taxonomy.
 * Analyzes each recipe and assigns appropriate tags (max 6).
 *
 * Rules:
 * - Max 6 tags per recipe
 * - Max 1 cuisine tag per recipe
 * - Max 1 cooking method tag per recipe
 * - `alto-proteína` auto-applied when pcal_ratio >= 0.70
 * - `fit` is opt-in only (lighter version of a classic)
 * - Tags must come from the canonical set below
 *
 * Usage: npx tsx scripts/retag-recipes.ts [--dry-run] [--apply]
 * Requires: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Without --apply: prints proposed SQL for review
 * With    --apply: applies changes directly to the DB
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
  console.error('Missing: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY')
  process.exit(1)
}

const applyChanges = process.argv.includes('--apply')
const dryRun = !applyChanges

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})
const anthropic = new Anthropic({ apiKey: anthropicKey })

// ---- Canonical taxonomy ----

const TAG_SECTIONS = {
  method: ['air-fryer', 'forno', 'fogão', 'micro-ondas', 'sem-cozinha', 'uma-frigideira', 'bimby', 'grelhador'],
  cuisine: ['português', 'mediterrâneo', 'italiano', 'francês', 'europeu', 'americano', 'mexicano', 'indiano', 'asiático', 'japonês', 'coreano', 'árabe', 'africano', 'latino-americano'],
  diet: ['sem-glúten', 'vegetariano', 'vegano', 'sem-lactose', 'alto-proteína', 'low-carb', 'fit'],
  type: ['pequeno-almoço', 'almoço', 'jantar', 'snack', 'sobremesa', 'sopa', 'pós-treino', 'batido'],
  context: ['meal-prep', 'rápido', 'reconfortante', 'leve', 'económico', 'família', 'festivo', '5-ingredientes', 'semana', 'verão'],
} as const

const ALL_CANONICAL_TAGS = Object.values(TAG_SECTIONS).flat()

// ---- Types ----

type Recipe = {
  id: string
  name: string
  proteins: string[]
  time_min: number | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  servings: number
  macros_total: boolean
  tags: string[]
  source: string | null
  ingredients: string[]
  steps: string[]
}

type TagProposal = {
  recipeId: string
  recipeName: string
  oldTags: string[]
  newTags: string[]
  autoAltoProteina: boolean
}

// ---- Helpers ----

// Uses the same ×10 formula as the library badge (green ≥ 1.0, yellow ≥ 0.70)
function pcalRatio(recipe: Recipe): number {
  if (!recipe.calories || recipe.calories === 0 || !recipe.protein) return 0
  const cal = recipe.macros_total ? recipe.calories / (recipe.servings || 1) : recipe.calories
  const prot = recipe.macros_total ? recipe.protein / (recipe.servings || 1) : recipe.protein
  return (prot * 10) / cal
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "''")
}

// ---- AI tagging ----

const SYSTEM_PROMPT = `You are a recipe tagging assistant. Given a recipe, assign the most appropriate tags from the canonical list.

Rules:
1. Return ONLY tags from the canonical list — no invented tags.
2. Max 6 tags total per recipe.
3. Max 1 cuisine tag (cuisine section).
4. Max 1 cooking method tag (method section).
5. Do NOT assign "alto-proteína" — it is applied automatically by the script.
6. Only assign "fit" if the recipe is clearly a lighter/healthier remake of a traditionally indulgent dish.
7. Assign "vegetariano" only if the recipe contains no meat or fish. Assign "vegano" only if no animal products at all.
8. Prefer specificity: "japonês" over "asiático" when clearly Japanese.
9. Assign "rápido" if time_min <= 20.
10. Assign "meal-prep" if the recipe yields multiple portions and stores well.
11. Assign "leve" if calories per serving < 350.
12. Assign "pós-treino" only if the recipe is explicitly post-workout oriented.

Canonical tags by section:
- method: air-fryer, forno, fogão, micro-ondas, sem-cozinha, uma-frigideira, bimby, grelhador
- cuisine: português, mediterrâneo, italiano, francês, europeu, americano, mexicano, indiano, asiático, japonês, coreano, árabe, africano, latino-americano
- diet: sem-glúten, vegetariano, vegano, sem-lactose, alto-proteína, low-carb, fit
- type: pequeno-almoço, almoço, jantar, snack, sobremesa, sopa, pós-treino, batido
- context: meal-prep, rápido, reconfortante, leve, económico, família, festivo, 5-ingredientes, semana, verão

Respond with a JSON object: { "tags": ["tag1", "tag2", ...] }`

async function tagRecipe(recipe: Recipe, attempt = 1): Promise<string[]> {
  const ingList = recipe.ingredients.slice(0, 12).join(', ')
  const calPerServing = recipe.macros_total && recipe.servings
    ? Math.round((recipe.calories ?? 0) / recipe.servings)
    : (recipe.calories ?? 0)
  const stepText = recipe.steps.join(' | ')

  const userMsg = `Recipe: ${recipe.name}
Proteins: ${recipe.proteins.join(', ') || 'none'}
Time: ${recipe.time_min != null ? `${recipe.time_min} min` : 'unknown'}
Calories per serving: ${calPerServing}
Servings: ${recipe.servings}
Key ingredients: ${ingList}
Steps: ${stepText || 'unknown'}
Source: ${recipe.source ?? 'unknown'}`

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })

    const raw = resp.content[0].type === 'text' ? resp.content[0].text : ''
    // Extract the tags array directly — handles markdown fences, trailing notes, and leading prose
    const arrayMatch = raw.match(/"tags"\s*:\s*(\[[\s\S]*?\])/)
    if (!arrayMatch) throw new Error(`No tags array found in: ${raw.substring(0, 80)}`)
    const parsed = { tags: JSON.parse(arrayMatch[1]) as string[] }
    const valid = parsed.tags.filter((t) => ALL_CANONICAL_TAGS.includes(t as never))
    return valid
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      return tagRecipe(recipe, attempt + 1)
    }
    console.error(`  ✗ Failed to tag ${recipe.name}: ${err}`)
    return []
  }
}

// ---- Main ----

async function main() {
  console.log(`\n🏷  Recipe retagger — ${dryRun ? 'DRY RUN (pass --apply to write)' : 'APPLYING CHANGES'}\n`)

  // Fetch all recipes with their ingredient names
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select(`
      id, name, proteins, time_min, calories, protein, carbs, fat,
      servings, macros_total, tags, source,
      recipe_ingredients ( name, raw_text ),
      recipe_steps ( position, text )
    `)
    .eq('visibility', 'system')
    .order('name')

  if (error) {
    console.error('Failed to fetch recipes:', error)
    process.exit(1)
  }

  console.log(`Found ${recipes.length} system recipes\n`)

  const proposals: TagProposal[] = []
  let processed = 0

  for (const r of recipes) {
    const ingredients = (r.recipe_ingredients as { name: string | null; raw_text: string }[])
      .map((i) => i.name ?? i.raw_text)
      .filter(Boolean)

    const steps = (r.recipe_steps as { position: number; text: string }[])
      .sort((a, b) => a.position - b.position)
      .map((s) => s.text)

    const recipe: Recipe = {
      id: r.id,
      name: r.name,
      proteins: r.proteins ?? [],
      time_min: r.time_min,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      servings: r.servings ?? 1,
      macros_total: r.macros_total ?? false,
      tags: r.tags ?? [],
      source: r.source,
      ingredients,
      steps,
    }

    process.stdout.write(`[${++processed}/${recipes.length}] ${recipe.name}... `)

    let aiTags = await tagRecipe(recipe)

    // Enforce max 1 cuisine, max 1 method
    const cuisineTags = aiTags.filter((t) => (TAG_SECTIONS.cuisine as readonly string[]).includes(t))
    const methodTags = aiTags.filter((t) => (TAG_SECTIONS.method as readonly string[]).includes(t))
    if (cuisineTags.length > 1) aiTags = aiTags.filter((t) => !(TAG_SECTIONS.cuisine as readonly string[]).includes(t) || t === cuisineTags[0])
    if (methodTags.length > 1) aiTags = aiTags.filter((t) => !(TAG_SECTIONS.method as readonly string[]).includes(t) || t === methodTags[0])

    // Auto-apply alto-proteína
    const ratio = pcalRatio(recipe)
    const autoAltoProteina = ratio >= 0.70
    if (autoAltoProteina && !aiTags.includes('alto-proteína')) {
      aiTags.push('alto-proteína')
    }
    if (!autoAltoProteina) {
      aiTags = aiTags.filter((t) => t !== 'alto-proteína')
    }

    // Enforce hard cap of 6
    if (aiTags.length > 6) aiTags = aiTags.slice(0, 6)

    proposals.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      oldTags: recipe.tags,
      newTags: aiTags,
      autoAltoProteina,
    })

    const changed = JSON.stringify([...recipe.tags].sort()) !== JSON.stringify([...aiTags].sort())
    console.log(changed ? `→ [${aiTags.join(', ')}]` : '(unchanged)')

    // Rate limit: 30 req/min for Haiku is generous; 200ms delay keeps us well under
    await new Promise((r) => setTimeout(r, 200))
  }

  // Generate SQL
  const sqlLines: string[] = ['-- Retag migration — review before applying']
  let changeCount = 0

  for (const p of proposals) {
    const oldSorted = [...p.oldTags].sort().join(',')
    const newSorted = [...p.newTags].sort().join(',')
    if (oldSorted === newSorted) continue
    changeCount++
    const arr = `ARRAY[${p.newTags.map((t) => `'${escapeStr(t)}'`).join(', ')}]`
    sqlLines.push(`UPDATE recipes SET tags = ${arr} WHERE id = '${p.recipeId}'; -- ${p.recipeName}`)
  }

  sqlLines.push(`\n-- ${changeCount} recipes changed out of ${proposals.length} total`)

  console.log(`\n${changeCount} recipes need tag changes.\n`)

  if (dryRun) {
    console.log('---- SQL (not applied) ----\n')
    console.log(sqlLines.join('\n'))
    console.log('\n---- End SQL ----')
    console.log('\nRun with --apply to write changes to the DB.')
    return
  }

  // Apply
  console.log('Applying changes...')
  let applied = 0
  for (const p of proposals) {
    const oldSorted = [...p.oldTags].sort().join(',')
    const newSorted = [...p.newTags].sort().join(',')
    if (oldSorted === newSorted) continue

    const { error: updateError } = await supabase
      .from('recipes')
      .update({ tags: p.newTags })
      .eq('id', p.recipeId)

    if (updateError) {
      console.error(`  ✗ Failed to update ${p.recipeName}: ${updateError.message}`)
    } else {
      applied++
    }
  }

  console.log(`\n✓ Applied ${applied}/${changeCount} changes.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
