export type ParsedRecipeImport = {
  name: string | null;
  servings: number | null;
  timeMin: number | null;
  ingredients: string[];
  steps: string[];
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  imageUrl: string | null;
  sourceUrl: string;
};

export type ParsedIngredient = {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  name: string | null;
};

const UNIT_MAP: Record<string, string> = {
  // metric
  g: "g",
  gram: "g",
  grams: "g",
  gramas: "g",
  grama: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  quilo: "kg",
  quilos: "kg",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  mililitro: "ml",
  mililitros: "ml",
  l: "L",
  liter: "L",
  liters: "L",
  litro: "L",
  litros: "L",
  // imperial
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  cup: "cup",
  cups: "cup",
  chávena: "cup",
  chávenas: "cup",
  xícara: "cup",
  xícaras: "cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  "colher de sopa": "tbsp",
  "colheres de sopa": "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  "colher de chá": "tsp",
  "colheres de chá": "tsp",
  "fl oz": "fl oz",
  "fluid oz": "fl oz",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  // count
  unit: "unit",
  units: "unit",
  unidade: "unit",
  unidades: "unit",
  slice: "slice",
  slices: "slice",
  fatia: "slice",
  fatias: "slice",
  clove: "clove",
  cloves: "clove",
  dente: "clove",
  dentes: "clove",
  pinch: "pinch",
  pinches: "pinch",
  pitada: "pinch",
  pitadas: "pinch",
  bunch: "bunch",
  bunches: "bunch",
  ramo: "bunch",
  ramos: "bunch",
  handful: "handful",
  punhado: "handful",
  sheet: "sheet",
  sheets: "sheet",
  folha: "sheet",
  folhas: "sheet",
  can: "can",
  cans: "can",
  lata: "can",
  latas: "can",
  sachet: "sachet",
  sachets: "sachet",
  saqueta: "sachet",
  saquetas: "sachet",
  scoop: "scoop",
  scoops: "scoop",
  medida: "scoop",
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function parseQuantity(s: string): number | null {
  // Replace unicode fractions first
  let normalized = s;
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replace(ch, ` ${val}`);
  }
  // Mixed number: "1 1/2" or "1½"
  const mixed = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed)
    return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  // Fraction: "1/2"
  const frac = normalized.trim().match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  // Decimal or integer
  const num = parseFloat(normalized.trim());
  return isNaN(num) ? null : num;
}

export function parseIngredientText(raw: string): ParsedIngredient {
  const text = raw.trim();

  // Build sorted unit keys (longest first to match "fl oz" before "fl")
  const sortedUnits = Object.keys(UNIT_MAP).sort((a, b) => b.length - a.length);
  const unitPattern = sortedUnits
    .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  // Attached unit (no space): "200g", "2tbsp"
  const attachedRe = new RegExp(
    `^([\\d½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\\/\\.]+)(${unitPattern})\\s*(.*)$`,
    "i",
  );
  const attachedMatch = text.match(attachedRe);
  if (attachedMatch) {
    const qty = parseQuantity(attachedMatch[1]);
    const unit = UNIT_MAP[attachedMatch[2].toLowerCase()] ?? null;
    const name = attachedMatch[3].trim() || null;
    if (qty !== null && unit)
      return { rawText: raw, quantity: qty, unit, name };
  }

  // Number then unit then name: "200 g dark chocolate", "2 tbsp olive oil"
  const spacedRe = new RegExp(
    `^([\\d½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\\/\\.]+(?:\\s+[\\d½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\\/\\.]+)?)\\s+(${unitPattern})\\b\\s*(.*)$`,
    "i",
  );
  const spacedMatch = text.match(spacedRe);
  if (spacedMatch) {
    const qty = parseQuantity(spacedMatch[1]);
    const unit = UNIT_MAP[spacedMatch[2].toLowerCase()] ?? null;
    const name = spacedMatch[3].trim() || null;
    if (qty !== null && unit)
      return { rawText: raw, quantity: qty, unit, name };
  }

  // Just a number at the start with no unit (e.g. "3 eggs")
  const numOnlyRe = /^([\d½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\/\.]+)\s+(.+)$/;
  const numOnly = text.match(numOnlyRe);
  if (numOnly) {
    const qty = parseQuantity(numOnly[1]);
    if (qty !== null)
      return {
        rawText: raw,
        quantity: qty,
        unit: "unit",
        name: numOnly[2].trim(),
      };
  }

  return { rawText: raw, quantity: null, unit: null, name: null };
}

function stripStepNumber(text: string): string {
  // Strip leading patterns: "1.", "1)", "Step 1:", "Step 1 -", "Passo 1:", "Passo 1 -", "Passo 1."
  return text
    .replace(/^\s*(?:step|passo|etapa)\s+\d+[\s\-:.]+/i, "")
    .replace(/^\s*\d+[\s]*[.):\-]\s+/, "")
    .trim();
}

function parseIsoDuration(iso: string): number | null {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  return h * 60 + m || null;
}

function parseServings(val: unknown): number | null {
  if (val == null) return null;
  const n = parseInt(String(val).replace(/\D.*$/, ""), 10);
  return isNaN(n) ? null : n;
}

function parseNumericNutrition(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function mapSchemaToRecipe(
  schema: Record<string, unknown>,
  url: string,
): ParsedRecipeImport {
  const name = typeof schema.name === "string" ? schema.name.trim() : null;

  const servings = parseServings(schema.recipeYield ?? schema.yield);

  let timeMin: number | null = null;
  if (schema.totalTime) timeMin = parseIsoDuration(String(schema.totalTime));
  if (timeMin == null && (schema.cookTime || schema.prepTime)) {
    const cook = schema.cookTime
      ? (parseIsoDuration(String(schema.cookTime)) ?? 0)
      : 0;
    const prep = schema.prepTime
      ? (parseIsoDuration(String(schema.prepTime)) ?? 0)
      : 0;
    timeMin = cook + prep || null;
  }

  const ingredients: string[] = Array.isArray(schema.recipeIngredient)
    ? (schema.recipeIngredient as unknown[])
        .map((i) => String(i).trim())
        .filter(Boolean)
    : [];

  const steps: string[] = [];
  if (Array.isArray(schema.recipeInstructions)) {
    for (const step of schema.recipeInstructions as unknown[]) {
      if (typeof step === "string") {
        const stripped = stripStepNumber(step.trim());
        if (stripped) steps.push(stripped);
      } else if (step && typeof step === "object") {
        const s = step as Record<string, unknown>;
        const text = s.text ?? s.name;
        if (typeof text === "string" && text.trim())
          steps.push(stripStepNumber(text.trim()));
      }
    }
  }

  let imageUrl: string | null = null;
  if (typeof schema.image === "string") {
    imageUrl = schema.image;
  } else if (Array.isArray(schema.image) && schema.image.length > 0) {
    const img = schema.image[0];
    imageUrl =
      typeof img === "string"
        ? img
        : (((img as Record<string, unknown>)?.url as string) ?? null);
  } else if (schema.image && typeof schema.image === "object") {
    imageUrl =
      ((schema.image as Record<string, unknown>).url as string) ?? null;
  }

  const nutrition = schema.nutrition as Record<string, unknown> | undefined;

  return {
    name,
    servings,
    timeMin,
    ingredients,
    steps,
    calories: parseNumericNutrition(
      nutrition?.calories ?? nutrition?.["schema:calories"],
    ),
    protein: parseNumericNutrition(
      nutrition?.proteinContent ?? nutrition?.["schema:proteinContent"],
    ),
    carbs: parseNumericNutrition(
      nutrition?.carbohydrateContent ??
        nutrition?.["schema:carbohydrateContent"],
    ),
    fat: parseNumericNutrition(
      nutrition?.fatContent ?? nutrition?.["schema:fatContent"],
    ),
    imageUrl,
    sourceUrl: url,
  };
}

function extractRecipeFromHtml(
  html: string,
  url: string,
): ParsedRecipeImport | null {
  const jsonLdPattern =
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const schema = candidate as Record<string, unknown>;
        const type = schema["@type"];
        const isRecipe =
          type === "Recipe" ||
          (Array.isArray(type) && (type as string[]).includes("Recipe"));
        if (isRecipe) return mapSchemaToRecipe(schema, url);
        if (Array.isArray(schema["@graph"])) {
          for (const node of schema["@graph"] as unknown[]) {
            if (node && typeof node === "object") {
              const n = node as Record<string, unknown>;
              const nt = n["@type"];
              if (
                nt === "Recipe" ||
                (Array.isArray(nt) && (nt as string[]).includes("Recipe"))
              ) {
                return mapSchemaToRecipe(n, url);
              }
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export { extractRecipeFromHtml };

export async function parseRecipeUrl(
  url: string,
): Promise<ParsedRecipeImport | null> {
  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    throw new Error(`fetch_failed: ${(err as Error).message}`);
  }
  return extractRecipeFromHtml(html, url);
}
