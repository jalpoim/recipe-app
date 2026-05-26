/**
 * Safely add missing common ingredients to the database.
 *
 * For each ingredient:
 *   1. Skip if it already exists (case-insensitive match on English name)
 *   2. Ask Haiku for macro estimates
 *   3. Find the closest USDA entry already in the DB — if similarity >= 0.85,
 *      use USDA macros instead of the AI estimate (USDA = ground truth)
 *   4. Insert with PT + EN translations
 *
 * Usage:
 *   npx tsx scripts/add-ingredients.ts                          (uses built-in list)
 *   npx tsx scripts/add-ingredients.ts --dry-run                (print what would be inserted)
 *   npx tsx scripts/add-ingredients.ts --name "bok choy"        (single ingredient)
 *   npx tsx scripts/add-ingredients.ts --category vegetables    (category subset)
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production");
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;
if (!url || !serviceKey || !anthropicKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic({ apiKey: anthropicKey });

const DRY_RUN = process.argv.includes("--dry-run");
const SINGLE_NAME_IDX = process.argv.indexOf("--name");
const SINGLE_NAME =
  SINGLE_NAME_IDX !== -1 ? process.argv[SINGLE_NAME_IDX + 1] : null;
const CATEGORY_IDX = process.argv.indexOf("--category");
const ONLY_CATEGORY =
  CATEGORY_IDX !== -1 ? process.argv[CATEGORY_IDX + 1] : null;

// ---- Ingredient list ----
// Organised by category. Add new entries here.
// Keep names in simple English (no USDA-style qualifiers).

type IngredientSpec = {
  name: string; // English canonical name
  category: "produce" | "meat" | "dairy" | "grains" | "other";
  defaultUnit: string; // g / ml / unit / etc
};

const INGREDIENTS: IngredientSpec[] = [
  // Vegetables
  { name: "bok choy", category: "produce", defaultUnit: "g" },
  { name: "artichoke", category: "produce", defaultUnit: "unit" },
  { name: "asparagus", category: "produce", defaultUnit: "g" },
  { name: "aubergine", category: "produce", defaultUnit: "g" },
  { name: "beetroot", category: "produce", defaultUnit: "g" },
  { name: "broccoli", category: "produce", defaultUnit: "g" },
  { name: "brussels sprouts", category: "produce", defaultUnit: "g" },
  { name: "cabbage", category: "produce", defaultUnit: "g" },
  { name: "cauliflower", category: "produce", defaultUnit: "g" },
  { name: "celery", category: "produce", defaultUnit: "g" },
  { name: "courgette", category: "produce", defaultUnit: "g" },
  { name: "cucumber", category: "produce", defaultUnit: "g" },
  { name: "fennel", category: "produce", defaultUnit: "g" },
  { name: "kale", category: "produce", defaultUnit: "g" },
  { name: "lettuce", category: "produce", defaultUnit: "g" },
  { name: "peas", category: "produce", defaultUnit: "g" },
  { name: "pumpkin", category: "produce", defaultUnit: "g" },
  { name: "radish", category: "produce", defaultUnit: "g" },
  { name: "spinach", category: "produce", defaultUnit: "g" },
  { name: "spring onion", category: "produce", defaultUnit: "g" },
  { name: "sweet potato", category: "produce", defaultUnit: "g" },
  { name: "turnip", category: "produce", defaultUnit: "g" },
  // Fruits
  { name: "avocado", category: "produce", defaultUnit: "unit" },
  { name: "banana", category: "produce", defaultUnit: "unit" },
  { name: "fig", category: "produce", defaultUnit: "unit" },
  { name: "kiwi", category: "produce", defaultUnit: "unit" },
  { name: "mango", category: "produce", defaultUnit: "unit" },
  { name: "melon", category: "produce", defaultUnit: "g" },
  { name: "papaya", category: "produce", defaultUnit: "g" },
  { name: "pear", category: "produce", defaultUnit: "unit" },
  { name: "pineapple", category: "produce", defaultUnit: "g" },
  { name: "plum", category: "produce", defaultUnit: "unit" },
  { name: "pomegranate", category: "produce", defaultUnit: "unit" },
  { name: "watermelon", category: "produce", defaultUnit: "g" },
  // Proteins
  { name: "beef mince", category: "meat", defaultUnit: "g" },
  { name: "chicken breast", category: "meat", defaultUnit: "g" },
  { name: "chicken thigh", category: "meat", defaultUnit: "g" },
  { name: "cod", category: "meat", defaultUnit: "g" },
  { name: "duck breast", category: "meat", defaultUnit: "g" },
  { name: "ham", category: "meat", defaultUnit: "g" },
  { name: "lamb chop", category: "meat", defaultUnit: "g" },
  { name: "pork belly", category: "meat", defaultUnit: "g" },
  { name: "pork loin", category: "meat", defaultUnit: "g" },
  { name: "prawns", category: "meat", defaultUnit: "g" },
  { name: "salmon fillet", category: "meat", defaultUnit: "g" },
  { name: "shrimp", category: "meat", defaultUnit: "g" },
  { name: "steak", category: "meat", defaultUnit: "g" },
  { name: "tuna fillet", category: "meat", defaultUnit: "g" },
  { name: "turkey breast", category: "meat", defaultUnit: "g" },
  // Dairy & eggs
  { name: "butter", category: "dairy", defaultUnit: "g" },
  { name: "egg", category: "dairy", defaultUnit: "unit" },
  { name: "egg white", category: "dairy", defaultUnit: "g" },
  { name: "egg yolk", category: "dairy", defaultUnit: "unit" },
  { name: "feta", category: "dairy", defaultUnit: "g" },
  { name: "greek yogurt", category: "dairy", defaultUnit: "g" },
  { name: "heavy cream", category: "dairy", defaultUnit: "ml" },
  { name: "sour cream", category: "dairy", defaultUnit: "g" },
  // Grains & pantry
  { name: "basmati rice", category: "grains", defaultUnit: "g" },
  { name: "brown rice", category: "grains", defaultUnit: "g" },
  { name: "bulgur wheat", category: "grains", defaultUnit: "g" },
  { name: "couscous", category: "grains", defaultUnit: "g" },
  { name: "lentils", category: "grains", defaultUnit: "g" },
  { name: "oats", category: "grains", defaultUnit: "g" },
  { name: "panko breadcrumbs", category: "grains", defaultUnit: "g" },
  { name: "pasta", category: "grains", defaultUnit: "g" },
  { name: "polenta", category: "grains", defaultUnit: "g" },
  { name: "quinoa", category: "grains", defaultUnit: "g" },
  { name: "white rice", category: "grains", defaultUnit: "g" },
  // Fats & oils
  { name: "coconut oil", category: "other", defaultUnit: "ml" },
  { name: "olive oil", category: "other", defaultUnit: "ml" },
  { name: "sesame oil", category: "other", defaultUnit: "ml" },
  { name: "sunflower oil", category: "other", defaultUnit: "ml" },
  // Herbs & spices
  { name: "basil", category: "produce", defaultUnit: "g" },
  { name: "bay leaf", category: "other", defaultUnit: "unit" },
  { name: "black pepper", category: "other", defaultUnit: "g" },
  { name: "chilli flakes", category: "other", defaultUnit: "g" },
  { name: "chilli powder", category: "other", defaultUnit: "g" },
  { name: "dill", category: "produce", defaultUnit: "g" },
  { name: "mint", category: "produce", defaultUnit: "g" },
  { name: "nutmeg", category: "other", defaultUnit: "g" },
  { name: "paprika", category: "other", defaultUnit: "g" },
  { name: "parsley", category: "produce", defaultUnit: "g" },
  { name: "rosemary", category: "produce", defaultUnit: "g" },
  { name: "salt", category: "other", defaultUnit: "g" },
  { name: "thyme", category: "produce", defaultUnit: "g" },
  { name: "turmeric", category: "other", defaultUnit: "g" },
  // Sauces & condiments
  { name: "balsamic vinegar", category: "other", defaultUnit: "ml" },
  { name: "coconut milk", category: "other", defaultUnit: "ml" },
  { name: "dijon mustard", category: "other", defaultUnit: "g" },
  { name: "fish sauce", category: "other", defaultUnit: "ml" },
  { name: "honey", category: "other", defaultUnit: "g" },
  { name: "hot sauce", category: "other", defaultUnit: "ml" },
  { name: "maple syrup", category: "other", defaultUnit: "ml" },
  { name: "miso paste", category: "other", defaultUnit: "g" },
  { name: "mustard", category: "other", defaultUnit: "g" },
  { name: "peanut butter", category: "other", defaultUnit: "g" },
  { name: "sriracha", category: "other", defaultUnit: "ml" },
  { name: "tahini", category: "other", defaultUnit: "g" },
  { name: "worcestershire sauce", category: "other", defaultUnit: "ml" },
  // Nuts & seeds
  { name: "almonds", category: "other", defaultUnit: "g" },
  { name: "cashews", category: "other", defaultUnit: "g" },
  { name: "chia seeds", category: "other", defaultUnit: "g" },
  { name: "flaxseeds", category: "other", defaultUnit: "g" },
  { name: "peanuts", category: "other", defaultUnit: "g" },
  { name: "pine nuts", category: "other", defaultUnit: "g" },
  { name: "pistachios", category: "other", defaultUnit: "g" },
  { name: "pumpkin seeds", category: "other", defaultUnit: "g" },
  { name: "sesame seeds", category: "other", defaultUnit: "g" },
  { name: "sunflower seeds", category: "other", defaultUnit: "g" },
  { name: "walnuts", category: "other", defaultUnit: "g" },
  // Sweeteners & baking
  { name: "brown sugar", category: "grains", defaultUnit: "g" },
  { name: "cocoa powder", category: "other", defaultUnit: "g" },
  { name: "cornstarch", category: "grains", defaultUnit: "g" },
  { name: "dark chocolate", category: "other", defaultUnit: "g" },
  { name: "sugar", category: "grains", defaultUnit: "g" },
  { name: "vanilla extract", category: "other", defaultUnit: "ml" },
  { name: "yeast", category: "grains", defaultUnit: "g" },
];

// PT name overrides — use when Haiku gives a technically-correct but uncommon Portuguese name.
// Key: English ingredient name (lowercase). Value: correct PT name.
const PT_NAME_OVERRIDES: Record<string, string> = {
  courgette: "Curgete",
  aubergine: "Beringela",
  beetroot: "Beterraba",
  "spring onion": "Cebolinho",
  "bok choy": "Pak choi",
  "brussels sprouts": "Couves de Bruxelas",
  pumpkin: "Abóbora",
  turnip: "Nabo",
  fennel: "Funcho",
  peas: "Ervilhas",
  prawns: "Camarão",
  shrimp: "Camarão",
  steak: "Bife",
  "heavy cream": "Natas",
  "sour cream": "Creme azedo",
  "greek yogurt": "Iogurte grego",
  oats: "Aveia",
  couscous: "Cuscuz",
  lentils: "Lentilhas",
  polenta: "Polenta",
  quinoa: "Quinoa",
  cornstarch: "Amido de milho",
  "brown sugar": "Açúcar amarelo",
  "cocoa powder": "Cacau em pó",
  "dark chocolate": "Chocolate negro",
  "vanilla extract": "Extrato de baunilha",
  yeast: "Fermento",
  "panko breadcrumbs": "Pão ralado panko",
  "olive oil": "Azeite",
  "coconut oil": "Óleo de coco",
  "sesame oil": "Óleo de sésamo",
  "sunflower oil": "Óleo de girassol",
  "peanut butter": "Manteiga de amendoim",
  tahini: "Tahini",
  "miso paste": "Pasta de miso",
  "fish sauce": "Molho de peixe",
  "worcestershire sauce": "Molho worcestershire",
  "hot sauce": "Molho picante",
  "maple syrup": "Xarope de ácer",
  "balsamic vinegar": "Vinagre balsâmico",
  "dijon mustard": "Mostarda de Dijon",
  "coconut milk": "Leite de coco",
  sriracha: "Sriracha",
  almonds: "Amêndoas",
  cashews: "Cajus",
  walnuts: "Nozes",
  pistachios: "Pistácios",
  "pine nuts": "Pinhões",
  peanuts: "Amendoins",
  "chia seeds": "Sementes de chia",
  flaxseeds: "Linhaça",
  "sesame seeds": "Sementes de sésamo",
  "pumpkin seeds": "Sementes de abóbora",
  "sunflower seeds": "Sementes de girassol",
  pomegranate: "Romã",
  watermelon: "Melancia",
  papaya: "Papaia",
  fig: "Figo",
  plum: "Ameixa",
  melon: "Melão",
};

// ---- Haiku macro estimation ----

type MacroResult = {
  ptName: string;
  dietaryFlags: string[];
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

async function estimateWithHaiku(
  specs: IngredientSpec[],
): Promise<Map<string, MacroResult>> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `For each ingredient, provide:
- pt_name: most common Portuguese (Portugal) name
- dietary_flags: array, only include flags that are definitively true — allowed values: meat, poultry, fish, shellfish, dairy, egg, honey, gluten, tree_nut, peanut, soy, sesame
- calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g: numbers per 100g/100ml (use null if genuinely uncertain)

Return JSON array only, no markdown:
[{"name":"...","pt_name":"...","dietary_flags":[...],"calories_per_100g":...,"protein_per_100g":...,"carbs_per_100g":...,"fat_per_100g":...}]

Ingredients:
${specs.map((s) => s.name).join("\n")}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON in Haiku response");

  const items: {
    name: string;
    pt_name: string;
    dietary_flags: string[];
    calories_per_100g: number | null;
    protein_per_100g: number | null;
    carbs_per_100g: number | null;
    fat_per_100g: number | null;
  }[] = JSON.parse(match[0]);

  const result = new Map<string, MacroResult>();
  for (const item of items) {
    result.set(item.name.toLowerCase(), {
      ptName: item.pt_name,
      dietaryFlags: item.dietary_flags ?? [],
      calories: item.calories_per_100g ?? null,
      protein: item.protein_per_100g ?? null,
      carbs: item.carbs_per_100g ?? null,
      fat: item.fat_per_100g ?? null,
    });
  }
  return result;
}

// ---- USDA validation ----
// Find the best existing USDA match and use its macros if similarity is high enough.

async function findUsdaMatch(name: string): Promise<{
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
} | null> {
  const { data } = await supabase
    .from("ingredients")
    .select(
      "name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, classification_source",
    )
    .eq("classification_source", "usda")
    .not("calories_per_100g", "is", null);

  if (!data?.length) return null;

  // Find best match by simple similarity (pg_trgm-style: ratio of common trigrams)
  // We approximate it here in JS: normalize and compare
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  const q = normalize(name);

  let bestScore = 0;
  let bestRow: (typeof data)[0] | null = null;

  for (const row of data) {
    const n = normalize(row.name);
    // Jaccard similarity on trigrams
    const qTri = trigrams(q);
    const nTri = trigrams(n);
    const intersection = new Set([...qTri].filter((x) => nTri.has(x)));
    const union = new Set([...qTri, ...nTri]);
    const score = union.size > 0 ? intersection.size / union.size : 0;
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  // Reject compound matches like "pomegranate juice" for "pomegranate":
  // if the USDA name starts with the query and the remainder contains a space, it's a compound.
  // Reject compound matches like "pomegranate juice" for "pomegranate":
  // the remainder after the query prefix must be only a simple suffix (s, es, ed, ...)
  // not an extra word (which would start with a space).
  const remainder =
    bestRow != null ? normalize(bestRow.name).slice(q.length) : "";
  const isCompoundMatch =
    bestRow != null &&
    normalize(bestRow.name).startsWith(q) &&
    remainder.startsWith(" "); // extra word added

  if (bestScore >= 0.65 && bestRow && !isCompoundMatch) {
    console.log(
      `    ✓ USDA match: "${bestRow.name}" (score ${bestScore.toFixed(2)}) — using USDA macros`,
    );
    return {
      calories: bestRow.calories_per_100g
        ? Number(bestRow.calories_per_100g)
        : null,
      protein: bestRow.protein_per_100g
        ? Number(bestRow.protein_per_100g)
        : null,
      carbs: bestRow.carbs_per_100g ? Number(bestRow.carbs_per_100g) : null,
      fat: bestRow.fat_per_100g ? Number(bestRow.fat_per_100g) : null,
    };
  }

  return null;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

// ---- Main ----

async function main() {
  console.log(`add-ingredients${DRY_RUN ? " (DRY RUN)" : ""}`);

  // Determine which specs to process
  let specs: IngredientSpec[] = INGREDIENTS;
  if (SINGLE_NAME) {
    specs = [{ name: SINGLE_NAME, category: "other", defaultUnit: "g" }];
  } else if (ONLY_CATEGORY) {
    specs = INGREDIENTS.filter((s) => s.category === ONLY_CATEGORY);
    console.log(
      `Filtering to category: ${ONLY_CATEGORY} (${specs.length} items)`,
    );
  }

  // Check which already exist — paginate to handle >1000 rows
  const existingNames = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await supabase
      .from("ingredients")
      .select("name")
      .is("owner_id", null)
      .range(from, from + PAGE - 1);
    if (!page?.length) break;
    for (const r of page) existingNames.add(r.name.toLowerCase());
    if (page.length < PAGE) break;
  }

  const missing = specs.filter((s) => !existingNames.has(s.name.toLowerCase()));
  console.log(
    `${specs.length} total → ${missing.length} missing, ${specs.length - missing.length} already exist\n`,
  );

  if (missing.length === 0) {
    console.log("Nothing to add.");
    return;
  }

  // Batch estimate with Haiku (max 50 per call)
  const BATCH = 50;
  const haikuMap = new Map<string, MacroResult>();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    process.stdout.write(
      `Haiku batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(missing.length / BATCH)}... `,
    );
    try {
      const result = await estimateWithHaiku(batch);
      for (const [k, v] of result) haikuMap.set(k, v);
      console.log(`✓ (${result.size} estimated)`);
    } catch (err) {
      console.error(`✗ ${err}`);
    }
    if (i + BATCH < missing.length)
      await new Promise((r) => setTimeout(r, 200));
  }

  // Insert each missing ingredient
  let inserted = 0;
  let failed = 0;

  for (const spec of missing) {
    const haiku = haikuMap.get(spec.name.toLowerCase());
    if (!haiku) {
      console.warn(`  ⚠ No Haiku estimate for "${spec.name}", skipping`);
      failed++;
      continue;
    }

    const ptName = PT_NAME_OVERRIDES[spec.name.toLowerCase()] ?? haiku.ptName;
    console.log(`\n  → ${spec.name} (${ptName})`);

    // Try to validate/override with USDA match
    let macros = {
      calories: haiku.calories,
      protein: haiku.protein,
      carbs: haiku.carbs,
      fat: haiku.fat,
    };
    const usdaMatch = await findUsdaMatch(spec.name);
    if (usdaMatch) {
      macros = usdaMatch;
    } else {
      console.log(`    ℹ No close USDA match — using Haiku estimate`);
    }

    if (DRY_RUN) {
      console.log(
        `    [dry-run] would insert: cal=${macros.calories} pro=${macros.protein} carbs=${macros.carbs} fat=${macros.fat}`,
      );
      continue;
    }

    // Insert ingredient
    const { data: newIng, error: ingErr } = await supabase
      .from("ingredients")
      .insert({
        name: spec.name,
        category: spec.category,
        default_unit: spec.defaultUnit,
        dietary_flags: haiku.dietaryFlags,
        calories_per_100g: macros.calories,
        protein_per_100g: macros.protein,
        carbs_per_100g: macros.carbs,
        fat_per_100g: macros.fat,
        classification_source: "manual",
      })
      .select("id")
      .single();

    if (ingErr || !newIng) {
      console.error(`    ✗ Insert error: ${ingErr?.message}`);
      failed++;
      continue;
    }

    // Insert translations
    const { error: transErr } = await supabase
      .from("ingredient_translations")
      .insert([
        { ingredient_id: newIng.id, language: "pt", name: ptName },
        {
          ingredient_id: newIng.id,
          language: "en",
          name: spec.name.charAt(0).toUpperCase() + spec.name.slice(1),
        },
      ]);

    if (transErr) {
      console.error(`    ✗ Translation error: ${transErr.message}`);
    } else {
      inserted++;
    }
  }

  console.log(
    `\nDone: ${inserted} inserted, ${failed} failed, ${specs.length - missing.length} skipped (already existed)`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
