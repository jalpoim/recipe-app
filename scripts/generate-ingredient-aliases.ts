/**
 * Generates aliases for ingredients using Claude Haiku.
 * Aliases are alternative names for the SAME ingredient (not substitutes).
 * Idempotent: skips ingredients that already have aliases.
 *
 * Usage: npx tsx scripts/generate-ingredient-aliases.ts
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/db'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient<Database>(
  process.env['VITE_SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
)

const API_KEY = process.env['ANTHROPIC_API_KEY']!
const BATCH_SIZE = 20

async function generateAliases(ingredients: { id: string; name: string }[]): Promise<Record<string, string[]>> {
  const prompt = `You are a food naming expert. For each ingredient, list its common alternative names in both Portuguese and English. Aliases must refer to the EXACT SAME ingredient — not substitutes or similar items.

Examples:
- "frango" → ["chicken", "ave", "galinha"]
- "atum em lata" → ["canned tuna", "atum enlatado"]
- "azeite" → ["olive oil", "azeite virgem extra"]
- "batata-doce" → ["sweet potato", "batata doce"]

Rules:
- Only list names that refer to EXACTLY the same food (same animal, cut, or preparation level)
- Do NOT include substitutes (e.g. do not list "salmão" as alias for "atum")
- Do NOT include broader categories (e.g. do not list "peixe" as alias for "salmão")
- Maximum 5 aliases per ingredient
- If no common aliases exist, return an empty array

Ingredients:
${ingredients.map((i, n) => `${n + 1}. ${i.name}`).join('\n')}

Respond with ONLY a JSON object where keys are ingredient names and values are string arrays of aliases:
{
  "ingredient_name": ["alias1", "alias2"],
  ...
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`API error ${res.status}`)
  const json = await res.json() as { content: Array<{ text: string }> }
  const text = json.content?.[0]?.text?.trim() ?? '{}'

  try {
    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(clean) as Record<string, string[]>
  } catch {
    console.error('Failed to parse response:', text)
    return {}
  }
}

async function main() {
  // Fetch ingredients that have no aliases yet
  const { data: ingredients, error } = await supabase
    .from('ingredients')
    .select('id, name, aliases')
    .order('name')

  if (error) throw error
  if (!ingredients?.length) { console.log('No ingredients found'); return }

  const toProcess = ingredients.filter((i) => !i.aliases || i.aliases.length === 0)
  console.log(`Processing ${toProcess.length} of ${ingredients.length} ingredients (${ingredients.length - toProcess.length} already have aliases)`)

  let processed = 0
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE)
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map((b) => b.name).join(', ')}`)

    const aliasMap = await generateAliases(batch)

    for (const ing of batch) {
      const aliases = (aliasMap[ing.name] ?? [])
        .map((a: string) => a.toLowerCase().trim())
        .filter((a: string) => a.length > 0 && a !== ing.name.toLowerCase())

      if (aliases.length > 0) {
        const { error: updateErr } = await supabase
          .from('ingredients')
          .update({ aliases })
          .eq('id', ing.id)
        if (updateErr) console.error(`Failed to update ${ing.name}:`, updateErr.message)
        else console.log(`  ✓ ${ing.name}: [${aliases.join(', ')}]`)
      } else {
        console.log(`  - ${ing.name}: no aliases`)
      }
    }

    processed += batch.length
    console.log(`Progress: ${processed}/${toProcess.length}`)

    // Rate limit: 1 batch per second
    if (i + BATCH_SIZE < toProcess.length) await new Promise((r) => setTimeout(r, 1000))
  }

  console.log('Done!')
}

main().catch(console.error)
