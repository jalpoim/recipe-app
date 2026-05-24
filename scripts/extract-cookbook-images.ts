/**
 * Extracts recipe images from cookbook PDFs using pdfimages, resizes with sharp,
 * and uploads to the recipe-images Supabase Storage bucket.
 *
 * Two PDFs:
 *  - ~/Downloads/EBOOK PORTUGUES.pdf            → 116 Cooking Abs recipes (84 unique images)
 *  - ~/Downloads/Joe x Fitness  COOKBOOK (2).pdf → 50 Joe x Fitness recipes
 *
 * Usage:
 *   npx tsx scripts/extract-cookbook-images.ts --dry-run     (list proposed matches, no uploads)
 *   npx tsx scripts/extract-cookbook-images.ts               (full run)
 *   npx tsx scripts/extract-cookbook-images.ts --pdf cooking (only Cooking Abs)
 *   npx tsx scripts/extract-cookbook-images.ts --pdf joe     (only Joe x Fitness)
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Requires: pdfimages + pdfinfo (brew install poppler), sharp (pnpm add sharp)
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
const PDF_FILTER = (() => {
  const i = process.argv.indexOf('--pdf')
  return i !== -1 ? process.argv[i + 1] : null
})()

// Min pixel dimension to consider as a recipe photo
const MIN_DIMENSION = 400
// Min height-to-width ratio for portrait photos (filters landscape spreads/headers)
const MIN_PORTRAIT_RATIO = 1.2

type PdfSource = {
  key: string
  pdfPath: string
  label: string
  created_after: string   // ISO — recipes seeded after this date
  created_before?: string // ISO — optional upper bound for DB query
  expected_count: number
  // If provided, only recipes whose names are in this JSON file are selected
  jsonPath?: string
  // Override minimum pixel dimension for this source (default: MIN_DIMENSION)
  min_px?: number
}

const PDF_SOURCES: PdfSource[] = [
  {
    key: 'joe',
    pdfPath: path.join(os.homedir(), 'Downloads', 'Joe x Fitness  COOKBOOK (2).pdf'),
    label: 'Joe x Fitness',
    created_after: '2026-05-19T00:00:00Z',
    created_before: '2026-05-20T00:00:00Z',
    expected_count: 50,
    jsonPath: path.resolve(process.cwd(), 'scripts/joe-x-fitness-recipes.json'),
    min_px: 430, // include smaller step/ingredient photos since hero shots are scarce
  },
  {
    key: 'cooking',
    pdfPath: path.join(os.homedir(), 'Downloads', 'EBOOK PORTUGUES.pdf'),
    label: 'Cooking Abs (PT)',
    created_after: '2026-05-21T00:00:00Z',
    expected_count: 116,
  },
]

type ImageInfo = {
  index: number
  page: number
  width: number
  height: number
  enc: string
}

// Parse `pdfimages -list` output to get metadata for all images.
// Returns deduplicated list (first occurrence per object ID) sorted by image index.
function listUniqueImages(pdfPath: string): ImageInfo[] {
  const raw = execSync(`pdfimages -list "${pdfPath}" 2>/dev/null`, { maxBuffer: 10 * 1024 * 1024 }).toString()
  const lines = raw.split('\n').slice(2).filter(l => l.trim())

  // Columns: page num type width height color comp bpc enc interp object ID ...
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
    // Object ID is two columns: "object ID" → combine into one key
    const objectId = `${cols[10]}-${cols[11]}`

    // Skip transparency masks (type: smask)
    if (type === 'smask') continue

    // Dedup by object ID (same embedded image referenced from multiple pages)
    if (seen.has(objectId)) continue
    seen.add(objectId)

    result.push({ index, page, width, height, enc })
  }

  return result.sort((a, b) => a.index - b.index)
}

// Filter to portrait recipe-like images (filters out landscape spreads, tiny icons, logos)
function filterRecipeImages(images: ImageInfo[], minPx = MIN_DIMENSION): ImageInfo[] {
  return images.filter(img => {
    if (img.width < minPx || img.height < minPx) return false
    const ratio = img.height / img.width
    return ratio >= MIN_PORTRAIT_RATIO
  })
}

// Extract all images from PDF to outDir (no conversion flags — native format)
function extractAllImages(pdfPath: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true })
  execSync(`pdfimages "${pdfPath}" "${path.join(outDir, 'img')}"`, { stdio: 'inherit' })
}

// Find the extracted file for a given image index.
// pdfimages names files as img-NNN.ppm / img-NNN.jpg / img-NNN.png
function findImageFile(outDir: string, index: number): string | null {
  const padded = String(index).padStart(3, '0')
  const extensions = ['jpg', 'jpeg', 'png', 'ppm', 'pbm', 'pgm']
  for (const ext of extensions) {
    const p = path.join(outDir, `img-${padded}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

// Read image file as a Buffer, converting from PPM/PBM via sips if needed.
// Returns null if file cannot be processed.
async function readImageAsJpeg(filePath: string): Promise<Buffer | null> {
  const ext = path.extname(filePath).toLowerCase()

  // Sharp handles JPEG/PNG/WebP natively
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    try {
      return fs.readFileSync(filePath)
    } catch {
      return null
    }
  }

  // For PPM/PBM/PGM, convert to JPEG via sips (macOS native)
  if (['.ppm', '.pbm', '.pgm'].includes(ext)) {
    const tmpJpeg = filePath + '.tmp.jpg'
    try {
      execSync(`sips -s format jpeg "${filePath}" --out "${tmpJpeg}" 2>/dev/null`, { timeout: 30000 })
      const buf = fs.readFileSync(tmpJpeg)
      fs.unlinkSync(tmpJpeg)
      return buf
    } catch {
      if (fs.existsSync(tmpJpeg)) fs.unlinkSync(tmpJpeg)
      return null
    }
  }

  return null
}

// Resize to hero: max 1200px wide, 85% quality JPEG
async function makeHero(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
}

// Resize to thumb: 400×400 cover crop, 80% quality JPEG
async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 400, height: 400, fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer()
}

async function uploadImage(buffer: Buffer, storagePath: string): Promise<string> {
  const { error } = await supabase.storage
    .from('recipe-images')
    .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Upload error for ${storagePath}: ${error.message}`)
  return supabase.storage.from('recipe-images').getPublicUrl(storagePath).data.publicUrl
}

// Fetch system recipes in insertion order for a given time window
async function fetchRecipesInOrder(
  created_after: string,
  created_before?: string,
): Promise<{ id: string; name: string }[]> {
  let q = supabase
    .from('recipes')
    .select('id, name')
    .is('owner_id', null)
    .gt('created_at', created_after)
  if (created_before) q = q.lt('created_at', created_before)
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new Error(`DB fetch error: ${error.message}`)
  return data ?? []
}

async function processPdfSource(source: PdfSource) {
  console.log(`\n===== ${source.label} =====`)

  if (!fs.existsSync(source.pdfPath)) {
    console.error(`  PDF not found: ${source.pdfPath}`)
    return
  }

  // Step 1: Get image metadata from PDF (deduped)
  console.log('  Scanning PDF image metadata...')
  const allUniqueImages = listUniqueImages(source.pdfPath)
  console.log(`  ${allUniqueImages.length} unique images in PDF`)

  const minPx = source.min_px ?? MIN_DIMENSION
  const recipeImages = filterRecipeImages(allUniqueImages, minPx)
  console.log(`  ${recipeImages.length} portrait recipe-sized images (≥${minPx}px, ratio ≥${MIN_PORTRAIT_RATIO})`)

  // Step 2: Fetch recipes from DB in insertion order
  let dbRecipes = await fetchRecipesInOrder(source.created_after, source.created_before)
  console.log(`  ${dbRecipes.length} recipes in DB (expected ${source.expected_count})`)

  // Filter by JSON name list if provided (used to disambiguate when time window overlaps other seeds)
  if (source.jsonPath && fs.existsSync(source.jsonPath)) {
    const jsonRecipes: { name: string }[] = JSON.parse(fs.readFileSync(source.jsonPath, 'utf8'))
    const allowedNames = new Set(jsonRecipes.map(r => r.name))
    dbRecipes = dbRecipes.filter(r => allowedNames.has(r.name))
    console.log(`  Filtered to ${dbRecipes.length} recipes matching ${source.jsonPath}`)
  }

  // Step 3: Extract images to temp dir
  const tmpDir = path.join(os.tmpdir(), `recipe-images-${source.key}-${Date.now()}`)
  console.log(`  Extracting images from PDF...`)
  extractAllImages(source.pdfPath, tmpDir)

  const matchCount = Math.min(recipeImages.length, dbRecipes.length)

  if (DRY_RUN) {
    console.log(`\n  Proposed matches (${matchCount} of ${dbRecipes.length} recipes will get images):`)
    for (let i = 0; i < dbRecipes.length; i++) {
      const img = recipeImages[i]
      const name = dbRecipes[i].name.substring(0, 45).padEnd(45)
      if (img) {
        const file = findImageFile(tmpDir, img.index)
        console.log(`  [${String(i).padStart(3)}] ${name} → img-${String(img.index).padStart(3)} (${img.width}×${img.height}, p${img.page}, ${img.enc})  ${file ? '✓' : '✗ not found'}`)
      } else {
        console.log(`  [${String(i).padStart(3)}] ${name} → NO IMAGE`)
      }
    }
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
    return
  }

  // Step 4: Upload images
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < matchCount; i++) {
    const recipe = dbRecipes[i]
    const img = recipeImages[i]

    // Check if already has image
    const { data: existing } = await supabase
      .from('recipes')
      .select('image_url')
      .eq('id', recipe.id)
      .single()

    if (existing?.image_url) {
      skipped++
      continue
    }

    const imagePath = findImageFile(tmpDir, img.index)
    if (!imagePath) {
      console.warn(`  [${i}] ⚠ img-${img.index} not found on disk for "${recipe.name}"`)
      failed++
      continue
    }

    try {
      const rawBuffer = await readImageAsJpeg(imagePath)
      if (!rawBuffer) throw new Error('Could not read/convert image')

      const [heroBuffer, thumbBuffer] = await Promise.all([makeHero(rawBuffer), makeThumb(rawBuffer)])
      const [heroUrl, thumbUrl] = await Promise.all([
        uploadImage(heroBuffer, `${recipe.id}/hero.jpg`),
        uploadImage(thumbBuffer, `${recipe.id}/thumb.jpg`),
      ])

      const { error: updateError } = await supabase
        .from('recipes')
        .update({ image_url: heroUrl, image_thumb_url: thumbUrl })
        .eq('id', recipe.id)

      if (updateError) throw new Error(updateError.message)

      console.log(`  [${i}] ✓ "${recipe.name}"`)
      uploaded++
    } catch (err) {
      console.error(`  [${i}] ✗ "${recipe.name}": ${err}`)
      failed++
    }
  }

  // Remaining recipes beyond matched count get no image
  if (dbRecipes.length > matchCount) {
    console.log(`  ${dbRecipes.length - matchCount} recipes have no image in PDF (will use gradient placeholder)`)
  }

  console.log(`\n  Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`)

  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
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
