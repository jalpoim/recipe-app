/**
 * Generates food photography images via gpt-image-2 for system recipes
 * (AI-generated, visibility='system') and uploads them to Supabase Storage.
 *
 * Usage:
 *   npx tsx scripts/generate-system-recipe-images.ts --dry-run
 *   npx tsx scripts/generate-system-recipe-images.ts
 *   npx tsx scripts/generate-system-recipe-images.ts --force   (re-generate existing)
 *   npx tsx scripts/generate-system-recipe-images.ts --limit 5
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import sharp from "sharp";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production");
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openaiKey = process.env.OPENAI_API_KEY!;

if (!url || !serviceKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!openaiKey) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? parseInt(process.argv[i + 1]) : Infinity;
})();
// --name "Recipe Name" can be repeated to target specific recipes
const NAME_FILTER: string[] = (() => {
  const names: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--name" && process.argv[i + 1]) {
      names.push(process.argv[i + 1]);
      i++;
    }
  }
  return names;
})();

const STEPS_CHAR_LIMIT = 400;

interface RecipeContext {
  ingredients: string[];
  proteins: string[];
  servings: number | null;
  stepsText: string | null;
}

// Sparse recipes (few ingredients) can't fully prevent hallucinated side items — the
// model's training data priors are too strong. We accept side items and focus on making
// the main food item itself look correct by avoiding over-descriptive construction prompts.
const SPARSE_THRESHOLD = 6;

function buildPrompt(recipeName: string, ctx: RecipeContext): string {
  const isSparse =
    ctx.ingredients.length > 0 && ctx.ingredients.length <= SPARSE_THRESHOLD;

  const parts: string[] = [];

  if (isSparse) {
    // Don't describe construction ("rolled into cylinders") — that triggers pinwheel/wrap
    // visual templates with visible cream cheese and spinach swirls. Just name the food.
    parts.push(`Casual home photo of "${recipeName}" on a plate.`);
    parts.push(
      `The dish is made with: ${ctx.ingredients.join(", ")}. ` +
        `Do not add cream cheese, spinach, lettuce, or any filling not in this list inside the rolls.`,
    );
  } else {
    parts.push(
      `Casual home photo of the finished, plated dish "${recipeName}", ready to eat.`,
    );
    if (ctx.proteins.length > 0) {
      parts.push(`Main protein: ${ctx.proteins.join(", ")}.`);
    }
    if (ctx.ingredients.length > 0) {
      const ingList = ctx.ingredients.join(", ");
      parts.push(
        `This dish contains EXACTLY AND ONLY these ingredients: ${ingList}. ` +
          `STRICT RULE: do NOT add any other food item — no extra vegetables, no garnish, no sauce, no dip, no dressing, no side dish, no extra toppings. ` +
          `Do not add any tortilla, wrap, flatbread, bread, rice, pasta, or starch unless explicitly named above.`,
      );
    }
    if (ctx.servings) {
      const portion =
        ctx.servings === 1
          ? "single-serving portion"
          : `${ctx.servings}-serving platter`;
      parts.push(`Plated as a ${portion}.`);
    }
    if (ctx.stepsText) {
      parts.push(`How it was made: ${ctx.stepsText}.`);
    }
  }

  parts.push(
    `Shot on a smartphone camera, slightly off-center composition, as if someone photographed their meal before eating.`,
    `Warm indoor lighting — window light or kitchen light, soft shadows, natural colour temperature.`,
    `Overhead or 45-degree angle on a simple everyday surface — a wooden table, a kitchen counter, or a plain ceramic plate.`,
    `Small concrete imperfections: slightly uneven portions, a small smear on the plate edge, asymmetric spacing between items.`,
    `Realistic food texture, not overly glossy or airbrushed. Colours look natural, not saturated for advertising.`,
    `No text, no watermarks, no people, no studio lighting, no professional food-styling props.`,
  );

  return parts.join(" ");
}

async function generateBasePlate(): Promise<Buffer> {
  const body = JSON.stringify({
    model: "gpt-image-2",
    prompt:
      "A plain empty white ceramic plate on a warm wooden table, overhead view, soft natural window light. The plate is completely empty — no food, no crumbs, nothing on it. Simple, clean, minimal.",
    n: 1,
    size: "1024x1024",
    quality: "medium",
  });

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI base plate error (${response.status}): ${err}`);
  }

  const json = (await response.json()) as { data: { b64_json: string }[] };
  const b64 = json.data[0]?.b64_json;
  if (!b64) throw new Error("No base plate image data");
  return Buffer.from(b64, "base64");
}

// Circular mask: transparent inside (edit zone = plate surface),
// opaque black outside (keep = table/background). The model can only
// place food within the transparent area.
async function createPlateMask(): Promise<Buffer> {
  const size = 1024;
  const cx = size / 2;
  const cy = size / 2;
  const r = 430;
  const data = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= r;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = inside ? 0 : 255; // transparent inside = edit here
    }
  }

  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

// Converts ingredient names to literal physical visual descriptions so the edit
// prompt avoids triggering food-category stereotypes (e.g. "turkey roll-ups" → platter).
function toVisualDescription(ingredients: string[]): string {
  const visual: Record<string, string> = {
    "turkey deli meat": "thin pale-pink flat slices of cooked deli turkey",
    "deli turkey": "thin pale-pink flat slices of cooked deli turkey",
    turkey: "thin pale-pink flat slices of cooked turkey",
    cheese: "thin flat slices of yellow cheese",
    "sliced cheese": "thin flat slices of yellow cheese",
    ham: "thin pale-pink flat slices of cured ham",
    "deli ham": "thin pale-pink flat slices of cured ham",
    egg: "whole shelled egg",
    eggs: "whole shelled eggs",
    "hard-boiled egg": "peeled hard-boiled egg sliced in half",
    "cottage cheese": "white creamy cottage cheese",
    tuna: "flaked light-coloured tuna",
    salmon: "pink salmon fillet",
    chicken: "cooked chicken pieces",
  };

  return ingredients
    .map((ing) => {
      const key = ing.toLowerCase().trim();
      return visual[key] ?? ing;
    })
    .join(" and ");
}

async function editPlateWithFood(
  plateBuffer: Buffer,
  maskBuffer: Buffer,
  ingredients: string[],
): Promise<Buffer> {
  const visualDesc = toVisualDescription(ingredients);
  const formData = new FormData();
  formData.append("model", "gpt-image-2");
  formData.append(
    "image",
    new Blob([plateBuffer], { type: "image/png" }),
    "plate.png",
  );
  formData.append(
    "mask",
    new Blob([maskBuffer], { type: "image/png" }),
    "mask.png",
  );
  formData.append(
    "prompt",
    `In the transparent area of this white plate, place ONLY: ${visualDesc}, rolled into small cylinders and arranged loosely. ` +
      `No lettuce, no spinach, no green leaves, no vegetables, no fruit, no crackers, no cream cheese, no sauce inside or outside the rolls. ` +
      `The rest of the white plate surface is empty ceramic. Nothing else anywhere.`,
  );
  formData.append("n", "3");
  formData.append("size", "1024x1024");
  formData.append("quality", "medium");
  formData.append("response_format", "b64_json");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI edit error (${response.status}): ${err}`);
  }

  const json = (await response.json()) as { data: { b64_json: string }[] };
  if (!json.data?.length)
    throw new Error("No image data in OpenAI edit response");

  // For sparse dishes pick the smallest buffer — fewer bytes = fewer extra objects painted in.
  const buffers = json.data.map((d) => Buffer.from(d.b64_json, "base64"));
  return buffers.reduce((best, cur) => (cur.length < best.length ? cur : best));
}

async function fetchRecipeContext(recipeId: string): Promise<RecipeContext> {
  const [ingredientsRes, recipeRes, stepsRes] = await Promise.all([
    supabase
      .from("recipe_ingredient_translations")
      .select("name, recipe_ingredients!inner(is_pantry)")
      .eq("recipe_id", recipeId)
      .eq("language", "en")
      .eq("recipe_ingredients.is_pantry", false),
    supabase
      .from("recipes")
      .select("proteins, servings")
      .eq("id", recipeId)
      .single(),
    supabase
      .from("recipe_step_translations")
      .select("instruction, recipe_steps!inner(step_number)")
      .eq("recipe_id", recipeId)
      .eq("language", "en")
      .order("recipe_steps(step_number)", { ascending: true }),
  ]);

  const ingredients = (ingredientsRes.data ?? []).map(
    (r: { name: string }) => r.name,
  );

  const proteins: string[] = recipeRes.data?.proteins ?? [];
  const servings: number | null = recipeRes.data?.servings ?? null;

  // Concatenate all steps, then keep the trailing ~400 chars (finishing/plating steps
  // are at the end and matter most for how the final dish looks).
  const allSteps = (
    (stepsRes.data as unknown as Array<{ instruction: string }> | null) ?? []
  )
    .map((s) => s.instruction)
    .join(" ");
  const stepsText =
    allSteps.length > 0
      ? allSteps.length > STEPS_CHAR_LIMIT
        ? "…" + allSteps.slice(-STEPS_CHAR_LIMIT)
        : allSteps
      : null;

  return { ingredients, proteins, servings, stepsText };
}

async function generateImage(
  recipeName: string,
  ctx: RecipeContext,
): Promise<Buffer> {
  const isSparse =
    ctx.ingredients.length > 0 && ctx.ingredients.length <= SPARSE_THRESHOLD;

  const body = JSON.stringify({
    model: "gpt-image-2",
    prompt: buildPrompt(recipeName, ctx),
    n: 3,
    size: "1024x1024",
    quality: "medium",
  });

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${err}`);
  }

  const json = (await response.json()) as { data: { b64_json: string }[] };
  if (!json.data?.length) throw new Error("No image data in OpenAI response");

  const buffers = json.data.map((d) => Buffer.from(d.b64_json, "base64"));
  // Sparse: pick smallest buffer (fewer painted objects = fewer hallucinated sides).
  // Non-sparse: pick largest buffer (most texture detail).
  return buffers.reduce((best, cur) =>
    isSparse
      ? cur.length < best.length
        ? cur
        : best
      : cur.length > best.length
        ? cur
        : best,
  );
}

async function makeHero(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 400, height: 400, fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function uploadImage(
  buffer: Buffer,
  storagePath: string,
): Promise<string> {
  const { error } = await supabase.storage
    .from("recipe-images")
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: true });
  if (error)
    throw new Error(`Upload error for ${storagePath}: ${error.message}`);
  return supabase.storage.from("recipe-images").getPublicUrl(storagePath).data
    .publicUrl;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\nFetching system recipes without images from DB...`);

  const { data: rows, error } = await supabase
    .from("recipe_translations")
    .select(
      "recipe_id, name, recipes!inner(id, image_url, visibility, owner_id)",
    )
    .eq("language", "en")
    .eq("recipes.visibility", "system")
    .is("recipes.owner_id", null);

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.error("No system recipes found");
    process.exit(1);
  }

  type Row = {
    recipe_id: string;
    name: string;
    recipes: {
      id: string;
      image_url: string | null;
      visibility: string;
      owner_id: string | null;
    };
  };

  const recipes = rows as unknown as Row[];
  const toProcess = (
    FORCE ? recipes : recipes.filter((r) => !r.recipes.image_url)
  )
    .filter((r) =>
      NAME_FILTER.length === 0
        ? true
        : NAME_FILTER.some((n) => r.name.toLowerCase() === n.toLowerCase()),
    )
    .slice(0, LIMIT);

  console.log(
    `${recipes.length} system recipes found. ${toProcess.length} need images.\n`,
  );

  if (DRY_RUN) {
    console.log("Dry run — would generate images for:");
    toProcess.forEach((r) => console.log(`  - ${r.name}`));
    return;
  }

  let done = 0;
  let failed = 0;

  for (const row of toProcess) {
    const { recipe_id, name } = row;
    process.stdout.write(
      `  [${done + failed + 1}/${toProcess.length}] "${name}" ... `,
    );

    try {
      const ctx = await fetchRecipeContext(recipe_id);
      const raw = await generateImage(name, ctx);
      const [hero, thumb] = await Promise.all([makeHero(raw), makeThumb(raw)]);

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const heroPath = `system/${slug}.jpg`;
      const thumbPath = `system/${slug}-thumb.jpg`;

      const [heroUrl, thumbUrl] = await Promise.all([
        uploadImage(hero, heroPath),
        uploadImage(thumb, thumbPath),
      ]);

      const { error: updateError } = await supabase
        .from("recipes")
        .update({ image_url: heroUrl, image_thumb_url: thumbUrl })
        .eq("id", recipe_id);

      if (updateError)
        throw new Error(`DB update failed: ${updateError.message}`);

      console.log("✓");
      done++;

      if (done + failed < toProcess.length) await sleep(13000);
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${done} generated, ${failed} failed.\n`);
}

main();
