/**
 * Meal-type (course) classification — Tier-2 Haiku backfill (F13).
 *
 * Classifies each recipe into exactly one course so plan generation can exclude
 * non-meals (desserts/snacks/drinks/sides). Signal: name + tags + proteins.
 *   course ∈ main | breakfast | dessert | snack | drink | side
 *
 * Idempotent: only classifies rows where course IS NULL (re-runs are cheap).
 * Gated: default = READ-ONLY sample print. WRITE=1 = write sample.
 *        WRITE=1 FULL=1 = classify+write every approved recipe missing a course.
 * Run: npx tsx scripts/classify-recipe-course.ts
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"] ?? "";
const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 15;
const WRITE = process.env["WRITE"] === "1";
const FULL = process.env["FULL"] === "1";

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error("Missing env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const COURSES = ["main", "breakfast", "dessert", "snack", "drink", "side"] as const;
type Course = (typeof COURSES)[number];

type Row = { id: string; name: string; tags: string[]; proteins: string[] };

async function classifyBatch(rows: Row[]): Promise<Map<string, Course>> {
  const list = rows
    .map(
      (r, i) =>
        `${i + 1}. id=${r.id} | "${r.name}" | tags: ${(r.tags ?? []).join(", ") || "—"} | proteins: ${(r.proteins ?? []).join(", ") || "—"}`,
    )
    .join("\n");

  const prompt = `Classify each recipe into exactly ONE course for a meal-planning app.
Courses:
- main: a lunch/dinner main dish (savoury, the centre of a meal)
- breakfast: a breakfast dish (pancakes, oats, eggs-for-breakfast, banana bread eaten at breakfast)
- dessert: cakes, sweets, puddings, sweet treats eaten after a meal
- snack: small bites / snacks (cookies, energy balls, chips)
- drink: shakes, smoothies, beverages
- side: side dishes / accompaniments not eaten alone (sauces, dips, a plain side)

Rules: pick the single best fit. A sweet cake is "dessert" even if high-protein. A protein shake is "drink". A sauce/dip is "side".

Recipes:
${list}

Respond with ONLY a JSON array, no markdown:
[{"id":"<id>","course":"main"}, ...]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content: { text: string }[] };
  let text = json.content?.[0]?.text?.trim() ?? "[]";
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(text) as { id: string; course: string }[];
  const out = new Map<string, Course>();
  for (const p of parsed) {
    if (COURSES.includes(p.course as Course)) out.set(p.id, p.course as Course);
  }
  return out;
}

async function main() {
  let query = supabase
    .from("recipes")
    .select("id, name, tags, proteins")
    .is("deleted_at", null)
    .eq("moderation_status", "approved")
    .is("course", null);
  if (!FULL) query = query.limit(BATCH_SIZE);
  const { data, error } = (await query) as unknown as { data: Row[] | null; error: unknown };
  if (error) throw error;
  const rows = data ?? [];
  console.log(`To classify: ${rows.length}${FULL ? "" : " (sample — set FULL=1 for all)"}`);
  if (rows.length === 0) return;

  const tally: Record<string, number> = {};
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await classifyBatch(batch);
    for (const r of batch) {
      const course = result.get(r.id) ?? "main"; // default to main if model omitted it
      tally[course] = (tally[course] ?? 0) + 1;
      if (!WRITE) {
        console.log(`  ${course.padEnd(9)} ${r.name}`);
      } else {
        const { error: upErr } = await supabase
          .from("recipes")
          .update({ course } as never)
          .eq("id", r.id);
        if (upErr) console.error(`  write failed ${r.id}: ${upErr.message}`);
      }
    }
    console.log(`batch ${i / BATCH_SIZE + 1}: ${batch.length} done`);
  }
  console.log(`\n${WRITE ? "WROTE" : "DRY-RUN"} distribution:`, tally);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
