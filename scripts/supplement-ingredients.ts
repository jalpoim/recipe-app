/**
 * Supplement the ingredient database with:
 *   1. Portuguese names for USDA-sourced entries missing name_pt
 *   2. Better default_unit for entries with null/awkward units
 *   3. Global cuisine and specialty ingredients not in USDA
 *
 * Usage:
 *   npx tsx scripts/supplement-ingredients.ts --task pt-names    (Portuguese names only)
 *   npx tsx scripts/supplement-ingredients.ts --task units       (default units only)
 *   npx tsx scripts/supplement-ingredients.ts --task expand      (global cuisine expansion)
 *   npx tsx scripts/supplement-ingredients.ts --task expand --category "Southeast Asian pantry"
 *   npx tsx scripts/supplement-ingredients.ts                    (all tasks in order)
 */

import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') { console.error('Refusing to run in production'); process.exit(1) }

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!
if (!url || !serviceKey || !anthropicKey) { console.error('Missing env vars'); process.exit(1) }

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

const TASK_IDX = process.argv.indexOf('--task')
const TASK = TASK_IDX !== -1 ? process.argv[TASK_IDX + 1] : 'all'

const CAT_IDX = process.argv.indexOf('--category')
const ONLY_CATEGORY = CAT_IDX !== -1 ? process.argv[CAT_IDX + 1] : null

const BATCH_DELAY_MS = 150
const PT_BATCH = 50
const UNIT_BATCH = 50
const EXPAND_BATCH = 20

// ---- Portuguese names ----

async function taskPtNames() {
  console.log('\n=== Portuguese Names ===')

  // Fetch all USDA ingredients using range pagination (Supabase JS caps at 1000/page)
  const rows: { id: string; name: string }[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('ingredients')
      .select('id, name')
      .eq('classification_source', 'usda')
      .not('name', 'is', null)
      // Only fetch those without any aliases yet
      .filter('aliases', 'eq', '{}')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!page?.length) break
    rows.push(...page)
    if (page.length < PAGE) break
  }

  if (!rows.length) { console.log('No USDA ingredients without aliases found'); return }

  console.log(`${rows.length} USDA ingredients to add Portuguese names to`)

  const batches: typeof rows[] = []
  for (let i = 0; i < rows.length; i += PT_BATCH) {
    batches.push(rows.slice(i, i + PT_BATCH))
  }

  let updated = 0

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    process.stdout.write(`  Batch ${b + 1}/${batches.length}... `)

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `For each English ingredient name, provide the most common Portuguese (Portugal) name. Return JSON array: [{"id": "...", "name_pt": "..."}]\n\nIngredients:\n${batch.map(r => `{"id":"${r.id}","name":"${r.name}"}`).join('\n')}`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) { console.log('No JSON'); continue }

      const results: { id: string; name_pt: string }[] = JSON.parse(match[0])

      for (const r of results) {
        if (!r.id || !r.name_pt) continue
        // Store Portuguese name in aliases array
        const { data: existing } = await supabase.from('ingredients').select('aliases').eq('id', r.id).single()
        const aliases = existing?.aliases ?? []
        if (!aliases.includes(r.name_pt)) {
          await supabase.from('ingredients').update({ aliases: [...aliases, r.name_pt] }).eq('id', r.id)
          updated++
        }
      }

      console.log(`✓`)
    } catch (err) {
      console.error(`✗: ${err}`)
    }

    if (b < batches.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  console.log(`Updated ${updated} ingredients with Portuguese names`)
}

// ---- Default units ----


async function taskUnits() {
  console.log('\n=== Default Units ===')

  const { data: rows, error } = await supabase
    .from('ingredients')
    .select('id, name, default_unit')
    .is('default_unit', null)
    .limit(5000)

  if (error) throw error
  if (!rows?.length) { console.log('No ingredients with null unit found'); return }

  console.log(`${rows.length} ingredients need default units`)

  const batches: typeof rows[] = []
  for (let i = 0; i < rows.length; i += UNIT_BATCH) {
    batches.push(rows.slice(i, i + UNIT_BATCH))
  }

  let updated = 0

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    process.stdout.write(`  Batch ${b + 1}/${batches.length}... `)

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `For each ingredient, assign the most natural cooking unit from: g, kg, ml, L, unit, slice, clove, pinch, bunch, handful, sheet, can, sachet, tbsp, tsp, oz, lb, cup.
Return JSON array: [{"id": "...", "unit": "..."}]

Ingredients:\n${batch.map(r => `{"id":"${r.id}","name":"${r.name}"}`).join('\n')}`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) { console.log('No JSON'); continue }

      const results: { id: string; unit: string }[] = JSON.parse(match[0])

      for (const r of results) {
        if (!r.id || !r.unit) continue
        await supabase.from('ingredients').update({ default_unit: r.unit }).eq('id', r.id)
        updated++
      }

      console.log(`✓`)
    } catch (err) {
      console.error(`✗: ${err}`)
    }

    if (b < batches.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  console.log(`Updated ${updated} ingredients with default units`)
}

// ---- Global cuisine expansion ----

const EXPANSION_CATEGORIES = [
  'Portuguese/Iberian staples (bacalhau, chouriço, presunto, piri piri, farinheira, alheira, migas)',
  'West African produce (egusi, plantain varieties, fufu flours, moringa, kontomire)',
  'Southeast Asian pantry (fish sauce, shrimp paste, galangal, kaffir lime leaves, pandan, belacan)',
  'Middle Eastern pantry (za\'atar, sumac, pomegranate molasses, halloumi, freekeh, dukkah)',
  'Latin American staples (masa harina, chipotle peppers, tomatillo, epazote, ancho chile, guajillo chile)',
  'East Asian pantry (white miso, red miso, mixed miso, mirin, sake, Shaoxing wine, dashi, ponzu, rice wine vinegar)',
  'South Asian spices (asafoetida, ajwain, amchur, curry leaf, tamarind paste, chaat masala)',
  'Fermented and cultured foods (water kefir, coconut kefir, tempeh, natto, kvass, jun tea)',
  'Plant-based milks (oat milk, almond milk, soy milk, rice milk, cashew milk, hemp milk, coconut milk light, coconut milk full-fat)',
  'Protein powders (whey protein concentrate, whey protein isolate, casein protein, pea protein, rice protein, hemp protein)',
  'Alternative flours (chickpea flour, teff flour, sorghum flour, cassava flour, tigernut flour, lupin flour)',
  'Specialty vinegars and cooking wines (sherry vinegar, mirin, Shaoxing rice wine, balsamic vinegar reduction, coconut aminos, tamari)',
]

const EXPAND_SYSTEM = `Generate real cooking ingredients for a recipe app. Return a JSON array where each element is:
{
  "name": "English name a home cook would use",
  "name_pt": "Most common Portuguese (Portugal) name",
  "dietary_flags": ["only from: meat,poultry,fish,shellfish,dairy,egg,honey,gluten,tree_nut,peanut,soy,sesame"],
  "default_unit": "most natural cooking unit (g/kg/ml/L/unit/slice/clove/pinch/bunch/tbsp/tsp/cup/can)",
  "calories_per_100g": number or null,
  "protein_per_100g": number or null,
  "carbs_per_100g": number or null,
  "fat_per_100g": number or null
}

Rules:
- Only include dietary flags that are definitively and unambiguously true
- Set any macro to null if you are not confident — do not guess
- Include meaningful variants as separate entries (fat content, processing state, white vs red miso)
- Do NOT include branded products, restaurant foods, baby foods, or composite dishes`

async function taskExpand() {
  console.log('\n=== Global Cuisine Expansion ===')

  const categories = ONLY_CATEGORY
    ? EXPANSION_CATEGORIES.filter(c => c.toLowerCase().includes(ONLY_CATEGORY.toLowerCase()))
    : EXPANSION_CATEGORIES

  if (categories.length === 0) {
    console.log(`No categories match: ${ONLY_CATEGORY}`)
    return
  }

  // Fetch existing names to avoid duplicates
  const { data: existingRows } = await supabase.from('ingredients').select('name')
  const existingNames = new Set((existingRows ?? []).map(r => r.name.toLowerCase()))

  let totalInserted = 0

  for (const category of categories) {
    console.log(`\n  Category: ${category}`)

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: EXPAND_SYSTEM,
        messages: [{
          role: 'user',
          content: `Generate ${EXPAND_BATCH} ingredients for: ${category}\n\nReturn JSON array only.`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) { console.log('  No JSON'); continue }

      const items: {
        name: string
        name_pt?: string
        dietary_flags?: string[]
        default_unit?: string
        calories_per_100g?: number | null
        protein_per_100g?: number | null
        carbs_per_100g?: number | null
        fat_per_100g?: number | null
      }[] = JSON.parse(match[0])

      let inserted = 0
      let skipped = 0

      for (const item of items) {
        if (!item.name) continue
        if (existingNames.has(item.name.toLowerCase())) { skipped++; continue }

        const aliases = item.name_pt ? [item.name_pt] : []

        // Check for existing (case-insensitive match on system ingredients)
        const { data: existingRow } = await supabase
          .from('ingredients')
          .select('id')
          .ilike('name', item.name)
          .is('owner_id', null)
          .maybeSingle()

        let insertError: { message: string } | null = null
        if (existingRow) {
          skipped++
          existingNames.add(item.name.toLowerCase())
          continue
        } else {
          const { error } = await supabase.from('ingredients').insert({
            name: item.name,
            aliases,
            dietary_flags: item.dietary_flags ?? [],
            default_unit: item.default_unit ?? 'g',
            calories_per_100g: item.calories_per_100g ?? null,
            protein_per_100g: item.protein_per_100g ?? null,
            carbs_per_100g: item.carbs_per_100g ?? null,
            fat_per_100g: item.fat_per_100g ?? null,
            classification_source: 'ai',
          })
          insertError = error
        }

        if (!insertError) {
          existingNames.add(item.name.toLowerCase())
          inserted++
        } else {
          console.error(`  ✗ "${item.name}": ${insertError.message}`)
        }
      }

      console.log(`  ✓ ${inserted} inserted, ${skipped} already existed`)
      totalInserted += inserted
    } catch (err) {
      console.error(`  ✗ ${category}: ${err}`)
    }

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  console.log(`\nExpansion complete: ${totalInserted} new ingredients added`)
}

// ---- Main ----

async function main() {
  console.log(`Supplement ingredients — task: ${TASK}`)

  if (TASK === 'pt-names' || TASK === 'all') await taskPtNames()
  if (TASK === 'units' || TASK === 'all') await taskUnits()
  if (TASK === 'expand' || TASK === 'all') await taskExpand()

  console.log('\nAll done.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
