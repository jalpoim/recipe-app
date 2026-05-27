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
        steps.push(step.trim());
      } else if (step && typeof step === "object") {
        const s = step as Record<string, unknown>;
        const text = s.text ?? s.name;
        if (typeof text === "string" && text.trim()) steps.push(text.trim());
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
