import posthog from 'posthog-js'

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com'

export function initAnalytics() {
  if (typeof window === 'undefined' || !key) return
  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: false, // we capture manually per route
    capture_pageleave: true,
    autocapture: false,
  })
}

export function identifyUser(userId: string, email?: string) {
  if (!key) return
  posthog.identify(userId, email ? { email } : undefined)
}

export function resetAnalyticsUser() {
  if (!key) return
  posthog.reset()
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!key) return
  posthog.capture(event, properties)
}
