/**
 * Translates English-named system recipes to Portuguese.
 * - Detects likely-English names (uppercase pattern, no accented chars, or "(PT)" suffix)
 * - Saves the current English name as the EN translation in recipe_translations (if not already there)
 * - Sends batches of 20 names to Haiku for PT translation following project conventions
 * - Updates recipes.name to the Portuguese name
 * - Skips recipes that already have a proper PT name
 *
 * Usage: npx tsx scripts/translate-system-recipe-names.ts
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
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

type Recipe = { id: string; name: string }
type TranslationItem = { id: string; name_pt: string }

const SYSTEM_PROMPT = `You are a culinary translator specialising in Portuguese (European/Brazilian home cooking). You will receive a JSON array of recipe objects with "id" and "name" fields (all in English). Return ONLY a valid JSON array — no markdown, no extra text — where each object has "id" (unchanged) and "name_pt" (the Portuguese translation).

Translation conventions (follow exactly):
- Translate English words to natural Portuguese that a home cook would use
- International dish/ingredient names stay as-is: Bulgogi, Enoki, Tikka Masala, Katsu, Teriyaki, Japchae, Kimchi, Bibimbap, Gimbap, Jeon, Jjigae, Croissant, Sriracha, Piri-Piri, and similar internationally-recognised terms
- Korean dish names with parenthetical descriptions: keep the Korean name, translate only the description in parentheses. e.g. "Dakgalbi (Spicy Stir-Fried Chicken)" → "Dakgalbi (Frango Picante Salteado)"
- "French Toast" → "Tosta Francesa" (it has a recognised Portuguese equivalent)
- "Banana Bread" → keep as "Banana Bread" (widely used in Portuguese)
- Remove any "(PT)" suffix from the output name — these are internal data annotations, not part of the dish name
- Do NOT add any suffixes or annotations
- Use natural, everyday Portuguese — not overly formal or literal
- Common meat translations: chicken→frango, turkey→peru, beef→carne de vaca/bife, pork→porco, lamb→borrego/cordeiro, shrimp→camarão, salmon→salmão, cod→bacalhau, tuna→atum
- "Stir-fried" → "Salteado/a", "Grilled" → "Grelhado/a", "Baked" → "Assado/a", "Roasted" → "Assado/a", "Stuffed" → "Recheado/a", "Smoked" → "Fumado/a", "Spicy" → "Picante"
- "Bowl" → "Tigela" or keep as "Bowl" when it's a dish format (e.g. "Buddha Bowl" → keep "Buddha Bowl")
- "Toast" standalone → "Tosta"; "French Toast" → "Tosta Francesa"`

async function translateBatch(
  batch: Recipe[],
  attempt = 1
): Promise<TranslationItem[] | null> {
  const payload = batch.map((r) => ({ id: r.id, name: r.name }))

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Translate these recipe names to Portuguese following the conventions. Return ONLY a JSON array:\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      system: SYSTEM_PROMPT,
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    // Strip markdown code fences if present, then extract the JSON array
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error(`No JSON array found in response: ${raw.slice(0, 200)}`)
    return JSON.parse(jsonMatch[0]) as TranslationItem[]
  } catch (err) {
    if (attempt < 3) {
      console.warn(`  Retry batch (attempt ${attempt + 1})...`)
      await new Promise((r) => setTimeout(r, 2000))
      return translateBatch(batch, attempt + 1)
    }
    console.error('  Failed to translate batch:', err)
    return null
  }
}

async function main() {
  // Fetch system recipes with likely-English names
  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('id, name')
    .is('owner_id', null)
    .is('deleted_at', null)

  if (rErr) throw rErr
  if (!recipes || recipes.length === 0) {
    console.log('No system recipes found.')
    return
  }

  // Filter to likely-English names:
  // - name matches Title Case / multi-word uppercase pattern AND has no Portuguese accented chars
  // - OR name contains "(PT)"
  const likelyEnglish = (recipes as Recipe[]).filter((r) => {
    const hasPT = r.name.includes('(PT)')
    const hasAccents = /[áàâãéêíóôõúüçÃÕÁÀÂÊÍÓÔÚÜ]/i.test(r.name)
    const titleCaseMultiWord = /[A-Z][a-z]+ [A-Z]/.test(r.name)
    return hasPT || (titleCaseMultiWord && !hasAccents)
  })

  console.log(`${recipes.length} system recipes total, ${likelyEnglish.length} likely-English names to process`)

  if (likelyEnglish.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Check which already have an EN translation
  const ids = likelyEnglish.map((r) => r.id)
  const { data: existingEn, error: eErr } = await supabase
    .from('recipe_translations')
    .select('recipe_id')
    .eq('language', 'en')
    .in('recipe_id', ids)
  if (eErr) throw eErr

  const existingEnIds = new Set(existingEn?.map((r) => r.recipe_id) ?? [])

  // Save English names as EN translations for those that don't have one yet
  const toSaveEn = likelyEnglish.filter((r) => !existingEnIds.has(r.id))
  if (toSaveEn.length > 0) {
    console.log(`\nSaving ${toSaveEn.length} English names as EN translations...`)
    // Strip "(PT)" suffix before saving as English translation
    const enRows = toSaveEn.map((r) => ({
      recipe_id: r.id,
      language: 'en',
      name: r.name.replace(/\s*\(PT\)\s*$/, '').trim(),
    }))
    const { error: enErr } = await supabase
      .from('recipe_translations')
      .upsert(enRows, { onConflict: 'recipe_id,language' })
    if (enErr) throw enErr
    console.log(`  Saved ${enRows.length} EN translations.`)
  } else {
    console.log('\nAll likely-English recipes already have EN translations.')
  }

  // Now translate in batches of 20
  const BATCH = 20
  let successCount = 0
  let failedCount = 0
  const translations: Map<string, string> = new Map()

  console.log(`\nTranslating ${likelyEnglish.length} names to Portuguese in batches of ${BATCH}...`)

  for (let i = 0; i < likelyEnglish.length; i += BATCH) {
    const batch = likelyEnglish.slice(i, i + BATCH)
    const batchNum = Math.floor(i / BATCH) + 1
    const totalBatches = Math.ceil(likelyEnglish.length / BATCH)
    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} recipes)`)

    const results = await translateBatch(batch)
    if (!results) {
      console.error(`  Batch ${batchNum} failed entirely — skipping`)
      failedCount += batch.length
      continue
    }

    // Map results by id
    const resultMap = new Map(results.map((r) => [r.id, r.name_pt]))

    for (const recipe of batch) {
      const namePt = resultMap.get(recipe.id)
      if (!namePt) {
        console.warn(`  No translation returned for: ${recipe.name} (${recipe.id})`)
        failedCount++
        continue
      }
      translations.set(recipe.id, namePt)
      console.log(`  ${recipe.name} → ${namePt}`)
    }

    // Small pause between batches
    if (i + BATCH < likelyEnglish.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Update recipes.name in the database
  if (translations.size > 0) {
    console.log(`\nUpdating ${translations.size} recipe names in database...`)
    for (const [id, namePt] of translations) {
      const { error: uErr } = await supabase
        .from('recipes')
        .update({ name: namePt })
        .eq('id', id)
      if (uErr) {
        console.error(`  DB error updating ${id}:`, uErr)
        failedCount++
        successCount-- // don't double-count
      } else {
        successCount++
      }
    }
  }

  console.log(`\nDone. ${successCount} translated and updated, ${failedCount} failed.`)
  if (failedCount > 0) {
    console.log('Re-run the script to retry failed recipes.')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
