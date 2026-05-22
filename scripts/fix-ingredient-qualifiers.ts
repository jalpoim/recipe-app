/**
 * Fixes ingredient data lost during PDF extraction:
 * 1. Restores parenthetical qualifiers to ingredient names (e.g., "leite" → "leite (uso de amêndoa sem açúcar)")
 * 2. Sets is_optional = true for ingredients prefixed with "(opcional)"
 * 3. Sets section_label = "Recheio" for ingredients suffixed with "(recheio)"
 * Updates both recipe_ingredients and recipe_ingredient_translations (EN).
 *
 * Usage: npx tsx scripts/fix-ingredient-qualifiers.ts [--apply]
 * Without --apply: prints proposed changes for review
 * With    --apply: writes to DB
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const applyChanges = process.argv.includes('--apply')

// ---- Types ----

type JsonIngredient = {
  raw_text: string
  name: string
  quantity: number | null
  unit: string | null
  is_optional?: boolean
  section?: string | null
}

type JsonRecipe = {
  name: string
  ingredients: JsonIngredient[]
}

type DbIngredient = {
  id: string
  name: string
  is_optional: boolean
  section_label: string | null
}

type Fix = {
  id: string
  recipeName: string
  oldName: string
  newName: string
  isOptional: boolean
  sectionLabel: string | null
  reason: string
}

// ---- Qualifier extraction ----

function extractQualifier(rawText: string): {
  isOptional: boolean
  sectionLabel: string | null
  qualifier: string | null
} {
  // "(opcional) ..." prefix
  if (/^\(opcional\)/i.test(rawText.trim())) {
    return { isOptional: true, sectionLabel: null, qualifier: null }
  }

  // "... (recheio)" suffix
  if (/\(recheio\)\s*$/i.test(rawText)) {
    return { isOptional: true, sectionLabel: 'Recheio', qualifier: null }
  }

  // "(receita neste ebook)" — cross-reference, ignore
  if (/receita neste ebook/i.test(rawText)) {
    return { isOptional: false, sectionLabel: null, qualifier: null }
  }

  // Extract meaningful qualifier(s) — skip:
  // - pure measurement conversions: "(20g)", "(60ml)", "(~250ml)"
  // - "uso de X" / "ex.: X" that just restate the ingredient name
  const MEASURE_ONLY = /^\~?\d+(\.\d+)?\s*(g|ml|cl|l|kg)$/i
  const parens = [...rawText.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((p) => {
      if (MEASURE_ONLY.test(p)) return false
      // "uso de amêndoa" / "ex: amêndoa" — skip if qualifier content already in name
      // "ex.: leite de amêndoa..." — skip if qualifier contains the ingredient name itself
      const pNorm = p.toLowerCase().replace(/^(uso de|ex\.:?|ex:|como)\s*/i, '').trim()
      const beforeParen = rawText.split('(')[0].toLowerCase()
      if (pNorm.split(/\s+/).filter(w => w.length > 3).every(w => beforeParen.includes(w))) return false
      // Also skip if the qualifier text is largely contained in the DB name (would append redundantly)
      // (handled later in buildNewName)
      return true
    })
  if (parens.length > 0) {
    const qualifier = parens.join(' / ')
    return { isOptional: false, sectionLabel: null, qualifier }
  }

  return { isOptional: false, sectionLabel: null, qualifier: null }
}

function buildNewName(dbName: string, qualifier: string | null): string {
  if (!qualifier) return dbName
  // Avoid double-appending if already present
  if (dbName.includes('(')) return dbName
  // Skip if the qualifier's meaningful words are already all present in the name
  const qualifierNorm = qualifier.toLowerCase().replace(/^(uso de|ex\.:?|ex:|como|para)\s*/i, '').replace(/\s*[-–]\s*\d+\s*\w+\s*$/, '')
  const qualifierWords = qualifierNorm.replace(/[()]/g, '').split(/\s+/).filter(w => w.length > 3)
  if (qualifierWords.length > 0 && qualifierWords.every(w => dbName.toLowerCase().includes(w))) return dbName
  return `${dbName} (${qualifier})`
}

// ---- Main ----

async function main() {
  console.log(`\n🔧 Fix ingredient qualifiers — ${applyChanges ? 'APPLYING' : 'DRY RUN (pass --apply)'}\n`)

  const cookbook: JsonRecipe[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'scripts/cookbook-recipes.json'), 'utf8'),
  )

  // Fetch all system recipes from DB in one go
  const { data: allDbRecipes, error: recipeErr } = await supabase
    .from('recipes')
    .select('id, name')
    .eq('visibility', 'system')

  if (recipeErr) throw recipeErr

  const recipeByName = new Map(allDbRecipes!.map((r) => [r.name, r.id]))

  const fixes: Fix[] = []
  let skipped = 0

  for (const jsonRecipe of cookbook) {
    const recipeId = recipeByName.get(jsonRecipe.name)
    if (!recipeId) {
      console.warn(`  ⚠ Recipe not found in DB: ${jsonRecipe.name}`)
      continue
    }

    // Fetch all ingredients for this recipe from DB
    const { data: dbIngs, error: ingErr } = await supabase
      .from('recipe_ingredients')
      .select('id, name, is_optional, section_label')
      .eq('recipe_id', recipeId)

    if (ingErr) throw ingErr

    // Track which DB ingredient IDs we've already matched (handles duplicates)
    const usedIds = new Set<string>()

    for (const jsonIng of jsonRecipe.ingredients) {
      const raw = jsonIng.raw_text || ''
      if (!raw.includes('(')) continue // no parenthetical — nothing to fix

      const { isOptional, sectionLabel, qualifier } = extractQualifier(raw)

      // No fix needed for this case
      if (!isOptional && !sectionLabel && !qualifier) {
        skipped++
        continue
      }

      // Find the first unused DB ingredient matching this JSON name
      const match = (dbIngs as DbIngredient[]).find(
        (d) => !usedIds.has(d.id) && d.name.toLowerCase() === jsonIng.name.toLowerCase(),
      )

      if (!match) {
        // Try partial match as fallback
        const partial = (dbIngs as DbIngredient[]).find(
          (d) =>
            !usedIds.has(d.id) &&
            (d.name.toLowerCase().includes(jsonIng.name.toLowerCase()) ||
              jsonIng.name.toLowerCase().includes(d.name.toLowerCase())),
        )
        if (!partial) {
          console.warn(`  ⚠ [${jsonRecipe.name}] No DB match for: "${jsonIng.name}" (raw: ${raw})`)
          continue
        }
        usedIds.add(partial.id)

        const newName = buildNewName(partial.name, qualifier)
        if (
          newName === partial.name &&
          isOptional === partial.is_optional &&
          sectionLabel === partial.section_label
        ) continue

        fixes.push({
          id: partial.id,
          recipeName: jsonRecipe.name,
          oldName: partial.name,
          newName,
          isOptional,
          sectionLabel,
          reason: `partial match from "${jsonIng.name}"`,
        })
        continue
      }

      usedIds.add(match.id)

      const newName = buildNewName(match.name, qualifier)
      if (
        newName === match.name &&
        isOptional === match.is_optional &&
        sectionLabel === match.section_label
      ) continue

      fixes.push({
        id: match.id,
        recipeName: jsonRecipe.name,
        oldName: match.name,
        newName,
        isOptional,
        sectionLabel,
        reason: raw,
      })
    }
  }

  console.log(`Found ${fixes.length} ingredients to fix (${skipped} skipped — ebook cross-refs)\n`)

  for (const fix of fixes) {
    const parts = []
    if (fix.newName !== fix.oldName) parts.push(`name: "${fix.oldName}" → "${fix.newName}"`)
    if (fix.isOptional) parts.push('is_optional: true')
    if (fix.sectionLabel) parts.push(`section_label: "${fix.sectionLabel}"`)
    console.log(`  [${fix.recipeName}] ${parts.join(', ')}`)
    console.log(`    from raw: ${fix.reason}`)
  }

  if (!applyChanges) {
    console.log('\nRun with --apply to write changes.')
    return
  }

  console.log('\nApplying...')
  let applied = 0
  let translationUpdated = 0

  for (const fix of fixes) {
    // Update recipe_ingredients
    const { error } = await supabase
      .from('recipe_ingredients')
      .update({
        name: fix.newName,
        is_optional: fix.isOptional,
        section_label: fix.sectionLabel,
      })
      .eq('id', fix.id)

    if (error) {
      console.error(`  ✗ Failed to update ${fix.id}: ${error.message}`)
      continue
    }
    applied++

    // Update PT translation
    const { error: ptErr } = await supabase
      .from('recipe_ingredient_translations')
      .update({ name: fix.newName, section_label: fix.sectionLabel })
      .eq('ingredient_id', fix.id)
      .eq('language', 'pt')

    if (!ptErr) translationUpdated++

    // Update EN translation if name changed (keep EN name as-is but update section_label)
    if (fix.sectionLabel) {
      await supabase
        .from('recipe_ingredient_translations')
        .update({ section_label: 'Filling' })
        .eq('ingredient_id', fix.id)
        .eq('language', 'en')
    }
  }

  console.log(`\n✓ Applied ${applied}/${fixes.length} ingredient fixes`)
  console.log(`✓ Updated ${translationUpdated} PT translations`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
