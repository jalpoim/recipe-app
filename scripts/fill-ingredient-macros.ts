/**
 * Uses Haiku to fill missing macro data for ingredients with incomplete nutritional info.
 * Targets: USDA/AI ingredients where calories_per_100g is null.
 *
 * Safe to re-run — only processes rows with null calories_per_100g.
 *
 * Usage: npx tsx scripts/fill-ingredient-macros.ts
 * Requires: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!

if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

const BATCH_SIZE = 60

type IngRow = { id: string; name: string; protein_per_100g: number | null; carbs_per_100g: number | null; fat_per_100g: number | null }
type MacroResult = { id: string; calories: number; protein: number; carbs: number; fat: number }

// Items that legitimately have 0 or near-0 calories — skip these
const ZERO_CAL_KEYWORDS = ['water', 'salt', 'pepper', 'spice', 'herb', 'seasoning', 'vinegar', 'mustard', 'hot sauce', 'soy sauce', 'fish sauce', 'worcestershire', 'lemon juice', 'lime juice', 'stock', 'broth', 'gelatin']

async function fillBatch(batch: IngRow[]): Promise<MacroResult[]> {
  const lines = batch
    .map((i, idx) => {
      const known = [
        i.protein_per_100g != null ? `protein=${i.protein_per_100g}g` : null,
        i.carbs_per_100g != null ? `carbs=${i.carbs_per_100g}g` : null,
        i.fat_per_100g != null ? `fat=${i.fat_per_100g}g` : null,
      ].filter(Boolean).join(', ')
      return `${idx + 1}. ${i.name}${known ? ` (known: ${known})` : ''}`
    })
    .join('\n')

  const prompt = `You are a nutrition database expert. For each ingredient below, provide the macronutrients per 100g.

Rules:
- Provide best estimate based on standard nutritional databases (USDA SR Legacy, FNDDS)
- If known values are provided, use those and only fill in the missing ones
- calories = (protein × 4) + (carbs × 4) + (fat × 9) — use this formula for consistency
- For zero-calorie items (pure water, pure salt) return null
- Return ONLY a JSON array: [{"idx": 1, "cal": 123, "pro": 12.3, "car": 8.5, "fat": 4.2}]
- Round to 1 decimal place
- Omit items where you cannot make a reasonable estimate (novel compounds, branded products)
- No explanation, just the JSON array

Ingredients:
${lines}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx: number; cal: number; pro: number; car: number; fat: number }>
    return parsed
      .filter(r => r.idx >= 1 && r.idx <= batch.length && r.cal > 0)
      .map(r => ({
        id: batch[r.idx - 1].id,
        calories: Math.round(r.cal * 10) / 10,
        protein: Math.round(r.pro * 10) / 10,
        carbs: Math.round(r.car * 10) / 10,
        fat: Math.round(r.fat * 10) / 10,
      }))
  } catch {
    console.warn('  JSON parse failed, skipping batch')
    return []
  }
}

async function main() {
  // Fetch all ingredients with missing calories (paginated)
  const items: IngRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, protein_per_100g, carbs_per_100g, fat_per_100g')
      .is('calories_per_100g', null)
      .in('classification_source', ['usda', 'ai'])
      .order('name')
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    items.push(...(data as IngRow[]))
    if (data.length < 1000) break
    offset += 1000
  }

  // Filter out obvious zero-cal items that don't need Haiku
  const toProcess = items.filter(i => {
    const nameLower = i.name.toLowerCase()
    return !ZERO_CAL_KEYWORDS.some(kw => nameLower.includes(kw))
  })

  console.log(`Found ${items.length} ingredients with missing calories`)
  console.log(`Skipping ${items.length - toProcess.length} zero-cal items`)
  console.log(`Processing ${toProcess.length} items`)

  let updated = 0
  let batches = 0

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE)
    batches++
    process.stdout.write(`Batch ${batches} (${i + 1}–${Math.min(i + BATCH_SIZE, toProcess.length)})... `)

    let results: MacroResult[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await fillBatch(batch)
        break
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    for (const r of results) {
      const { error: upErr } = await supabase
        .from('ingredients')
        .update({
          calories_per_100g: r.calories,
          protein_per_100g: r.protein,
          carbs_per_100g: r.carbs,
          fat_per_100g: r.fat,
        })
        .eq('id', r.id)
      if (upErr) console.warn(`  Failed to update ${r.id}: ${upErr.message}`)
      else updated++
    }

    console.log(`filled ${results.length}/${batch.length}`)
    if (i + BATCH_SIZE < toProcess.length) await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\nDone. Filled macros for ${updated} ingredients across ${batches} batches.`)
}

main().catch(e => { console.error(e); process.exit(1) })
