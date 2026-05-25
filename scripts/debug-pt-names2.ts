import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anthropicKey = process.env.ANTHROPIC_API_KEY!
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const anthropic = new Anthropic({ apiKey: anthropicKey })

async function main() {
  const { data: rows, error } = await supabase
    .from('ingredients')
    .select('id, name')
    .eq('classification_source', 'usda')
    .not('name', 'is', null)
    .limit(5000)
  
  if (error) { console.error('FETCH ERROR:', error); return }
  console.log(`Fetched ${rows?.length} rows (limit was 5000)`)
  
  const batch = rows!.slice(0, 5)
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `For each English ingredient name, provide the most common Portuguese (Portugal) name. Return JSON array: [{"id": "...", "name_pt": "..."}]\n\nIngredients:\n${batch.map(r => `{"id":"${r.id}","name":"${r.name}"}`).join('\n')}`,
      }],
    })
    
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('Response (first 300):', JSON.stringify(text.slice(0, 300)))
    const match = text.match(/\[[\s\S]*\]/)
    console.log('Match:', match ? 'YES - ' + match[0].slice(0, 100) : 'NO MATCH')
    
    if (match) {
      const results = JSON.parse(match[0])
      console.log('Parsed results:', results.length, 'items')
      
      // Test the alias update
      for (const r of results.slice(0, 1)) {
        console.log('Testing alias update for:', r.id, r.name_pt)
        const { data: existing, error: fetchErr } = await supabase.from('ingredients').select('aliases').eq('id', r.id).single()
        console.log('  existing:', existing, 'err:', fetchErr)
        const aliases = existing?.aliases ?? []
        console.log('  current aliases:', aliases)
        const { error: updateErr } = await supabase.from('ingredients').update({ aliases: [...aliases, r.name_pt] }).eq('id', r.id)
        console.log('  update error:', updateErr)
      }
    }
  } catch (err) {
    console.error('CAUGHT ERROR:', err)
  }
}

main().catch(console.error)
