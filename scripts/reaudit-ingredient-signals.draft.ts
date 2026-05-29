/**
 * DRAFT — Re-audit ingredient enrichment (Sonnet pass + deterministic allergen net).
 *
 * WHY: A prior Haiku enrichment pass produced DANGEROUS dietary-flag errors for
 * allergen filtering (e.g. tofu/gochujang flagged "soy-free"; dried cod missing
 * "gluten-free"). This re-audit:
 *   (a) reasons COMPOSITION-FIRST with a higher-stakes model (claude-sonnet-4-6),
 *   (b) is backstopped by a DETERMINISTIC allergen rule layer (the "net") derived
 *       from the ingredient NAME that OVERRIDES the AI when they contradict.
 *
 * STATUS: DRAFT for human review. By default it runs in READ-ONLY SAMPLE MODE:
 *   it processes a small hardcoded sample list and PRINTS proposed output.
 *   It performs NO database writes in sample mode. A real full run would require
 *   setting WRITE=1 AND FULL=1 (both intentionally gated) — review before enabling.
 *
 * Run (sample, read-only):   npx tsx scripts/reaudit-ingredient-signals.draft.ts
 * Run (sample, JSON dump):   SAMPLE_JSON=1 npx tsx scripts/reaudit-ingredient-signals.draft.ts
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local
 *
 * ----------------------------------------------------------------------------
 * STORED VOCABULARY (what actually lives in ingredients.dietary_flags today):
 *   gluten-free, dairy-free, soy-free, nut-free, vegan, vegetarian
 * There is NO egg-free / shellfish-free / fish-free flag in the catalog, and a
 * single "nut-free" covers BOTH peanut and tree_nut. So the AI reasons in a rich
 * CONTAINMENT vocabulary (gluten/dairy/soy/egg/peanut/tree_nut/shellfish/fish),
 * and we DERIVE the stored "-free" flags from "does NOT contain X". The net asserts
 * containment from the name and overrides/derives the final stored flags.
 * ----------------------------------------------------------------------------
 */

import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"] ?? "";
const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 16; // single batch for the 15-item PT spot-check (one paid call)

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error(
    "Missing required env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ---------------------------------------------------------------------------
// Canonical vocabularies (the prompt MUST enforce these)
// ---------------------------------------------------------------------------

const CANONICAL_CUISINES = [
  "portuguese", "italian", "japanese", "mexican", "indian", "thai", "chinese",
  "french", "greek", "moroccan", "korean", "spanish", "middle-eastern",
  "american", "brazilian", "vietnamese", "turkish", "german",
] as const;

// Stored ONLY these 11; "spicy" is NOT stored (derived from heat_level downstream).
const CANONICAL_FLAVOR_NOTES = [
  "sweet", "sour", "salty", "bitter", "umami", "smoky", "earthy", "fresh",
  "rich", "nutty", "aromatic",
] as const;

// AI reasons in this rich containment vocabulary.
const ALLERGENS = [
  "gluten", "dairy", "soy", "egg", "peanut", "tree_nut", "shellfish", "fish",
] as const;
type Allergen = (typeof ALLERGENS)[number];

// Stored dietary_flags vocabulary (what the DB column actually holds).
type StoredFlag =
  | "gluten-free" | "dairy-free" | "soy-free" | "nut-free"
  | "vegan" | "vegetarian";

// ---------------------------------------------------------------------------
// The improved Sonnet prompt: composition-first + anti-patterns + self-verify + cuisine rules
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a professional culinary database curator and food-safety analyst.
For each ingredient you will (1) state what it is MADE FROM, then (2) derive allergen
CONTAINMENT, then (3) self-verify and correct contradictions. Allergen accuracy is
SAFETY-CRITICAL — under-flagging "free of X" when X is present can harm an allergic user.

=== STEP 1: COMPOSITION ===
First, in "composition", briefly state the primary ingredients/process this food is made from
(e.g. tofu -> "coagulated soybean curd"; gochujang -> "fermented chili paste with soybeans,
glutinous rice, salt"; bacalhau -> "salt-cured dried codfish").

=== STEP 2: ALLERGEN CONTAINMENT (framed as "does it CONTAIN", never "is it free") ===
From the composition, list every allergen the ingredient CONTAINS in "contains_allergens".
Allowed values: gluten, dairy, soy, egg, peanut, tree_nut, shellfish, fish.
If it contains none of these, return an empty array.

ANTI-PATTERNS — these are the exact mistakes a previous pass made. Obey strictly:
- SOY: tofu, edamame, miso, tempeh, gochujang, natto, soy sauce, shoyu, tamari, soy lecithin
  CONTAIN soy. NEVER mark a soy product as not containing soy.
- DAIRY: butter, cheese, cream, milk, whey, yogurt, ghee, casein, curds CONTAIN dairy.
  EXCEPTIONS that are NOT dairy: coconut milk / coconut cream, almond milk, soy milk, oat milk,
  rice milk (plant "milks"); peanut butter / almond butter / other NUT butters (these are nut, not dairy).
- GLUTEN: wheat (incl. all wheat flour, whole wheat, semolina/semola, durum, farro, spelt),
  barley, rye, malt, seitan, couscous, bulgur, bread, pasta/noodles made from wheat CONTAIN gluten.
  EXCEPTIONS that are gluten-free: rice flour, corn/maize flour, almond flour, coconut flour,
  chickpea/gram flour, buckwheat (despite the name), tamari labelled gluten-free, plain dried/salted fish & meat.
- NUTS: peanut is a legume -> "peanut"; almond, cashew, walnut, pistachio, hazelnut, pecan,
  macadamia, pine nut, Brazil nut, chestnut -> "tree_nut".
- EGG: egg, egg white/yolk, mayonnaise (unless explicitly vegan/tofu-based), meringue, aioli CONTAIN egg.
- SHELLFISH: shrimp/prawn, crab, lobster, clam, mussel, squid/calamari, octopus, scallop, oyster.
- FISH: cod (incl. salted dried cod / bacalhau), salmon, tuna, sardine, anchovy, mackerel, etc.
- Plain single-ingredient whole foods are gluten-free, dairy-free, soy-free unless they ARE that allergen:
  e.g. salted dried cod CONTAINS fish but is gluten-free, dairy-free, soy-free.

=== STEP 3: SELF-VERIFICATION (do this before emitting) ===
Re-read your "composition" and ask, one allergen at a time:
"Does this contain gluten? soy? dairy? egg? peanut? tree_nut? shellfish? fish?"
If any answer contradicts your contains_allergens array, FIX the array. Put a one-line note of any
correction in "verify_note" (or "ok" if nothing changed).

=== LIFESTYLE FLAGS (only when confident) ===
- "vegan": contains NO animal product (no meat, fish, shellfish, dairy, egg, honey, gelatin).
- "vegetarian": contains NO meat/fish/shellfish (dairy & egg allowed). Anything vegan is also vegetarian.
Put applicable values in "lifestyle" (subset of ["vegan","vegetarian"]). Empty if unsure or if it is an animal flesh.

=== CUISINE SIGNALS ===
Use ONLY these slugs: ${CANONICAL_CUISINES.join(", ")}
- Add a cuisine ONLY if a professional chef would IMMEDIATELY recognise the ingredient as
  characteristic of that cuisine. When unsure, leave EMPTY.
- The ingredient NAME may be in Portuguese because Portuguese is the app's language. That is
  NOT evidence of Portuguese cuisine — judge by culinary tradition ONLY.
- Leave cuisine_signals EMPTY for base/global ingredients (salt, sugar, water, garlic, onion,
  oil, flour, plain proteins like chicken/beef/pork/fish/tofu). These are not cuisine identifiers.

=== FLAVOR NOTES ===
Choose up to 3 from EXACTLY this list (no others; do NOT use "spicy"):
${CANONICAL_FLAVOR_NOTES.join(", ")}

=== HEAT LEVEL ===
Integer 0-3 ONLY (0 none, 1 very mild, 2 mild-medium, 3 hot). NEVER emit 4 or 5.

=== OUTPUT ===
Return a JSON array ONLY (no prose, no markdown fences). One object per input ingredient:
{
  "id": "<uuid>",
  "composition": "<short>",
  "contains_allergens": ["soy"],
  "verify_note": "ok",
  "lifestyle": ["vegan","vegetarian"],
  "cuisine_signals": [],
  "flavor_notes": ["umami"],
  "heat_level": 0
}`;

// ---------------------------------------------------------------------------
// AI call types
// ---------------------------------------------------------------------------

type AiResult = {
  id: string;
  composition: string;
  contains_allergens: string[];
  verify_note: string;
  lifestyle: string[];
  cuisine_signals: string[];
  flavor_notes: string[];
  heat_level: number;
};

function stripFences(raw: string): string {
  // Models wrap JSON in ```json ... ``` fences despite instructions. Strip robustly.
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If there is leading/trailing prose, grab the outermost JSON array.
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return s.trim();
}

async function callSonnet(
  batch: { id: string; name: string }[],
): Promise<AiResult[]> {
  const userMessage = `Tag these ingredients:\n${batch
    .map((i) => `{ "id": "${i.id}", "name": ${JSON.stringify(i.name)} }`)
    .join("\n")}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      // Cache the static system prompt across all batches — big input-cost win on a full run.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { content: Array<{ text: string }> };
  const raw = json.content?.[0]?.text ?? "[]";
  const parsed = JSON.parse(stripFences(raw)) as AiResult[];

  // Sanitize against canonical vocabularies (defense in depth — the net handles allergens).
  return parsed.map((r) => ({
    id: r.id,
    composition: String(r.composition ?? ""),
    contains_allergens: (r.contains_allergens ?? []).filter((a) =>
      (ALLERGENS as readonly string[]).includes(a),
    ),
    verify_note: String(r.verify_note ?? ""),
    lifestyle: (r.lifestyle ?? []).filter((l) => l === "vegan" || l === "vegetarian"),
    cuisine_signals: (r.cuisine_signals ?? []).filter((c) =>
      (CANONICAL_CUISINES as readonly string[]).includes(c),
    ),
    flavor_notes: (r.flavor_notes ?? [])
      .filter((f) => (CANONICAL_FLAVOR_NOTES as readonly string[]).includes(f))
      .slice(0, 3),
    heat_level: Math.max(0, Math.min(3, Math.round(Number(r.heat_level ?? 0)) || 0)),
  }));
}

// ---------------------------------------------------------------------------
// DETERMINISTIC ALLERGEN NET — the key safety layer (code, not AI).
// Operates on the ingredient NAME, accent-insensitive + lowercased, matching
// BOTH Portuguese and English terms. Asserts containment that OVERRIDES the AI.
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics: amêndoa -> amendoa
    .replace(/[^a-z0-9\s,()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Match helpers operate on the normalized (accent-free) string.
// WORD-BOUNDARY matching (not substring) so an allergen keyword embedded in a
// benign word cannot misfire: "wheat" must NOT match "buckwheat", "egg" must NOT
// match "eggplant", "milk" must NOT match "milkfish", "ovo" must NOT match
// "provolone", "fish" must NOT match "shellfish". This kills the whole class of
// substring false-positives generically (vs. per-item guards).
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (s: string, ...terms: string[]) =>
  terms.some((t) => {
    const nt = normalize(t);
    if (!nt) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRe(nt)}(?:[^a-z0-9]|$)`).test(s);
  });

type NetVerdict = {
  contains: Set<Allergen>;
  notes: string[]; // human-readable reasoning for the report
};

/**
 * Returns allergens the NAME deterministically implies are CONTAINED.
 * Carefully encodes the documented exceptions:
 *  - coconut/almond/soy/oat/rice "milk" are NOT dairy
 *  - nut "butter" (peanut/almond/etc) is NOT dairy
 *  - rice/corn/almond/coconut/chickpea flour & buckwheat are NOT gluten
 *  - tamari / soy sauce explicitly "gluten-free" is NOT gluten
 */
function allergenNet(rawName: string): NetVerdict {
  const s = normalize(rawName);
  const contains = new Set<Allergen>();
  const notes: string[] = [];
  const add = (a: Allergen, why: string) => {
    if (!contains.has(a)) {
      contains.add(a);
      notes.push(`${a}: ${why}`);
    }
  };

  // Imitation / substitute / free-from / shaped products are DEFINED by not containing
  // the thing their name references. Keyword matching over-flags them (e.g. "imitation
  // crab", "fish-shaped crackers", "sour cream substitute", "pasta without egg") — defer
  // entirely to the composition-aware AI.
  if (has(s, "imitation", "substitute", "alternative", "without", "non-dairy",
          "non-soy", "shaped", "mock", "eggless", "meatless")) {
    return { contains, notes: ["net deferred to AI — imitation/substitute/shaped/free-from"] };
  }

  // --- SOY ---
  if (has(s, "soja", "soy", "tofu", "edamame", "miso", "tempeh", "gochujang",
          "gochugaru", "natto", "tamari", "shoyu", "molho de soja", "soybean", "edamame")) {
    // gochugaru is Korean chili FLAKES (no soy) — exclude unless it's gochujang.
    const isGochugaruOnly = has(s, "gochugaru") && !has(s, "gochujang");
    // "chickpea miso" / "miso, chickpea" is soy-free (made from chickpeas).
    const isChickpeaMiso = has(s, "miso") && has(s, "chickpea", "grao de bico", "grao-de-bico");
    if (isGochugaruOnly) {
      notes.push("soy: SKIPPED — gochugaru is chili flakes, contains no soy");
    } else if (isChickpeaMiso) {
      notes.push("soy: SKIPPED — chickpea miso is made from chickpeas, not soy");
    } else {
      add("soy", "name indicates a soy-derived product");
    }
  }

  // --- GLUTEN ---
  // Buckwheat ("trigo sarraceno") is gluten-free despite containing "wheat"/"trigo".
  const isBuckwheat = has(s, "buckwheat", "trigo sarraceno");
  if (has(s, "trigo", "wheat", "pao", "bread", "pasta", "esparguete",
          "noodle", "cevada", "barley", "centeio", "rye", "malte", "malt",
          "bulgur", "cuscuz", "couscous", "seitan", "semola", "semolina",
          "durum", "farro", "spelt") &&
      !isBuckwheat &&
      !(has(s, "gluten-free", "gluten free", "rice noodle", "noodle de arroz"))) {
    add("gluten", "name indicates a wheat/barley/rye/gluten grain product");
  }
  // NOTE: bare "flour"/"farinha" and "massa" are NOT assumed wheat — too many naturally
  // gluten-free flours (almond, rice, oat, chickpea, amaranth, sorghum, teff, soy…).
  // The AI decides for unqualified flour.

  // --- DAIRY ---
  const plantMilk = has(s, "leite de coco", "coconut milk", "leite de amendoa",
    "almond milk", "leite de soja", "soy milk", "leite de aveia", "oat milk",
    "leite de arroz", "rice milk", "leite vegetal", "cashew milk", "leite de caju",
    "hemp milk", "pea milk", "flax milk", "macadamia milk", "tigernut milk");
  if (has(s, "leite", "milk") && !plantMilk) {
    add("dairy", "name indicates milk (animal)");
  }
  // Only UNAMBIGUOUS dairy words. "butter"/"cream" are intentionally dropped — too many
  // non-dairy uses (apple/cocoa/nut butter; cream of tartar, cream soda, coconut cream,
  // whipped/sour cream substitutes). The AI handles genuine dairy butter/cream.
  if (has(s, "queijo", "cheese", "iogurte", "yogurt", "whey", "soro de leite",
          "requeijao", "ghee", "caseina", "casein") &&
      !has(s, "liver cheese", "head cheese", "hog head cheese")) {
    add("dairy", "name indicates a dairy product (cheese/yogurt/whey)");
  }

  // --- EGG ---
  if (has(s, "ovo", "ovos", "egg", "clara", "gema", "maionese", "mayonnaise", "meringue", "aioli")) {
    const veganMayo = (has(s, "maionese", "mayonnaise", "aioli")) &&
      has(s, "vegan", "tofu", "tofu-based", "tofu based", "egg-free", "egg free", "sem ovo");
    if (veganMayo) {
      notes.push("egg: SKIPPED — vegan/tofu-based mayo contains no egg");
    } else {
      add("egg", "name indicates egg or egg-containing product");
    }
  }

  // --- PEANUT ---
  if (has(s, "amendoim", "peanut")) add("peanut", "name indicates peanut");

  // --- TREE_NUT ---
  if (has(s, "amendoa", "almond", "noz", "walnut", "caju", "cashew", "pistac",
          "pistachio", "avela", "hazelnut", "pecan", "macadamia", "castanha",
          "pinhao", "pine nut", "brazil nut", "noz-pecan")) {
    // "noz moscada" (nutmeg) and "noz de coco" (coconut) are NOT tree nuts.
    const nutmeg = has(s, "noz moscada", "noz-moscada", "nutmeg");
    const coconut = has(s, "noz de coco", "coco");
    if ((has(s, "noz") || has(s, "castanha")) && (nutmeg || coconut) &&
        !has(s, "amendoa", "almond", "caju", "cashew", "pistac", "avela",
             "hazelnut", "pecan", "macadamia", "pinhao", "pine nut")) {
      notes.push("tree_nut: SKIPPED — nutmeg/coconut are not tree nuts");
    } else {
      add("tree_nut", "name indicates a tree nut");
    }
  }

  // --- SHELLFISH ---
  // "oyster"/"scallop"/"ostra" dropped — common non-shellfish homonyms (oyster mushroom,
  // king oyster mushroom, beef oyster blade, scallop squash). Real oysters/scallops → AI.
  if (has(s, "camarao", "shrimp", "gambas", "prawn", "caranguejo", "crab",
          "lagosta", "lobster", "ameijoa", "clam", "mexilhao",
          "mussel", "lula", "squid", "calamari", "polvo", "octopus", "marisco")) {
    add("shellfish", "name indicates shellfish/mollusc");
  }

  // --- FISH ---
  if (has(s, "bacalhau", "salmao", "atum", "peixe", "fish", "sardinha", "robalo",
          "dourada", "truta", "anchova", "anchovy", "cavala", "cod", "salmon",
          "tuna", "sardine", "mackerel", "trout", "sea bass")) {
    // "fish sauce" still contains fish; "shellfish" handled separately (don't double count as fish only)
    add("fish", "name indicates a finfish");
  }

  return { contains, notes };
}

// ---------------------------------------------------------------------------
// Reconcile AI + net into the FINAL stored dietary_flags + report metadata.
// ---------------------------------------------------------------------------

type Reconciled = {
  finalContains: Allergen[];
  storedFlags: StoredFlag[];
  overrides: string[]; // human-readable: where the net OVERRODE the AI
  aiMissed: Allergen[]; // net added containment AI didn't list
  aiContradicted: Allergen[]; // AI said "free of X" but net says contains X
};

const NUT_ALLERGENS: Allergen[] = ["peanut", "tree_nut"];

function reconcile(ai: AiResult, name: string): Reconciled {
  const net = allergenNet(name);
  const aiSet = new Set<Allergen>(ai.contains_allergens as Allergen[]);
  const overrides: string[] = [];
  const aiMissed: Allergen[] = [];
  const aiContradicted: Allergen[] = [];

  // Net is authoritative for ADDING containment. Union AI ∪ net.
  const finalSet = new Set<Allergen>(aiSet);
  for (const a of net.contains) {
    if (!aiSet.has(a)) {
      finalSet.add(a);
      aiMissed.push(a);
      aiContradicted.push(a); // AI omitting => effectively claimed "free of X"
      overrides.push(
        `NET OVERRIDE: name implies CONTAINS ${a}, AI omitted it -> forced contained`,
      );
    }
  }

  const finalContains = [...finalSet];

  // Derive stored "-free" flags from final containment (absence => free).
  const storedFlags: StoredFlag[] = [];
  if (!finalSet.has("gluten")) storedFlags.push("gluten-free");
  if (!finalSet.has("dairy")) storedFlags.push("dairy-free");
  if (!finalSet.has("soy")) storedFlags.push("soy-free");
  if (!finalSet.has("peanut") && !finalSet.has("tree_nut")) storedFlags.push("nut-free");

  // Lifestyle flags: AI proposes, but net vetoes if an animal allergen is present.
  const animalPresent =
    finalSet.has("dairy") || finalSet.has("egg") ||
    finalSet.has("fish") || finalSet.has("shellfish");
  let vegan = ai.lifestyle.includes("vegan");
  let vegetarian = ai.lifestyle.includes("vegetarian") || vegan;
  if (animalPresent && vegan) {
    vegan = false;
    overrides.push("NET OVERRIDE: animal allergen present -> removed AI 'vegan'");
  }
  if ((finalSet.has("fish") || finalSet.has("shellfish")) && vegetarian) {
    vegetarian = false;
    vegan = false;
    overrides.push("NET OVERRIDE: fish/shellfish present -> removed 'vegetarian'");
  }
  if (vegan) storedFlags.push("vegan");
  if (vegetarian) storedFlags.push("vegetarian");

  return { finalContains, storedFlags, overrides, aiMissed, aiContradicted };
}

// ---------------------------------------------------------------------------
// Sample set (READ-ONLY). Exact catalog names confirmed via ilike search.
// ---------------------------------------------------------------------------

// Portuguese edge-case / known-trap spot-check (2026-05-29). Base names are English
// but each has PT aliases/translations (leite de coco, manteiga de amendoa, etc.).
// The net must get every one of these RIGHT. NOTE: "pistachio butter" / "manteiga de
// pistacio" is NOT in the catalog — closest row is plain "pistachios" (still exercises
// the tree_nut branch; the "butter"->not-dairy guard is exercised by almond butter).
const SAMPLE_IDS = [
  "696b889d-dbd3-472f-b35a-dbdfbfe88fcc", // coconut milk        (leite de coco)      -> must NOT be dairy
  "9def73a2-4844-43db-a53d-4b5a8253af0c", // soy milk, unsweetened (leite de soja)    -> soy, NOT dairy
  "4c8e8342-251a-402b-a898-a7201d8ac394", // almond butter        (manteiga de amendoa) -> tree_nut, NOT dairy
  "a021bced-c0ca-4230-acde-d683508c7ff0", // pistachios           (manteiga de pistacio N/A) -> tree_nut
  "c43a503b-9ae5-439c-ad0c-33df4151831b", // peanut oil           (oleo de amendoim)   -> peanut
  "d0c01ed4-2606-4d1c-a317-d495c2e89d32", // nutmeg               (noz moscada)        -> must NOT be tree_nut
  "465610cb-4550-408a-9be0-f889a9157f12", // rice flour           (farinha de arroz)   -> must NOT be gluten
  "4bab478b-1bac-4a5f-9b31-b6a43c7ed562", // corn flour, yellow   (farinha de milho)   -> must NOT be gluten
  "62724afb-79dd-4c62-b1f5-3829ade87556", // buckwheat            (trigo sarraceno)    -> must NOT be gluten
  "123a1832-077a-45b8-9bd8-aa85d095d865", // soy sauce            (molho de soja)      -> soy + (conservative) gluten
  "d9b1901a-d74b-43a6-a937-e01064dbdb06", // goat cheese, soft    (queijo de cabra)    -> dairy
  "961c93ac-ef0f-4d12-abd8-547cd9f1faeb", // cream                (natas)              -> dairy
  "08fe5a79-6b5d-45e1-86c4-7b865e8eda5f", // egg                  (ovo)                -> egg
  "843ef044-1f11-41a1-ae76-76b3ba5ed424", // shrimp               (camarao)            -> shellfish
  "ba487a0a-d1c1-415b-b46a-1c2265c163d4", // squid                (lula)               -> shellfish
  // Known-error cases (verify the re-audit FIXES these) + the word-boundary egg fix:
  "aa320537-1db6-4bb7-969d-30c932563697", // tofu      -> contains soy (was wrongly soy-free)
  "dc6e8b8b-bad5-429b-a88e-cd84dc0878ef", // gochujang -> contains soy+gluten (was wrongly soy-free)
  "7f11d83f-61f3-4f75-a5a7-88e7646e43bf", // bacalhau  -> contains fish, now gluten-free (was missing)
  "6b489c9b-afd0-4f11-8c20-9948b6fda81c", // eggplant  -> must NOT be egg ("egg" must not match "eggplant")
] as const;

// ---------------------------------------------------------------------------
// main() — READ-ONLY sample mode by default.
// ---------------------------------------------------------------------------

const WRITE = process.env["WRITE"] === "1";
const FULL = process.env["FULL"] === "1";
const SAMPLE_JSON = process.env["SAMPLE_JSON"] === "1";

type Row = {
  id: string; name: string; cuisine_signals: string[];
  flavor_notes: string[]; heat_level: number; dietary_flags: string[];
};

async function fetchRows(ids: readonly string[]): Promise<Row[]> {
  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, cuisine_signals, flavor_notes, heat_level, dietary_flags")
    .in("id", ids as string[]);
  if (error) throw new Error(`fetch failed: ${error.message}`);
  const byId = new Map((data ?? []).map((r) => [r.id, r as Row]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Row[];
}

async function fetchAllSystemRows(): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, cuisine_signals, flavor_notes, heat_level, dietary_flags")
      .is("owner_id", null)
      .order("name")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

// Gating: default = read-only SAMPLE. WRITE=1 = write the SAMPLE set (small batch).
// WRITE=1 FULL=1 = write the whole catalog (the real run). FULL without WRITE is refused
// (a full read-only run would pay for AI without writing anything).
async function main() {
  if (FULL && !WRITE) {
    console.error("REFUSING: FULL requires WRITE=1. Use `WRITE=1 FULL=1` for the real run, or no flags for the read-only sample.");
    process.exit(1);
  }

  const mode = FULL ? "FULL WRITE" : WRITE ? "SAMPLE WRITE" : "SAMPLE READ-ONLY";
  console.log(`Re-audit — ${mode} (model=${MODEL}, batch=${BATCH_SIZE})\n`);

  const envIds = process.env["IDS"]?.split(",").map((x) => x.trim()).filter(Boolean);
  const rows = FULL
    ? await fetchAllSystemRows()
    : await fetchRows(envIds && envIds.length ? envIds : SAMPLE_IDS);
  console.log(`Loaded ${rows.length} ingredients.\n`);

  const reportRows: Array<Record<string, unknown>> = [];
  const disagreements: string[] = [];
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let ai: AiResult[];
    try {
      ai = await callSonnet(batch.map((r) => ({ id: r.id, name: r.name })));
    } catch (e) {
      console.warn(`Batch @${i} AI error: ${(e as Error).message}`);
      failed += batch.length;
      continue;
    }
    const aiById = new Map(ai.map((a) => [a.id, a]));

    for (const row of batch) {
      const a = aiById.get(row.id);
      if (!a) { console.warn(`No AI result for ${row.name}`); failed++; continue; }
      const rec = reconcile(a, row.name);
      const net = allergenNet(row.name);
      if (rec.overrides.length) disagreements.push(`${row.name} :: ${rec.overrides.join(" | ")}`);

      if (WRITE) {
        const { error } = await supabase.from("ingredients").update({
          contains_allergens: rec.finalContains,
          dietary_flags: rec.storedFlags,
          cuisine_signals: a.cuisine_signals,
          flavor_notes: a.flavor_notes,
          heat_level: a.heat_level,
          signals_enriched_at: new Date().toISOString(),
        }).eq("id", row.id);
        if (error) { console.warn(`update failed ${row.name}: ${error.message}`); failed++; }
        else updated++;
      }

      reportRows.push({
        name: row.name, id: row.id, current_dietary_flags: row.dietary_flags,
        final_contains: rec.finalContains, proposed_dietary_flags: rec.storedFlags,
        cuisine_signals: a.cuisine_signals, flavor_notes: a.flavor_notes,
        heat_level: a.heat_level, overrides: rec.overrides,
      });

      if (!FULL) {
        console.log("─".repeat(72));
        console.log(`${row.name}`);
        console.log(`  composition    : ${a.composition}`);
        console.log(`  CURRENT flags  : ${JSON.stringify(row.dietary_flags)}`);
        console.log(`  AI contains    : ${JSON.stringify(a.contains_allergens)}  (verify: ${a.verify_note})`);
        console.log(`  NET contains   : ${JSON.stringify([...net.contains])}`);
        console.log(`  FINAL contains : ${JSON.stringify(rec.finalContains)}`);
        console.log(`  PROPOSED flags : ${JSON.stringify(rec.storedFlags)}`);
        console.log(`  cuisine/flavor : ${JSON.stringify(a.cuisine_signals)} / ${JSON.stringify(a.flavor_notes)}  heat=${a.heat_level}`);
        if (rec.overrides.length) rec.overrides.forEach((o) => console.log(`     ** ${o}`));
      } else if ((i + BATCH_SIZE) % 320 === 0) {
        console.log(`  …processed ~${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
      }
    }

    if (i + BATCH_SIZE < rows.length) await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n${mode} complete. ${WRITE ? `updated=${updated}, failed=${failed}` : "no writes"}.`);
  console.log(`Net↔AI disagreements: ${disagreements.length}`);
  if (disagreements.length) {
    const fs = await import("fs");
    fs.writeFileSync("docs/reaudit-disagreements.txt", disagreements.join("\n"));
    console.log("  wrote docs/reaudit-disagreements.txt");
  }
  if (SAMPLE_JSON) console.log("\n=== JSON DUMP ===\n" + JSON.stringify(reportRows, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
