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

function extractAllImages(pdfPath: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true })
  execSync(`pdfimages "${pdfPath}" "${path.join(outDir, 'img')}"`, { stdio: 'inherit' })
}

function findImageFile(outDir: string, index: number): string | null {
  const padded = String(index).padStart(3, '0')
  for (const ext of ['jpg', 'jpeg', 'png', 'ppm', 'pbm', 'pgm']) {
    const p = path.join(outDir, `img-${padded}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

async function readImageAsJpeg(filePath: string): Promise<Buffer | null> {
  const ext = path.extname(filePath).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    try { return fs.readFileSync(filePath) } catch { return null }
  }
  if (['.ppm', '.pbm', '.pgm'].includes(ext)) {
    const tmp = filePath + '.tmp.jpg'
    try {
      execSync(`sips -s format jpeg "${filePath}" --out "${tmp}" 2>/dev/null`, { timeout: 30000 })
      const buf = fs.readFileSync(tmp)
      fs.unlinkSync(tmp)
      return buf
    } catch {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      return null
    }
  }
  return null
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

// For each recipe name, find the page where it most likely first appears.
// Returns Map<recipeId, pageNumber> — only recipes confidently matched get an entry.
function findRecipeTitlePages(
  pdfPath: string,
  totalPages: number,
  recipes: DbRecipe[],
  minPage: number,
  verbose = false,
): Map<string, number> {
  const normalizedNames = recipes.map(r => ({ id: r.id, name: r.name, norm: normalize(r.name) }))
  const result = new Map<string, number>()
  const usedPages = new Set<number>()

  console.log(`  Scanning ${totalPages - minPage + 1} pages for recipe titles...`)

  // Score each (recipe, page) pair
  const scores: Array<{ id: string; name: string; page: number; score: number }> = []

  for (let page = minPage; page <= totalPages; page++) {
    const text = extractPageText(pdfPath, page)
    const normPage = normalize(text)

    for (const r of normalizedNames) {
      // Check substring first (fast path)
      if (normPage.includes(r.norm)) {
        scores.push({ id: r.id, name: r.name, page, score: 1.0 })
        continue
      }
      // Word overlap fallback
      const lines = normPage.split('\n')
      for (const line of lines) {
        if (line.length < 4) continue
        const s = wordOverlap(r.norm, line)
        if (s >= 0.7) {
          scores.push({ id: r.id, name: r.name, page, score: s })
          break
        }
      }
    }
  }

  // For each recipe, take the earliest high-confidence page match
  for (const r of normalizedNames) {
    const candidates = scores
      .filter(s => s.id === r.id)
      .sort((a, b) => a.page - b.page || b.score - a.score)

    if (candidates.length === 0) {
      if (verbose) console.log(`  ⚠ No page found for: ${r.name}`)
      continue
    }

    const best = candidates[0]
    if (!usedPages.has(best.page)) {
      result.set(r.id, best.page)
      usedPages.add(best.page)
      if (verbose) console.log(`  p${best.page} → "${r.name}" (score ${best.score.toFixed(2)})`)
    } else {
      // Page already claimed — use next best non-conflicting candidate
      const alt = candidates.find(c => !usedPages.has(c.page))
      if (alt) {
        result.set(r.id, alt.page)
        usedPages.add(alt.page)
        if (verbose) console.log(`  p${alt.page} → "${r.name}" (alt, score ${alt.score.toFixed(2)})`)
      } else if (verbose) {
        console.log(`  ⚠ Conflict — no unambiguous page for: ${r.name}`)
      }
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

const VISION_SYSTEM_PROMPT = `You evaluate cookbook photos for a meal prep app hero image.

Respond ONLY with valid JSON: {"usable": true|false, "score": 0.0–1.0, "disqualified": true|false}

DISQUALIFIED (usable=false, score=0, disqualified=true) — hard rules, no exceptions:
- A face or recognisable person is clearly visible (portrait, selfie, person in background)
- The dish is not visible or is only a minor element of the image
- Prep steps where food is being actively worked on: chopping, mixing raw ingredients, food mid-cook in a pan or oven

ALLOWED (not disqualified):
- Hands holding or presenting a finished dish — acceptable as long as the complete dish is fully in frame
- A wrist or forearm at the edge of frame while the dish is the clear subject

SCORING for non-disqualified images (higher is better):
- 0.8–1.0: Complete dish fully in frame, no people, even natural lighting, clean/simple background, appetising presentation
- 0.6–0.7: Complete dish in frame but hands/arms visible holding or presenting it
- 0.4–0.5: Dish mostly in frame, acceptable lighting, minor clutter or slight crop
- 0.2–0.3: Partial dish, harsh shadows, very dark or overexposed, unappealing
- 0.0–0.1: Not a final dish photo

The image must work as both a 400×400 thumbnail and a full-width hero. Images where the dish is cut off at the edges score low.`

type VisionResult = { index: number; score: number }

// Score images as final plated dish via Haiku vision.
// Returns them sorted best-first (highest score first).
async function rankImagesForRecipe(
  images: ImageInfo[],
  tmpDir: string,
  recipeName: string,
): Promise<VisionResult[]> {
  if (images.length === 0) return []
  if (images.length === 1) {
    // Only one candidate — still classify to verify it's actually a dish
    const img = images[0]
    const filePath = findImageFile(tmpDir, img.index)
    if (!filePath) return []
    const raw = await readImageAsJpeg(filePath)
    if (!raw) return []
    const thumb = await sharp(raw).resize({ width: 400, height: 400, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()
    const score = await scoreSingleImage(thumb, recipeName)
    return score > 0 ? [{ index: img.index, score }] : []
  }

  // Multiple candidates — send all at once and ask Haiku to rank them
  const parts: { index: number; b64: string }[] = []
  for (const img of images) {
    const filePath = findImageFile(tmpDir, img.index)
    if (!filePath) continue
    const raw = await readImageAsJpeg(filePath)
    if (!raw) continue
    const thumb = await sharp(raw).resize({ width: 400, height: 400, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()
    parts.push({ index: img.index, b64: thumb.toString('base64') })
  }

  if (parts.length === 0) return []

  return rankImagesWithVision(parts, recipeName)
}

async function scoreSingleImage(thumb: Buffer, recipeName: string): Promise<number> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY!
  const b64 = thumb.toString('base64')

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
      system: VISION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: `Evaluate this photo for the recipe: "${recipeName}"` },
        ],
      }],
    }),
  })

  if (!res.ok) return 0
  const json = await res.json() as { content?: { text?: string }[] }
  const text = json?.content?.[0]?.text?.trim() ?? ''
  try {
    const r = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
      usable: boolean; score: number; disqualified: boolean
    }
    if (!r.usable || r.disqualified) return 0
    return r.score ?? 0
  } catch { /* */ }
  return 0
}

async function rankImagesWithVision(
  parts: Array<{ index: number; b64: string }>,
  recipeName: string,
): Promise<VisionResult[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY!

  const content: object[] = []
  for (let i = 0; i < parts.length; i++) {
    content.push({ type: 'text', text: `Image ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: parts[i].b64 } })
  }
  content.push({
    type: 'text',
    text: `These are all photos from the recipe "${recipeName}". ` +
      `Score each image 0.0–1.0 for use as a hero/thumbnail in a meal prep app. ` +
      `Set score to 0 and disqualified=true only if: a face or recognisable person is visible, OR the dish is not the main subject, OR food is actively being prepared/cooked. ` +
      `Hands holding or presenting a finished dish are allowed (not disqualified) — score them 0.6–0.7 if the full dish is in frame. ` +
      `Score highest (0.8–1.0) for: complete dish fully in frame with no people, even lighting, clean background, appetising presentation. ` +
      `Score lowest for: prep steps, raw ingredients, mid-cook shots, cluttered backgrounds, dark or blown-out lighting, dish cut off at frame edges. ` +
      `Return ONLY JSON array: [{"img": 1, "score": 0.9, "disqualified": false}, ...]. No explanation.`,
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
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) return parts.map((p, i) => ({ index: p.index, score: 1 - i * 0.1 }))

  const json = await res.json() as { content?: { text?: string }[] }
  const text = json?.content?.[0]?.text?.trim() ?? ''
  try {
    const ranked = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
      img: number; score: number; disqualified?: boolean
    }>
    return ranked
      .filter(r => r.img >= 1 && r.img <= parts.length && !r.disqualified)
      .map(r => ({ index: parts[r.img - 1].index, score: r.score }))
      .sort((a, b) => b.score - a.score)
  } catch {
    return parts.map((p, i) => ({ index: p.index, score: 1 - i * 0.1 }))
  }
}

// ─── DB queries ──────────────────────────────────────────────────────────────

async function fetchRecipes(
  created_after: string,
  created_before: string | undefined,
  name_language: 'pt' | 'en',
): Promise<DbRecipe[]> {
  let q = supabase
    .from('recipes')
    .select('id, name')
    .is('owner_id', null)
    .gt('created_at', created_after)
  if (created_before) q = q.lt('created_at', created_before)
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const recipes = (data ?? []) as DbRecipe[]

  if (name_language === 'en') {
    // Replace names with English translations for matching against English PDF
    const ids = recipes.map(r => r.id)
    const { data: rtrans } = await supabase
      .from('recipe_translations')
      .select('recipe_id, name')
      .in('recipe_id', ids)
      .eq('language', 'en')

    const enMap = new Map(((rtrans ?? []) as Array<{ recipe_id: string; name: string }>).map(t => [t.recipe_id, t.name]))
    return recipes.map(r => ({ id: r.id, name: enMap.get(r.id) ?? r.name }))
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
  const recipes = await fetchRecipes(source.created_after, source.created_before, source.name_language)
  console.log(`  ${recipes.length} recipes in DB`)

  if (recipes.length === 0) {
    console.log('  Nothing to process.')
    return
  }

  // Find which page each recipe title appears on
  const titlePages = findRecipeTitlePages(source.pdfPath, totalPages, recipes, minPage)
  console.log(`  Matched ${titlePages.size}/${recipes.length} recipes to pages`)

  const unmatched = recipes.filter(r => !titlePages.has(r.id))
  if (unmatched.length > 0) {
    console.log(`  Unmatched recipes:`)
    unmatched.forEach(r => console.log(`    - ${r.name}`))
  }

  // Build page ranges for matched recipes
  const pageRanges = buildPageRanges(titlePages, totalPages)

  // Get all portrait images from PDF
  const minPx = source.min_px ?? MIN_DIMENSION
  const allUniqueImages = listUniqueImages(source.pdfPath, minPage)
  const recipeImages = filterRecipeImages(allUniqueImages, minPx)
  console.log(`  ${recipeImages.length} portrait images found (≥${minPx}px, ratio ≥${MIN_PORTRAIT_RATIO})`)

  // Group images by recipe page range
  const imagesByRecipe = new Map<string, ImageInfo[]>()
  for (const [id, range] of pageRanges.entries()) {
    const imgs = recipeImages.filter(img => img.page >= range.from && img.page <= range.to)
    imagesByRecipe.set(id, imgs)
  }

  if (DRY_RUN) {
    console.log('\n  Proposed matches:')
    const sorted = Array.from(pageRanges.entries()).sort((a, b) => a[1].from - b[1].from)
    for (const [id, range] of sorted) {
      const recipe = recipes.find(r => r.id === id)!
      const imgs = imagesByRecipe.get(id) ?? []
      console.log(`  p${range.from}–${range.to} "${recipe.name}" → ${imgs.length} image(s): ${imgs.map(i => `img-${i.index}(p${i.page})`).join(', ') || 'none'}`)
    }
    return
  }

  // Extract all images to temp dir
  const tmpDir = path.join(os.tmpdir(), `recipe-images-${source.key}-${Date.now()}`)
  console.log(`\n  Extracting images from PDF...`)
  extractAllImages(source.pdfPath, tmpDir)

  // Process each recipe
  let uploaded = 0, skipped = 0, failed = 0, noImage = 0
  const sorted = Array.from(pageRanges.entries()).sort((a, b) => a[1].from - b[1].from)

  for (const [id, range] of sorted) {
    const recipe = recipes.find(r => r.id === id)!
    const imgs = imagesByRecipe.get(id) ?? []

    if (!FORCE) {
      const { data: existing } = await supabase.from('recipes').select('image_url').eq('id', id).single()
      if (existing?.image_url) {
        process.stdout.write('·')
        skipped++
        continue
      }
    }

    if (imgs.length === 0) {
      console.log(`  ⚠ No images in range p${range.from}–${range.to} for "${recipe.name}"`)
      noImage++
      continue
    }

    // Rank images by vision and pick the best
    let ranked: VisionResult[] = []
    try {
      ranked = await rankImagesForRecipe(imgs, tmpDir, recipe.name)
      // Small delay between vision calls
      await new Promise(r => setTimeout(r, 300))
    } catch (e) {
      console.warn(`  ⚠ Vision ranking failed for "${recipe.name}": ${e}`)
      // Fall back to first image in range
      ranked = imgs.map((img, i) => ({ index: img.index, score: 1 - i * 0.1 }))
    }

    if (ranked.length === 0) {
      // No image passed vision check — use first in range as fallback
      ranked = [{ index: imgs[0].index, score: 0 }]
    }

    const bestIndex = ranked[0].index
    const imagePath = findImageFile(tmpDir, bestIndex)

    if (!imagePath) {
      console.warn(`  ⚠ img-${bestIndex} not on disk for "${recipe.name}"`)
      failed++
      continue
    }

    try {
      const rawBuffer = await readImageAsJpeg(imagePath)
      if (!rawBuffer) throw new Error('Could not read/convert image')

      const [heroBuffer, thumbBuffer] = await Promise.all([makeHero(rawBuffer), makeThumb(rawBuffer)])
      const [heroUrl, thumbUrl] = await Promise.all([
        uploadImage(heroBuffer, `${id}/hero.jpg`),
        uploadImage(thumbBuffer, `${id}/thumb.jpg`),
      ])

      const { error: upErr } = await supabase
        .from('recipes')
        .update({ image_url: heroUrl, image_thumb_url: thumbUrl })
        .eq('id', id)

      if (upErr) throw new Error(upErr.message)

      const scoreStr = ranked[0].score > 0 ? ` (score ${ranked[0].score.toFixed(2)}, ${imgs.length} candidates)` : ''
      console.log(`  ✓ "${recipe.name}"${scoreStr}`)
      uploaded++
    } catch (err) {
      console.error(`  ✗ "${recipe.name}": ${err}`)
      failed++
    }
  }

  console.log(`\n  Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed, ${noImage} with no images`)
  console.log(`  ${recipes.length - titlePages.size} recipes unmatched (no title page found)`)

  try { fs.rmSync(tmpDir, { recursive: true }) } catch { /* */ }
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
