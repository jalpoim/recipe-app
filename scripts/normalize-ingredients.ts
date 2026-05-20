/**
 * Canonicalizes and categorizes all recipe ingredients using Claude.
 * Populates the `ingredients` table and links `recipe_ingredients.ingredient_id`.
 *
 * Run AFTER applying 20260520000001_ingredients_table.sql migration.
 * Safe to re-run — idempotent throughout.
 *
 * Usage: npx tsx scripts/normalize-ingredients.ts
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

type RawIngredient = { id: string; name: string; unit: string | null }
type NormalizedIngredient = {
  original_name: string
  canonical_name: string
  category: 'meat' | 'produce' | 'dairy' | 'grains' | 'other'
  default_unit: string | null
}

async function normalizeWithClaude(names: string[]): Promise<NormalizedIngredient[]> {
  const prompt = `You are a culinary data expert. Normalize the following Portuguese ingredient names.

For each ingredient, return:
- original_name: exactly as provided
- canonical_name: clean, consistent Portuguese name (fix typos, standardize format, e.g. "frango (peito)" → "peito de frango")
- category: one of exactly: "meat", "produce", "dairy", "grains", "other"
  - meat: all meats, fish, seafood, eggs, deli
  - produce: fresh vegetables, fruits, fresh herbs
  - dairy: milk, cheese, yogurt, butter, cream
  - grains: rice, pasta, bread, flour, legumes, canned goods, oils, condiments, spices, dry goods
  - other: anything that doesn't fit above
- default_unit: most natural unit for this ingredient (g, ml, unidade, colher de sopa, dente, ramo) or null if variable

Return ONLY a valid JSON array, no markdown, no explanation:
[{"original_name":"...","canonical_name":"...","category":"...","default_unit":"..."}]

Ingredients to normalize:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON array in response')
      return JSON.parse(match[0]) as NormalizedIngredient[]
    } catch (err) {
      if (attempt === 2) throw err
      console.warn('  Retrying Claude call...')
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  return []
}

async function main() {
  // 1. Fetch all unique non-null ingredient names
  const { data: rawIngs, error: fetchErr } = await supabase
    .from('recipe_ingredients')
    .select('id, name, unit')
    .not('name', 'is', null)
  if (fetchErr) throw fetchErr

  const allIngs = rawIngs as RawIngredient[]
  const uniqueNames = [...new Set(allIngs.map((i) => i.name).filter(Boolean))]
  console.log(`Found ${uniqueNames.length} unique ingredient names across ${allIngs.length} rows`)

  // 2. Normalize with Claude in batches of 40
  const BATCH = 40
  const normalized: NormalizedIngredient[] = []

  for (let i = 0; i < uniqueNames.length; i += BATCH) {
    const batch = uniqueNames.slice(i, i + BATCH)
    console.log(`Normalizing batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(uniqueNames.length / BATCH)} (${batch.length} names)...`)
    const result = await normalizeWithClaude(batch)
    normalized.push(...result)
    if (i + BATCH < uniqueNames.length) await new Promise((r) => setTimeout(r, 800))
  }

  console.log(`\nClaude returned ${normalized.length} normalized ingredients`)

  // 3. Deduplicate by canonical_name (lowercased) — build ingredient rows
  const canonicalMap = new Map<string, NormalizedIngredient>()
  for (const n of normalized) {
    const key = n.canonical_name.toLowerCase().trim()
    if (!canonicalMap.has(key)) canonicalMap.set(key, n)
  }

  const ingredientRows = [...canonicalMap.values()].map((n) => ({
    name: n.canonical_name.trim(),
    category: n.category,
    default_unit: n.default_unit,
    owner_id: null, // system ingredients
  }))

  console.log(`${ingredientRows.length} canonical ingredients after deduplication`)

  // 4. Insert canonical ingredients — query existing first to avoid expression index conflict
  // (unique index is on lower(name), not name, so onConflict: 'name' fails)
  const { data: existingIngs, error: existingErr } = await supabase
    .from('ingredients')
    .select('name')
    .is('owner_id', null)
  if (existingErr) throw existingErr

  const existingNames = new Set(
    (existingIngs as { name: string }[]).map((i) => i.name.toLowerCase().trim())
  )
  const newRows = ingredientRows.filter((r) => !existingNames.has(r.name.toLowerCase().trim()))
  console.log(`${existingNames.size} already in DB, inserting ${newRows.length} new`)

  if (newRows.length > 0) {
    const { error: insertErr } = await supabase.from('ingredients').insert(newRows)
    if (insertErr) throw insertErr
  }
  console.log('✓ Inserted canonical ingredients')

  // 5. Fetch back all inserted ingredients to get their IDs
  const { data: insertedIngs, error: fetchIngErr } = await supabase
    .from('ingredients')
    .select('id, name')
  if (fetchIngErr) throw fetchIngErr

  const idByName = new Map(
    (insertedIngs as { id: string; name: string }[]).map((i) => [i.name.toLowerCase().trim(), i.id])
  )

  // 6. Build original_name → ingredient_id mapping
  const originalToCanonical = new Map(
    normalized.map((n) => [n.original_name.toLowerCase().trim(), n.canonical_name.toLowerCase().trim()])
  )

  // 7. Update recipe_ingredients.ingredient_id in batches
  let updated = 0
  let skipped = 0
  const updates: Array<{ id: string; ingredient_id: string }> = []

  for (const ing of allIngs) {
    const originalKey = (ing.name ?? '').toLowerCase().trim()
    const canonicalKey = originalToCanonical.get(originalKey)
    const ingredientId = canonicalKey ? idByName.get(canonicalKey) : undefined

    if (ingredientId) {
      updates.push({ id: ing.id, ingredient_id: ingredientId })
    } else {
      skipped++
    }
  }

  // Batch updates in groups of 100
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100)
    await Promise.all(
      batch.map(({ id, ingredient_id }) =>
        supabase
          .from('recipe_ingredients')
          .update({ ingredient_id })
          .eq('id', id)
      )
    )
    updated += batch.length
    if (i % 500 === 0 && i > 0) console.log(`  Updated ${i}/${updates.length} rows...`)
  }

  console.log(`\n✅ Done.`)
  console.log(`   ${ingredientRows.length} canonical ingredients in ingredients table`)
  console.log(`   ${updated} recipe_ingredients rows linked`)
  if (skipped > 0) console.log(`   ${skipped} rows skipped (no canonical match found)`)

  // 8. Summary — show category breakdown
  const { data: catBreakdown } = await supabase
    .from('ingredients')
    .select('category')
  if (catBreakdown) {
    const counts: Record<string, number> = {}
    for (const row of catBreakdown as { category: string | null }[]) {
      const cat = row.category ?? 'null'
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    console.log('\nCategory breakdown:')
    for (const [cat, count] of Object.entries(counts).sort()) {
      console.log(`   ${cat}: ${count}`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
