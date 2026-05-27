/**
 * Generates food photography images via DALL-E 3 for Joe x Fitness recipes
 * (Korean cookbook) and uploads them to Supabase Storage.
 *
 * Usage:
 *   npx tsx scripts/generate-dalle-images.ts --dry-run
 *   npx tsx scripts/generate-dalle-images.ts
 *   npx tsx scripts/generate-dalle-images.ts --force   (re-generate existing)
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

// Joe x Fitness recipe English names (the 50 Korean-inspired recipes)
const JOE_RECIPE_NAMES = [
  "Bulgogi KBBQ Meal Prep",
  "Spicy BBQ Gochujang Chicken",
  "Honey Sriracha Shrimp",
  "Chicken Katsu",
  "Sesame Salmon",
  "Kung Pao Chicken",
  "Orange Chicken",
  "Kimchi Shrimp Fried Rice",
  "Chicken Bulgogi Ssam",
  "Vietnamese Shaken Beef",
  "Bulgogi Gimbap Wrap",
  "Shrimp Rice Paper Noodles",
  "Tunacado Sandwich",
  "Microwave Hot Pot",
  "Korean-Inspired Omelette",
  "Beef Pepper Rice",
  "Spicy Tofu Bowl",
  "Salmon Sushi Bake",
  "Fresh Shrimp Spring Rolls",
  "Lox Cucumber Salad",
  "Dakjuk (Chicken Rice Porridge)",
  "Chicken Yaki Udon",
  "Rice Paper Shrimp Roll",
  "Tuna Salad Lettuce Wrap",
  "Lazy Chicken Udon",
  "Spring Roll Bowl",
  "Korean Egg Bites",
  "Kimchi Jeon",
  "Dakgalbi (Spicy Stir-Fried Chicken)",
  "Rice Paper Scallion Pancake",
  "Napa Cabbage Shrimp Dumpling Rolls",
  "Gyeranjjim (Korean Steamed Egg)",
  "Egg Drop Soup",
  "Kimchi Tuna Melt",
  "Beef Enoki Rolls",
  "Mayak Eggs (Marinated Eggs)",
  "Eomuk Bokkeum (Fish Cake)",
  "Ojingeochae Muchim (Spicy Squid)",
  "Myeolchi Bokkeum (Stir-Fried Anchovies)",
  "Jangjorim (Soy Braised Beef)",
  "Gyeran-mari (Korean Rolled Omelette)",
  "Sangchu Geotjeori (Spicy Salad)",
  "Japchae (Glass Noodle Stir Fry)",
  "Oi-muchim (Spicy Cucumber)",
  "Sigeumchi-namul (Marinated Spinach)",
  "Spicy Soondubu (Tofu Soup)",
  "Miyeokguk (Seaweed Beef Soup)",
  "Kimchi Jjigae (Kimchi Beef Stew)",
  "Ddukguk (Beef Rice Cake Soup)",
  "Muguk (Beef & Radish Soup)",
];

function buildPrompt(recipeName: string, ingredients: string[]): string {
  const ingredientList =
    ingredients.length > 0
      ? ` Key ingredients: ${ingredients.join(", ")}.`
      : "";
  return (
    `Professional food photography of "${recipeName}".${ingredientList} ` +
    `Overhead or 45-degree angle shot on a clean, minimal surface. ` +
    `Vibrant, appetising, well-lit with natural light. ` +
    `No text, no watermarks, no people. ` +
    `High-quality restaurant-style plating.`
  );
}

async function fetchIngredients(recipeId: string): Promise<string[]> {
  const { data } = await supabase
    .from("recipe_ingredient_translations")
    .select("name, recipe_ingredients!inner(is_pantry)")
    .eq("recipe_id", recipeId)
    .eq("language", "en")
    .eq("recipe_ingredients.is_pantry", false);
  return (data ?? []).map((r: { name: string }) => r.name).slice(0, 8);
}

async function generateImage(
  recipeName: string,
  ingredients: string[],
): Promise<Buffer> {
  const body = JSON.stringify({
    model: "gpt-image-2",
    prompt: buildPrompt(recipeName, ingredients),
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
    throw new Error(`OpenAI error (${response.status}): ${err}`);
  }

  const json = (await response.json()) as { data: { b64_json: string }[] };
  const b64 = json.data[0]?.b64_json;
  if (!b64) throw new Error("No image data in OpenAI response");

  return Buffer.from(b64, "base64");
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
  console.log(`\nFetching Joe x Fitness recipes from DB...`);

  // Fetch recipe IDs by joining with english translations
  const { data: rows, error } = await supabase
    .from("recipe_translations")
    .select("recipe_id, name, recipes!inner(id, image_url, owner_id)")
    .eq("language", "en")
    .in("name", JOE_RECIPE_NAMES)
    .is("recipes.owner_id", null);

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.error(
      "No recipes found — check translation table has English rows",
    );
    process.exit(1);
  }

  type Row = {
    recipe_id: string;
    name: string;
    recipes: { id: string; image_url: string | null; owner_id: string | null };
  };

  const recipes = rows as unknown as Row[];
  const toProcess = (
    FORCE ? recipes : recipes.filter((r) => !r.recipes.image_url)
  ).slice(0, LIMIT);

  console.log(
    `${recipes.length} Joe recipes found. ${toProcess.length} need images.\n`,
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
      const ingredients = await fetchIngredients(recipe_id);
      const raw = await generateImage(name, ingredients);
      const [hero, thumb] = await Promise.all([makeHero(raw), makeThumb(raw)]);

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const heroPath = `joe/${slug}.jpg`;
      const thumbPath = `joe/${slug}-thumb.jpg`;

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

      // Respect OpenAI rate limits (~5 req/min on tier 1 — wait 13s between calls)
      if (done + failed < toProcess.length) await sleep(13000);
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${done} generated, ${failed} failed.\n`);
}

main();
