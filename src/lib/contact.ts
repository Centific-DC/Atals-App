// Participant contact trace: which confirmation emails went out and which calls were
// made, so a Scheduler can see at a glance who still has to be reached.
//
// The log lives on the booking (`contacts`) and rides in Atlas_Bookings.HistoryJson,
// so every change saves it through the Atlas action flow like the activity log.
// Two more sources are read in: the moderator checklist's "Called participant" step
// (contactedAt / contactedBy) and the flow's last participant email, when the read
// flow returns one (participantEmailAt / participantEmailStatus).

import type { EmailTemplate } from './oneforma/types.ts'

export type ContactKind = 'email' | 'call'
export type CallOutcome = 'reached' | 'voicemail' | 'no-answer' | 'wrong-number'
export type ContactSource = 'atlas' | 'checklist' | 'flow'

export interface ContactEntry {
  id: string
  kind: ContactKind
  /** ISO time it happened. */
  at: string
  /** Account email of whoever sent or logged it ('' when unknown). */
  by: string
  /** Their display name at the time, so the log reads without a user lookup. */
  byName: string
  /** Email only: which template went out. */
  template?: EmailTemplate
  /** Call only: how it went. */
  outcome?: CallOutcome
  note?: string
  /** Where the entry came from; Atlas when absent. */
  source?: ContactSource
}

/** Where a booked participant stands since the latest booking or reschedule. */
export type ContactState = 'needs' | 'emailed' | 'tried' | 'reached'

/** The parts of a booking this module reads. */
export interface ContactSession {
  status: string
  contacts?: ContactEntry[]
  history?: { at: string; type: string }[]
  contactedAt?: string
  contactedBy?: string
  participantEmailAt?: string
  participantEmailStatus?: string
}

export const CONTACT_STATES: ContactState[] = ['needs', 'emailed', 'tried', 'reached']

export const CONTACT_LABEL: Record<ContactState, string> = {
  needs: 'Not contacted',
  emailed: 'Emailed',
  tried: 'Call not answered',
  reached: 'Reached',
}

/** Filter menu wording (a group called Contact). */
export const CONTACT_FILTER_LABEL: Record<ContactState, string> = {
  needs: 'Not contacted',
  emailed: 'Emailed only',
  tried: 'Call not answered',
  reached: 'Reached by phone',
}

export const CONTACT_FILTER_TITLE: Record<ContactState, string> = {
  needs: 'Booked, and no email or call since it was booked or moved',
  emailed: 'Confirmation emailed, no call yet',
  tried: 'Called but not reached yet (voicemail, no answer, wrong number)',
  reached: 'Spoke to the participant by phone',
}

export const OUTCOMES: CallOutcome[] = ['reached', 'voicemail', 'no-answer', 'wrong-number']

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  reached: 'Reached',
  voicemail: 'Left voicemail',
  'no-answer': 'No answer',
  'wrong-number': 'Wrong number',
}

export const TEMPLATE_LABEL: Record<EmailTemplate, string> = {
  'booking-confirmed': 'Booking confirmation',
  'booking-rescheduled': 'New time',
  'booking-cancelled': 'Cancellation',
}

/** Lookup maps so classes are never composed from strings at runtime. */
export const CHIP_CLASS: Record<ContactState, string> = {
  needs: 'atlas-contact-chip atlas-contact-chip--needs',
  emailed: 'atlas-contact-chip atlas-contact-chip--emailed',
  tried: 'atlas-contact-chip atlas-contact-chip--tried',
  reached: 'atlas-contact-chip atlas-contact-chip--reached',
}

export const ENTRY_CLASS: Record<CallOutcome | 'email', string> = {
  email: 'atlas-contact-entry atlas-contact-entry--email',
  reached: 'atlas-contact-entry atlas-contact-entry--reached',
  voicemail: 'atlas-contact-entry atlas-contact-entry--tried',
  'no-answer': 'atlas-contact-entry atlas-contact-entry--tried',
  'wrong-number': 'atlas-contact-entry atlas-contact-entry--bad',
}

const isOutcome = (v: unknown): v is CallOutcome => typeof v === 'string' && (OUTCOMES as string[]).includes(v)

/** Keep only well-formed entries from stored JSON. */
export function cleanContacts(raw: unknown): ContactEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is ContactEntry => {
    if (!c || typeof c !== 'object') return false
    const e = c as Partial<ContactEntry>
    if (typeof e.id !== 'string' || typeof e.at !== 'string') return false
    if (e.kind === 'call') return isOutcome(e.outcome)
    return e.kind === 'email'
  })
}

/**
 * Every contact for a booking, newest first: Atlas's own log, plus the moderator
 * checklist call and the flow's last email when Atlas has no entry for them.
 */
export function contactLog(s: ContactSession): ContactEntry[] {
  const own = s.contacts ?? []
  const all = [...own]
  if (s.contactedAt && !own.some((c) => c.kind === 'call' && c.at === s.contactedAt)) {
    all.push({ id: `checklist-${s.contactedAt}`, kind: 'call', at: s.contactedAt, by: s.contactedBy ?? '', byName: '', outcome: 'reached', source: 'checklist' })
  }
  const flowAt = s.participantEmailAt
  if (flowAt && s.participantEmailStatus !== 'failed' && !own.some((c) => c.kind === 'email' && Math.abs(Date.parse(c.at) - Date.parse(flowAt)) < 10 * 60 * 1000)) {
    all.push({ id: `flow-${flowAt}`, kind: 'email', at: flowAt, by: '', byName: '', source: 'flow' })
  }
  return all.sort((a, b) => b.at.localeCompare(a.at))
}

/** When the current booking time was set: the latest booking or reschedule ('' if unknown). */
export function contactSince(s: ContactSession): string {
  let since = ''
  for (const h of s.history ?? []) if ((h.type === 'created' || h.type === 'rescheduled') && h.at > since) since = h.at
  return since
}

export interface ContactSummary {
  state: ContactState
  emailed: boolean
  called: boolean
  /** A contact happened, but before the latest reschedule (so it confirmed the old time). */
  stale: boolean
  last: ContactEntry | null
  lastCall: ContactEntry | null
}

/**
 * Contact standing for a booking still to happen; null once it is in session,
 * completed or cancelled (contact no longer matters there).
 */
export function contactSummary(s: ContactSession): ContactSummary | null {
  if (s.status !== 'booked') return null
  const since = contactSince(s)
  const log = contactLog(s)
  const current = log.filter((c) => c.at >= since)
  const emailed = current.some((c) => c.kind === 'email')
  const calls = current.filter((c) => c.kind === 'call')
  const reached = calls.some((c) => c.outcome === 'reached')
  const state: ContactState = reached ? 'reached' : calls.length ? 'tried' : emailed ? 'emailed' : 'needs'
  return { state, emailed, called: calls.length > 0, stale: !current.length && log.length > 0, last: current[0] ?? null, lastCall: calls[0] ?? null }
}

/** The filter value for a booking: its contact state, or undefined when contact doesn't apply. */
export const contactStateOf = (s: ContactSession): ContactState | undefined => contactSummary(s)?.state

/** Short words for a chip's tooltip: "Emailed · called (no answer)". */
export function contactTitle(sum: ContactSummary): string {
  if (sum.stale) return 'Contacted before it was moved: confirm the new time'
  if (sum.state === 'needs') return 'No email or call since it was booked'
  const parts = [sum.emailed ? 'Confirmation emailed' : 'Not emailed']
  if (sum.state === 'reached') parts.push('reached by phone')
  else if (sum.called) parts.push(`called (${OUTCOME_LABEL[sum.lastCall?.outcome ?? 'no-answer'].toLowerCase()})`)
  else parts.push('not called yet')
  return parts.join(' · ')
}
