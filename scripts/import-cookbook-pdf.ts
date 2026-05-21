/**
 * Extracts recipes from a PDF cookbook (Cooking Abs / @foodiesguide__) using Claude vision.
 * Renders each page to JPEG via qlmanage + sips, then sends to Claude for extraction.
 * Outputs scripts/cookbook-recipes.json for review before seeding.
 *
 * Usage:
 *   npx tsx scripts/import-cookbook-pdf.ts <path-to-cookbook.pdf>
 *
 * Then run:
 *   npx tsx scripts/seed-cookbook-recipes.ts
 *
 * Requires: ANTHROPIC_API_KEY in .env.local
 * Requires: macOS (uses qlmanage + sips for PDF→JPEG rendering)
 */

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production')
  process.exit(1)
}

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('Usage: npx tsx scripts/import-cookbook-pdf.ts <path-to-cookbook.pdf>')
  process.exit(1)
}

const anthropicKey = process.env.ANTHROPIC_API_KEY
if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local')
  process.exit(1)
}

const anthropic = new Anthropic({ apiKey: anthropicKey })
const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/cookbook-recipes.json')
const PROGRESS_PATH = path.resolve(process.cwd(), 'scripts/cookbook-recipes.progress.json')
const TMP_DIR = path.join(os.tmpdir(), 'cookbook-import')
fs.mkdirSync(TMP_DIR, { recursive: true })

// Pages to send per Claude call — 3 covers recipes that spread across a full spread plus one extra page
const PAGES_PER_BATCH = 3
// Advance by 2 so consecutive batches overlap by 1 page, preventing a 3-page recipe from being split at a boundary
const BATCH_ADVANCE = 2

type Category = 'Talho/Peixaria' | 'Frutas/Legumes' | 'Lacticínios' | 'Mercearia' | 'Outros'
type ProteinSlug = 'chicken' | 'beef' | 'salmon' | 'tuna' | 'eggs' | 'legumes' | 'turkey' | 'pork' | 'cod' | 'shrimp'

type ExtractedIngredient = {
  raw_text: string
  quantity: number | null
  unit: string | null
  name: string
  category: Category
  is_pantry: boolean
}

type ExtractedRecipe = {
  name: string
  time_min: number
  servings: number
  calories: number
  protein: number
  carbs: number
  fat: number
  proteins: ProteinSlug[]
  tags: string[]
  ingredients: ExtractedIngredient[]
  steps: string[]
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'submit_recipes',
  description: 'Submit all complete recipes found on these cookbook pages.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'time_min', 'servings', 'calories', 'protein', 'carbs', 'fat', 'proteins', 'tags', 'ingredients', 'steps'],
          properties: {
            name: { type: 'string', description: 'Recipe name exactly as shown (Portuguese)' },
            time_min: { type: 'number', description: 'Prep + cook time in minutes shown on the page. If not shown, estimate.' },
            servings: { type: 'number', description: 'Number of servings (porções) shown on the page.' },
            calories: { type: 'number', description: 'Calories per serving (all macros are per serving in this book).' },
            protein: { type: 'number', description: 'Protein in grams per serving.' },
            carbs: { type: 'number', description: 'Carbohydrates in grams per serving.' },
            fat: { type: 'number', description: 'Fat in grams per serving.' },
            proteins: {
              type: 'array',
              items: { type: 'string', enum: ['chicken', 'beef', 'salmon', 'tuna', 'eggs', 'legumes', 'turkey', 'pork', 'cod', 'shrimp'] },
              description: 'Primary protein sources. Use English slugs. Empty array if no clear protein (e.g. pure dessert/snack).',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags in lowercase Portuguese. Always include "fit" and "alto proteína". Add others based on recipe: "rápido" (<20min), "sem glúten", "vegetariano", "lanche", "pequeno almoço", "sobremesa", "sem açúcar", "batch cooking", etc.',
            },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                required: ['raw_text', 'quantity', 'unit', 'name', 'category', 'is_pantry'],
                properties: {
                  raw_text: { type: 'string', description: 'Full ingredient line as written, e.g. "50g de farinha de aveia". Ignore substitution notes in parentheses.' },
                  quantity: { type: ['number', 'null'], description: 'Numeric amount or null.' },
                  unit: { type: ['string', 'null'], description: 'Unit (g, ml, colher sopa, colher chá, etc.) or null.' },
                  name: { type: 'string', description: 'Ingredient name in Portuguese.' },
                  category: {
                    type: 'string',
                    enum: ['Talho/Peixaria', 'Frutas/Legumes', 'Lacticínios', 'Mercearia', 'Outros'],
                    description: 'Talho/Peixaria=meat/fish, Frutas/Legumes=produce, Lacticínios=dairy/eggs, Mercearia=dry goods/pantry, Outros=everything else',
                  },
                  is_pantry: { type: 'boolean', description: 'True for staples: olive oil, salt, pepper, vinegar, spices, herbs, sweeteners.' },
                },
              },
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Cooking steps in Portuguese as written. Include all numbered steps.',
            },
          },
        },
      },
    },
    required: ['recipes'],
  },
}

async function renderPageToJpeg(fullPdf: PDFDocument, pageIndex: number): Promise<Buffer | null> {
  try {
    const doc = await PDFDocument.create()
    const [page] = await doc.copyPages(fullPdf, [pageIndex])
    doc.addPage(page)
    const pdfBytes = await doc.save()
    const tmpPdf = path.join(TMP_DIR, `page_${pageIndex}.pdf`)
    const tmpPng = path.join(TMP_DIR, `page_${pageIndex}.pdf.png`)
    const tmpJpg = path.join(TMP_DIR, `page_${pageIndex}.jpg`)
    fs.writeFileSync(tmpPdf, pdfBytes)
    execSync(`qlmanage -t -s 1400 -o "${TMP_DIR}" "${tmpPdf}" 2>/dev/null`, { timeout: 15000 })
    if (!fs.existsSync(tmpPng)) return null
    execSync(`sips -s format jpeg -s formatOptions 88 --resampleWidth 1200 "${tmpPng}" --out "${tmpJpg}" 2>/dev/null`)
    return fs.readFileSync(tmpJpg)
  } catch {
    return null
  }
}

async function extractFromImages(images: Buffer[], pageNums: number[]): Promise<ExtractedRecipe[]> {
  const content: Anthropic.MessageParam['content'] = [
    ...images.map((img) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.toString('base64') },
    })),
    {
      type: 'text' as const,
      text: `These are pages ${pageNums.join(', ')} from the "Cooking Abs" Portuguese fitness cookbook (@foodiesguide__).

Key facts about this book:
- ALL macros are per serving (per porção) — never total
- Servings count and time are shown in a banner near the recipe title
- Macros (kcal, P, C, G) appear in boxes — may be on a different page from the ingredients/steps; combine across pages into one recipe
- Ingredients are bulleted; ignore substitution notes in parentheses
- Steps are numbered; steps may continue across pages

Extract every COMPLETE recipe whose title, macros, ingredients AND steps are all visible across these pages combined.
If a recipe is missing any of those four parts (e.g. starts or ends beyond these pages), skip it.
If these are intro/index/section pages with no recipe, call submit_recipes with an empty array.`,
    },
  ]

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content }],
  })

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) return []
  return ((toolUse.input as { recipes: ExtractedRecipe[] }).recipes) ?? []
}

async function main() {
  const absPath = path.resolve(pdfPath)
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`)
    process.exit(1)
  }

  console.log(`Loading PDF: ${absPath}`)
  const fullPdf = await PDFDocument.load(fs.readFileSync(absPath))
  const totalPages = fullPdf.getPageCount()
  console.log(`Total pages: ${totalPages}`)

  // Resume from existing output if present
  let allRecipes: ExtractedRecipe[] = []
  let startPage = 0
  if (fs.existsSync(OUTPUT_PATH)) {
    allRecipes = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'))
    if (fs.existsSync(PROGRESS_PATH)) {
      const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'))
      startPage = progress.lastPage ?? 0
    }
    console.log(`Resuming — ${allRecipes.length} recipes already extracted, starting at page ${startPage + 1}`)
  }

  const seenNames = new Set(allRecipes.map((r) => r.name.toLowerCase()))
  let consecutiveEmpty = 0

  for (let page = startPage; page < totalPages; page += BATCH_ADVANCE) {
    const batchPages = Array.from(
      { length: Math.min(PAGES_PER_BATCH, totalPages - page) },
      (_, i) => page + i,
    )

    process.stdout.write(`  Pages ${batchPages.map((p) => p + 1).join('+')}… `)

    // Render pages to JPEG
    const images: Buffer[] = []
    for (const pageIdx of batchPages) {
      const jpeg = await renderPageToJpeg(fullPdf, pageIdx)
      if (jpeg) images.push(jpeg)
    }

    if (images.length === 0) {
      console.log('render failed, skipping')
      continue
    }

    let recipes: ExtractedRecipe[] = []
    try {
      recipes = await extractFromImages(images, batchPages.map((p) => p + 1))
    } catch (err) {
      console.log(`API error: ${(err as Error).message}`)
      continue
    }

    const newRecipes = recipes.filter((r) => !seenNames.has(r.name.toLowerCase()))
    newRecipes.forEach((r) => seenNames.add(r.name.toLowerCase()))
    allRecipes.push(...newRecipes)

    console.log(`${newRecipes.length} recipes (total: ${allRecipes.length})`)

    // Save recipes and progress after every batch
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allRecipes, null, 2))
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ lastPage: page }))

    if (recipes.length === 0) {
      consecutiveEmpty++
      // Only stop if we've already found recipes — avoids bailing on intro pages
      if (consecutiveEmpty >= 6 && allRecipes.length > 0) {
        console.log('6 consecutive empty batches after recipes — likely end of cookbook.')
        break
      }
    } else {
      consecutiveEmpty = 0
    }

    // Brief pause to stay within rate limits
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`\nDone. ${allRecipes.length} recipes written to ${OUTPUT_PATH}`)
  console.log('Review the JSON, then run:')
  console.log('  npx tsx scripts/seed-cookbook-recipes.ts --owner-id <your-uuid>')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
