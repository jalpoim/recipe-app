/**
 * Uses Haiku to classify shopping categories for ingredients that have none.
 * Valid values are constrained by the DB check: meat | produce | dairy | grains | other
 *
 * Safe to re-run — only processes rows with category IS NULL.
 *
 * Usage: npx tsx scripts/categorize-ingredients-haiku.ts
 * Requires: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;

if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
  console.error(
    "Missing env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic({ apiKey: anthropicKey });

const BATCH_SIZE = 100;
const VALID_CATEGORIES = [
  "meat",
  "produce",
  "dairy",
  "grains",
  "other",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

type IngRow = { id: string; name: string };
type CatResult = { id: string; category: Category };

async function classifyBatch(batch: IngRow[]): Promise<CatResult[]> {
  const nameList = batch.map((i, idx) => `${idx + 1}. ${i.name}`).join("\n");

  const prompt = `You are a supermarket category classifier. For each ingredient below, assign exactly one category from this set:
meat, produce, dairy, grains, other

Definitions:
- "meat" = fresh/frozen/cured meat, poultry, fish, seafood, shellfish, eggs, and products primarily made from them
- "produce" = fresh/frozen fruit and vegetables (whole, cut, or minimally processed)
- "dairy" = milk, cheese, yogurt, butter, cream, kefir, whey, and dairy-based products
- "grains" = rice, pasta, bread, flour, oats, cereals, oils, vinegars, sauces, condiments, spices, canned/preserved goods, pulses, legumes, nuts, seeds, sweeteners, baking ingredients, drinks, protein powders, supplements
- "other" = anything that genuinely doesn't fit the above (e.g. prepared meals, alcohol, non-food items)

When in doubt between "grains" and "other", prefer "grains".

Return ONLY a JSON array. Each element: {"idx": <1-based number>, "category": "<one of the 5 values>"}
Include every item. No explanation, just the JSON array.

Ingredients:
${nameList}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      idx: number;
      category: string;
    }>;
    return parsed
      .filter((r) => r.idx >= 1 && r.idx <= batch.length)
      .map((r) => ({
        id: batch[r.idx - 1].id,
        category: r.category as Category,
      }))
      .filter((r) =>
        (VALID_CATEGORIES as readonly string[]).includes(r.category),
      );
  } catch {
    console.warn("JSON parse failed for batch, skipping");
    return [];
  }
}

async function main() {
  const items: IngRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name")
      .is("category", null)
      .order("name")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    items.push(...(data as IngRow[]));
    if (data.length < 1000) break;
    offset += 1000;
  }

  console.log(`Found ${items.length} uncategorized ingredients`);
  if (items.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let batches = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    batches++;
    process.stdout.write(
      `Batch ${batches} (${i + 1}–${Math.min(i + BATCH_SIZE, items.length)})... `,
    );

    let results: CatResult[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await classifyBatch(batch);
        break;
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`);
        if (attempt < 3)
          await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    for (const r of results) {
      const { error: upErr } = await supabase
        .from("ingredients")
        .update({ category: r.category })
        .eq("id", r.id);
      if (upErr) console.warn(`  Failed to update ${r.id}: ${upErr.message}`);
      else updated++;
    }

    console.log(`classified ${results.length} items`);
    if (i + BATCH_SIZE < items.length)
      await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `\nDone. Categorized ${updated} ingredients across ${batches} batches.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
