// The Power Automate read flow: one POST with the session token returns what the
// signed-in role may see: endorsed participants (Atlas_Participants) and bookings
// (Atlas_Bookings); a moderator gets only the sessions assigned to them, yesterday to
// tomorrow. The participant queue and the schedule both load from it; calls made
// while one is running share it.

import { getToken, rejectSession } from '../auth/session.ts'
import { READ_URL } from './config.ts'
import type { BookingRow, ParticipantRow } from './types.ts'

/**
 * The OneForma relay's health, when the read flow reports it (optional; today's
 * flow doesn't send it). lastContactAt includes a heartbeat at least every 15 min.
 */
export interface OneformaSync {
  lastContactAt: string | null
  lastEventAt?: string | null
  lastEventCount?: number | null
  lastError?: string | null
  lastErrorAt?: string | null
}

export interface ReadBody {
  syncedAt?: string
  oneformaSync?: OneformaSync | null
  me?: { email: string; displayName: string; role: string; shortName: string | null }
  participants?: ParticipantRow[]
  bookings?: Partial<BookingRow>[]
}

/** The read flow refused the session token; the app sends the person back to sign-in. */
export class SignInRefusedError extends Error {}

let inflight: Promise<ReadBody> | null = null

export function fetchRead(): Promise<ReadBody> {
  if (!READ_URL) return Promise.reject(new Error('No read flow set'))
  if (inflight) return inflight
  const url = READ_URL
  inflight = (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        // text/plain: the flows' HTTP trigger answers no CORS preflight, which
        // application/json would trigger; it also keeps timestamps exactly as sent.
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ schemaVersion: 1, token: getToken() }),
      })
      if (res.status === 401) {
        // The flow's own 401 is JSON with a message ("Please sign in again."): the
        // token ran out or a newer sign-in replaced it. A 401 without one comes from
        // Power Automate itself (the flow URL was refused), so the token is not to blame.
        const reply = await res.json().catch(() => null) as { message?: unknown } | null
        if (reply && typeof reply.message === 'string') {
          rejectSession()
          throw new SignInRefusedError(reply.message)
        }
      }
      if (!res.ok) throw new Error(`the read flow answered ${res.status}`)
      return await res.json() as ReadBody
    } finally {
      inflight = null
    }
  })()
  return inflight
}
