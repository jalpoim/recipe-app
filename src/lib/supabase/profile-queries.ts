import { createServerFn } from '@tanstack/react-start'
import { makeClient } from './client-server'
import type { Profile } from '../../types/db'
import type { MeasurementUnit } from '../detect-locale'

export const fetchMyProfile = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Profile | null> => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  },
)

export const fetchProfileByUsername = createServerFn({ method: 'GET' })
  .inputValidator((username: string) => username)
  .handler(async ({ data: username }): Promise<Profile | null> => {
    const supabase = makeClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .inputValidator((input: { displayName: string; bio: string | null }) => input)
  .handler(async ({ data }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: data.displayName, bio: data.bio })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const saveMeasurementUnit = createServerFn({ method: 'POST' })
  .inputValidator((unit: MeasurementUnit) => unit)
  .handler(async ({ data: unit }) => {
    const supabase = makeClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('profiles')
      .update({ measurement_unit: unit })
      .eq('user_id', session.user.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })
