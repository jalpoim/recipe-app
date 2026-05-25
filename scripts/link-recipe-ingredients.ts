/**
 * Links recipe_ingredients.ingredient_id to canonical ingredients for system recipes.
 * Uses pg_trgm to find candidate matches, then Haiku to resolve ambiguous cases.
 *
 * Strategy per unlinked ingredient name:
 *  1. pg_trgm similarity search → top 8 candidates
 *  2. Haiku picks the best match (or "none")
 *  3. Update all recipe_ingredients rows with that name
 *
 * Safe to re-run — only processes rows with ingredient_id IS NULL on system recipes.
 *
 * Usage: npx tsx scripts/link-recipe-ingredients.ts
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

const HAIKU_BATCH = 25  // ingredient names per Haiku call
const CANDIDATES_PER = 8 // pg_trgm candidates to fetch per name

type Candidate = { id: string; name: string; similarity: number }

// Fetch top candidates for a batch of ingredient names using pg_trgm
async function fetchCandidates(names: string[]): Promise<Map<string, Candidate[]>> {
  const results = new Map<string, Candidate[]>()

  // Run one query per name (pg_trgm doesn't batch well across different search terms)
  await Promise.all(
    names.map(async (name) => {
      const { data, error } = await supabase.rpc('search_ingredients_fuzzy', {
        search_term: name,
        result_limit: CANDIDATES_PER,
      } as never)

      if (error || !data) {
        // Fallback: ILIKE
        const { data: ilike } = await supabase
          .from('ingredients')
          .select('id, name')
          .ilike('name', `%${name.split(' ')[0]}%`)
          .limit(CANDIDATES_PER)
        results.set(name, (ilike ?? []).map(r => ({ id: r.id, name: r.name, similarity: 0 })))
      } else {
        results.set(name, (data as Candidate[]))
      }
    })
  )

  return results
}

type LinkDecision = { name: string; ingredientId: string | null }

async function resolveWithHaiku(
  batch: Array<{ name: string; candidates: Candidate[] }>
): Promise<LinkDecision[]> {
  const lines = batch.map((item, idx) => {
    const opts = item.candidates.length > 0
      ? item.candidates.map((c, ci) => `  ${ci + 1}. [${c.id}] ${c.name}`).join('\n')
      : '  (no candidates found)'
    return `### ${idx + 1}. Ingredient: "${item.name}"\nCandidates:\n${opts}`
  }).join('\n\n')

  const prompt = `You are matching messy recipe ingredient names to canonical ingredient database entries.

For each ingredient below, pick the best matching candidate ID or return null.

Rules:
- Match to the base ingredient, ignoring preparation qualifiers like: cozida/cozido, maduro/a, fumado/a, fresco/a, ralado/a, laminado/a, desfiado/a, em spray, em pó, triturado, picado, etc.
- When there are alternatives (e.g. "X ou Y"), match to the FIRST / primary option
- Compound descriptions (e.g. "sal, pimenta e alho em pó") → null (can't link to a single ingredient)
- Spice/seasoning blends → null if no exact match
- Brand-specific or made-up items (e.g. "proteína em pó sabor X") → null
- Only return null if genuinely no reasonable match exists

Return ONLY a JSON array: [{"idx": 1, "id": "<uuid or null>"}, ...]
No explanation.

${lines}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return batch.map(b => ({ name: b.name, ingredientId: null }))

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx: number; id: string | null }>
    const decisions: LinkDecision[] = batch.map(b => ({ name: b.name, ingredientId: null }))
    for (const r of parsed) {
      if (r.idx >= 1 && r.idx <= batch.length) {
        decisions[r.idx - 1].ingredientId = r.id ?? null
      }
    }
    return decisions
  } catch {
    console.warn('  JSON parse failed, skipping batch')
    return batch.map(b => ({ name: b.name, ingredientId: null }))
  }
}

async function main() {
  // 1. Fetch all distinct unlinked names from system recipes (owner_id IS NULL)
  // Two-step: get system recipe IDs first, then unlinked ingredient names
  const { data: sysRecipes, error: sysErr } = await supabase
    .from('recipes')
    .select('id')
    .is('owner_id', null)
  if (sysErr) throw new Error(sysErr.message)
  const sysIds = (sysRecipes ?? []).map(r => r.id)

  const { data: nameRows, error: nameErr } = await supabase
    .from('recipe_ingredients')
    .select('name')
    .in('recipe_id', sysIds)
    .is('ingredient_id', null)
  if (nameErr) throw new Error(nameErr.message)

  const distinctNames = [
    ...new Set((nameRows ?? []).map(r => (r.name as string)?.trim()).filter(Boolean))
  ]
  console.log(`Found ${distinctNames.length} distinct unlinked ingredient names`)

  // 2. Fetch candidates for each name using pg_trgm
  console.log('Fetching fuzzy candidates...')
  const candidateMap = await fetchCandidates(distinctNames)

  // 3. Prepare batches for Haiku
  const toResolve = distinctNames.map(name => ({
    name,
    candidates: candidateMap.get(name) ?? [],
  }))

  const decisions: LinkDecision[] = []
  let batchNum = 0

  for (let i = 0; i < toResolve.length; i += HAIKU_BATCH) {
    const batch = toResolve.slice(i, i + HAIKU_BATCH)
    batchNum++
    process.stdout.write(`Resolving batch ${batchNum} (${i + 1}–${Math.min(i + HAIKU_BATCH, toResolve.length)})... `)

    let results: LinkDecision[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await resolveWithHaiku(batch)
        break
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    const matched = results.filter(r => r.ingredientId !== null).length
    console.log(`matched ${matched}/${batch.length}`)
    decisions.push(...results)

    if (i + HAIKU_BATCH < toResolve.length) await new Promise(r => setTimeout(r, 400))
  }

  // 4. Apply decisions — update all recipe_ingredient rows with each name
  console.log('\nApplying links...')
  let linked = 0
  let skipped = 0

  for (const decision of decisions) {
    if (!decision.ingredientId) {
      skipped++
      continue
    }

    const { error: upErr, count } = await supabase
      .from('recipe_ingredients')
      .update({ ingredient_id: decision.ingredientId })
      .eq('name', decision.name)
      .in('recipe_id', sysIds)
      .is('ingredient_id', null)

    if (upErr) {
      console.warn(`  Failed to link "${decision.name}": ${upErr.message}`)
    } else {
      linked += count ?? 0
    }
  }

  // 5. Summary
  console.log(`\n=== Done ===`)
  console.log(`Linked: ${linked} recipe_ingredient rows`)
  console.log(`No match: ${skipped} ingredient names`)

  // Print unmatched for review
  const unmatched = decisions.filter(d => !d.ingredientId).map(d => d.name)
  if (unmatched.length > 0) {
    console.log('\nUnmatched (review manually):')
    unmatched.forEach(n => console.log(` - ${n}`))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
