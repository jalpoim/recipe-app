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
  const { data: rows } = await supabase
    .from('ingredients')
    .select('id, name')
    .eq('classification_source', 'usda')
    .not('name', 'is', null)
    .limit(50)
  
  // Test with first real batch of 50
  const batch = rows!.slice(0, 50)
  const content = `For each English ingredient name, provide the most common Portuguese (Portugal) name. Return JSON array: [{"id": "...", "name_pt": "..."}]\n\nIngredients:\n${batch.map(r => `{"id":"${r.id}","name":"${r.name}"}`).join('\n')}`
  console.log('Prompt chars:', content.length)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  })
  
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  console.log('Response stop_reason:', response.stop_reason)
  console.log('Response output_tokens:', response.usage.output_tokens)
  console.log('Response length:', text.length)
  console.log('Last 200 chars:', JSON.stringify(text.slice(-200)))
  const match = text.match(/\[[\s\S]*\]/)
  console.log('Match:', match ? 'YES (' + match[0].slice(0,50) + '...)' : 'NO MATCH')
}

main().catch(console.error)
