/**
 * Batch enrichment script: populates cuisine_signals, flavor_notes, heat_level, dietary_flags
 * on ingredients that currently have no cuisine signals.
 *
 * Run: npx tsx scripts/seed-ingredient-signals.ts
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 *
 * Idempotent — skips ingredients where cuisine_signals is already populated.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"] ?? "";
const BATCH_SIZE = 20;

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error("Missing required env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SYSTEM_PROMPT = `You are a professional culinary database curator with expertise in global cuisines.
Your task is to tag ingredients with cuisine_signals, flavor_notes, heat_level, and dietary_flags.

RULES — follow strictly:
1. Only add a cuisine signal if a professional chef would IMMEDIATELY recognise this ingredient as characteristic of that cuisine. When in doubt, leave cuisine_signals as an empty array.
2. Base ingredients (salt, pepper, garlic, onion, olive oil, butter, flour, water, sugar, eggs, lemon juice, vegetable oil) must ALWAYS have cuisine_signals = [].
3. Proteins (chicken, beef, pork, lamb, fish, tuna, salmon, turkey) must have cuisine_signals = []. They are protein sources, not cuisine identifiers.
4. If an ingredient belongs to multiple cuisines, list all of them.
5. heat_level: 0 = no heat, 1 = very mild, 2 = mild-medium, 3 = hot/very hot.
6. flavor_notes: choose from [savory, sweet, sour, bitter, umami, spicy, smoky, earthy, fresh, rich, tangy, aromatic]. Max 3.
7. dietary_flags: choose from [vegan, vegetarian, gluten-free, dairy-free, nut-free, soy-free]. Only flag what is definitively true.

Return a JSON array. Each element: { "id": "<uuid>", "cuisine_signals": [], "flavor_notes": [], "heat_level": 0, "dietary_flags": [] }
No explanation. Valid JSON only.`;

type IngredientSignals = {
  id: string;
  cuisine_signals: string[];
  flavor_notes: string[];
  heat_level: number;
  dietary_flags: string[];
};

async function enrichBatch(
  batch: { id: string; name: string }[],
): Promise<IngredientSignals[]> {
  const userMessage = `Tag these ingredients:\n${batch
    .map((i) => `{ "id": "${i.id}", "name": "${i.name}" }`)
    .join("\n")}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { content: Array<{ text: string }> };
  const raw = json.content?.[0]?.text?.trim() ?? "[]";

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(cleaned) as IngredientSignals[];
}

async function main() {
  console.log("Fetching ingredients without cuisine signals...");

  const { data: ingredients, error } = await supabase
    .from("ingredients")
    .select("id, name")
    .eq("cuisine_signals", "{}")
    .is("owner_id", null) // system ingredients only
    .order("name");

  if (error) {
    console.error("Failed to fetch ingredients:", error.message);
    process.exit(1);
  }

  const total = (ingredients ?? []).length;
  console.log(`Found ${total} ingredients to enrich.`);

  let processed = 0;
  let updated = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = (ingredients ?? []).slice(i, i + BATCH_SIZE);
    process.stdout.write(`Processing ${i + 1}–${Math.min(i + BATCH_SIZE, total)} of ${total}...`);

    try {
      const signals = await enrichBatch(batch);

      for (const sig of signals) {
        const { error: updateErr } = await supabase
          .from("ingredients")
          .update({
            cuisine_signals: sig.cuisine_signals,
            flavor_notes: sig.flavor_notes,
            heat_level: sig.heat_level,
            dietary_flags: sig.dietary_flags,
          })
          .eq("id", sig.id);

        if (updateErr) {
          console.warn(`\nFailed to update ${sig.id}: ${updateErr.message}`);
        } else {
          updated++;
        }
      }

      processed += batch.length;
      console.log(` done (${updated} updated so far)`);
    } catch (err) {
      console.error(`\nBatch failed: ${(err as Error).message}`);
    }

    // Rate limit courtesy pause between batches
    if (i + BATCH_SIZE < total) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nComplete. ${updated} of ${processed} ingredients updated.`);
  console.log("Run refresh_platform_averages() in Supabase SQL editor to update cached stats.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
