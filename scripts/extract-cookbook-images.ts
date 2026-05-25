/**
 * Extracts recipe images from cookbook PDFs and uploads to Supabase Storage.
 *
 * Matching strategy (robust, name-based):
 *  1. Extract text per page via pdftotext
 *  2. Fuzzy-match each page's text against DB recipe names to find title pages
 *  3. Each recipe spans from its title page to the start of the next recipe
 *  4. Collect all images within that page range
 *  5. Use Haiku vision to pick the best "final plated dish" image from each group
 *  6. Upload hero + thumb to Supabase Storage
 *
 * Two PDFs:
 *  - ~/Downloads/EBOOK PORTUGUES.pdf             → Cooking Abs (PT) recipes
 *  - ~/Downloads/Joe x Fitness  COOKBOOK (2).pdf → Joe x Fitness recipes
 *
 * Usage:
 *   npx tsx scripts/extract-cookbook-images.ts --dry-run
 *   npx tsx scripts/extract-cookbook-images.ts
 *   npx tsx scripts/extract-cookbook-images.ts --force
 *   npx tsx scripts/extract-cookbook-images.ts --pdf cooking
 *   npx tsx scripts/extract-cookbook-images.ts --pdf joe
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 * Requires: pdfimages + pdfinfo + pdftotext (brew install poppler), sharp (pnpm add sharp)
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import sharp from 'sharp'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const PDF_FILTER = (() => {
  const i = process.argv.indexOf('--pdf')
  return i !== -1 ? process.argv[i + 1] : null
})()

const MIN_DIMENSION = 400
const MIN_PORTRAIT_RATIO = 1.2
const MAX_RENDER_PAGES = 6  // max pages to render per recipe range for Vision

type PdfSource = {
  key: string
  pdfPath: string
  label: string
  // ISO date window for fetching recipes from DB
  created_after: string
  created_before?: string
  // Skip pages before this number (intro/content-creator pages)
  min_page?: number
  // Min pixel dimension for recipe photos
  min_px?: number
  // Language of recipe names in this PDF ('pt' | 'en')
  name_language: 'pt' | 'en'
  // If set, only process recipes whose names appear in this JSON file (array of {name})
  // Used when multiple cookbooks were seeded in the same time window
  jsonPath?: string
  // Manual page overrides: recipe EN/PT name → title page number.
  // Used when PDF titles differ enough from DB names that text matching fails.
  pageOverrides?: Record<string, number>
}

const PDF_SOURCES: PdfSource[] = [
  {
    key: 'cooking',
    pdfPath: path.join(os.homedir(), 'Downloads', 'EBOOK PORTUGUES.pdf'),
    label: 'Cooking Abs (PT)',
    created_after: '2026-05-21T00:00:00Z',
    min_page: 20,
    name_language: 'pt',
  },
  {
    key: 'joe',
    pdfPath: path.join(os.homedir(), 'Downloads', 'Joe x Fitness  COOKBOOK (2).pdf'),
    label: 'Joe x Fitness',
    created_after: '2026-05-19T00:00:00Z',
    created_before: '2026-05-20T00:00:00Z',
    min_px: 430,
    min_page: 11,
    name_language: 'en',
    jsonPath: path.resolve(process.cwd(), 'scripts/joe-x-fitness-recipes.json'),
    // Korean recipes whose PDF titles use different English descriptions than the DB.
    // Page numbers confirmed via pdftotext scan.
    pageOverrides: {
      'Dakjuk (Chicken Rice Porridge)': 73,
      'Korean Egg Bites': 93,
      'Dakgalbi (Spicy Stir-Fried Chicken)': 99,
      'Mayak Eggs (Marinated Eggs)': 121,
      'Eomuk Bokkeum (Fish Cake)': 124,
      'Ojingeochae Muchim (Spicy Squid)': 127,
      'Myeolchi Bokkeum (Stir-Fried Anchovies)': 129,
      'Jangjorim (Soy Braised Beef)': 132,
      'Sangchu Geotjeori (Spicy Salad)': 138,
      'Japchae (Glass Noodle Stir Fry)': 140,
      'Sigeumchi-namul (Marinated Spinach)': 145,
      'Spicy Soondubu (Tofu Soup)': 149,
      'Miyeokguk (Seaweed Beef Soup)': 152,
      'Kimchi Jjigae (Kimchi Beef Stew)': 155,
      'Ddukguk (Beef Rice Cake Soup)': 158,
      'Muguk (Beef & Radish Soup)': 161,
      'Oi-muchim (Spicy Cucumber)': 143,
    },
  },
]

type ImageInfo = {
  index: number
  page: number
  width: number
  height: number
  enc: string
}

type DbRecipe = { id: string; name: string }

// ─── PDF utilities ──────────────────────────────────────────────────────────

function getPdfPageCount(pdfPath: string): number {
  const out = execSync(`pdfinfo "${pdfPath}" 2>/dev/null`).toString()
  const m = out.match(/Pages:\s+(\d+)/)
  return m ? parseInt(m[1]) : 0
}

function extractPageText(pdfPath: string, page: number): string {
  try {
    return execSync(
      `pdftotext -layout -f ${page} -l ${page} "${pdfPath}" - 2>/dev/null`,
      { maxBuffer: 4 * 1024 * 1024 }
    ).toString()
  } catch {
    return ''
  }
}

function listUniqueImages(pdfPath: string, minPage?: number): ImageInfo[] {
  const raw = execSync(`pdfimages -list "${pdfPath}" 2>/dev/null`, { maxBuffer: 10 * 1024 * 1024 }).toString()
  const lines = raw.split('\n').slice(2).filter(l => l.trim())

  const seen = new Set<string>()
  const result: ImageInfo[] = []

  for (const line of lines) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 13) continue
    const page = parseInt(cols[0])
    const index = parseInt(cols[1])
    const type = cols[2]
    const width = parseInt(cols[3])
    const height = parseInt(cols[4])
    const enc = cols[8]
    const objectId = `${cols[10]}-${cols[11]}`

    if (type === 'smask') continue
    if (minPage && page < minPage) continue
    if (seen.has(objectId)) continue
    seen.add(objectId)

    result.push({ index, page, width, height, enc })
  }

  return result.sort((a, b) => a.index - b.index)
}

function filterRecipeImages(images: ImageInfo[], minPx = MIN_DIMENSION): ImageInfo[] {
  return images.filter(img => {
    if (img.width < minPx || img.height < minPx) return false
    return img.height / img.width >= MIN_PORTRAIT_RATIO
  })
}

// Render a single PDF page to a JPEG buffer via pdftoppm.
// Uses the actual PDF page number in the output filename (zero-padded).
function renderPageToBuffer(pdfPath: string, page: number, dpi = 150): Buffer | null {
  const prefix = path.join(os.tmpdir(), `pdfpage-${process.pid}-${Date.now()}`)
  try {
    execSync(
      `pdftoppm -jpeg -r ${dpi} -f ${page} -l ${page} "${pdfPath}" "${prefix}" 2>/dev/null`,
      { maxBuffer: 30 * 1024 * 1024, timeout: 30000 },
    )
    // Find the output file — filename is prefix-<padded-page-num>.jpg
    const dir = path.dirname(prefix)
    const base = path.basename(prefix)
    const found = fs.readdirSync(dir).find(f => f.startsWith(base + '-') && f.endsWith('.jpg'))
    if (!found) return null
    const filePath = path.join(dir, found)
    const buf = fs.readFileSync(filePath)
    fs.unlinkSync(filePath)
    return buf
  } catch {
    return null
  }
}

async function makeHero(input: Buffer): Promise<Buffer> {
  return sharp(input).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
}

async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input).resize({ width: 400, height: 400, fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
}

async function uploadImage(buffer: Buffer, storagePath: string): Promise<string> {
  const { error } = await supabase.storage
    .from('recipe-images')
    .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Upload error for ${storagePath}: ${error.message}`)
  return supabase.storage.from('recipe-images').getPublicUrl(storagePath).data.publicUrl
}

// ─── Name matching ───────────────────────────────────────────────────────────

// Normalize text for fuzzy matching: lowercase, strip accents, collapse whitespace, remove punctuation
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Simple word-overlap similarity between two normalized strings (0–1)
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) if (wordsB.has(w)) overlap++
  return overlap / Math.max(wordsA.size, wordsB.size)
}

// For each recipe name, find the page where the actual recipe starts.
// Key insight: index/TOC pages mention many recipes but have no food photos.
// A real recipe page (or its spread) always has at least one portrait image nearby.
// Returns Map<recipeId, pageNumber>
function findRecipeTitlePages(
  pdfPath: string,
  totalPages: number,
  recipes: DbRecipe[],
  minPage: number,
  portraitImagePages: Set<number>, // pages that contain portrait-sized images
  pageOverrides: Record<string, number> = {},
  verbose = false,
): Map<string, number> {
  const normalizedNames = recipes.map(r => ({ id: r.id, name: r.name, norm: normalize(r.name) }))
  const result = new Map<string, number>()
  const usedPages = new Set<number>()

  // Apply manual page overrides first — bypasses text matching for known-problematic names
  const overriddenIds = new Set<string>()
  for (const r of normalizedNames) {
    const overridePage = pageOverrides[r.name]
    if (overridePage !== undefined) {
      result.set(r.id, overridePage)
      usedPages.add(overridePage)
      overriddenIds.add(r.id)
      if (verbose) console.log(`  p${overridePage} → "${r.name}" (manual override)`)
    }
  }

  console.log(`  Scanning ${totalPages - minPage + 1} pages for recipe titles (${overriddenIds.size} overridden)...`)

  // Score each (recipe, page) pair
  type PageScore = { id: string; name: string; page: number; textScore: number; hasNearbyImage: boolean }
  const scores: PageScore[] = []

  // Count how many recipes match each page (index pages match many; recipe pages match ~1)
  const matchesPerPage = new Map<number, number>()

  for (let page = minPage; page <= totalPages; page++) {
    const text = extractPageText(pdfPath, page)
    const normPage = normalize(text)
    let pageMatchCount = 0

    for (const r of normalizedNames) {
      if (overriddenIds.has(r.id)) continue
      let textScore = 0
      if (normPage.includes(r.norm)) {
        textScore = 1.0
      } else {
        const lines = normPage.split('\n')
        for (const line of lines) {
          if (line.length < 4) continue
          const s = wordOverlap(r.norm, line)
          if (s >= 0.7) { textScore = s; break }
        }
      }
      if (textScore > 0) {
        // A real recipe page has at least one portrait image within ±3 pages of the title
        const hasNearbyImage = [0, 1, 2, 3].some(offset =>
          portraitImagePages.has(page + offset) || portraitImagePages.has(page - offset)
        )
        scores.push({ id: r.id, name: r.name, page, textScore, hasNearbyImage })
        pageMatchCount++
      }
    }
    matchesPerPage.set(page, pageMatchCount)
  }

  // For each recipe, rank candidates: prefer pages with nearby images and low match-count
  // (avoids index/TOC pages that mention many recipes and have no images)
  for (const r of normalizedNames) {
    if (overriddenIds.has(r.id)) continue
    const candidates = scores
      .filter(s => s.id === r.id)
      .sort((a, b) => {
        // 1. Prefer pages with nearby images over those without
        if (a.hasNearbyImage !== b.hasNearbyImage) return a.hasNearbyImage ? -1 : 1
        // 2. Prefer pages that match fewer recipes (real recipe page ≈ 1–2 matches)
        const aMatches = matchesPerPage.get(a.page) ?? 0
        const bMatches = matchesPerPage.get(b.page) ?? 0
        if (aMatches !== bMatches) return aMatches - bMatches
        // 3. Earlier page wins if otherwise equal
        return a.page - b.page
      })

    if (candidates.length === 0) {
      if (verbose) console.log(`  ⚠ No page found for: ${r.name}`)
      continue
    }

    const pick = candidates.find(c => !usedPages.has(c.page))
    if (pick) {
      result.set(r.id, pick.page)
      usedPages.add(pick.page)
      if (verbose) {
        const flag = pick.hasNearbyImage ? '📷' : '⚠ no img'
        console.log(`  p${pick.page} → "${r.name}" (${flag}, ${matchesPerPage.get(pick.page)} page-matches)`)
      }
    } else if (verbose) {
      console.log(`  ⚠ All candidate pages already claimed for: ${r.name}`)
    }
  }

  return result
}

// Build page ranges: recipe N spans [titlePage[N], titlePage[N+1] - 1]
// Last recipe spans to totalPages.
function buildPageRanges(
  titlePages: Map<string, number>,
  totalPages: number,
): Map<string, { from: number; to: number }> {
  const entries = Array.from(titlePages.entries()).sort((a, b) => a[1] - b[1])
  const ranges = new Map<string, { from: number; to: number }>()

  for (let i = 0; i < entries.length; i++) {
    const [id, from] = entries[i]
    const to = i + 1 < entries.length ? entries[i + 1][1] - 1 : totalPages
    ranges.set(id, { from, to })
  }

  return ranges
}

// ─── Vision selection ────────────────────────────────────────────────────────

// Send full rendered PDF pages to Claude Vision and pick the best food photo page.
// Returns the buffer of the winning page (original resolution), or null if none qualifies.
async function selectBestFoodPage(
  pages: Array<{ page: number; buf: Buffer }>,
  recipeName: string,
): Promise<{ buf: Buffer; page: number } | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY!

  // Resize pages to 800px wide for Vision (preserves detail, controls token cost)
  const resized = await Promise.all(
    pages.map(async (p) => ({
      page: p.page,
      buf: p.buf,
      b64: (await sharp(p.buf).resize({ width: 800 }).jpeg({ quality: 80 }).toBuffer()).toString('base64'),
    })),
  )

  const content: object[] = []
  for (let i = 0; i < resized.length; i++) {
    content.push({ type: 'text', text: `Page ${i + 1} (PDF page ${resized[i].page}):` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resized[i].b64 } })
  }
  content.push({
    type: 'text',
    text: `These are consecutive pages from a cookbook for the recipe "${recipeName}". ` +
      `Which page (if any) is the best hero/thumbnail for this recipe in a meal prep app? ` +
      `Prefer: a full-bleed food photo of the final plated dish, complete in frame, good lighting, no faces. ` +
      `Hands holding the finished dish are fine. ` +
      `Skip: mostly-text pages, step-by-step prep shots, mid-cook shots, pages where the dish is cut off at the edges. ` +
      `Return ONLY JSON: {"best": <1-based index or 0 if none qualify>, "reason": "<brief>"}`,
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) return pages[0] ? { buf: pages[0].buf, page: pages[0].page } : null

  const json = await res.json() as { content?: { text?: string }[] }
  const text = json?.content?.[0]?.text?.trim() ?? ''
  try {
    const r = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { best: number; reason?: string }
    if (r.best >= 1 && r.best <= pages.length) {
      const pick = pages[r.best - 1]
      return { buf: pick.buf, page: pick.page }
    }
  } catch { /* */ }

  return pages[0] ? { buf: pages[0].buf, page: pages[0].page } : null
}

// ─── DB queries ──────────────────────────────────────────────────────────────

async function fetchRecipes(
  created_after: string,
  created_before: string | undefined,
  name_language: 'pt' | 'en',
  jsonPath?: string,
): Promise<DbRecipe[]> {
  let q = supabase
    .from('recipes')
    .select('id, name')
    .is('owner_id', null)
    .gt('created_at', created_after)
  if (created_before) q = q.lt('created_at', created_before)
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  let recipes = (data ?? []) as DbRecipe[]

  if (name_language === 'en') {
    // Replace names with English translations for matching against English PDF
    const ids = recipes.map(r => r.id)
    const { data: rtrans } = await supabase
      .from('recipe_translations')
      .select('recipe_id, name')
      .in('recipe_id', ids)
      .eq('language', 'en')

    const enMap = new Map(((rtrans ?? []) as Array<{ recipe_id: string; name: string }>).map(t => [t.recipe_id, t.name]))
    recipes = recipes.map(r => ({ id: r.id, name: enMap.get(r.id) ?? r.name }))
  }

  // Filter to only recipes listed in the JSON file (disambiguates overlapping time windows)
  if (jsonPath && fs.existsSync(jsonPath)) {
    const jsonRecipes = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Array<{ name: string }>
    const allowed = new Set(jsonRecipes.map(r => r.name))
    recipes = recipes.filter(r => allowed.has(r.name))
  }

  return recipes
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function processPdfSource(source: PdfSource) {
  console.log(`\n===== ${source.label} =====`)

  if (!fs.existsSync(source.pdfPath)) {
    console.error(`  PDF not found: ${source.pdfPath}`)
    return
  }

  const totalPages = getPdfPageCount(source.pdfPath)
  const minPage = source.min_page ?? 1
  console.log(`  PDF: ${totalPages} total pages (scanning from page ${minPage})`)

  // Fetch recipes and their display names in the PDF's language
  const recipes = await fetchRecipes(source.created_after, source.created_before, source.name_language, source.jsonPath)
  console.log(`  ${recipes.length} recipes in DB`)

  if (recipes.length === 0) {
    console.log('  Nothing to process.')
    return
  }

  // Use pdfimages metadata ONLY to build the set of pages that have portrait photos.
  // This is used by findRecipeTitlePages to reject index/TOC page matches.
  const minPx = source.min_px ?? MIN_DIMENSION
  const allUniqueImages = listUniqueImages(source.pdfPath, minPage)
  const recipeImages = filterRecipeImages(allUniqueImages, minPx)
  const portraitImagePages = new Set(recipeImages.map(img => img.page))
  console.log(`  ${recipeImages.length} portrait image objects found (for TOC filtering)`)

  // Find which page each recipe title appears on
  const titlePages = findRecipeTitlePages(source.pdfPath, totalPages, recipes, minPage, portraitImagePages, source.pageOverrides ?? {})
  console.log(`  Matched ${titlePages.size}/${recipes.length} recipes to pages`)

  const unmatched = recipes.filter(r => !titlePages.has(r.id))
  if (unmatched.length > 0) {
    console.log('  Unmatched recipes:')
    unmatched.forEach(r => console.log(`    - ${r.name}`))
  }

  // Build page ranges for matched recipes
  const pageRanges = buildPageRanges(titlePages, totalPages)
  const sorted = Array.from(pageRanges.entries()).sort((a, b) => a[1].from - b[1].from)

  if (DRY_RUN) {
    console.log('\n  Proposed matches (pages to render per recipe):')
    for (const [id, range] of sorted) {
      const recipe = recipes.find(r => r.id === id)!
      const nPages = Math.min(range.to - range.from + 1, MAX_RENDER_PAGES)
      console.log(`  p${range.from}–${range.from + nPages - 1} (of p${range.from}–${range.to}) "${recipe.name}"`)
    }
    return
  }

  // Process each recipe: render pages → Vision selects best food photo → upload
  let uploaded = 0, skipped = 0, failed = 0, noPage = 0

  for (const [id, range] of sorted) {
    const recipe = recipes.find(r => r.id === id)!

    if (!FORCE) {
      const { data: existing } = await supabase.from('recipes').select('image_url').eq('id', id).single()
      if (existing?.image_url) {
        process.stdout.write('·')
        skipped++
        continue
      }
    }

    // Render up to MAX_RENDER_PAGES pages from this recipe's range
    const pagesToRender: number[] = []
    for (let p = range.from; p <= range.to && pagesToRender.length < MAX_RENDER_PAGES; p++) {
      pagesToRender.push(p)
    }

    const pageBuffers: Array<{ page: number; buf: Buffer }> = []
    for (const page of pagesToRender) {
      const buf = renderPageToBuffer(source.pdfPath, page)
      if (buf) pageBuffers.push({ page, buf })
    }

    if (pageBuffers.length === 0) {
      console.log(`  ⚠ No pages rendered for "${recipe.name}" (p${range.from}–${range.to})`)
      noPage++
      continue
    }

    // Pick the best food-photo page via Vision
    let best: { buf: Buffer; page: number } | null = null
    try {
      best = pageBuffers.length === 1
        ? pageBuffers[0]
        : await selectBestFoodPage(pageBuffers, recipe.name)
      await new Promise(r => setTimeout(r, 250))
    } catch (e) {
      console.warn(`  ⚠ Vision failed for "${recipe.name}": ${e}`)
      best = pageBuffers[0]
    }

    if (!best) best = pageBuffers[0]

    try {
      const [heroBuffer, thumbBuffer] = await Promise.all([makeHero(best.buf), makeThumb(best.buf)])
      const [heroUrl, thumbUrl] = await Promise.all([
        uploadImage(heroBuffer, `${id}/hero.jpg`),
        uploadImage(thumbBuffer, `${id}/thumb.jpg`),
      ])

      const { error: upErr } = await supabase
        .from('recipes')
        .update({ image_url: heroUrl, image_thumb_url: thumbUrl })
        .eq('id', id)

      if (upErr) throw new Error(upErr.message)
      console.log(`  ✓ "${recipe.name}" (p${best.page})`)
      uploaded++
    } catch (err) {
      console.error(`  ✗ "${recipe.name}": ${err}`)
      failed++
    }
  }

  console.log(`\n  Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed, ${noPage} with no pages`)
  console.log(`  ${recipes.length - titlePages.size} recipes unmatched (no title page found)`)
}

async function main() {
  if (DRY_RUN) console.log('DRY RUN — no uploads will happen\n')

  const sources = PDF_FILTER
    ? PDF_SOURCES.filter(s => s.key === PDF_FILTER)
    : PDF_SOURCES

  if (sources.length === 0) {
    console.error(`Unknown --pdf filter: ${PDF_FILTER}. Use "cooking" or "joe".`)
    process.exit(1)
  }

  for (const source of sources) {
    await processPdfSource(source)
  }

  console.log('\nAll done.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
