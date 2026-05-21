/**
 * Cheaply extracts recipe titles from a PDF cookbook using Claude Haiku vision.
 * Renders each page to JPEG via qlmanage + sips, sends to Haiku asking only for the title.
 *
 * Usage:
 *   npx tsx scripts/list-cookbook-titles.ts <path-to-cookbook.pdf>
 */

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('Usage: npx tsx scripts/list-cookbook-titles.ts <path-to-cookbook.pdf>')
  process.exit(1)
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const TMP_DIR = path.join(os.tmpdir(), 'cookbook-titles')
fs.mkdirSync(TMP_DIR, { recursive: true })

async function renderPage(fullPdf: PDFDocument, pageIndex: number): Promise<Buffer | null> {
  try {
    const doc = await PDFDocument.create()
    const [page] = await doc.copyPages(fullPdf, [pageIndex])
    doc.addPage(page)
    const tmpPdf = path.join(TMP_DIR, `page_${pageIndex}.pdf`)
    const tmpPng = path.join(TMP_DIR, `page_${pageIndex}.pdf.png`)
    const tmpJpg = path.join(TMP_DIR, `page_${pageIndex}.jpg`)
    if (fs.existsSync(tmpJpg)) return fs.readFileSync(tmpJpg)
    fs.writeFileSync(tmpPdf, await doc.save())
    execSync(`qlmanage -t -s 800 -o "${TMP_DIR}" "${tmpPdf}" 2>/dev/null`, { timeout: 15000 })
    if (!fs.existsSync(tmpPng)) return null
    execSync(`sips -s format jpeg -s formatOptions 70 --resampleWidth 700 "${tmpPng}" --out "${tmpJpg}" 2>/dev/null`)
    return fs.readFileSync(tmpJpg)
  } catch {
    return null
  }
}

async function getTitles(images: Buffer[], pageNums: number[]): Promise<string[]> {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.toString('base64') },
        })),
        {
          type: 'text' as const,
          text: `These are pages ${pageNums.join(', ')} from a fitness cookbook. List only the recipe title(s) visible — one per line. If a page has no recipe title (intro, index, section divider, photo-only), output nothing for it. Output only the titles, no other text.`,
        },
      ],
    }],
  })
  const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

async function main() {
  const absPath = path.resolve(pdfPath)
  const fullPdf = await PDFDocument.load(fs.readFileSync(absPath))
  const totalPages = fullPdf.getPageCount()
  console.log(`${totalPages} pages — scanning for titles with Haiku…\n`)

  const allTitles: string[] = []
  const BATCH = 3
  const ADVANCE = 2

  for (let page = 0; page < totalPages; page += ADVANCE) {
    const batchPages = Array.from({ length: Math.min(BATCH, totalPages - page) }, (_, i) => page + i)
    process.stdout.write(`  Pages ${batchPages.map((p) => p + 1).join('+')}… `)

    const images: Buffer[] = []
    for (const idx of batchPages) {
      const jpg = await renderPage(fullPdf, idx)
      if (jpg) images.push(jpg)
    }
    if (images.length === 0) { console.log('render failed'); continue }

    try {
      const titles = await getTitles(images, batchPages.map((p) => p + 1))
      if (titles.length) {
        titles.forEach((t) => allTitles.push(t))
        console.log(titles.join(' | '))
      } else {
        console.log('—')
      }
    } catch (err) {
      console.log(`error: ${(err as Error).message}`)
    }

    await new Promise((r) => setTimeout(r, 150))
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Found ${allTitles.length} recipe titles:\n`)
  allTitles.forEach((t, i) => console.log(`${i + 1}. ${t}`))
}

main().catch((err) => { console.error(err); process.exit(1) })
