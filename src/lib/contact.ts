// Participant contact trace, in three stages:
//   1. Availability: a Scheduler calls an endorsed participant before booking.
//   2. Confirmation: once booked, the Scheduler emails and/or calls to confirm.
//   3. Moderator call: before the session the moderator calls to check they're ready.
//
// Stage 1 is logged on the participant (kept per browser until a SharePoint column
// exists) and copied onto the booking when it is made. Stages 2 and 3 live on the
// booking (`contacts`) and ride in Atlas_Bookings.HistoryJson, so the Atlas action
// flow saves them for everyone. Also read in: the moderator checklist's "Call" step
// (contactedAt / contactedBy) and the flow's last participant email when the read
// flow returns one (participantEmailAt / participantEmailStatus).

import type { EmailTemplate } from './oneforma/types.ts'

export type ContactKind = 'email' | 'call'
export type ContactStage = 'availability' | 'confirmation' | 'presession'
export type CallOutcome = 'available' | 'unavailable' | 'reached' | 'voicemail' | 'no-answer' | 'wrong-number'
export type ContactSource = 'atlas' | 'checklist' | 'flow'

export interface ContactEntry {
  id: string
  kind: ContactKind
  /** Which step it belongs to; confirmation when absent (entries made before stages existed). */
  stage?: ContactStage
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

/** Where a booked participant stands, the furthest step first. */
export type ContactState = 'needs' | 'emailed' | 'tried' | 'reached' | 'ready'

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

export const STAGES: ContactStage[] = ['availability', 'confirmation', 'presession']

export const STAGE_LABEL: Record<ContactStage, string> = {
  availability: 'Availability',
  confirmation: 'Confirmation',
  presession: 'Moderator call',
}

export const CONTACT_STATES: ContactState[] = ['needs', 'emailed', 'tried', 'reached', 'ready']

export const CONTACT_LABEL: Record<ContactState, string> = {
  needs: 'Not contacted',
  emailed: 'Emailed',
  tried: 'Call not answered',
  reached: 'Confirmed',
  ready: 'Moderator called',
}

/** Filter menu wording (a group called Contact). */
export const CONTACT_FILTER_LABEL: Record<ContactState, string> = {
  needs: 'Not contacted',
  emailed: 'Emailed only',
  tried: 'Call not answered',
  reached: 'Confirmed by phone',
  ready: 'Moderator called',
}

export const CONTACT_FILTER_TITLE: Record<ContactState, string> = {
  needs: 'Booked, and no email or call since it was booked or moved',
  emailed: 'Confirmation emailed, no call yet',
  tried: 'Called to confirm but not reached yet',
  reached: 'Confirmed by phone; the moderator has not called yet',
  ready: 'The moderator called before the session',
}

/** Which outcomes a call can have at each step. */
export const OUTCOMES_FOR: Record<ContactStage, CallOutcome[]> = {
  availability: ['available', 'unavailable', 'voicemail', 'no-answer', 'wrong-number'],
  confirmation: ['reached', 'voicemail', 'no-answer', 'wrong-number'],
  presession: ['reached', 'voicemail', 'no-answer', 'wrong-number'],
}

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  available: 'Available',
  unavailable: 'Not available',
  reached: 'Reached',
  voicemail: 'Left voicemail',
  'no-answer': 'No answer',
  'wrong-number': 'Wrong number',
}

/** good = the call did its job, bad = a dead end, '' = try again. */
export const OUTCOME_TONE: Record<CallOutcome, 'good' | 'bad' | ''> = {
  available: 'good',
  reached: 'good',
  unavailable: 'bad',
  'wrong-number': 'bad',
  voicemail: '',
  'no-answer': '',
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
  ready: 'atlas-contact-chip atlas-contact-chip--ready',
}

export const ENTRY_CLASS: Record<'email' | 'good' | 'bad' | '', string> = {
  email: 'atlas-contact-entry atlas-contact-entry--email',
  good: 'atlas-contact-entry atlas-contact-entry--good',
  bad: 'atlas-contact-entry atlas-contact-entry--bad',
  '': 'atlas-contact-entry',
}

export const entryClass = (c: ContactEntry): string =>
  ENTRY_CLASS[c.kind === 'email' ? 'email' : OUTCOME_TONE[c.outcome ?? 'no-answer']]

export const stageOf = (c: ContactEntry): ContactStage =>
  c.stage ?? (c.source === 'checklist' ? 'presession' : 'confirmation')

const isOutcome = (v: unknown): v is CallOutcome => typeof v === 'string' && v in OUTCOME_LABEL
const isStage = (v: unknown): v is ContactStage => typeof v === 'string' && (STAGES as string[]).includes(v)

/** Keep only well-formed entries from stored JSON. */
export function cleanContacts(raw: unknown): ContactEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is ContactEntry => {
    if (!c || typeof c !== 'object') return false
    const e = c as Partial<ContactEntry>
    if (typeof e.id !== 'string' || typeof e.at !== 'string') return false
    if (e.stage !== undefined && !isStage(e.stage)) return false
    if (e.kind === 'call') return isOutcome(e.outcome)
    return e.kind === 'email'
  })
}

/** Newest first. */
export const newestFirst = (list: ContactEntry[]): ContactEntry[] => [...list].sort((a, b) => b.at.localeCompare(a.at))

/**
 * Every contact for a booking, newest first: Atlas's own log, plus the moderator
 * checklist call and the flow's last email when Atlas has no entry for them.
 */
export function contactLog(s: ContactSession): ContactEntry[] {
  const own = s.contacts ?? []
  const all = [...own]
  if (s.contactedAt && !own.some((c) => c.kind === 'call' && c.at === s.contactedAt)) {
    all.push({ id: `checklist-${s.contactedAt}`, kind: 'call', stage: 'presession', at: s.contactedAt, by: s.contactedBy ?? '', byName: '', outcome: 'reached', source: 'checklist' })
  }
  const flowAt = s.participantEmailAt
  if (flowAt && s.participantEmailStatus !== 'failed' && !own.some((c) => c.kind === 'email' && Math.abs(Date.parse(c.at) - Date.parse(flowAt)) < 10 * 60 * 1000)) {
    all.push({ id: `flow-${flowAt}`, kind: 'email', stage: 'confirmation', at: flowAt, by: '', byName: '', source: 'flow' })
  }
  return newestFirst(all)
}

/** When the current booking time was set: the latest booking or reschedule ('' if unknown). */
export function contactSince(s: ContactSession): string {
  let since = ''
  for (const h of s.history ?? []) if ((h.type === 'created' || h.type === 'rescheduled') && h.at > since) since = h.at
  return since
}

/** One step's standing: done, tried (something happened, not finished), or nothing yet. */
export type StepState = 'done' | 'tried' | 'none'

export interface ContactSummary {
  state: ContactState
  steps: Record<ContactStage, StepState>
  emailed: boolean
  /** A confirmation happened, but before the latest reschedule (so it confirmed the old time). */
  stale: boolean
  /** Latest call per step, for wording. */
  lastCall: Partial<Record<ContactStage, ContactEntry>>
}

/** The latest call outcome decides an availability or moderator step; any good outcome counts. */
function callStep(calls: ContactEntry[]): StepState {
  if (calls.some((c) => c.outcome && OUTCOME_TONE[c.outcome] === 'good')) return 'done'
  return calls.length ? 'tried' : 'none'
}

/**
 * Contact standing for a booking still to happen; null once it is in session,
 * completed or cancelled (contact no longer matters there).
 */
export function contactSummary(s: ContactSession): ContactSummary | null {
  if (s.status !== 'booked') return null
  const since = contactSince(s)
  const log = contactLog(s)
  const of = (stage: ContactStage) => log.filter((c) => stageOf(c) === stage)
  const confirmAll = of('confirmation')
  const confirm = confirmAll.filter((c) => c.at >= since)
  const presession = of('presession').filter((c) => c.at >= since && c.kind === 'call')
  const emailed = confirm.some((c) => c.kind === 'email')
  const confirmCalls = confirm.filter((c) => c.kind === 'call')
  const reached = confirmCalls.some((c) => c.outcome === 'reached')
  const moderator = callStep(presession)
  const availability = callStep(of('availability').filter((c) => c.kind === 'call'))
  const confirmation: StepState = reached ? 'done' : confirm.length ? 'tried' : 'none'
  let state: ContactState = reached ? 'reached' : confirmCalls.length ? 'tried' : emailed ? 'emailed' : 'needs'
  if (moderator === 'done') state = 'ready'
  const latest = (list: ContactEntry[]) => list.find((c) => c.kind === 'call')
  return {
    state,
    steps: { availability, confirmation, presession: moderator },
    emailed,
    stale: !confirm.length && confirmAll.length > 0,
    lastCall: { availability: latest(of('availability')), confirmation: latest(confirm), presession: latest(presession) },
  }
}

/** The filter value for a booking: its contact state, or undefined when contact doesn't apply. */
export const contactStateOf = (s: ContactSession): ContactState | undefined => contactSummary(s)?.state

const stepWords = (sum: ContactSummary, stage: ContactStage): string => {
  const call = sum.lastCall[stage]
  if (stage === 'confirmation') {
    if (sum.steps.confirmation === 'done') return 'reached by phone'
    if (call?.outcome) return `${sum.emailed ? 'emailed, ' : ''}call ${OUTCOME_LABEL[call.outcome].toLowerCase()}`
    return sum.emailed ? 'emailed' : sum.stale ? 'contacted before the move' : 'not yet'
  }
  return call?.outcome ? OUTCOME_LABEL[call.outcome].toLowerCase() : 'not yet'
}

/** Tooltip for a chip: "Availability: available · Confirmation: emailed · Moderator call: not yet". */
export function contactTitle(sum: ContactSummary): string {
  return STAGES.map((st) => `${STAGE_LABEL[st]}: ${stepWords(sum, st)}`).join(' · ')
}

/** One step in words, for the drawer's stepper. */
export const stepText = (sum: ContactSummary, stage: ContactStage): string => {
  const w = stepWords(sum, stage)
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/* ---------- Before booking (participant) ---------- */

/** The latest availability call to an unbooked participant, for queue rows and the booking form. */
export function availabilityCall(list: ContactEntry[]): ContactEntry | null {
  return newestFirst(list).find((c) => c.kind === 'call') ?? null
}

export const AVAIL_CLASS: Record<'good' | 'bad' | '', string> = {
  good: 'atlas-avail atlas-avail--good',
  bad: 'atlas-avail atlas-avail--bad',
  '': 'atlas-avail',
}
