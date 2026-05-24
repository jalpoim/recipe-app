export type MeasurementSystem = 'metric' | 'imperial'

const COUNT_UNITS = new Set([
  'unit', 'slice', 'clove', 'pinch', 'bunch', 'handful', 'sheet', 'can', 'sachet',
  'tbsp', 'tsp', 'cup', 'fl oz', 'oz', 'lb',  // user-authored imperial pass-through
])

// Factors: metric value × factor = imperial value
const METRIC_TO_IMPERIAL: Record<string, { factor: number; unit: string }> = {
  g:  { factor: 0.035274, unit: 'oz' },
  kg: { factor: 2.20462,  unit: 'lb' },
  ml: { factor: 0.033814, unit: 'fl oz' },
  L:  { factor: 4.22675,  unit: 'cups' },
}

const IMPERIAL_TO_METRIC: Record<string, { factor: number; unit: string }> = {
  oz:     { factor: 28.3495, unit: 'g' },
  lb:     { factor: 453.592, unit: 'g' },
  'fl oz':{ factor: 29.5735, unit: 'ml' },
  cup:    { factor: 236.588, unit: 'ml' },
  cups:   { factor: 236.588, unit: 'ml' },
  tbsp:   { factor: 14.7868, unit: 'ml' },
  tsp:    { factor: 4.92892, unit: 'ml' },
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

function smartRoundImperial(value: number, unit: string): { value: number; unit: string } {
  switch (unit) {
    case 'oz':
      return { value: roundTo(value, value < 4 ? 0.25 : 0.5), unit: 'oz' }
    case 'lb':
      return { value: roundTo(value, 0.25), unit: 'lb' }
    case 'fl oz':
      return { value: roundTo(value, 0.5), unit: 'fl oz' }
    case 'cups': {
      if (value >= 2) return { value: roundTo(value, 0.25), unit: 'cups' }
      if (value < 0.25) {
        const tbsp = value * 16
        if (tbsp < 1) return { value: roundTo(tbsp * 3, 0.5), unit: 'tsp' }
        return { value: roundTo(tbsp, 0.5), unit: 'tbsp' }
      }
      return { value: roundTo(value, 0.25), unit: 'cups' }
    }
    default:
      return { value, unit }
  }
}

function smartRoundMetric(value: number, unit: string): { value: number; unit: string } {
  if (unit === 'g') return { value: Math.round(value), unit: 'g' }
  if (unit === 'kg') return { value: roundTo(value, 0.01), unit: 'kg' }
  if (unit === 'ml') return { value: Math.round(value), unit: 'ml' }
  if (unit === 'L') return { value: roundTo(value, 0.01), unit: 'L' }
  return { value, unit }
}

export function convertUnit(
  value: number,
  unit: string,
  toSystem: MeasurementSystem,
): { value: number; unit: string } {
  if (!unit || COUNT_UNITS.has(unit)) return { value, unit }

  if (toSystem === 'imperial') {
    const conv = METRIC_TO_IMPERIAL[unit]
    if (!conv) return { value, unit }
    let converted = value * conv.factor
    let targetUnit = conv.unit

    // For ml: prefer cups for amounts ≥ 60ml (¼ cup), fl oz for smaller amounts
    if (unit === 'ml') {
      const cups = value / 236.588
      if (cups >= 0.25) {
        converted = cups
        targetUnit = 'cups'
      }
    }

    return smartRoundImperial(converted, targetUnit)
  }

  if (toSystem === 'metric') {
    const conv = IMPERIAL_TO_METRIC[unit]
    if (!conv) return { value, unit }
    const converted = value * conv.factor
    return smartRoundMetric(converted, conv.unit)
  }

  return { value, unit }
}

export function formatQuantity(value: number): string {
  // Show decimals only when meaningful
  if (Number.isInteger(value)) return String(value)
  // For 0.25 steps show fractions nicely
  const fracs: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1.25: '1¼', 1.5: '1½', 1.75: '1¾', 2.25: '2¼', 2.5: '2½', 2.75: '2¾' }
  if (fracs[value]) return fracs[value]
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}
