# Strategy & Roadmap — "the meal planner that knows what you actually cook"

> **STATUS: NOT YET GRILLED.** This captures a strategy discussion (2026-05-31) and a
> prioritised backlog. It has **not** been through a `grill-me` session. Treat every
> item below as a *proposal to pressure-test*, not a committed decision. Grill the
> thesis and each backlog item before building.

## Positioning

> *"O planeador que sabe o que tu realmente cozinhas — em português, da despensa ao prato, num toque."*

We don't win on breadth (catalogue size, video guided-cooking, retailer APIs). As a
**solo dev**, we win on three compounding pillars where both generic AI and the PT
incumbents are weak:

1. **Memory** — a taste + repertoire profile that compounds with zero re-prompting.
2. **Loop** — discover → plan → shop → cook → log → *next week is better*.
3. **Locale** — PT recipes, PT ingredient names, PT supermarket aisle order, EU units, pt-PT tone.

## Competitive read

**Vs. generic AI ("give ChatGPT a markdown doc, get a weekly plan"):**

| | AI + markdown | This app |
|---|---|---|
| Context upkeep | the user maintains the doc | app builds & evolves it from what you actually cook |
| Effort / week | re-prompt, paste, read prose | one tap |
| Output | a wall of text to re-type | editable plan → aisle-sorted list → cooking companion → "marcar cozinhado" |
| Grounding | hallucinated recipes/quantities | real recipes, real macros, PT-available ingredients |
| Memory | cold each week unless re-pasted | remembers + improves automatically |

The one thing AI does better — **free-form intent** ("apetece-me algo leve esta semana") —
we close with the F12d contextual nudge and (later) voice. Then AI has no remaining edge.

**Vs. PT incumbents:** none own taste/identity.
- **Continente "Planeador de Refeições"** — a supermarket's tool: retailer-locked, recipe-limited, no taste model.
- **SaveCook** — owns "poupar dinheiro" (PT chain prices/flyers), not taste/repertoire.
- **PlanMyMeals.pt**, Whisk/Samsung Food, Paprika — shallow PT support.

→ Our wedge is being **the personal one**, not the cheapest or the supermarket's.

## Lean into (existing strengths to amplify)

- **The identity engine** (cook profile, flavor profile, Wrapped) — our most defensible,
  AI-proof, solo-friendly asset. Rivals are utilities; identity is emotional retention +
  organic sharing ("Spotify-for-cooking"). Double down here above anything else.
- **Instant, improving generation** (F10 + the F12 transparency/seed plan) — winners
  "generate plans fast and don't make users browse"; we already do.

## Prioritised backlog (NOT GRILLED — proposals)

| # | Item | Why | Effort | Notes |
|---|---|---|---|---|
| 1 | **F10/F12 personalization + transparency** | kills "feels random"; makes the memory legible | — | *In progress now* (reason tags + cold-start progress + profile bridge). Taste-seed (F12b/c) deferred pending grill (§10.7 of plan-generator-spec). |
| 2 | **"Cozinhar com o que tenho" / pantry path** | neutralises AI's best use case; cuts food waste (~40%); retention | MED | AND-logic ingredient combobox already exists but buried — surface as a first-class entry. |
| 3 | **PT-localized shopping-list depth** | "usable grocery list" separates winners from browsers; retention | MED | Aisle order for PT supermarkets + clean export. NOT a grocery API integration (too heavy solo). Light "menos desperdício/poupa" message rides along. |
| 4 | **Wrapped / shareable identity** | cheapest CAC lever in PT; inherently viral | MED | Already roadmapped (flavor-identity-spec). |
| 5 | **Frictionless import** (PT blogs/Instagram) | feeds the private repertoire that powers the moat | MED | URL import exists; extend to PT sources. |
| 6 | **Voice / free-text intent** | AI-parity on ease; fun; differentiator | HIGH | "diz o que te apetece" → seeds weekly generation. Later. |

## Explicitly DON'T build (solo-dev discipline)

- A giant recipe database / catalogue race.
- Video guided cooking (SideChef-style).
- Deep retailer API / checkout integrations.

These are capital-intensive and **not** our moat.

## Recommended sequence

The compounding trio, all solo-doable, all where AI + PT incumbents are weak:
**(1) finish F10/F12 personalization + transparency (Memory) → (2) "cozinhar com o que tenho" (Loop + waste/savings + retention) → (3) Wrapped / shareable identity (Growth).**

## Research basis (for the grill)

- Pantry / "cook from what you have" as a key differentiator + waste reducer; category adoption +47% in 2025: https://conservefood.org/2025/07/02/6-meal-planning-recipes-apps-to-simplify-cooking-and-cut-food-waste/
- Winners generate fast / deprioritise browsers + heavy setup: https://blog.eatthismuch.com/best-meal-planning-apps/
- PT incumbents: Continente Planeador (https://feed.continente.pt/receitas/planeador-refeicoes/como-funciona), SaveCook (https://tek.sapo.pt/mobile/apps/artigos/savecook-aplicacao-portuguesa-quer-ajudar-a-poupar-tempo-e-dinheiro-nas-refeicoes)
- Yummly taste-profile pattern (stated prior + revealed behaviour): https://mealthinker.com/blog/yummly-alternative
