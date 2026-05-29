# Flavor Identity & Cook Profile — Full Design Spec

Last updated: 2026-05-29
Status: In progress — grilling session with João

> **⚡ 2026-05-29 updates (these SUPERSEDE the inline content below):**
> - **Heat scale is 0–3** (DB constraint), not 0–5.
> - **Title ladders renamed** (no more "Engenheiro Nutricional" / "Ninja da Cozinha" / "Arquiteto de Refeições") — final wording is live in i18n; see implementation plan.
> - **Specialty badge = all-time dominant, preserved in the cuisine-badge collection, never blanks once earned.** Section 6's "snapshot of the present" wording is superseded.
> - **No emojis or icons in copy anywhere** (custom icons only). Strip the emoji used in copy below.
> - **Dietary/allergen = containment model.** Ingredients carry positive `contains_allergens` (gluten/dairy/soy/egg/peanut/tree_nut/shellfish/fish); the `-free` flags are DERIVED from "does not contain X"; the library intolerance filter matches on `contains_allergens`. Section 11's positive AND-aggregation is replaced.
> - **Flavor notes = canonical 12** (`spicy` derived from `heat_level`): sweet, sour, salty, bitter, umami, smoky, earthy, fresh, rich, spicy, nutty, aromatic.
> - **Planner axis** scores plan-driven activity only (planned cook +1, shopping completion +2, meal-prep week +3).
>
> Full detail + live status: `docs/claude-code-implementation-plan.md` → "Recipe Data Quality, Derivation & Allergen Safety — Session Plan (2026-05-29)".

---

## 1. Core Purpose

The profile feature is an **identity engine**, not a stats dashboard.

- Stats are evidence for the story. They are never the story itself.
- Everything surfaced to the user must be **celebratory**. Nothing punishing, nothing shameful.
- No ingredient, cuisine, or cooking habit should ever feel like a negative judgement. If someone cooks eggs every day, that is a positive signal, not a class marker.
- The job: make each user feel *"this app knows me better than any other cooking app"* so they keep coming back to build their narrative.
- Narrative over numbers. Profile page hides raw stats and surfaces only identity copy and positive milestones.

---

## 2. The Five Personas

These are the five user archetypes the system must recognise and serve differently. Each gets their own identity ladder, narrative copy, and recommended content.

### Persona 1 — The Macro Optimizer
- **Who:** Filters by protein/calorie needs. Protein-first mindset. Tracks macros actively.
- **What they want from their profile:** Confirmation they're hitting their goals. Recognition that their approach is working.
- **Key signals:** Uses macro filter, saves high-protein recipes, cooks recipes with protein > 30g per serving.
- **Identity reward:** Feel like a disciplined, data-driven cook.

### Persona 2 — The Casual Meal Prepper
- **Who:** Browses by meat/fish category. Decides on taste and simplicity. Doesn't obsess over macros unless losing weight.
- **What they want from their profile:** Feeling organised and in control of their week.
- **Key signals:** Uses plan regularly, cooks batch-friendly recipes (servings ≥ 4), completes shopping trips.
- **Identity reward:** Feel like someone who has their life together.

### Persona 3 — The Time Crunched Parent/Person
- **Who:** Filters by time. Wants quick, minimal-ingredient, family-friendly meals.
- **What they want from their profile:** Recognition that they're feeding people well despite being busy.
- **Key signals:** Predominantly cooks recipes under 30 min, uses time filter, low ingredient count recipes.
- **Identity reward:** Feel like an efficient, capable provider.

### Persona 4 — The Dietary Restricted / Fitness Person
- **Who:** Vegan, gluten-free, dairy-free, or allergy-driven. Dietary flags are a constraint, not a lifestyle choice. Cares deeply about finding meals they actually enjoy within their restrictions.
- **What they want from their profile:** Validation that they're not missing out. Their restrictions feel like a superpower, not a limitation.
- **Key signals:** dietary_mode is set to non-none, intolerances set, saves and cooks recipes matching their dietary profile.
- **Identity reward:** Feel like their diet is an identity they're proud of, not a burden.

### Persona 5 — The Bored Routine Breaker
- **Who:** Wants novelty. Driven by ratings and cook counts. Tries one new recipe per week. Has lots saved. May not cook at home frequently but loves trying new food.
- **What they want from their profile:** Evidence that they're adventurous. A record of their exploration.
- **Key signals:** High variety of cuisines cooked, high number of saved recipes, low repeat cook rate, high distinct recipe count relative to total cooks.
- **Identity reward:** Feel like a genuine food explorer with a rich, eclectic taste.

---

## 3. Persona Detection — Hybrid Model

**Approach:** Onboarding seeds the persona. Behaviour overrides it silently over time.

### Onboarding addition
Cook style becomes **Step 1** — the very first screen after account creation (before Language, Units, Dietary). This makes the app feel immediately personal and tailored from the first interaction.

**New onboarding order:** Cook Style → Language → Units → Dietary

Step 1 headline: *"O que mais importa quando escolhes o que cozinhar?"* (EN: *"What matters most when you choose what to cook?"*)

The five options — conversational, not clinical persona labels:

| Option displayed | Maps to persona |
|---|---|
| 🥩 **Proteína e macros** — "Quero atingir os meus objetivos" | Macro Optimizer |
| ⏱️ **Rapidez e simplicidade** — "Tenho pouco tempo" | Time Crunched |
| 🌍 **Explorar sabores** — "Quero experimentar coisas novas" | Routine Breaker |
| 🥗 **Cabe na minha dieta** — "Tenho preferências alimentares" | Dietary Restricted |
| 🍽️ **Refeições práticas** — "Cozinho para a família/semana" | Casual Meal Prepper |

- Single select, same visual style as existing onboarding steps (border-2, check icon on selected)
- Skip button available — if skipped, persona starts as null and is inferred purely from behaviour
- Selection stored in a new `cook_style` column on `profiles` table (text, nullable)
- Values: `'optimizer'` | `'time_crunched'` | `'explorer'` | `'dietary'` | `'meal_prepper'` | null

**Closing sentence (shown on the last onboarding screen, below the skip/continue button):**
> PT: *"Quanto mais cozinhares, mais o teu perfil ganha vida e as sugestões melhoram."*
> EN: *"The more you cook, the richer your profile gets and the better your recommendations become."*

No reward promises, no previews of locked content. Just a warm signal that the app learns from them.

### Dietary step change
Remove the active "Sem restrições" / "No restrictions" option. Show only the actual restriction options that can be tapped and untapped (vegan, vegetarian, gluten-free, dairy-free, etc.). If the user taps nothing and continues, that is equivalent to no restrictions — no explicit selection needed.

### Contextual reminder — recommendations
Users should be reminded of the profile/recommendations link at two moments (not as push notifications):
1. **First time they save a recipe** — a soft one-time inline hint below the heart animation: *"As receitas que guardas ajudam a personalizar as tuas sugestões."* Never shown again after first trigger.
2. **First visit to profile page** — if profile has <5 cooks, a warm sentence is shown below the hero: *"Cozinha receitas para o teu perfil ganhar vida e as sugestões melhorarem."* Disappears permanently after 5 cooks are logged.

### Behavioural override
Over time, the system independently scores the user on all 5 axes (0–100) based on their actual behaviour. If a user selected "Dietary" at onboarding but their behaviour scores highest on "Explorer", the Explorer ladder becomes their primary displayed title. The stored `cook_style` acts only as a tiebreaker for new users with sparse data.

---

## 4. XP — Never Shown as a Raw Number

XP is a purely internal currency. The user never sees "340 XP" or any numeric score.

What the user sees instead:
- Their current **title** (consequence of XP)
- Their current **specialty badge** (consequence of behaviour patterns)
- A **progress bar toward next level** — but ONLY when they are ≥70% of the way there (see Section 8)
- A **level-up overlay** when they cross a threshold (see Section 8)

The 70% rule: showing progress when the goal feels close motivates. Showing it when the goal feels distant demotivates. Below 70%, no progress indicator is shown at all.

---

## 5. Primary Title System — Five Parallel Ladders

Each persona has its own 5-level progression ladder. The user is scored independently on all 5 axes. Whichever axis scores highest determines the title displayed on their profile.

Two users at "Level 3" can have completely different titles. This is intentional — it's the core identity differentiator.

**The user sees only their primary (highest) title at any time.** They do not see all five scores or all five ladders. The complexity is internal.

### Ladder 1 — Explorer (Routine Breaker persona)
Progression driven by: distinct cuisines cooked + distinct proteins tried

| Level | Title (PT) | Title (EN) |
|---|---|---|
| 1 | Curioso | Curious |
| 2 | Viajante | Wanderer |
| 3 | Explorador | Explorer |
| 4 | Embaixador dos Sabores | Flavour Ambassador |
| 5 | Nómada Gastronómico | Gastronomic Nomad |

### Ladder 2 — Optimizer (Macro Optimizer persona)
Progression driven by: % of cooked recipes meeting the protein-to-calorie ratio threshold (protein×4 ≥ 25% of total calories)

| Level | Title (PT) | Title (EN) |
|---|---|---|
| 1 | Consciente | Mindful |
| 2 | Preciso | Precise |
| 3 | Atleta de Cozinha | Kitchen Athlete |
| 4 | Engenheiro Nutricional | Nutritional Engineer |
| 5 | Chef de Alta Performance | High Performance Chef |

### Ladder 3 — Planner (Casual Meal Prepper persona)
Progression driven by: weeks with active plan + ≥3 cooks from that plan

| Level | Title (PT) | Title (EN) |
|---|---|---|
| 1 | Organizado | Organised |
| 2 | Planeador | Planner |
| 3 | Chef de Semana | Weekly Chef |
| 4 | Mestre do Meal Prep | Meal Prep Master |
| 5 | Arquiteto de Refeições | Meal Architect |

### Ladder 4 — Swift (Time Crunched persona)
Progression driven by: % of cooked recipes under 30 min

| Level | Title (PT) | Title (EN) |
|---|---|---|
| 1 | Ágil | Agile |
| 2 | Veloz | Swift |
| 3 | Ninja da Cozinha | Kitchen Ninja |
| 4 | Chef Expresso | Express Chef |
| 5 | Mestre do Tempo | Time Master |

**Note:** The Dietary axis was removed as a primary title ladder. Dietary identity is expressed through the specialty badge layer instead (e.g. "Chef Plant-Based", "Chef Keto"). This avoids framing medical restrictions or lifestyle choices as a competitive ladder — see Section 6.

---

## 6. Specialty Badge

**Separate from the primary title.** Reflects the user's dominant flavour identity *right now*. Changes as behaviour shifts — it is a snapshot of the present, not a permanent achievement. This is what makes it feel alive.

### Signal priority hierarchy (agreed Q6)

Winner is determined by this strict order:

1. **Cuisine wins first** — if the user has cooked ≥5 recipes sharing the same cuisine_tag, that cuisine claims the badge. e.g. "Embaixador Italiano". Most unique and shareable identity. Cuisine is rarer and more personal than protein.
2. **Cooking style wins second** — if no single cuisine hits ≥5 cooks (user is varied), the dominant cooking style tag wins. e.g. "Rei do Meal Prep", "Mestre das Receitas Rápidas". Reflects *how* they cook, stable across varied cuisines.
3. **Protein wins last** — most generic signal, most likely to feel reductive. Only surfaces as badge when neither cuisine nor cooking style is strong enough. Never frames protein as a social/economic marker.

**Minimum threshold:** ≥5 instances of that signal in the cook log to claim any badge. Below threshold: no specialty badge shown — profile shows primary title only. This is fine.

**Badge examples by signal type:**
- Cuisine: "Embaixador Italiano", "Mestre Asiático", "Explorador Mediterrâneo", "Chef Português"
- Cooking style: "Rei do Meal Prep", "Ninja das Receitas Rápidas", "Mestre do Grelhador"
- Protein (last resort): "Especialista em Frango", "Mestre do Peixe", "Chef de Proteínas"

---

## 7. Actions — What Gets Tracked and What Gets Feedback

### Actions with visible feedback

| Action | Feedback shown | Form |
|---|---|---|
| Mark recipe as cooked (no level-up) | Warm 2-second toast: e.g. *"Receita registada ✓ — o teu perfil está a crescer"* | Toast + small checkmark animation on button |
| Mark recipe as cooked (level-up) | Full-screen overlay showing new title, auto-dismisses | See Section 8 |
| Complete shopping trip | Toast: warm sentence acknowledging completion | Toast |
| Create + publish a recipe | Enhanced success state on publish screen (slightly more celebratory than current) | Success state |
| Specialty badge changes | Banner at top of profile page, auto-dismisses | Banner |

### Actions tracked silently (no visible feedback beyond existing UI)

| Action | Why silent |
|---|---|
| Save/bookmark a recipe | Heart/bookmark tap is already feedback |
| First new cuisine cooked | Surfaces later as narrative in profile |
| First new protein cooked | Surfaces later as narrative in profile |
| Invite household member | Existing invite flow handles this |
| Import recipe via URL | Existing success state handles this |
| Consecutive weeks cooking | Surfaces as streak narrative in profile |
| Rate a recipe | Gentle prompt appears naturally after marking cooked |
| Cook your own created recipe | Silently tracked, surfaces in profile narrative |

---

## 8. Feedback Mechanisms

### Routine action toast (no level-up)
- Appears at bottom of screen for 2 seconds
- Warm, conversational copy — never clinical
- Small motion: subtle scale-up + fade using framer-motion
- No confetti, no particle effects — this is a serious cooking app

### Level-up overlay (primary title only)
- Full-screen overlay, semi-transparent dark background
- Large display of new title, centred
- Sub-copy: one sentence explaining what earned it
- Auto-dismisses after 3–4 seconds OR user taps to dismiss
- Only fires for primary title level-ups (happens max 4 times per user ever)
- Framer-motion: slide up + fade in, feels earned not cheap

### Specialty badge change (banner)
- Slim banner at top of profile page
- Auto-dismisses after 3 seconds
- e.g. *"O teu perfil de sabor evoluiu — agora és Embaixador Italiano 🇮🇹"*

### Progress bar (profile page only)
- Shown **only when user is ≥70% of the way to the next level**
- Shows current title + slim progress bar below it
- No percentage number, no XP count
- When below 70%: only title is shown, no progress indicator

---

## 9. Profile Page — Layout & Design (Q14 resolved)

### Design principles
- **No raw stats visible** on the profile page. No "20 recipes cooked this month" as a headline number.
- Stats only appear as supporting evidence inside a narrative sentence: *"Cozinhaste 7 cozinhas diferentes este mês"* not a table.
- "Receitas que dominaste" section removed — cooked ≠ mastered, and this surfaces too early.
- Protein/ingredient labels must never feel like economic or social judgements. Frame everything as a superpower: *"Os teus pratos são ricos em proteína"* not *"A tua proteína favorita é ovo"*.
- Everything should feel like a celebration of what they've done, not a measurement of what they haven't.

### Section order

```
1. Hero (gradient) — avatar · display name · @username · primary title · specialty badge chip
2. Badge row — Creator card + Specialty card (side-by-side, ~40% width each; row hidden until first one earned)
3. This month's narrative cards (see unlock gates below)
4. Shopping milestone row (earned milestones only; hidden until first earned)
5. Cuisine badge collection — one row, expandable; hidden until first badge earned
6. Lifetime counters — two narrative sentences at the bottom: cook count + shopping trips
```

### Progress bar placement
**Never on the profile page.** Only shown during cook actions: when marking a recipe as cooked and the user is ≥70% to their next axis level, the cook action toast includes a slim animated progress bar that fills up. The profile page shows only the current title — no bar, no percentage.

### Content unlock gates
Nothing is locked or greyed out. Sections simply do not exist until earned. Users discover the page growing richer over time — no "unlock at X cooks" messaging.

| Gate | What appears |
|---|---|
| 0–4 cooks | Hero only. Warm hero subtitle: *"O teu perfil de sabor está a ganhar vida."* |
| 5+ cooks | Cook count narrative card appears |
| 10+ cooks | Cuisine discovery card + signature recipe card (if individual thresholds met) |
| 15+ cooks | Top protein narrative card (if ≥40% concentration across cooks) |
| First cuisine badge earned | Cuisine collection row appears |
| Creator Level ≥1 | Creator card appears in badge row |
| Specialty badge earned | Specialty card appears in badge row |

### Narrative card thresholds
- **Signature recipe card**: only when user has cooked the same recipe ≥3 times AND has ≥10 total distinct recipe cooks. Below this it's coincidence, not a pattern.
- **Top protein narrative card**: only when one protein represents ≥40% of all cooks AND user has ≥15 distinct recipes cooked. Framed positively: *"Os teus pratos são frequentemente ricos em [protein]"* — never as a label or identity marker.
- **Cuisine discovery card**: appears the month a first-time cuisine is cooked. Shows the recipe's own thumbnail image — personal and immediate.

### Narrative is all-time, not monthly
Profile sections (signature recipe, cuisine identity, top protein, badge collection) are based on **all-time cooking history**. Identity accumulates permanently — nothing resets. Every cook adds to the user's story.

The "this month" framing is dropped from section copy. Instead: *"A tua receita preferida"*, *"A tua cozinha dominante"* — all-time truths that grow richer over time.

**Annual recap (Spotify Wrapped style):** Roadmap only — not built at launch. To be designed and scoped separately when the user base is large enough for the data to be interesting.

### Icon and visual style
- **Narrative cards**: custom SVG icons in the app's coral accent style — same approach as the chip strip. No Lucide icons, no emoji placeholders in the final version.
- **Cuisine discovery card**: shows the cooked recipe's own thumbnail image alongside the cuisine name. No generic flags as the primary element; a small tasteful flag may complement the visual but is not the badge itself.
- **Cuisine badges**: circular medallion illustrations — one pre-commissioned illustration per cuisine (steaming ramen bowl for Japanese, pastel de nata for Portuguese, tagine for Moroccan, etc.). 3 tiers per badge with progressively richer framing (bronze → silver → gold). Designed to feel collectible and shareable.
- **Creator + specialty badge cards**: small self-contained cards (~40% screen width), rounded, with illustration inside. Not chips or filter-style tags. Creator illustration: stylised chef's notebook or recipe card. Tiers upgrade the illustration detail and frame.
- **Badge art** added to pre-checklist: 15–18 cuisine badges × 3 tiers + Creator badge × 5 levels + specialty badge types. Ship Tier 1 first; upgrade over time.

### Accidental cook log — undo pattern
No confirmation dialog on mark-as-cooked (too much friction). Instead: the action toast includes a timed **[Anular]** link visible for 5 seconds. Tapping it removes the log entry immediately. After 5 seconds the toast fades and the entry is committed. Since profile data is always derived from `cook_log`, undoing automatically reverses any profile unlock that was triggered — no extra state to manage.

### General user level system — not implemented
No overall XP level. The anti-ceiling mechanisms are:
1. Monthly narrative refresh (always fresh content)
2. Cuisine badge tier progression (3 tiers per cuisine, open-ended depth)
3. Lifetime counters as autobiography (infinite accumulation, no ceiling)

Research (Peloton, Nike Run Club, MyFitnessPal) shows hard level ceilings cause motivation cliffs. Monthly narrative gives power users a reason to return without manufacturing artificial progression.

---

## 10. Axis Scoring Formulas (Q12 — in progress)

### Explorer axis
Rewards breadth, novelty, and genuine discovery. Cooking the same diverse meals repeatedly does NOT continue to progress this axis after the discovery bonus is earned.

| Signal | Points | Notes |
|---|---|---|
| First time cooking each cuisine | +5 one-time | ~30 cuisines available — no cap |
| First time cooking each protein | +3 one-time | ~12 proteins |
| Each distinct new recipe cooked (never cooked before) | +0.5 ongoing | No cap |
| Cooking the same recipe again | +0 | Explorer does not reward repetition |

Level thresholds: L1=10, L2=25, L3=50, L4=75, L5=100

**Discovery moment UI:** when a first-time bonus fires, a warm narrative toast appears: *"Cozinhaste cozinha japonesa pela primeira vez 🎉"* — feeds into profile narrative.

### Optimizer axis
Rewards macro discipline. Scales correctly for all body types and genders.

**Metric:** `(protein_g_per_serving × 4) / calories_per_serving ≥ 0.25`
(Protein contributes ≥25% of total calories — standard nutritional definition of high-protein.)

Score = % of cooked recipes (with macro data) where this threshold is met.
Recipes with no macro data: excluded from calculation, not penalised.
Score is continuous — naturally updates as user cooks more.

### Planner axis
Rewards organised, consistent cooking habits. Shopping trip completion rewards ALL users (see below), but counts more for Planners.

**Primary signal:** Weeks where the user had an active plan AND completed ≥3 cook logs from that plan = genuine meal prepper week.

| Signal | Points | Notes |
|---|---|---|
| Each "meal prepper week" (plan + 3+ cooks from it) | +3 | No cap |
| Shopping trip completion | +2 (Planners) / +0.5 (all others) | Universal incentive, weighted for Planners |

The `servings ≥ 4` metric for batch cooking is **not used** as primary signal — too ambiguous (single-person high-yield recipes like protein balls inflate it falsely).

### Dietary axis
Rewards mastery and variety within dietary identity — NOT the existence of restrictions.
Users with `dietary_mode = 'none'` and no intolerances score 0 on this axis permanently. Correct behaviour — they are not on this ladder.

| Signal | Points | Notes |
|---|---|---|
| Each distinct recipe cooked matching dietary mode | +2 | Discovery of variety within constraints |
| First time cooking a new-to-them recipe within restrictions | +3 bonus | Discovery bonus |
| Creating a recipe matching restrictions that gets saved by others | +5 | Creation + community validation |

The ladder represents: *"I've built a rich, varied cooking life within my dietary identity."* Not: *"I have limitations."*

### Swift axis
Rewards speed and efficiency. Simple and unambiguous.

Score = % of cooked recipes (with time_min data) where `time_min ≤ 30`.
Continuous — updates naturally. Recipes with no time data: excluded, not penalised.

### Universal shopping completion signal
Shopping trip completion has platform value for ALL personas, not just Planners. To incentivise it universally:
- +0.5 points to whichever ladder is currently the user's highest-scoring axis
- Planners get +2 instead (see above)
- This means every user has a reason to complete shopping through the app

---

## 11. Tag & Cuisine Inference Architecture

### The problem
Users creating recipes will provide minimum input: name, image, ingredients. Sometimes no steps. We cannot rely on users to tag recipes correctly. Everything must be inferred.

### Three-tier inference system

**Tier 1 — Programmatic, instant, free (runs in auto-tag.ts at save time)**

Derives from the ingredients table's existing metadata columns (`cuisine_signals[]`, `flavor_notes[]`, `heat_level`, `dietary_flags[]`):

| Derived field | Method |
|---|---|
| `cuisine_tags[]` on recipe | Weighted vote across all ingredient `cuisine_signals`. If top cuisine ≥ 30% of total signal weight → tagged. Multiple tags allowed (Italian + Mediterranean is valid and more accurate than forcing one). |
| `dietary_flags` on recipe | Aggregate across ingredients. If all ingredients carry "vegan" → recipe is vegan. High reliability. |
| `flavor_notes[]` on recipe | Aggregate most frequent flavor_notes across all ingredients. |
| `proteins[]` | Already implemented. |
| `tags[]` (fit, rápido, meal-prep, picante, fumado, etc.) | Already implemented in auto-tag.ts. |

Ambiguity is handled by allowing multiple cuisine_tags, not by forcing a single winner.

**Tier 2 — Async Haiku background job (fires after recipe creation, non-blocking)**

Triggered when: programmatic cuisine confidence is below threshold (no dominant signal ≥ 30%), OR recipe name contains strong cuisine hints not captured by ingredients (e.g. "Ramen", "Shakshuka", "Arroz de Pato").

Input: recipe name + ingredient names (plain list)
Output: `{ cuisine_tags: string[], flavor_notes: string[] }`

Cost: ~$0.000016 per recipe at current Haiku pricing. 1 million recipes = ~$16. Run on every user-created recipe as a background enrichment job. Programmatic result is the immediate default; Haiku corrects/enriches asynchronously.

**Tier 3 — One-time ingredient DB enrichment (batch script, run once)**

The USDA database is the nutritional source of truth but lacks cuisine/flavour metadata. `cuisine_signals`, `flavor_notes`, `heat_level`, `dietary_flags` may be sparse on USDA-sourced ingredients.

Action required:
1. Audit ingredients table — identify rows where `cuisine_signals = []` and `flavor_notes = []`
2. Run a Haiku batch enrichment script on those ingredients (input: ingredient name → output: JSON with all signal fields)
3. After enrichment, re-run Tier 1 derivation on all existing recipes to populate their `cuisine_tags`
4. For recipes where Tier 1 still yields no result, batch Haiku pass on recipe name + ingredients

This is a one-time investment. After enrichment, every future recipe creation benefits from Tier 1 accuracy at zero marginal cost.

### DB audit prompt design — defensive rules

The batch enrichment prompt for ingredients must follow strict defensive rules to avoid over-tagging and false confidence.

**The three confidence tiers:**
1. **Tag confidently** — ingredient is distinctively and immediately associated with a cuisine by any professional chef. Examples: gochujang → Korean, za'atar → Middle Eastern, miso → Japanese, fish sauce → Southeast Asian, nduja → Italian (Calabrian).
2. **Tag with multiple regions** — ingredient is genuinely characteristic of multiple cuisines. Examples: chorizo → ["Portuguese", "Spanish", "Mexican"], tahini → ["Middle Eastern", "Mediterranean"], coconut milk → ["Thai", "Indian", "Caribbean"].
3. **Do not tag** — ingredient is a base/global ingredient with no cuisine specificity. **MUST leave cuisine_signals empty.** Examples: salt, pepper, garlic, onion, olive oil, butter, flour, eggs, sugar, water, vegetable oil, lemon, tomato, potato, carrot, celery.

**Explicit edge cases the prompt must handle:**
- Olive oil: global, NOT Italian or Mediterranean — leave empty
- Garlic: global — leave empty
- Pasta (dry): Italian signal is valid — but "noodles" generically is not
- Chicken/beef/pork: leave cuisine_signals empty — these are proteins, not cuisine signals
- Soy sauce: was Japanese/Chinese, now global — leave empty OR tag ["Japanese", "Chinese"] with low confidence note
- Paprika: Spanish if smoked (pimentão fumado), Hungarian otherwise — differentiate by full ingredient name
- Curry powder: Indian signal valid if labelled as such; generic "curry powder" = leave empty

**The prompt structure (system message):**
```
You are a professional culinary database curator with expertise in global cuisines.
Your task is to tag ingredients with cuisine_signals, flavor_notes, heat_level, and dietary_flags.

RULES — follow strictly:
1. Only add a cuisine signal if a professional chef would IMMEDIATELY recognise this ingredient as characteristic of that cuisine. When in doubt, leave cuisine_signals as an empty array.
2. Base ingredients (salt, pepper, garlic, onion, olive oil, butter, flour, water, sugar, eggs, lemon juice, vegetable oil) must ALWAYS have cuisine_signals = [].
3. Proteins (chicken, beef, pork, lamb, fish) must have cuisine_signals = []. They are protein sources, not cuisine identifiers.
4. If an ingredient belongs to multiple cuisines, list all of them — do not pick just one.
5. heat_level: 0 = no heat, 1 = very mild, 2 = mild, 3 = medium, 4 = hot, 5 = very hot/extreme.
6. flavor_notes: choose from [savory, sweet, sour, bitter, umami, spicy, smoky, earthy, fresh, rich, tangy, aromatic]. Max 3.
7. dietary_flags: choose from [vegan, vegetarian, gluten-free, dairy-free, nut-free, soy-free]. Only flag what is definitively true.

Return valid JSON only. No explanations.
```

**Quality check after batch run:** sample 100 tagged ingredients, manually verify a cross-section of edge cases before applying to recipe derivation.

### Source of truth
The ingredients table is the source of truth for Tier 1 inference — but only once it has been enriched. The richer the ingredient metadata, the more recipes we can tag correctly without AI. Target: reduce Haiku fallback rate to <20% of new recipes after enrichment.

## 11. Recommendations — Library Sort Personalisation (Q17 resolved)

Phase 1 scope: **personalised sort/filter defaults on the library page only**. No dedicated "For You" section. No AI-generated recommendations.

### How it works
`fetchLibrary` is already fully server-side (sort, filters, search, pagination all run in PostgREST). Personalisation requires no changes to the core query logic — it pre-populates the default sort and filter values passed to `fetchLibrary` based on the user's `cook_style` and `user_cook_profile`.

| Persona | Default sort | Pre-applied filter |
|---|---|---|
| `optimizer` | `pcal` | none |
| `time_crunched` | `time` | none |
| `explorer` | `popular` | none |
| `meal_prepper` | `popular` | none |
| `dietary` | `popular` | already handled by `dietary_mode` / `intolerances` |
| null | `popular` | no change from current behaviour |

**No cuisine exclusions are applied by default.** Users return to the same recipes they love — this is a meal planning app first, not a discovery engine. Excluding already-cooked cuisines would break the core weekly use case.

These are defaults only. The user can still change sort and filters manually — persona just pre-selects the sort that makes sense for them on first load.

### "Novo para mim" chip — future feature, not Phase 1
Available to **all users** (not gated on Explorer persona). When active, applies two exclusions server-side:
1. Exclude recipe IDs already in the user's `cook_log` (recipes they've cooked before)
2. Exclude cuisine_tags already in `user_cook_profile.explored_cuisines` (cuisines they've explored)

Naming: **"Novo para mim"** (PT) / **"New to me"** (EN). Not "Explore" (sounds like a nav tab) and not "New" (implies recently added to platform).

Two new params needed in `fetchLibrary`: `excludedRecipeIds?: string[]` and `excludedCuisines?: string[]`. Both roadmap — not Phase 1.

### When to apply persona defaults
- Read `profiles.cook_style` in the library page loader
- Apply default sort only on first mount (no user-set sort in URL params)
- User-set filters always take precedence over persona defaults

---

## 12. Cuisine Badge Collection

A collectable system separate from the title/axis system. Represents the user's culinary exploration history.

### Rules
- **15–18 target world cuisines** selected to match the platform's content strategy (cuisines with meaningful recipe coverage)
- Earned by cooking **≥3 distinct recipes** with that cuisine_tag — from any source (library, created, imported)
- Badges appear only when **earned** (full colour). Not earned = completely hidden. No locked states, no greyed-out teasers except when ≥80% of the way to earning one (shows as teaser to motivate the final push)
- The collection grows as the user discovers new cuisines. Purely positive — nothing to feel bad about

### Visual design
- **Pre-commissioned illustrations**, one per cuisine — done once, used for all users
- Not AI-generated per user. Reviewed manually before going live.
- Style: food culture illustrations — a bowl of ramen for Japanese, a tagine for Moroccan, pastel de nata for Portuguese
- High quality matters — these are things users will show each other

### Candidate cuisines (to be finalised with content strategy)
Portuguese · Italian · Japanese · Mexican · Indian · Thai · Chinese · French · Greek/Mediterranean · Moroccan · Korean · Spanish · Middle Eastern · American · Brazilian · Vietnamese · Turkish · German/Central European

### Content dependency
The 15–18 target cuisines must map to cuisines with committed recipe library coverage. Badge collection is a content strategy commitment, not just a feature.

---

## 13. Shopping Completion — Lifetime Counter (not a streak)

Shopping trip completion is a universal platform action incentivised for all users.

**No streak.** Streaks cause grief. A week off shouldn't erase progress.

**Lifetime counter:** "203 refeições planeadas em casa" — permanently accumulating, never resets. Visible on all profiles.

**Milestone badges** at: 10 · 25 · 50 · 100 · 200 · 500 shopping trips completed. Permanent, earned, never lost.

Philosophy: *"Podes perder o ritmo, mas nunca perdes o que já fizeste."*

---

## 14. Creator Track

A separate progression track — not one of the 5 cooking style axes. Orthogonal to cooking style: an Explorer can also be a great Creator. Creator level does not compete for the primary title slot.

### Why separate
A mass importer could reach Creator Level 5 without cooking anything meaningful, which would undermine the identity system if Creator competed with cooking style axes for the primary title.

### Profile layer
Displayed as its own badge on the profile, below the primary title. Labelled "Criador" with its level.

### Scoring

| Action | Points |
|---|---|
| Import recipe via URL | +0.5 |
| Create recipe from scratch | +3 |
| Recipe saved by another user | +5 |
| Recipe cooked by another user | +8 |

### Creator title ladder

| Level | Title (PT) | Title (EN) |
|---|---|---|
| 1 | Autor de Receitas | Recipe Author |
| 2 | Criador de Conteúdo | Content Creator |
| 3 | Chef da Comunidade | Community Chef |
| 4 | Influenciador Culinário | Culinary Influencer |
| 5 | Mestre Criador | Master Creator |

### Importer milestone (separate from Creator level)
**"Colecionador de Receitas"** — one-time badge awarded when ≥10 recipes imported. Rewards bringing your cookbook to the platform. Does not inflate Creator level progression.

### Natural progression path
Import → others save your recipes → others cook your recipes → original creation. The scoring naturally incentivises this transition without forcing it.

---

## 15. Lifetime Cooking Counter

Separate from all axes and Creator track. Visible on all profiles.

"X refeições cozinhadas em casa" — total cook log entries, accumulates forever, never resets.

This is the one number that tells the story of how much someone has cooked with this app. Always positive.

---

---

## 16. Pre-Implementation Checklist

Each item below must be completed and verified before implementation begins. Testing uses the MCP Supabase `execute_sql` tool. After running each query, interpret the results against the expected output described.

---

### Step 1 — Audit current recipe tag coverage

**Why:** Before adding new columns or running the enrichment script, establish a baseline of how much data is already tagged. This tells you how much work the audit needs to do.

**Run these queries:**

```sql
-- 1a. What % of system recipes have cuisine_tags populated?
SELECT
  COUNT(*) AS total_system_recipes,
  COUNT(*) FILTER (WHERE array_length(cuisine_tags, 1) > 0) AS has_cuisine_tags,
  ROUND(100.0 * COUNT(*) FILTER (WHERE array_length(cuisine_tags, 1) > 0) / COUNT(*), 1) AS pct_with_cuisine
FROM recipes
WHERE visibility = 'system' AND deleted_at IS NULL;

-- 1b. What % of system recipes have flavor_notes populated?
SELECT
  COUNT(*) AS total_system_recipes,
  COUNT(*) FILTER (WHERE array_length(flavor_notes, 1) > 0) AS has_flavor_notes,
  ROUND(100.0 * COUNT(*) FILTER (WHERE array_length(flavor_notes, 1) > 0) / COUNT(*), 1) AS pct_with_flavor_notes
FROM recipes
WHERE visibility = 'system' AND deleted_at IS NULL;

-- 1c. What cuisine_tags values actually exist (check casing, typos, inconsistency)?
SELECT unnest(cuisine_tags) AS tag, COUNT(*) AS recipe_count
FROM recipes
WHERE visibility = 'system'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 50;

-- 1d. What % of ingredients have cuisine_signals populated?
SELECT
  COUNT(*) AS total_ingredients,
  COUNT(*) FILTER (WHERE array_length(cuisine_signals, 1) > 0) AS has_signals,
  ROUND(100.0 * COUNT(*) FILTER (WHERE array_length(cuisine_signals, 1) > 0) / COUNT(*), 1) AS pct_with_signals
FROM ingredients;

-- 1e. What % of ingredients have dietary_flags populated?
SELECT
  COUNT(*) AS total_ingredients,
  COUNT(*) FILTER (WHERE array_length(dietary_flags, 1) > 0) AS has_dietary_flags,
  ROUND(100.0 * COUNT(*) FILTER (WHERE array_length(dietary_flags, 1) > 0) / COUNT(*), 1) AS pct_with_dietary_flags
FROM ingredients;
```

**Interpret results:**
- `pct_with_cuisine` < 50% → significant audit work needed before axis scoring is reliable
- Cuisine tag values with mixed casing (e.g. `Italian` vs `italian`) → normalise to lowercase slugs before anything else
- `pct_with_signals` on ingredients < 30% → Tier 1 programmatic inference will be very weak; Haiku enrichment is essential

---

### Step 2 — Verify schema additions

After running the migrations to add `dietary_flags`, `cooking_method`, `cook_style`, and `user_cook_profile`, confirm they landed correctly.

```sql
-- 2a. Confirm dietary_flags and cooking_method columns exist on recipes
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'recipes'
  AND column_name IN ('dietary_flags', 'cooking_method')
ORDER BY column_name;

-- 2b. Confirm cook_style exists on profiles
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name = 'cook_style';

-- 2c. Confirm user_cook_profile table exists with expected columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_cook_profile'
ORDER BY ordinal_position;

-- 2d. Confirm RLS is enabled on user_cook_profile
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'user_cook_profile';
-- relrowsecurity must be true

-- 2e. List RLS policies on user_cook_profile
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'user_cook_profile';
-- Expect at minimum: SELECT policy (user_id = auth.uid()), UPSERT policy
```

**Interpret results:**
- If any column is missing → migration did not run or has an error; check `supabase migration list`
- `relrowsecurity = false` → critical security gap; RLS was not enabled; fix before continuing
- No policies → table is open to all authenticated users; add ownership policies

---

### Step 3 — Verify ingredient enrichment (after audit script runs)

After running the Haiku batch enrichment script on ingredients:

```sql
-- 3a. Coverage improvement check (compare to Step 1d baseline)
SELECT
  COUNT(*) AS total_ingredients,
  COUNT(*) FILTER (WHERE array_length(cuisine_signals, 1) > 0) AS has_signals,
  COUNT(*) FILTER (WHERE array_length(dietary_flags, 1) > 0) AS has_dietary_flags,
  COUNT(*) FILTER (WHERE array_length(flavor_notes, 1) > 0) AS has_flavor_notes
FROM ingredients;

-- 3b. Spot-check: verify base ingredients have NO cuisine_signals (guard against over-tagging)
SELECT name, cuisine_signals, dietary_flags
FROM ingredients
WHERE name IN ('salt', 'pepper', 'garlic', 'onion', 'olive oil', 'butter',
               'flour', 'eggs', 'sugar', 'water', 'lemon', 'tomato')
ORDER BY name;
-- All cuisine_signals must be {} for these. If any are non-empty, the prompt is over-tagging.

-- 3c. Spot-check: verify distinctive ingredients have correct signals
SELECT name, cuisine_signals, dietary_flags, flavor_notes
FROM ingredients
WHERE name ILIKE ANY (ARRAY['%miso%', '%gochujang%', '%za''atar%', '%fish sauce%',
                             '%nduja%', '%tahini%', '%chorizo%'])
ORDER BY name;
-- miso → ['japanese'], gochujang → ['korean'], za'atar → ['middle eastern'], etc.

-- 3d. Find ingredients that still have no signals after enrichment (for manual review)
SELECT id, name, classification_source
FROM ingredients
WHERE array_length(cuisine_signals, 1) IS NULL
  AND owner_id IS NULL  -- system ingredients only
ORDER BY name
LIMIT 100;
-- A short list is acceptable; a long list means enrichment script missed many rows
```

**Interpret results:**
- Base ingredients (salt, garlic, eggs) with non-empty `cuisine_signals` → prompt is over-tagging; rollback those rows and tighten the prompt before re-running
- Distinctive ingredients with empty or wrong signals → enrichment incomplete; check which rows the script skipped
- AI interpretation: paste the spot-check results into the chat and ask: "Do these cuisine signals look accurate for a professional culinary database? Flag any that seem wrong or missing."

---

### Step 4 — Verify recipe tag derivation (after Tier 1 auto-tag runs on existing recipes)

After re-running Tier 1 derivation on existing system recipes using the enriched ingredient data:

```sql
-- 4a. Coverage improvement on cuisine_tags (compare to Step 1a baseline)
SELECT
  COUNT(*) AS total_system_recipes,
  COUNT(*) FILTER (WHERE array_length(cuisine_tags, 1) > 0) AS has_cuisine_tags,
  COUNT(*) FILTER (WHERE array_length(dietary_flags, 1) > 0) AS has_dietary_flags,
  COUNT(*) FILTER (WHERE cooking_method IS NOT NULL) AS has_cooking_method
FROM recipes
WHERE visibility = 'system' AND deleted_at IS NULL;

-- 4b. Top cuisine distribution across system recipes
SELECT unnest(cuisine_tags) AS cuisine, COUNT(*) AS recipe_count
FROM recipes
WHERE visibility = 'system' AND deleted_at IS NULL
GROUP BY 1
ORDER BY 2 DESC;
-- AI interpretation: does this distribution make sense given the recipe library?
-- e.g. if Portuguese is the top cuisine, that's expected. If 'international' is top, investigate.

-- 4c. Dietary flag distribution across system recipes
SELECT unnest(dietary_flags) AS flag, COUNT(*) AS recipe_count
FROM recipes
WHERE visibility = 'system' AND deleted_at IS NULL
GROUP BY 1
ORDER BY 2 DESC;

-- 4d. Spot-check: sample 10 untagged recipes to understand why they weren't tagged
SELECT r.id, r.name, array_agg(DISTINCT i.name) AS ingredient_names, r.cuisine_tags
FROM recipes r
JOIN recipe_ingredients ri ON ri.recipe_id = r.id
JOIN ingredients i ON i.id = ri.ingredient_id
WHERE r.visibility = 'system'
  AND array_length(r.cuisine_tags, 1) IS NULL
  AND r.deleted_at IS NULL
GROUP BY r.id, r.name, r.cuisine_tags
LIMIT 10;
-- For each untagged recipe, check if ingredients lack cuisine_signals.
-- If so: Tier 1 can't infer anything → these are Haiku Tier 2 candidates.

-- 4e. Sanity check: flag recipes tagged with implausible cuisines
SELECT r.name, r.cuisine_tags, array_agg(DISTINCT i.name ORDER BY i.name) AS key_ingredients
FROM recipes r
JOIN recipe_ingredients ri ON ri.recipe_id = r.id
JOIN ingredients i ON i.id = ri.ingredient_id
WHERE 'japanese' = ANY(r.cuisine_tags)
GROUP BY r.id, r.name, r.cuisine_tags
LIMIT 20;
-- AI interpretation: do these recipes actually seem Japanese based on their ingredients?
```

**Interpret results:**
- Coverage jumping from <50% to >70% after enrichment = healthy improvement
- Ask AI: "Here is a sample of 10 recipes and their inferred cuisine tags. Do these assignments look accurate? Which ones look wrong and why?"

---

### Step 5 — Verify axis score computation on a known user

After the axis scoring function is implemented, verify it produces sensible results for a real user (your own account is best since you have cook log data).

```sql
-- 5a. Pull your own cook log with recipe details to manually verify expected scores
SELECT
  cl.cooked_at,
  r.name,
  r.cuisine_tags,
  r.dietary_flags,
  r.time_min,
  r.calories,
  r.protein,
  r.servings,
  r.proteins
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
ORDER BY cl.cooked_at DESC
LIMIT 30;

-- 5b. Manually calculate Explorer score from this user's data
SELECT
  COUNT(DISTINCT unnest) AS distinct_cuisines_cooked,
  COUNT(DISTINCT cl.recipe_id) AS distinct_recipes_cooked
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
CROSS JOIN LATERAL unnest(r.cuisine_tags)
WHERE cl.user_id = auth.uid();

-- 5c. Manually calculate Optimizer score (% recipes meeting protein ratio threshold)
WITH cooked_with_macros AS (
  SELECT
    r.calories,
    r.protein,
    r.servings,
    CASE WHEN r.macros_total THEN r.protein::numeric / r.servings ELSE r.protein END AS protein_per_serving,
    CASE WHEN r.macros_total THEN r.calories::numeric / r.servings ELSE r.calories END AS cal_per_serving
  FROM cook_log cl
  JOIN recipes r ON r.id = cl.recipe_id
  WHERE cl.user_id = auth.uid()
    AND r.calories IS NOT NULL
    AND r.protein IS NOT NULL
)
SELECT
  COUNT(*) AS total_with_macros,
  COUNT(*) FILTER (WHERE (protein_per_serving * 4.0) / NULLIF(cal_per_serving, 0) >= 0.25) AS meets_threshold,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (protein_per_serving * 4.0) / NULLIF(cal_per_serving, 0) >= 0.25) / NULLIF(COUNT(*), 0), 1) AS optimizer_pct
FROM cooked_with_macros;

-- 5d. Swift score (% recipes under 30 min)
SELECT
  COUNT(*) FILTER (WHERE r.time_min IS NOT NULL) AS total_with_time,
  COUNT(*) FILTER (WHERE r.time_min <= 30) AS under_30_min,
  ROUND(100.0 * COUNT(*) FILTER (WHERE r.time_min <= 30) / NULLIF(COUNT(*) FILTER (WHERE r.time_min IS NOT NULL), 0), 1) AS swift_pct
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid();

-- 5e. Check what user_cook_profile shows after computation
SELECT * FROM user_cook_profile WHERE user_id = auth.uid();
```

**Interpret results:**
- Compare the manual query results (5b–5d) against `user_cook_profile` values (5e)
- They must match. Discrepancies = bug in the scoring function
- Ask AI: "Given these raw cook log results, which axis should score highest, and what title level should this user be at?"

---

### Step 6 — Verify specialty badge derivation

```sql
-- 6a. Count cuisine occurrences in user's cook log (badge threshold check)
SELECT
  unnest(r.cuisine_tags) AS cuisine,
  COUNT(*) AS times_cooked
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
GROUP BY 1
ORDER BY 2 DESC;
-- If any cuisine hits ≥5 → Level 1 badge should fire for that cuisine

-- 6b. Count dietary flag occurrences (Level 2 threshold)
SELECT
  unnest(r.dietary_flags) AS flag,
  COUNT(*) AS times_cooked,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM cook_log WHERE user_id = auth.uid()), 1) AS pct_of_cooks
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
GROUP BY 1
ORDER BY 2 DESC;
-- If any flag ≥70% of total cooks → Level 2 badge fires for that dietary pattern

-- 6c. Count cooking method occurrences (Level 3)
SELECT
  r.cooking_method,
  COUNT(*) AS times_cooked,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM cook_log WHERE user_id = auth.uid()), 1) AS pct_of_cooks
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
  AND r.cooking_method IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;

-- 6d. Check the stored specialty badge matches the expected derivation
SELECT specialty_badge_key FROM user_cook_profile WHERE user_id = auth.uid();
```

**Interpret results:**
- Manually trace through the hierarchy: does query 6a produce a winner? If yes, does 6d match?
- If badge is wrong or empty when it should fire → bug in derivation logic
- Ask AI: "Based on these query results, what specialty badge should this user have? Is the stored badge correct?"

---

### Step 7 — Verify cuisine badge collection

```sql
-- 7a. Per-cuisine distinct recipe count for the current user
SELECT
  unnest(r.cuisine_tags) AS cuisine,
  COUNT(DISTINCT cl.recipe_id) AS distinct_recipes_cooked
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
GROUP BY 1
ORDER BY 2 DESC;
-- Cuisines with ≥3 distinct recipes → badge earned
-- Cuisines at 2/3 → teaser eligible (if ≥80% of threshold = 2.4, so 2 or 3 both count)

-- 7b. How many total distinct cuisines has this user explored?
SELECT COUNT(DISTINCT unnest) AS total_cuisines_explored
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
CROSS JOIN LATERAL unnest(r.cuisine_tags)
WHERE cl.user_id = auth.uid();
```

**Interpret results:**
- Cross-reference with the 15–18 target cuisine list from Section 12
- Ask AI: "Given this user has cooked from these cuisines, which badges should be earned vs teasered vs hidden?"

---

### Step 9 — Verify onboarding cook_style step saves correctly

After implementing the new Step 1 onboarding screen:

```sql
-- 9a. Verify cook_style column exists and accepted values are correct
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'cook_style';

-- 9b. Check distribution of cook_style values across all users
SELECT cook_style, COUNT(*) AS user_count
FROM profiles
GROUP BY cook_style
ORDER BY user_count DESC;
-- Expect: mostly null (existing users who haven't re-onboarded)
-- Any non-null values from test accounts should match the 5 valid slugs

-- 9c. Verify your own cook_style was saved after testing onboarding
SELECT user_id, cook_style, onboarding_completed
FROM profiles
WHERE user_id = auth.uid();

-- 9d. Verify null cook_style users are handled gracefully by persona detection
-- (axis scoring must not error when cook_style is null — it should just use behaviour alone)
SELECT COUNT(*) AS users_without_cook_style
FROM profiles
WHERE cook_style IS NULL;
```

**Interpret results:**
- If `cook_style` column missing → migration didn't run
- Non-null values must only be: `optimizer`, `time_crunched`, `explorer`, `dietary`, `meal_prepper`
- Any other value = validation bug in the onboarding form handler

### Step 10 — Simulate profile unlock gates with test cook_logs

This step uses real Supabase calls to create test cook_log entries for the authenticated user, verifies each unlock gate fires at the right threshold, then cleans up.

**Phase A — find suitable test recipes with good data coverage:**
```sql
-- Find 20 system recipes spread across different cuisines and proteins
SELECT id, name, cuisine_tags, proteins, time_min, calories, protein, servings
FROM recipes
WHERE visibility = 'system'
  AND array_length(cuisine_tags, 1) > 0
  AND deleted_at IS NULL
ORDER BY RANDOM()
LIMIT 20;
```
Note the IDs returned. Use a mix: different cuisine_tags, different proteins, some under 30 min, some over.

**Phase B — insert test cook_logs in batches, verifying gates:**
```sql
-- Insert 4 cook_logs (below first gate — profile should show hero only)
INSERT INTO cook_log (user_id, recipe_id, source, cooked_at)
VALUES
  (auth.uid(), '<recipe_id_1>', 'manual', now() - interval '4 days'),
  (auth.uid(), '<recipe_id_2>', 'manual', now() - interval '3 days'),
  (auth.uid(), '<recipe_id_3>', 'manual', now() - interval '2 days'),
  (auth.uid(), '<recipe_id_4>', 'manual', now() - interval '1 day');

-- Verify distinct cook count = 4 (below 5 gate)
SELECT COUNT(DISTINCT recipe_id) FROM cook_log WHERE user_id = auth.uid();

-- Insert 1 more to cross the 5-cook gate
INSERT INTO cook_log (user_id, recipe_id, source, cooked_at)
VALUES (auth.uid(), '<recipe_id_5>', 'manual', now());

-- Verify distinct count = 5 → cook count narrative card should now appear
SELECT COUNT(DISTINCT recipe_id) FROM cook_log WHERE user_id = auth.uid();

-- Insert up to 15 distinct recipes to cross all gates
-- (fill in with real IDs from Phase A query)
```

**Phase C — verify axis scores at 15 cooks:**
Run the manual axis calculation queries from Step 5 (queries 5b, 5c, 5d) and ask Claude to interpret: "Given these results, which axis should score highest? What title level should this user be at?"

**Phase D — verify specialty badge threshold:**
Run Step 6 queries and confirm the badge key derived manually matches what `user_cook_profile.specialty_badge_key` stores.

**Phase E — clean up:**
```sql
-- Delete all test cook_logs for this user
DELETE FROM cook_log
WHERE user_id = auth.uid()
  AND source = 'manual'
  AND cooked_at > now() - interval '30 days';

-- Verify clean
SELECT COUNT(*) FROM cook_log WHERE user_id = auth.uid();
```

**AI interpretation after each phase:** paste results and ask: "Do the unlock gates fire at the right thresholds? Do the narrative sentences that would appear make sense for this user's data? Is anything surfacing prematurely?"

### Step 8 — Regression check on existing profile page

After all schema changes and data migrations, verify the existing profile page queries still return valid data and nothing is broken.

```sql
-- 8a. getDistinctCookedCount still works
SELECT COUNT(DISTINCT recipe_id) AS distinct_cooked
FROM cook_log
WHERE user_id = auth.uid();

-- 8b. getCookSummaryThisMonth — verify its underlying data
SELECT
  cl.recipe_id,
  r.name,
  COUNT(*) AS cook_count,
  unnest(r.cuisine_tags) AS cuisine
FROM cook_log cl
JOIN recipes r ON r.id = cl.recipe_id
WHERE cl.user_id = auth.uid()
  AND cl.cooked_at >= date_trunc('month', now())
GROUP BY cl.recipe_id, r.name, r.cuisine_tags
ORDER BY cook_count DESC;

-- 8c. getSavesSummary — verify saved recipes data is intact
SELECT COUNT(*) FROM recipe_saves WHERE user_id = auth.uid();
```

**Interpret results:**
- Results from 8a/8b/8c must match what the profile page currently renders
- If counts differ → a migration or schema change broke an existing query

---

## Open Questions (to be resolved in order, one at a time)

- **Q6** — ✅ RESOLVED. Hierarchy: cuisine (≥5 cooks) → cooking style (dominant tag) → protein (last resort). Minimum threshold: 5 instances. See Section 6.
- **Q12** — ✅ RESOLVED. See Section 10 (axis formulas), Sections 12–15 (badges, Creator track, lifetime counter, shopping counter).
- **Q13** — ✅ RESOLVED. Four ladders × 5 levels finalised. Dietary removed as axis. See Section 5.
- **Q14** — ✅ RESOLVED. Section order, unlock gates, thresholds, icons, undo pattern, no general level. See Section 9.
- **Q15** — ✅ RESOLVED. Cook style is Step 1 (not last). Dietary step shows only restriction options. Closing sentence added. Contextual reminders defined. Annual recap is roadmap. See Section 3 and 9.
- **Q16** — ✅ RESOLVED. See Section 17 for full schema spec.
- **Q17** — ✅ RESOLVED. Library sort defaults only, no For You section. `excludedCuisines` param needed for Explorer. See Section 11.
- **Q18** — Phase 1 scope: what gets built now vs roadmap ← CURRENT

---

## 17. DB Schema Changes (Q16 resolved)

### profiles table — add column
```sql
ALTER TABLE profiles ADD COLUMN cook_style text;
-- Valid values: 'optimizer' | 'time_crunched' | 'explorer' | 'dietary' | 'meal_prepper' | null
```

### recipes table — add columns
```sql
ALTER TABLE recipes
  ADD COLUMN dietary_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN cooking_method text;
-- dietary_flags values: 'vegan' | 'vegetarian' | 'gluten-free' | 'dairy-free' | 'keto' | 'nut-free'
-- cooking_method values: 'grill' | 'bake' | 'fry' | 'slow-cook' | 'steam' | 'air-fry' | 'no-cook'
```

### user_cook_profile — new table
```sql
CREATE TABLE user_cook_profile (
  user_id              uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  explorer_score       numeric NOT NULL DEFAULT 0,
  optimizer_score      numeric NOT NULL DEFAULT 0,  -- stored as 0–100 (percentage)
  planner_score        numeric NOT NULL DEFAULT 0,
  swift_score          numeric NOT NULL DEFAULT 0,   -- stored as 0–100 (percentage)
  creator_points       numeric NOT NULL DEFAULT 0,
  specialty_badge_key  text,                          -- e.g. 'italian', 'plant-based', 'grill'
  lifetime_cook_count  integer NOT NULL DEFAULT 0,
  shopping_trip_count  integer NOT NULL DEFAULT 0,
  explored_cuisines    text[] NOT NULL DEFAULT '{}', -- cuisines cooked at least once (all-time)
  explored_proteins    text[] NOT NULL DEFAULT '{}', -- proteins cooked at least once (all-time)
  last_computed_at     timestamptz
);

ALTER TABLE user_cook_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own cook profile"
  ON user_cook_profile FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users can upsert own cook profile"
  ON user_cook_profile FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

### Recomputation strategy
- Scores are recomputed on each `cook_log` INSERT (triggered client-side post-mutation, not a DB trigger in Phase 1)
- Profile page reads from the cached `user_cook_profile` row — no aggregation on page load
- `last_computed_at` is set on each recomputation; used for debugging and potential staleness detection
- No AI involved in score computation — pure SQL aggregates over `cook_log` + `recipes`

### Action feedback copy — counter inline in toasts
- Mark as cooked: *"Receita registada ✓ · {n} receitas cozinhadas em casa"*
- Complete shopping trip: full-width success banner on the shopping page: *"Lista concluída 🎉 · {n} listas no total"*
- Milestone moments (10, 25, 50, 100, 200 for each counter): celebratory toast, stays 4 seconds
