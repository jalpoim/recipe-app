# Ingredient Re-audit — Sample Test Report

**Status:** DRAFT for human review. READ-ONLY test. No database writes were performed and the full audit was NOT run.

- **Draft script:** `scripts/reaudit-ingredient-signals.draft.ts`
- **Model used:** `claude-sonnet-4-6` (dietary/allergen pass — higher stakes than the prior Haiku pass)
- **Sample size:** 15 ingredients (1 small Sonnet batch + reasoning)
- **Date:** 2026-05-29

## How to read this

The DB column `ingredients.dietary_flags` actually stores a small **"-free" vocabulary**:
`gluten-free, dairy-free, soy-free, nut-free, vegan, vegetarian`. There is **no** `egg-free`,
`shellfish-free`, or `fish-free` flag, and a single `nut-free` covers **both** peanut and tree nut.

So the pipeline is:

1. **AI (Sonnet)** reasons composition-first and emits a rich **containment** set
   (`gluten, dairy, soy, egg, peanut, tree_nut, shellfish, fish`) + a self-verify note + lifestyle flags + cuisine/flavor/heat.
2. **Deterministic net** independently asserts containment from the **name** (accent-insensitive, PT+EN).
3. **Reconcile**: `final_contains = AI ∪ net` (net can only ADD containment / remove a false "free" claim).
   Stored `-free` flags are then **derived** from "does NOT contain X". `vegan`/`vegetarian` vetoed if an animal allergen is present.

This guarantees the net can never *under*-flag: if either the AI or the keyword net says an allergen is present, the corresponding `-free` flag is removed.

## Known errors — all fixed in the sample

| Ingredient | Current (buggy) flags | Problem | Proposed flags | Fixed? |
|---|---|---|---|---|
| `tofu` | `vegan, gluten-free, dairy-free, **soy-free**, nut-free` | soy product marked soy-free | `gluten-free, dairy-free, nut-free, vegan, vegetarian` (no soy-free) | YES |
| `gochujang` | `vegan, gluten-free, dairy-free, **soy-free**` | soy product marked soy-free; also wrongly gluten-free | `dairy-free, nut-free, vegan, vegetarian` (no soy-free, no gluten-free) | YES |
| `Bacalhau (salted dried cod)` | `dairy-free, soy-free` (**missing gluten-free**) | dried cod is gluten-free but unflagged | `gluten-free, dairy-free, soy-free, nut-free` | YES |

`tofu` and `gochujang` now correctly **contain soy** (so `soy-free` is removed). `bacalhau` now correctly **contains fish** and is marked **gluten-free** (plus dairy-free, soy-free, nut-free).

## Full sample — before / after

Legend: containment shown is the reconciled `final_contains`. Proposed = stored `dietary_flags`.

| Ingredient | Current flags | AI contains | Net contains | Final contains | Proposed flags | Net overrode AI? |
|---|---|---|---|---|---|---|
| tofu | vegan, gf, df, **soy-free**, nf | soy | soy | soy | gf, df, nf, vegan, veg | no |
| gochujang | vegan, **gf**, df, **soy-free** | soy, gluten | soy | soy, gluten | df, nf, vegan, veg | no |
| tempeh | vegan, gf, df, nf | soy | soy | soy | gf, df, nf, vegan, veg | no |
| edamame, frozen | vegan, gf, df, **soy-free** | soy | soy | soy | gf, df, nf, vegan, veg | no |
| miso | vegan, **gf**, df, nf | soy, gluten | soy | soy, gluten | df, nf, vegan, veg | no |
| Miso paste, chickpea | vegan, gf, df, nf | — (none) | — (none) | — | gf, df, soy-free, nf, vegan, veg | no |
| soy sauce | vegan, df | soy, gluten | soy | soy, gluten | df, nf, vegan, veg | no |
| soy sauce, tamari | vegan, gf, df | soy | soy | soy | gf, df, nf, vegan, veg | no |
| Bacalhau (salted dried cod) | df, soy-free (**no gf**) | fish | fish | fish | gf, df, soy-free, nf | no |
| almond butter | vegan, gf, df, soy-free | tree_nut | tree_nut | tree_nut | gf, df, soy-free, vegan, veg | no |
| wheat flour, all-purpose | vegan, **gf**, df, nf, soy-free | gluten | gluten | gluten | df, soy-free, nf, vegan, veg | no |
| milk | (empty) | dairy | dairy | dairy | gf, soy-free, nf, vegetarian | no |
| salt | vegan, veg, gf, df, soy-free, nf | — | — | — | gf, df, soy-free, nf, vegan, veg | no |
| chicken | gf, df, soy-free | — | — | — | gf, df, soy-free, nf | no |
| coconut milk | vegan, gf, df | — (none) | — (none) | — | gf, df, soy-free, nf, vegan, veg | no |

(gf = gluten-free, df = dairy-free, nf = nut-free, veg = vegetarian)

## Exception handling — verified correct

These are the documented traps the net must NOT trip on. All handled correctly:

- **`coconut milk`** → net adds NO dairy ("milk" but plant-based). AI agreed. Proposed `dairy-free` retained.
- **`almond butter`** → net adds `tree_nut`, NOT dairy ("butter" is a nut butter). Proposed `dairy-free`, no nut-free.
- **`soy sauce, tamari`** → net does NOT add gluten (tamari is wheat-free); AI agreed and explicitly kept it gluten-free.
- **`Miso paste, chickpea`** → net SKIPS soy (chickpea miso); AI agreed. Correctly soy-free.
- **`salt` / `chicken`** → no false cuisine signals, no spurious allergens.

## AI vs. net disagreements

**The net never had to override the AI in this sample** (`net_overrode_ai = false` for all 15). Sonnet
independently produced the correct containment for every dangerous case, including the three known errors.

However the relationship is asymmetric and worth noting:

- **AI was stricter than the net (good)** on `gochujang`, `miso`, and `soy sauce`: the AI added **gluten**
  (wheat/barley used in fermentation) which the keyword net does NOT detect from the name alone. Because
  reconciliation is a UNION, these gluten containments are preserved. The net would have *kept* them gluten-free,
  so here the **AI is the safety win and the net is the floor** — exactly the intended division of labour.
- **Net is the floor for the soy/fish/nut errors**: even if a future batch regresses and the AI mistakenly
  drops `soy` from tofu, the net forces it back. That backstop is the whole point; it is currently latent
  because Sonnet is already correct.

## Concerns / prompt observations

1. **Generic vs. branded gluten (gochujang/miso/soy sauce).** The AI flags these as containing gluten
   because *standard/commercial* versions use wheat or barley. This is the **safe** default for allergen
   filtering. But many real products are certified gluten-free (e.g. gluten-free gochujang, rice-koji miso).
   This means some genuinely gluten-free items will be marked as containing gluten. For an allergen filter,
   over-flagging gluten is the correct (conservative) direction, but **a human should confirm** this is the
   desired policy before a full run, since it will flip the `gluten-free` flag off for these three.

2. **`nut-free` granularity.** The DB has a single `nut-free` flag for both peanut and tree nut. The script
   already maps peanut OR tree_nut → removes `nut-free`. The richer `peanut`/`tree_nut` distinction the AI/net
   produce is **not storable** today. If allergen filtering ever needs to separate peanut from tree nut, the
   schema needs a column change. Flagged for product decision, not blocking.

3. **No `egg-free` / `fish-free` / `shellfish-free` storage.** Egg/fish/shellfish containment is computed and
   used to veto `vegan`/`vegetarian`, but is otherwise **not persisted** (no column). e.g. `bacalhau` "contains fish"
   is captured for lifestyle logic but the only place it surfaces in `dietary_flags` is the *absence* of vegan/veg.
   If fish/shellfish/egg need to be filterable allergens, that requires a schema change too.

4. **`milk` proposed flags.** Net correctly forces `dairy` → drops `dairy-free`, keeps `vegetarian` (dairy is
   vegetarian), drops `vegan`. Current DB has milk with `[]` (no flags at all) — the proposal is a clear improvement.

5. **Net normalization edge cases handled:** diacritic stripping (`amêndoa`→`amendoa`), nutmeg/coconut excluded
   from tree_nut, `gochugaru` (chili flakes) excluded from soy, plant milks excluded from dairy. These are coded
   defensively but only `coconut milk` / `chickpea miso` were exercised by this sample — the PT-name exceptions
   (`leite de coco`, `manteiga de amêndoa`, `farinha de arroz`) were not present in the sample and should be
   spot-checked against the real catalog before a full run.

6. **`flavor_notes` / `heat_level` / `cuisine_signals` all conform** to the canonical vocabularies. No `spicy`,
   no out-of-range heat (gochujang correctly heat 3), cuisine signals plausible (tofu→chinese/japanese,
   coconut milk→thai, bacalhau→portuguese). Note tofu got cuisine signals here, whereas the prior Haiku rules
   said plain proteins should be empty — minor, not an allergen-safety issue, worth a human glance.

## Recommendations before a full paid run

1. **Decide the gluten policy** for fermented soy condiments (gochujang/miso/soy sauce): conservative
   "contains gluten" (current AI behavior) vs. respecting gluten-free variants. Recommend keeping conservative
   for safety but get sign-off, since it flips existing `gluten-free` flags.
2. **Spot-check Portuguese-named exception ingredients** that weren't in this sample
   (`leite de coco`, `manteiga de amêndoa`, `farinha de arroz/milho`, `noz moscada`) — add 5–10 of them to the
   sample list and re-run read-only to confirm the net's PT exception branches fire correctly.
3. **Confirm the derived-flags model is acceptable** (deriving `-free` flags from containment rather than trusting
   the AI's `-free` claims). This is the core design change and should be explicitly approved.
4. **Run advisors / review write path.** The draft's `main()` is gated (`WRITE=1 FULL=1` both required and currently
   refused). Before enabling, add the actual `UPDATE` + `signals_enriched_at` write (mirroring the Haiku script),
   batch size tuning, and idempotency. Then run on a small WRITE batch first, verify in DB, then full.
5. **Cost:** Sonnet is materially more expensive than Haiku. Estimate token cost across the full catalog
   (~2000+ ingredients) before committing to a full re-audit; consider Sonnet only for the allergen pass and
   keeping Haiku for cuisine/flavor if cost is a concern.

## Portuguese edge-case spot-check (2026-05-29)

**Status:** READ-ONLY follow-up to exercise the net's Portuguese exception branches. No DB writes, full audit NOT run, no commit. One paid Sonnet batch (15 items, `claude-sonnet-4-6`).

These rows have **English base names** but PT aliases/translations (`leite de coco`, `manteiga de amêndoa`, `noz moscada`, etc.), so the net's accent-insensitive PT+EN keyword layer is what's under test. Catalog IDs were resolved via `ilike` on `name` (aliases/translations confirmed present).

> **Note:** `manteiga de pistácio` / pistachio butter is **not in the catalog**. Closest row is plain `pistachios` (`a021bced`), which still exercises the `tree_nut` branch; the "butter → not dairy" guard is independently covered by `almond butter`.

### Result: 14 / 15 PASS, 1 FAIL

| Trap (PT) | Row | Current flags | AI contains | Net contains | Final | Proposed flags | Verdict |
|---|---|---|---|---|---|---|---|
| leite de coco | coconut milk | vegan, gf, df | — | — | — | gf, df, soy-free, nf, vegan, veg | **PASS** — not dairy |
| leite de soja | soy milk, unsweetened | vegan, gf, df | soy | soy | soy | gf, df, nf, vegan, veg | **PASS** — soy, not dairy |
| manteiga de amêndoa | almond butter | vegan, gf, df, soy-free | tree_nut | tree_nut | tree_nut | gf, df, soy-free, vegan, veg | **PASS** — tree_nut, not dairy |
| manteiga de pistácio (N/A) | pistachios | vegan, veg, gf, df, soy-free | tree_nut | tree_nut | tree_nut | gf, df, soy-free, vegan, veg | **PASS** — tree_nut |
| óleo de amendoim | peanut oil | vegan, gf, df | peanut | peanut | peanut | gf, df, soy-free, vegan, veg | **PASS** — peanut |
| noz moscada | nutmeg | vegan, gf, df, nf, soy-free | — | — | — | gf, df, soy-free, nf, vegan, veg | **PASS** — NOT tree_nut (net `noz` exclusion fired) |
| farinha de arroz | rice flour | vegan, gf, df, nf, soy-free | — | — | — | gf, df, soy-free, nf, vegan, veg | **PASS** — not gluten |
| farinha de milho | corn flour, yellow | vegan, gf, df, nf, soy-free | — | — | — | gf, df, soy-free, nf, vegan, veg | **PASS** — not gluten |
| trigo sarraceno | buckwheat | vegan, veg, gf, df, soy-free, nf | — (gluten-free) | **gluten** | **gluten** | df, soy-free, nf, vegan, veg | **FAIL** — net wrongly added gluten; drops `gluten-free` |
| molho de soja | soy sauce | vegan, df | soy, gluten | soy | soy, gluten | df, nf, vegan, veg | **PASS** — soy + (conservative) gluten via AI |
| queijo de cabra | goat cheese, soft | veg, gf | dairy | dairy | dairy | gf, soy-free, nf, veg | **PASS** — dairy |
| natas | cream | gf, nf, soy-free | dairy | dairy | dairy | gf, soy-free, nf, veg | **PASS** — dairy |
| ovo | egg | (empty) | egg | egg | egg | gf, df, soy-free, nf, veg | **PASS** — egg |
| camarão | shrimp | (empty) | shellfish | shellfish | shellfish | gf, df, soy-free, nf | **PASS** — shellfish |
| lula | squid | (empty) | shellfish | shellfish | shellfish | gf, df, soy-free, nf | **PASS** — shellfish |

(gf = gluten-free, df = dairy-free, nf = nut-free, veg = vegetarian)

### Trap-by-trap notes

- **`noz moscada` (nutmeg) — PASS.** The single most important false-positive trap. The net's `nutmeg`/`noz moscada` exclusion correctly suppressed `tree_nut`; AI also returned no allergens. Net `contains = []`, `nut-free` retained.
- **`leite de coco` / `manteiga de amêndoa` / plant milks / nut butters — PASS.** None mis-flagged as dairy. The `plantMilk` and `nutButter` guards in the DAIRY branch work for both PT and EN forms.
- **`farinha de arroz` / `farinha de milho` — PASS.** The `glutenFlourExempt` list correctly exempts rice/corn flour, so neither hit the "bare flour → wheat" default.
- **`trigo sarraceno` (buckwheat) — FAIL (net keyword bug).** See below.
- **`molho de soja` (soy sauce) — PASS.** Net asserts `soy`; AI adds the conservative `gluten` (standard soy sauce uses wheat). Union preserves both. Correct for an allergen filter.

### The one failure — buckwheat / trigo sarraceno wrongly flagged gluten

**Root cause (net keyword bug in `allergenNet`):** The GLUTEN logic has the buckwheat/`trigo sarraceno` exemption (`glutenFlourExempt`) but only consults it in the **second** branch (bare `farinha`/`flour`). The **first** branch fires on `has(s, "trigo", "wheat", ...)` and its guard only excludes `gluten-free` and rice noodles — it does **not** exclude buckwheat. Two ways it trips:

- English `"buckwheat"` → normalized `"buckwheat"` matches `has(s, "wheat")` because `"buckwheat".includes("wheat")`.
- Portuguese `"trigo sarraceno"` → matches `has(s, "trigo")`.

Either way the first branch adds `gluten`, the net OVERRIDES the (correct) AI, and `gluten-free` is dropped. This is an **over-flag** (safe direction for an allergen filter — it won't harm a celiac user) but it is **factually wrong**: buckwheat is gluten-free, and the current DB rows are already correctly `gluten-free`. A full run would regress all 8 buckwheat rows.

**Required net fix (before any full run):** add a buckwheat/`trigo sarraceno` guard to the **first** gluten branch, e.g. introduce a `isBuckwheat = has(s, "buckwheat", "trigo sarraceno")` and change the first branch condition to `... && !(has(...gluten-free...) || isBuckwheat)`. (The existing `glutenFlourExempt` already lists these but is unreachable for them because the first branch wins.) After the fix, re-run this spot-check to confirm `trigo sarraceno`/`buckwheat` → `contains = []`, `gluten-free` retained.

### Net keyword fixes needed (summary)

1. **buckwheat / trigo sarraceno → must NOT be gluten.** First gluten branch needs the buckwheat exemption (see above). This is the only confirmed net bug from this sample. **The `noz moscada` → tree_nut trap did NOT fire wrongly** (it passed), so no change needed there.

### Other observations (non-blocking)

- **`pistachios` got cuisine signals** (`middle-eastern`, `moroccan`) — same minor note as `tofu` in the prior report: plain whole-food proteins/nuts arguably shouldn't carry cuisine. Not an allergen-safety issue.
- **`nutmeg` heat_level = 1** — defensible (warm spice); within the 0–3 range.
- All `flavor_notes` / `heat_level` / `cuisine_signals` conform to canonical vocabularies. No `spicy`, no out-of-range heat.
