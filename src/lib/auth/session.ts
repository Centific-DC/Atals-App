// The current session token, readable outside React so the read and action flow
// calls can carry it. Kept in this browser until sign-out or expiry. With real
// data, signing out also clears the cached bookings and participants, so no phone
// number stays behind. (The outbox stays: sign-out waits until it is sent.)

import { READ_URL, storageKey } from '../oneforma/config.ts'
import type { AuthSession } from './types.ts'

const KEY = 'atlas_session_v1'
/** Browser copies that may hold participant details; cleared on sign-out. */
const PERSONAL_KEYS = ['atlas_schedule_v3', 'atlas_schedule_v4', 'atlas_of_cache_v2'].map(storageKey)

let current: AuthSession | null = readSaved()

function readSaved(): AuthSession | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as AuthSession | null
    if (saved?.token && saved.expiresAt && Date.parse(saved.expiresAt) > Date.now()) return saved
  } catch { /* storage off */ }
  return null
}

export function getSession(): AuthSession | null {
  if (current && Date.parse(current.expiresAt) <= Date.now()) current = null
  return current
}

export const getToken = (): string | null => getSession()?.token ?? null

export function setSession(next: AuthSession | null): void {
  current = next
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next))
    else window.localStorage.removeItem(KEY)
  } catch { /* storage off: the session lasts for this tab */ }
}

export function clearPersonalData(): void {
  // Sample data holds no real people; keep it so a review survives switching accounts.
  if (!READ_URL) return
  try { for (const k of PERSONAL_KEYS) window.localStorage.removeItem(k) } catch { /* storage off */ }
}

// The flows refused this token (it ran out, or a sign-in somewhere else that uses
// the same accounts replaced it). The browser still thinks it is valid, so the
// read flow reports it here and the sign-in state listens.
const rejectedListeners = new Set<() => void>()

export function onSessionRejected(fn: () => void): () => void {
  rejectedListeners.add(fn)
  return () => { rejectedListeners.delete(fn) }
}

export function rejectSession(): void {
  for (const fn of rejectedListeners) fn()
}
