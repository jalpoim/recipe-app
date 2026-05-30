import { createServerFn } from "@tanstack/react-start";
import { makeClient, getLang } from "./client-server";
import type { Json } from "../../types/db";

export type FlavorProfile = {
  signatureIngredient: string | null;
  signatureIngredientPlatformMultiple: number;
  topFlavorNotes: string[];
  avgHeatLevel: number;
  cuisineBreakdown: { cuisine: string; pct: number }[];
  topProtein: string | null;
  proteinVarietyCount: number;
  avgCookingTimeMin: number | null;
  platformAvgCookingTimeMin: number | null;
  distinctCuisines: number;
  platformAvgCuisines: number | null;
  lifetimeCookCount: number;
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildNarrativePrompt(
  fp: FlavorProfile,
  lang: string,
  monthName: string,
  year: number,
): string {
  const langDesc =
    lang === "pt" ? 'Portuguese (European, informal "tu" form)' : "English";

  const facts: string[] = [];
  if (fp.topProtein) facts.push(`Most cooked protein: ${fp.topProtein}`);
  if (fp.proteinVarietyCount > 1)
    facts.push(`Cooks ${fp.proteinVarietyCount} different proteins`);
  if (fp.cuisineBreakdown.length > 0) {
    facts.push(
      `Cuisine mix: ${fp.cuisineBreakdown
        .slice(0, 3)
        .map((c) => `${c.cuisine} ${c.pct}%`)
        .join(", ")}`,
    );
  }
  if (fp.avgCookingTimeMin != null) {
    const desc =
      fp.avgCookingTimeMin < 20
        ? "cooks very quickly (under 20 min on average)"
        : fp.avgCookingTimeMin < 35
          ? `cooks fairly quickly (${Math.round(fp.avgCookingTimeMin)} min average)`
          : `tends toward longer recipes (${Math.round(fp.avgCookingTimeMin)} min average)`;
    facts.push(`Cooking tempo: ${desc}`);
  }
  if (fp.topFlavorNotes.length > 0)
    facts.push(`Dominant flavors: ${fp.topFlavorNotes.join(", ")}`);
  if (fp.signatureIngredient) {
    facts.push(
      `Signature ingredient: "${fp.signatureIngredient}" appears in ${Math.round(fp.signatureIngredientPlatformMultiple)}x more of their recipes than the average user`,
    );
  }
  if (fp.avgHeatLevel > 1.5) facts.push("Clearly enjoys spicy cooking");
  else if (fp.avgHeatLevel > 0.8) facts.push("Uses moderate heat in cooking");
  facts.push(`Total recipes cooked: ${fp.lifetimeCookCount}`);
  facts.push(`Month: ${monthName} ${year}`);

  return `You are writing a short, warm, personal description of someone's cooking identity for a meal prep app.

Write exactly 2–3 sentences in ${langDesc}.
Tone: like a knowledgeable friend who has been watching them cook — warm, specific, slightly poetic. Never clinical, never generic.
Write in second person. No lists, no hashtags, no marketing language. Never mention the app by name.
Start with something specific and true about them. Never start with "Based on" or "According to".

Data about this person:
${facts.map((f) => `- ${f}`).join("\n")}

Write the description now.`;
}

// ─── Internal computation ─────────────────────────────────────────────────────

async function _computeFlavorProfile(
  supabase: ReturnType<typeof makeClient>,
  uid: string,
): Promise<FlavorProfile | null> {
  // Fetch cook log + recipe data
  const { data: logs } = (await supabase
    .from("cook_log")
    .select("recipe_id, recipes(cuisine_tags, proteins, time_min)")
    .eq("user_id", uid)) as unknown as {
    data:
      | {
          recipe_id: string;
          recipes: {
            cuisine_tags: string[];
            proteins: string[];
            time_min: number | null;
          } | null;
        }[]
      | null;
  };

  const rows = logs ?? [];
  if (rows.length < 5) return null;

  // Deduplicate to distinct recipes
  const distinctRecipeMap = new Map<
    string,
    { cuisine_tags: string[]; proteins: string[]; time_min: number | null }
  >();
  for (const row of rows) {
    if (!distinctRecipeMap.has(row.recipe_id) && row.recipes) {
      distinctRecipeMap.set(row.recipe_id, row.recipes);
    }
  }
  const distinctRecipes = [...distinctRecipeMap.values()];
  const distinctCount = distinctRecipes.length;

  // Cuisine breakdown
  const cuisineRecipes = new Map<string, number>();
  for (const r of distinctRecipes) {
    for (const c of r.cuisine_tags ?? []) {
      cuisineRecipes.set(c, (cuisineRecipes.get(c) ?? 0) + 1);
    }
  }
  const cuisineBreakdown = [...cuisineRecipes.entries()]
    .map(([cuisine, n]) => ({ cuisine, pct: Math.round((n / distinctCount) * 100) }))
    .sort((a, b) => b.pct - a.pct);

  // Protein data
  const proteinCounts = new Map<string, number>();
  for (const r of distinctRecipes) {
    for (const p of r.proteins ?? []) {
      proteinCounts.set(p, (proteinCounts.get(p) ?? 0) + 1);
    }
  }
  const topProtein =
    proteinCounts.size > 0
      ? [...proteinCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;
  const proteinVarietyCount = proteinCounts.size;

  // Cooking time
  const times = distinctRecipes
    .map((r) => r.time_min)
    .filter((t): t is number => t != null);
  const avgCookingTimeMin =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;

  // Ingredient-based data (separate query for efficiency)
  const recipeIds = [...distinctRecipeMap.keys()];
  const { data: ingRows } = (await supabase
    .from("recipe_ingredients")
    .select("recipe_id, name, ingredients(flavor_notes, heat_level)")
    .in("recipe_id", recipeIds)) as unknown as {
    data:
      | {
          recipe_id: string;
          name: string | null;
          ingredients: { flavor_notes: string[]; heat_level: number } | null;
        }[]
      | null;
  };

  const ingNameCount = new Map<string, number>();
  const flavorNoteCounts = new Map<string, number>();
  let heatSum = 0,
    heatCount = 0;

  for (const ing of ingRows ?? []) {
    if (ing.name) {
      const key = ing.name.toLowerCase().trim();
      ingNameCount.set(key, (ingNameCount.get(key) ?? 0) + 1);
    }
    if (ing.ingredients) {
      for (const note of ing.ingredients.flavor_notes ?? []) {
        flavorNoteCounts.set(note, (flavorNoteCounts.get(note) ?? 0) + 1);
      }
      if (ing.ingredients.heat_level > 0) {
        heatSum += ing.ingredients.heat_level;
        heatCount++;
      }
    }
  }

  const avgHeatLevel = heatCount > 0 ? heatSum / heatCount : 0;

  const baseFlavorNotes = [...flavorNoteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([note]) => note);
  // 'spicy' is derived from heat_level (not stored as a flavor note): surface it
  // as the lead chip when the user's cooking carries real, repeated heat.
  const isSpicy = heatCount >= 2 && avgHeatLevel >= 1;
  const topFlavorNotes = (isSpicy ? ["spicy", ...baseFlavorNotes] : baseFlavorNotes).slice(0, 3);

  // Platform averages (single cached row).
  const { data: pa } = await supabase
    .from("platform_averages")
    .select("top_10_ingredients, avg_heat_level, avg_distinct_cuisines, avg_cooking_time_min")
    .eq("id", 1)
    .maybeSingle() as {
    data: {
      top_10_ingredients: string[];
      avg_heat_level: number | null;
      avg_distinct_cuisines: number | null;
      avg_cooking_time_min: number | null;
    } | null;
  };

  const top10 = (pa?.top_10_ingredients ?? []).map((s) => s.toLowerCase());

  // Signature ingredient: highest user frequency, excluding platform top-10 noise ingredients
  const sigCandidates = [...ingNameCount.entries()]
    .filter(([name]) => !top10.includes(name))
    .filter(([, count]) => count / distinctCount >= 0.25)
    .sort((a, b) => b[1] - a[1]);

  let signatureIngredient: string | null = null;
  let signatureIngredientPlatformMultiple = 0;

  if (sigCandidates.length > 0) {
    const [name, count] = sigCandidates[0];
    const userFraction = count / distinctCount;
    signatureIngredient = name;
    // Rough platform multiple: user fraction / assumed platform baseline (~10%)
    signatureIngredientPlatformMultiple = Math.max(2, Math.round(userFraction / 0.1));
  }

  return {
    signatureIngredient,
    signatureIngredientPlatformMultiple,
    topFlavorNotes,
    avgHeatLevel,
    cuisineBreakdown,
    topProtein,
    proteinVarietyCount,
    avgCookingTimeMin,
    platformAvgCookingTimeMin: pa?.avg_cooking_time_min
      ? Number(pa.avg_cooking_time_min)
      : null,
    distinctCuisines: cuisineRecipes.size,
    platformAvgCuisines: pa?.avg_distinct_cuisines
      ? Number(pa.avg_distinct_cuisines)
      : null,
    lifetimeCookCount: rows.length,
  };
}

// ─── Server functions ─────────────────────────────────────────────────────────

export const getUserFlavorProfile = createServerFn({ method: "GET" }).handler(
  async (): Promise<FlavorProfile | null> => {
    const supabase = makeClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    return _computeFlavorProfile(supabase, session.user.id);
  },
);

export const generateFlavorNarrative = createServerFn({
  method: "POST",
}).handler(async (): Promise<string | null> => {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const supabase = makeClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  const uid = session.user.id;
  const lang = getLang();

  // Check cache
  const { data: profileRow } = (await supabase
    .from("profiles")
    .select("flavor_narrative, flavor_narrative_generated_at, flavor_narrative_lang")
    .eq("user_id", uid)
    .maybeSingle()) as unknown as {
    data: {
      flavor_narrative: string | null;
      flavor_narrative_generated_at: string | null;
      flavor_narrative_lang: string | null;
    } | null;
  };

  const generatedAt = profileRow?.flavor_narrative_generated_at
    ? new Date(profileRow.flavor_narrative_generated_at)
    : null;
  const daysSince = generatedAt
    ? (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;
  const langChanged = profileRow?.flavor_narrative_lang !== lang;

  if (profileRow?.flavor_narrative && daysSince < 30 && !langChanged) {
    return profileRow.flavor_narrative;
  }

  // Compute flavor profile
  const fp = await _computeFlavorProfile(supabase, uid);
  if (!fp) return null;

  // Build prompt and call Sonnet
  const now = new Date();
  const monthName = now.toLocaleString(lang === "pt" ? "pt-PT" : "en-GB", {
    month: "long",
  });
  const year = now.getFullYear();
  const prompt = buildNarrativePrompt(fp, lang, monthName, year);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const json = (await response.json()) as {
    content: Array<{ text: string }>;
  };
  const narrative = json.content?.[0]?.text?.trim() ?? null;
  if (!narrative) return null;

  // Persist to profiles
  await supabase
    .from("profiles")
    .update({
      flavor_narrative: narrative,
      flavor_narrative_generated_at: new Date().toISOString(),
      flavor_narrative_lang: lang,
      flavor_profile_data: fp as unknown as Json,
    })
    .eq("user_id", uid);

  return narrative;
});
