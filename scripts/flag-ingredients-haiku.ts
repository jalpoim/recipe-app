/**
 * Uses Haiku to classify dietary flags for ingredients that have none.
 * Covers the 17 flag types: meat, poultry, fish, shellfish, dairy, egg, honey,
 * gluten, tree_nut, peanut, soy, sesame, celery, mustard, lupin, mollusc, sulphite.
 *
 * Safe to re-run — only processes rows with empty/null dietary_flags.
 *
 * Usage: npx tsx scripts/flag-ingredients-haiku.ts
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
  console.error('Missing env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

const BATCH_SIZE = 80
const VALID_FLAGS = [
  'meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'honey',
  'gluten', 'tree_nut', 'peanut', 'soy', 'sesame', 'celery', 'mustard',
  'lupin', 'mollusc', 'sulphite',
]

type IngRow = { id: string; name: string }
type FlagResult = { id: string; flags: string[] }

async function classifyBatch(batch: IngRow[]): Promise<FlagResult[]> {
  const nameList = batch.map((i, idx) => `${idx + 1}. ${i.name}`).join('\n')

  const prompt = `You are a food allergen and dietary restriction classifier. For each ingredient below, list which dietary flags apply from this exact set:
meat, poultry, fish, shellfish, dairy, egg, honey, gluten, tree_nut, peanut, soy, sesame, celery, mustard, lupin, mollusc, sulphite

Rules:
- "meat" = beef, pork, lamb, veal, game (not poultry/fish)
- "poultry" = chicken, turkey, duck, goose
- "fish" = any fish species (cod, salmon, tuna, etc.) and fish-derived products (fish sauce, worcestershire, dashi)
- "shellfish" = crustaceans: shrimp, crab, lobster, crayfish
- "mollusc" = clams, mussels, oysters, scallops, squid, octopus, cuttlefish, snails
- "dairy" = milk, cheese, yogurt, butter, cream, whey, casein
- "egg" = eggs, egg-derived products (mayo, hollandaise)
- "honey" = honey, bee products, agave syrup (fructose-heavy sweeteners)
- "gluten" = wheat, barley, rye, spelt, kamut, triticale, and products thereof (bread, pasta, beer, soy sauce unless GF-labelled)
- "tree_nut" = almonds, cashews, walnuts, hazelnuts, pistachios, macadamia, pecans, brazil nuts, pine nuts, coconut
- "peanut" = peanuts and peanut products (peanut butter, peanut oil)
- "soy" = soybeans, tofu, miso, tempeh, edamame, soy sauce, tamari
- "sesame" = sesame seeds, tahini, sesame oil
- "celery" = celery, celeriac, celery seed, celery salt
- "mustard" = mustard seeds, mustard powder, mustard condiment, mustard oil
- "lupin" = lupin/lupine beans and flour
- "mollusc" = already defined above
- "sulphite" = wine, beer, vinegar, dried fruits (raisins, apricots), some processed foods with SO2 preservatives

Return ONLY a JSON array. Each element: {"idx": <1-based number>, "flags": ["flag1","flag2"]}
Only include items that have at least one flag. Items with no flags → omit entirely.
No explanation, just the JSON array.

Ingredients:
${nameList}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx: number; flags: string[] }>
    return parsed
      .filter(r => r.idx >= 1 && r.idx <= batch.length)
      .map(r => ({
        id: batch[r.idx - 1].id,
        flags: r.flags.filter(f => VALID_FLAGS.includes(f)),
      }))
      .filter(r => r.flags.length > 0)
  } catch {
    console.warn('JSON parse failed for batch, skipping')
    return []
  }
}

async function main() {
  // Fetch all unflagged ingredients (paginated — Supabase returns max 1000 per call)
  const items: IngRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name')
      .or('dietary_flags.is.null,dietary_flags.eq.{}')
      .order('name')
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    items.push(...(data as IngRow[]))
    if (data.length < 1000) break
    offset += 1000
  }
  console.log(`Found ${items.length} unflagged ingredients`)

  let updated = 0
  let batches = 0

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    batches++
    process.stdout.write(`Batch ${batches} (${i + 1}–${Math.min(i + BATCH_SIZE, items.length)})... `)

    let results: FlagResult[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await classifyBatch(batch)
        break
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    for (const r of results) {
      const { error: upErr } = await supabase
        .from('ingredients')
        .update({ dietary_flags: r.flags })
        .eq('id', r.id)
      if (upErr) console.warn(`  Failed to update ${r.id}: ${upErr.message}`)
      else updated++
    }

    console.log(`flagged ${results.length} items`)

    // Rate limit — avoid hammering the API
    if (i + BATCH_SIZE < items.length) await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nDone. Flagged ${updated} ingredients across ${batches} batches.`)
}

main().catch(e => { console.error(e); process.exit(1) })
