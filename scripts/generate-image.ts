/**
 * AI image generator — DALL-E 3
 *
 * Usage:
 *   pnpm tsx scripts/generate-image.ts --prompt "chicken drumstick" --type icon --out public/icons/chicken.png
 *   pnpm tsx scripts/generate-image.ts --prompt "grilled salmon with lemon" --type recipe --out /tmp/salmon.png
 *   pnpm tsx scripts/generate-image.ts --prompt "trending / fire" --type icon --out /tmp/em-alta.png --upload icons
 *
 * Flags:
 *   --prompt   Required. What to generate.
 *   --type     "icon" (default) or "recipe". Controls size and style prefix.
 *   --out      Output file path. Defaults to ./generated-<type>-<timestamp>.png
 *   --upload   Supabase Storage bucket name to upload to (e.g. "icons" or "recipe-images").
 *              Requires SUPABASE_SERVICE_ROLE_KEY in .env.local for write access.
 *   --hd       Use HD quality (doubles cost, ~$0.08 per image).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function arg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : undefined
}

function flag(name: string): boolean {
  return args.includes(`--${name}`)
}

const prompt = arg('prompt')
const type = (arg('type') ?? 'icon') as 'icon' | 'recipe'
const outArg = arg('out')
const uploadBucket = arg('upload')
const hd = flag('hd')

if (!prompt) {
  console.error('Error: --prompt is required')
  console.error('Example: pnpm tsx scripts/generate-image.ts --prompt "chicken drumstick" --type icon --out /tmp/chicken.png')
  process.exit(1)
}

if (!['icon', 'recipe'].includes(type)) {
  console.error('Error: --type must be "icon" or "recipe"')
  process.exit(1)
}

// ── config ───────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY not found in .env.local')
  process.exit(1)
}

// Icon style: produces a cohesive series — same background treatment, same illustration weight,
// same color warmth across all chips. Only the subject changes per call.
const ICON_STYLE_PREFIX =
  'One icon from a consistent UI series for a recipe and meal-prep app. ' +
  'Style: flat illustration with a single bold food or cooking subject, centered on a soft rounded-square background. ' +
  'Pastel warm background color (choose one that suits the subject). ' +
  'Thick clean outlines, friendly and modern, slightly stylized but not cartoonish. ' +
  'No text. No drop shadows. No gradients on the subject. No 3D effects. No frames or borders. ' +
  'Consistent stroke weight and color saturation across the series. White or transparent margin around icon. ' +
  '1:1 square ratio. Subject: '

// Recipe style: food photography optimized for recipe card thumbnails.
const RECIPE_STYLE_PREFIX =
  'Professional food photography for a recipe app thumbnail. ' +
  'Natural soft window light. Clean neutral background (white, cream, or light wood). ' +
  'Overhead or 45-degree angle. Appetizing plating, restaurant quality presentation. ' +
  'Shallow depth of field with soft bokeh. No text, no watermarks, no props that distract. Dish: '

const STYLE: Record<'icon' | 'recipe', { prefix: string; size: string }> = {
  icon:   { prefix: ICON_STYLE_PREFIX,   size: '1024x1024' },
  recipe: { prefix: RECIPE_STYLE_PREFIX, size: '1536x1024' },
}

// ── generate ─────────────────────────────────────────────────────────────────

const fullPrompt = STYLE[type].prefix + prompt
const outPath = outArg ?? `generated-${type}-${Date.now()}.png`

console.log(`\nGenerating ${type} image (${hd ? 'HD' : 'standard'})…`)
console.log(`Prompt: ${fullPrompt}\n`)

const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-image-2',
    prompt: fullPrompt,
    n: 1,
    size: STYLE[type].size,
    quality: hd ? 'high' : 'medium',
  }),
})

if (!res.ok) {
  const body = await res.text()
  console.error('OpenAI API error:', res.status, body)
  process.exit(1)
}

const json = await res.json() as { data: { b64_json?: string; url?: string; revised_prompt?: string }[] }
const item = json.data[0]
const revisedPrompt = item.revised_prompt

if (revisedPrompt && revisedPrompt !== fullPrompt) {
  console.log(`Revised prompt: ${revisedPrompt}\n`)
}

let buffer: Buffer
if (item.b64_json) {
  buffer = Buffer.from(item.b64_json, 'base64')
} else if (item.url) {
  const imgRes = await fetch(item.url)
  if (!imgRes.ok) { console.error('Failed to download image'); process.exit(1) }
  buffer = Buffer.from(await imgRes.arrayBuffer())
} else {
  console.error('No image data in response:', JSON.stringify(json))
  process.exit(1)
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, buffer)
console.log(`✓ Saved → ${outPath}`)

// ── upload to Supabase Storage (optional) ────────────────────────────────────

if (uploadBucket) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Upload skipped: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found')
    process.exit(0)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const fileName = path.basename(outPath)

  const { error } = await supabase.storage
    .from(uploadBucket)
    .upload(fileName, buffer, { contentType: 'image/png', upsert: true })

  if (error) {
    console.error('Upload error:', error.message)
    process.exit(1)
  }

  const { data: { publicUrl } } = supabase.storage.from(uploadBucket).getPublicUrl(fileName)
  console.log(`✓ Uploaded → ${publicUrl}`)
}
