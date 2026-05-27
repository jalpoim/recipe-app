// Deterministic tag derivation from recipe data — called on both create and edit save paths.
// Returns the merged tag array (existing + auto-detected, deduplicated).
// Never removes a tag the user set manually.

export type AutoTagInput = {
  tags: string[]
  proteins?: string[]
  calories?: number | null
  protein?: number | null
  servings?: number
  macros_total?: boolean
  time_min?: number | null
  ingredientNames?: string[]
  stepTexts?: string[]
}

const HEAT_SIGNALS = [
  'piri-piri',
  'malagueta',
  'gochugaru',
  'gochujang',
  'harissa',
  'jalapeño',
  'jalapeno',
  'sriracha',
  'cayenne',
  'chili',
  'chile',
  'cayena',
  'tabasco',
]

const SMOKE_SIGNALS = [
  'chouriço',
  'chourico',
  'chorizo',
  'paprika defumada',
  'smoked',
  'fumado',
  'salmão fumado',
  'salmon fumado',
  'bacon',
  'panceta',
  'pancetta',
]

export function autoTagRecipe(input: AutoTagInput): string[] {
  const existing = new Set(input.tags)
  const add = (tag: string) => existing.add(tag)

  const servings = input.servings ?? 1
  const calories = input.calories ?? null
  const proteinG = input.protein ?? null
  const macrosTotal = input.macros_total ?? false

  // Per-serving macros
  const calPerServing = calories != null ? (macrosTotal ? calories / servings : calories) : null
  const proteinPerServing = proteinG != null ? (macrosTotal ? proteinG / servings : proteinG) : null

  // fit / alto-proteína
  if (calPerServing != null && proteinPerServing != null) {
    if (proteinPerServing >= 25 && calPerServing <= 500) {
      add('fit')
      add('alto-proteína')
    } else if (calPerServing > 0 && proteinPerServing / calPerServing >= 0.15) {
      add('alto-proteína')
    }
  }

  // rápido
  if (input.time_min != null && input.time_min < 30) {
    add('rápido')
  }

  // meal-prep
  if (servings >= 4) {
    add('meal-prep')
  }

  // 5-ingredientes
  const ingredientCount = (input.ingredientNames ?? []).length
  if (ingredientCount > 0 && ingredientCount <= 5) {
    add('5-ingredientes')
  }

  // picante — scan ingredient names for heat signals
  const ingLower = (input.ingredientNames ?? []).map((n) => n.toLowerCase())
  if (HEAT_SIGNALS.some((sig) => ingLower.some((n) => n.includes(sig)))) {
    add('picante')
  }

  // fumado — scan ingredient names for smoke signals
  if (SMOKE_SIGNALS.some((sig) => ingLower.some((n) => n.includes(sig)))) {
    add('fumado')
  }

  // cooking method — scan step text (add only if method not already present)
  const stepLower = (input.stepTexts ?? []).join(' ').toLowerCase()
  const hasMethod = (tags: string[]) => tags.some((t) => existing.has(t))

  if (
    (stepLower.includes('forno') || stepLower.includes('assado')) &&
    !hasMethod(['forno', 'air-fryer', 'grelhador', 'micro-ondas'])
  ) {
    add('forno')
  }
  if (stepLower.includes('air fryer') || stepLower.includes('airfryer')) {
    add('air-fryer')
  }
  if (
    stepLower.includes('grelhador') ||
    stepLower.includes('grelhado') ||
    stepLower.includes('grelha')
  ) {
    add('grelhador')
  }
  if (stepLower.includes('micro-ondas') || stepLower.includes('microwave')) {
    add('micro-ondas')
  }
  if (
    (stepLower.includes('frigideira') ||
      stepLower.includes('saltear') ||
      stepLower.includes('refogar') ||
      stepLower.includes('vapor') ||
      stepLower.includes('cozido a vapor')) &&
    !hasMethod(['forno', 'air-fryer', 'grelhador', 'micro-ondas'])
  ) {
    add('fogão')
  }

  return [...existing]
}

// Diff: returns tags that autoTagRecipe would add that are NOT already in currentTags
export function getSuggestedTags(input: AutoTagInput): string[] {
  const before = new Set(input.tags)
  const after = autoTagRecipe(input)
  return after.filter((t) => !before.has(t))
}
