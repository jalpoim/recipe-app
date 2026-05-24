/**
 * Consolidates the 184 manual Portuguese ingredient entries into their canonical USDA equivalents.
 *
 * For each manual ingredient:
 *  1. Find USDA candidates via pg_trgm (searches name + aliases)
 *  2. Haiku picks the best match with qualifier awareness (magro → nonfat, inteiro → whole milk, etc.)
 *  3. Re-point recipe_ingredients rows from manual.id → usda.id
 *  4. Save the Portuguese name as ingredient_translations(language='pt') for the canonical entry
 *  5. Save the USDA English name as ingredient_translations(language='en') if not already there
 *  6. Delete the manual entry (if all links were migrated)
 *
 * Safe to re-run — skips manual entries already migrated (no recipe_ingredient links left).
 *
 * Usage: npx tsx scripts/consolidate-manual-ingredients.ts
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

const HAIKU_BATCH = 20
const CANDIDATES_PER = 10

type ManualIng = { id: string; name: string }
type Candidate = { id: string; name: string; similarity: number; calories_per_100g: number | null }
type Decision = { manualId: string; manualName: string; canonicalId: string | null; canonicalName: string | null }

async function fetchCandidates(name: string): Promise<Candidate[]> {
  const { data, error } = await supabase.rpc('search_ingredients_fuzzy', {
    search_term: name,
    result_limit: CANDIDATES_PER,
  } as never)

  if (error || !data) {
    // ILIKE fallback on first word
    const word = name.split(/\s+/)[0]
    const { data: ilike } = await supabase
      .from('ingredients')
      .select('id, name, calories_per_100g')
      .in('classification_source', ['usda', 'ai'])
      .ilike('name', `%${word}%`)
      .limit(CANDIDATES_PER)
    return (ilike ?? []).map(r => ({ id: r.id, name: r.name, similarity: 0, calories_per_100g: r.calories_per_100g }))
  }

  // Enrich with calories
  const ids = (data as Candidate[]).map(c => c.id)
  const { data: enriched } = await supabase
    .from('ingredients')
    .select('id, calories_per_100g')
    .in('id', ids)
  const calMap = new Map((enriched ?? []).map(e => [e.id, e.calories_per_100g]))

  return (data as Candidate[]).map(c => ({ ...c, calories_per_100g: calMap.get(c.id) ?? null }))
}

async function resolveWithHaiku(
  batch: Array<{ manual: ManualIng; candidates: Candidate[] }>
): Promise<Decision[]> {
  const lines = batch.map((item, idx) => {
    const opts = item.candidates.length > 0
      ? item.candidates.map((c, ci) =>
          `  ${ci + 1}. [${c.id}] ${c.name}${c.calories_per_100g != null ? ` (${c.calories_per_100g} kcal/100g)` : ''}`
        ).join('\n')
      : '  (no candidates found)'
    return `### ${idx + 1}. Portuguese name: "${item.manual.name}"\nCandidates (USDA/AI, English names):\n${opts}`
  }).join('\n\n')

  const prompt = `You are matching Portuguese ingredient names to canonical English-named USDA database entries.

For each Portuguese ingredient, pick the best-matching candidate ID.

Qualifier mapping rules (CRITICAL for macros accuracy):
- magro / light / desnatado / 0% → pick the nonfat or lowfat variant
- meio-gordo / semi-desnatado → pick the reduced-fat or lowfat variant
- gordo / inteiro → pick the whole milk / full-fat variant
- natural / simples / plain → prefer "plain" variants over flavored
- fumado → smoked variant if available
- cru → raw variant
- cozido / assado / grelhado → cooked variant if available, else raw is acceptable
- em pó → powdered/dried variant
- fresco → fresh variant

Other rules:
- Strip preparation qualifiers (picado, laminado, ralado, etc.) and match the base ingredient
- "X ou Y" alternatives → match the FIRST option
- If the name is a compound dish or blend (e.g. "caldo de carne e legumes") → null
- Brand names or very specific products → null if no clear match
- Prefer candidates with calorie data over those without

Return ONLY a JSON array: [{"idx": 1, "id": "<uuid or null>"}]
No explanation.

${lines}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return batch.map(b => ({ manualId: b.manual.id, manualName: b.manual.name, canonicalId: null, canonicalName: null }))

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx: number; id: string | null }>
    return batch.map((b, i) => {
      const result = parsed.find(r => r.idx === i + 1)
      const canonicalId = result?.id ?? null
      const candidate = canonicalId ? b.candidates.find(c => c.id === canonicalId) : null
      return {
        manualId: b.manual.id,
        manualName: b.manual.name,
        canonicalId,
        canonicalName: candidate?.name ?? null,
      }
    })
  } catch {
    console.warn('  JSON parse failed, skipping batch')
    return batch.map(b => ({ manualId: b.manual.id, manualName: b.manual.name, canonicalId: null, canonicalName: null }))
  }
}

async function upsertTranslation(ingredientId: string, language: string, name: string) {
  const { error } = await supabase
    .from('ingredient_translations')
    .upsert({ ingredient_id: ingredientId, language, name }, { onConflict: 'ingredient_id,language', ignoreDuplicates: true })
  if (error) console.warn(`    Translation upsert failed for ${ingredientId}/${language}: ${error.message}`)
}

async function main() {
  // Fetch all manual ingredients
  const { data: manualItems, error: manErr } = await supabase
    .from('ingredients')
    .select('id, name')
    .eq('classification_source', 'manual')
    .order('name')
  if (manErr) throw new Error(manErr.message)

  const manual = (manualItems ?? []) as ManualIng[]
  console.log(`Found ${manual.length} manual ingredients to consolidate`)

  // Fetch candidates for all of them (parallelised in groups of 20 to avoid rate limits)
  console.log('Fetching fuzzy candidates...')
  const toResolve: Array<{ manual: ManualIng; candidates: Candidate[] }> = []

  for (let i = 0; i < manual.length; i += 20) {
    const chunk = manual.slice(i, i + 20)
    const results = await Promise.all(chunk.map(async m => ({
      manual: m,
      candidates: (await fetchCandidates(m.name)).filter(c => c.id !== m.id),
    })))
    toResolve.push(...results)
    if (i + 20 < manual.length) await new Promise(r => setTimeout(r, 200))
  }

  // Resolve with Haiku in batches
  const decisions: Decision[] = []
  let batchNum = 0

  for (let i = 0; i < toResolve.length; i += HAIKU_BATCH) {
    const batch = toResolve.slice(i, i + HAIKU_BATCH)
    batchNum++
    process.stdout.write(`Resolving batch ${batchNum} (${i + 1}–${Math.min(i + HAIKU_BATCH, toResolve.length)})... `)

    let results: Decision[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await resolveWithHaiku(batch)
        break
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    const matched = results.filter(r => r.canonicalId !== null).length
    console.log(`matched ${matched}/${batch.length}`)
    decisions.push(...results)

    if (i + HAIKU_BATCH < toResolve.length) await new Promise(r => setTimeout(r, 400))
  }

  // Apply decisions
  console.log('\nApplying consolidations...')
  let relinked = 0
  let translationsAdded = 0
  let deleted = 0
  const unmatched: string[] = []

  for (const d of decisions) {
    if (!d.canonicalId) {
      unmatched.push(d.manualName)
      continue
    }

    // Re-point recipe_ingredients
    const { error: upErr } = await supabase
      .from('recipe_ingredients')
      .update({ ingredient_id: d.canonicalId })
      .eq('ingredient_id', d.manualId)
    if (upErr) {
      console.warn(`  Re-link failed for "${d.manualName}": ${upErr.message}`)
      continue
    }

    // Save PT translation (the Portuguese name → canonical ingredient)
    await upsertTranslation(d.canonicalId, 'pt', d.manualName)
    translationsAdded++

    // Save EN translation (USDA name) if not already there
    if (d.canonicalName) {
      await upsertTranslation(d.canonicalId, 'en', d.canonicalName)
    }

    // Delete the manual entry (no more links)
    const { error: delErr } = await supabase
      .from('ingredients')
      .delete()
      .eq('id', d.manualId)
    if (delErr) {
      console.warn(`  Delete failed for "${d.manualName}": ${delErr.message}`)
    } else {
      deleted++
    }

    relinked++
    process.stdout.write('.')
  }

  console.log('\n')
  console.log(`=== Done ===`)
  console.log(`Consolidated: ${relinked} manual ingredients`)
  console.log(`PT translations added: ${translationsAdded}`)
  console.log(`Manual entries deleted: ${deleted}`)
  console.log(`Unmatched (kept as-is): ${unmatched.length}`)

  if (unmatched.length > 0) {
    console.log('\nUnmatched manual ingredients (review manually):')
    unmatched.forEach(n => console.log(` - ${n}`))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
