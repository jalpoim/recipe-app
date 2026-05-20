/**
 * Verifies that the DB schema and RLS policies are correctly applied.
 *
 * Usage:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npx tsx scripts/verify-schema.ts
 *
 * Or with a .env.local file already set up:
 *   npx dotenv -e .env.local -- npx tsx scripts/verify-schema.ts
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/db'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const anon = createClient<Database>(url, anonKey)

let passed = 0
let failed = 0

function ok(label: string) {
  console.log(`  ✓  ${label}`)
  passed++
}

function fail(label: string, detail?: string) {
  console.error(`  ✗  ${label}${detail ? `: ${detail}` : ''}`)
  failed++
}

async function checkTableExists(table: string) {
  const { error } = await anon.from(table as 'recipes').select('id').limit(1)
  // RLS will block rows but the table should exist (error code 42P01 = table not found)
  if (error?.code === '42P01') {
    fail(`Table "${table}" exists`, 'table not found — run the migration first')
  } else {
    ok(`Table "${table}" exists`)
  }
}

async function checkAnonBlocked(table: string) {
  const { data, error } = await anon.from(table as 'recipes').select('id').limit(1)
  if (error) {
    // Some RLS denials return an error rather than empty array
    ok(`Anon cannot read "${table}" (error returned)`)
  } else if (!data || data.length === 0) {
    ok(`Anon cannot read "${table}" (empty result)`)
  } else {
    fail(`Anon can read "${table}"`, 'RLS policy missing or incorrect')
  }
}

async function main() {
  console.log('\n── Table existence (unauthenticated client) ──────────────────')
  const tables = [
    'recipes',
    'recipe_ingredients',
    'recipe_steps',
    'households',
    'household_members',
    'plans',
    'plan_items',
    'shopping_check_state',
  ]
  for (const t of tables) await checkTableExists(t)

  console.log('\n── RLS: anon should see no rows ──────────────────────────────')
  // Anon user should get 0 rows from every table (no system recipes yet, no plans)
  for (const t of tables) await checkAnonBlocked(t)

  console.log('\n── Summary ───────────────────────────────────────────────────')
  console.log(`  ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
