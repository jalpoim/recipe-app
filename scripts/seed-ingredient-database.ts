/**
 * USDA ingredient import + Haiku canonicalization.
 *
 * Sources:
 *   docs/usda/FoodData_Central_foundation_food_json_2026-04-30.json  (395 items — primary)
 *   docs/usda/FoodData_Central_sr_legacy_food_json_2018-04.json      (7793 items — gap-fill)
 *
 * Usage:
 *   npx tsx scripts/seed-ingredient-database.ts --dry-run     (show stats, no DB writes)
 *   npx tsx scripts/seed-ingredient-database.ts               (full run)
 *   npx tsx scripts/seed-ingredient-database.ts --source foundation   (foundation only)
 *   npx tsx scripts/seed-ingredient-database.ts --source sr           (sr legacy only)
 *   npx tsx scripts/seed-ingredient-database.ts --skip-ai    (insert pre-processed only, no Haiku)
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!
if (!url || !serviceKey) { console.error('Missing Supabase env vars'); process.exit(1) }
if (!anthropicKey) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1) }

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

const DRY_RUN    = process.argv.includes('--dry-run')
const SKIP_AI    = process.argv.includes('--skip-ai')
const SOURCE_IDX = process.argv.indexOf('--source')
const SOURCE     = SOURCE_IDX !== -1 ? process.argv[SOURCE_IDX + 1] : 'both'

const FOUNDATION_PATH = path.resolve(process.cwd(), 'docs/usda/FoodData_Central_foundation_food_json_2026-04-30.json')
const SR_PATH         = path.resolve(process.cwd(), 'docs/usda/FoodData_Central_sr_legacy_food_json_2018-04.json')
const PROGRESS_PATH   = path.resolve(process.cwd(), 'scripts/seed-ingredient-database.progress.json')
const BATCH_SIZE      = 50
const BATCH_DELAY_MS  = 150

// Nutrient IDs (per 100g)
const NID_CALORIES = 1008
const NID_PROTEIN  = 1003
const NID_CARBS    = 1005
const NID_FAT      = 1004

// Drop these entire USDA categories
const CATEGORY_BLOCKLIST = new Set([
  'Baby Foods',
  'Fast Foods',
  'Restaurant Foods',
  'American Indian/Alaska Native Foods',
  'Meals, Entrees, and Side Dishes',
])

// Case-insensitive substring blocklist applied to description
const DESC_BLOCKLIST = [
  'restaurant', 'fast food', 'babyfood', 'baby food',
  'frozen, prepared', "from kid's menu",
]

// Regex for all-caps brand names (3+ chars, e.g. OSCAR MAYER)
const BRAND_REGEX = /\b[A-Z]{3,}\b/

type UsdaFood = {
  fdcId: number
  description: string
  foodCategory?: { description: string }
  foodNutrients?: Array<{ nutrient?: { id: number }; amount?: number }>
}

type CanonicalResult = {
  usda_description: string
  canonical_name: string
  variant: string | null
  canonical_full: string
}

type ProcessedEntry = {
  description: string
  preprocessed: string
  category: string
  macros: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null }
  dietaryFlags: string[]
}

// ---- Load USDA data ----

function loadFoundation(): UsdaFood[] {
  if (!fs.existsSync(FOUNDATION_PATH)) { console.error('Foundation JSON not found:', FOUNDATION_PATH); return [] }
  const raw = JSON.parse(fs.readFileSync(FOUNDATION_PATH, 'utf8'))
  return raw.FoundationFoods ?? raw.foods ?? raw
}

function loadSrLegacy(): UsdaFood[] {
  if (!fs.existsSync(SR_PATH)) { console.error('SR Legacy JSON not found:', SR_PATH); return [] }
  const raw = JSON.parse(fs.readFileSync(SR_PATH, 'utf8'))
  return raw.SRLegacyFoods ?? raw.foods ?? raw
}

// ---- Filtering ----

function isAllowed(food: UsdaFood): boolean {
  const cat = food.foodCategory?.description ?? ''
  if (CATEGORY_BLOCKLIST.has(cat)) return false

  const desc = food.description.toLowerCase()
  for (const blocked of DESC_BLOCKLIST) {
    if (desc.includes(blocked)) return false
  }

  // Drop all-caps brand names in description (not category)
  if (BRAND_REGEX.test(food.description)) return false

  return true
}

// ---- Pre-processing ----

function preprocess(desc: string): string {
  let s = desc

  // Strip size prefix at start
  s = s.replace(/^(Large|Medium|Small),\s*/i, '')

  // Quality/grade
  s = s.replace(/,\s*(choice|select|prime|grade [a-z]|NFS)\b/gi, '')

  // Trim level
  s = s.replace(/,?\s*separable lean (only|and fat)/gi, '')
  s = s.replace(/,?\s*trimmed to \d+["'/]+ fat/gi, '')

  // Redundant qualifiers
  s = s.replace(/,?\s*(unprepared|without salt|with salt added|without skin|skin removed)/gi, '')

  // Cooking state suffixes — strip if followed by end or another comma
  s = s.replace(/,\s*cooked[^,]*/gi, '')
  s = s.replace(/,\s*raw\s*$/gi, '')

  // Parenthetical with USDA food program references
  s = s.replace(/\(Includes foods for USDA'?s? Food Distribution Program\)/gi, '')
  s = s.replace(/\([^)]*USDA[^)]*\)/gi, '')

  // Trailing commas/whitespace
  s = s.replace(/,\s*$/, '').trim()

  return s
}

// ---- Macro extraction ----

function extractMacros(food: UsdaFood) {
  const map: Record<number, number> = {}
  for (const fn of food.foodNutrients ?? []) {
    if (fn.nutrient?.id != null && fn.amount != null) {
      map[fn.nutrient.id] = fn.amount
    }
  }
  return {
    calories: map[NID_CALORIES] ?? null,
    protein:  map[NID_PROTEIN]  ?? null,
    carbs:    map[NID_CARBS]    ?? null,
    fat:      map[NID_FAT]      ?? null,
  }
}

// ---- Dietary flags ----

function deriveDietaryFlags(food: UsdaFood): string[] {
  const cat  = food.foodCategory?.description ?? ''
  const desc = food.description.toLowerCase()
  const flags: string[] = []

  if (/Beef Products|Pork Products|Lamb, Veal, and Game/i.test(cat)) flags.push('meat')
  if (/Poultry/i.test(cat)) flags.push('poultry')
  if (/Finfish/i.test(cat)) flags.push('fish')
  if (/Shellfish|Crustacean|Mollusks/i.test(cat)) flags.push('shellfish')
  if (/Dairy and Egg Products/i.test(cat)) {
    if (/egg/i.test(desc)) flags.push('egg')
    else flags.push('dairy')
  }
  if (/Cereal Grains and Pasta|Baked Products/i.test(cat) && /wheat|flour|bread|pasta|rye|barley/i.test(desc)) flags.push('gluten')
  if (/Nut and Seed Products/i.test(cat) && !/peanut|sesame/i.test(desc)) flags.push('tree_nut')
  if (/Legumes/i.test(cat) && /peanut/i.test(desc)) flags.push('peanut')
  if (/Legumes/i.test(cat) && /\bsoy\b|tofu|edamame/i.test(desc)) flags.push('soy')

  return flags
}

// ---- Haiku canonicalization ----

const HAIKU_SYSTEM = `You are a food database assistant and dietitian. For each USDA food description, return a clean canonical kitchen ingredient name.

Return a JSON array of objects with fields: usda_description (exact input), canonical_name (base ingredient), variant (specific variant or null), canonical_full (the final stored name).

MERGE same ingredient different cooking states, grades, organic/conventional, salted/unsalted, whole/sliced produce.

KEEP SEPARATE: dairy fat tiers, ground meat lean %, meat/fish cuts, fresh/smoked/canned processing, dried/canned legumes, egg components, flour types, grain variants, plant-based milks, protein powders, fermented food variants, coconut products, cooking wines/vinegars.

Examples:
Input: "Yogurt, Greek, plain, nonfat"
Output: {"usda_description":"...","canonical_name":"Greek yogurt","variant":"nonfat","canonical_full":"Greek yogurt, nonfat"}

Input: "Beef, chuck, arm pot roast, separable lean only"
Output: {"usda_description":"...","canonical_name":"beef chuck","variant":null,"canonical_full":"beef chuck"}

Input: "Tuna, light, canned in water"
Output: {"usda_description":"...","canonical_name":"tuna","variant":"canned in water","canonical_full":"canned tuna in water"}

Input: "Chickpeas, mature seeds, canned, drained"
Output: {"usda_description":"...","canonical_name":"chickpeas","variant":"canned","canonical_full":"chickpeas, canned"}

Input: "Salmon, Atlantic, farmed, cooked"
Output: {"usda_description":"...","canonical_name":"salmon","variant":null,"canonical_full":"salmon"}`

async function canonicalizeBatch(entries: ProcessedEntry[]): Promise<CanonicalResult[]> {
  const inputList = entries.map(e => e.preprocessed).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: HAIKU_SYSTEM,
    messages: [{ role: 'user', content: `Canonicalize these USDA food descriptions. Return JSON array only:\n${inputList}` }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`)

  const results: CanonicalResult[] = JSON.parse(jsonMatch[0])
  return results
}

// ---- Progress tracking ----

type ProgressFile = {
  processedDescriptions: string[]
}

function loadProgress(): Set<string> {
  if (!fs.existsSync(PROGRESS_PATH)) return new Set()
  try {
    const p: ProgressFile = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'))
    return new Set(p.processedDescriptions)
  } catch {
    return new Set()
  }
}

function saveProgress(processed: Set<string>) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ processedDescriptions: [...processed] }, null, 2))
}

// ---- DB upsert ----

async function upsertIngredient(name: string, macros: ProcessedEntry['macros'], flags: string[]) {
  // Check for existing system ingredient (partial unique index: lower(name) WHERE owner_id IS NULL)
  const { data: existing } = await supabase
    .from('ingredients')
    .select('id, classification_source')
    .ilike('name', name)
    .is('owner_id', null)
    .maybeSingle()

  if (existing) {
    // Only overwrite if not user-curated
    if (existing.classification_source === 'user_submitted' || existing.classification_source === 'manual') return
    const { error } = await supabase.from('ingredients').update({
      dietary_flags: flags,
      classification_source: 'usda',
      calories_per_100g: macros.calories,
      protein_per_100g: macros.protein,
      carbs_per_100g: macros.carbs,
      fat_per_100g: macros.fat,
    }).eq('id', existing.id)
    if (error) throw new Error(`Update error for "${name}": ${error.message}`)
  } else {
    const { error } = await supabase.from('ingredients').insert({
      name,
      dietary_flags: flags,
      classification_source: 'usda',
      calories_per_100g: macros.calories,
      protein_per_100g: macros.protein,
      carbs_per_100g: macros.carbs,
      fat_per_100g: macros.fat,
    })
    if (error) throw new Error(`Insert error for "${name}": ${error.message}`)
  }
}

// ---- Main ----

async function main() {
  console.log(`USDA ingredient import${DRY_RUN ? ' (DRY RUN)' : ''}${SKIP_AI ? ' (skip AI)' : ''}`)
  console.log(`Source: ${SOURCE}\n`)

  let foundationFoods: UsdaFood[] = []
  let srFoods: UsdaFood[] = []

  if (SOURCE === 'both' || SOURCE === 'foundation') {
    foundationFoods = loadFoundation()
    console.log(`Foundation Foods loaded: ${foundationFoods.length}`)
  }
  if (SOURCE === 'both' || SOURCE === 'sr') {
    srFoods = loadSrLegacy()
    console.log(`SR Legacy loaded: ${srFoods.length}`)
  }

  // Merge — foundation takes priority (higher quality)
  const validFoundation = foundationFoods.filter(f => f?.description)
  const foundationDescs = new Set(validFoundation.map(f => f.description))
  const allFoods: UsdaFood[] = [
    ...validFoundation,
    ...srFoods.filter(f => f?.description && !foundationDescs.has(f.description)),
  ]
  console.log(`Combined (deduped by description): ${allFoods.length}`)

  // Filter
  const filtered = allFoods.filter(isAllowed)
  console.log(`After category/description filter: ${filtered.length}`)

  if (DRY_RUN) {
    const catCounts: Record<string, number> = {}
    for (const f of filtered) {
      const cat = f.foodCategory?.description ?? 'unknown'
      catCounts[cat] = (catCounts[cat] ?? 0) + 1
    }
    console.log('\nCategory breakdown:')
    Object.entries(catCounts).sort((a,b) => b[1]-a[1]).forEach(([cat, n]) => console.log(`  ${String(n).padStart(4)} ${cat}`))
    return
  }

  // Pre-process
  const entries: ProcessedEntry[] = filtered.map(f => ({
    description: f.description,
    preprocessed: preprocess(f.description),
    category: f.foodCategory?.description ?? '',
    macros: extractMacros(f),
    dietaryFlags: deriveDietaryFlags(f),
  }))

  // Load progress
  const alreadyProcessed = loadProgress()
  const todo = entries.filter(e => !alreadyProcessed.has(e.description))
  console.log(`\n${entries.length} entries to canonicalize (${alreadyProcessed.size} already done)`)

  if (SKIP_AI) {
    // Insert as-is using preprocessed name
    console.log('Skipping AI — inserting pre-processed names directly...')
    let inserted = 0
    // Deduplicate by preprocessed name
    const seen = new Map<string, ProcessedEntry>()
    for (const e of entries) {
      const key = e.preprocessed.toLowerCase()
      if (!seen.has(key)) seen.set(key, e)
    }
    for (const [, e] of seen) {
      await upsertIngredient(e.preprocessed, e.macros, e.dietaryFlags)
      inserted++
    }
    console.log(`Inserted ${inserted} ingredients (deduped from ${entries.length})`)
    return
  }

  // Haiku canonicalization in batches
  const canonicalMap = new Map<string, CanonicalResult>() // description → result

  // Re-process already-done (load their results from DB if needed — skip for simplicity)
  // We process the remaining in batches
  const batches: ProcessedEntry[][] = []
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    batches.push(todo.slice(i, i + BATCH_SIZE))
  }

  console.log(`Processing ${batches.length} batches of up to ${BATCH_SIZE}...`)

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    process.stdout.write(`  Batch ${b + 1}/${batches.length} (${batch.length} items)... `)

    try {
      const results = await canonicalizeBatch(batch)

      // Match results back to entries by position (results should be in same order)
      for (let i = 0; i < batch.length; i++) {
        const result = results[i]
        if (result?.canonical_full) {
          canonicalMap.set(batch[i].description, result)
          alreadyProcessed.add(batch[i].description)
        }
      }

      console.log(`✓ (${results.length} canonicalized)`)
    } catch (err) {
      console.error(`✗ batch ${b + 1} failed: ${err}`)
    }

    // Save progress after each batch
    saveProgress(alreadyProcessed)

    if (b < batches.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  // Deduplicate by canonical_full — keep best entry per canonical name
  // Best = prefer raw over cooked, plain over flavored
  const deduped = new Map<string, { entry: ProcessedEntry; result: CanonicalResult }>()

  for (const [desc, result] of canonicalMap) {
    const entry = entries.find(e => e.description === desc)
    if (!entry) continue

    const key = result.canonical_full.toLowerCase()
    const existing = deduped.get(key)

    if (!existing) {
      deduped.set(key, { entry, result })
      continue
    }

    // Prefer entries with more complete macros
    const newScore = [entry.macros.calories, entry.macros.protein, entry.macros.carbs, entry.macros.fat].filter(v => v != null).length
    const oldScore = [existing.entry.macros.calories, existing.entry.macros.protein, existing.entry.macros.carbs, existing.entry.macros.fat].filter(v => v != null).length

    if (newScore > oldScore) {
      deduped.set(key, { entry, result })
    }
  }

  console.log(`\n${canonicalMap.size} canonicalized → ${deduped.size} unique canonical ingredients`)

  // Upsert to DB
  let inserted = 0
  let failed = 0

  for (const [, { entry, result }] of deduped) {
    try {
      await upsertIngredient(result.canonical_full, entry.macros, entry.dietaryFlags)
      inserted++
    } catch (err) {
      console.error(`  ✗ "${result.canonical_full}": ${err}`)
      failed++
    }
  }

  console.log(`\nDone: ${inserted} inserted/updated, ${failed} failed`)

  // Clean up progress file on success
  if (failed === 0) {
    try { fs.unlinkSync(PROGRESS_PATH) } catch {}
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
