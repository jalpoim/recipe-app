export type MeasurementUnit = 'metric' | 'imperial'

// Only three countries still use non-metric measurement systems
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM'])

export function detectLocaleFromBrowser(): { language: 'pt' | 'en'; measurementUnit: MeasurementUnit } {
  if (typeof navigator === 'undefined') return { language: 'pt', measurementUnit: 'metric' }

  const lang = navigator.language || 'pt'

  // Country subtag is the most reliable signal for units (e.g. "en-US" → "US")
  const parts = lang.split('-')
  const country = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : null
  const measurementUnit: MeasurementUnit =
    country && IMPERIAL_COUNTRIES.has(country) ? 'imperial' : 'metric'

  // Language: default to 'pt' for anything not English
  const language: 'pt' | 'en' = lang.toLowerCase().startsWith('en') ? 'en' : 'pt'

  return { language, measurementUnit }
}
