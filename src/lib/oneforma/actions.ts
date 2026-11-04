// Atlas actions: every change to a booking is saved to SharePoint (Atlas_Bookings)
// through the Power Automate "Atlas action" flow, which also sends the emails and
// forwards the OneForma event when there is one. These helpers turn an Atlas
// booking into the row the flow stores, and a stored row back into a booking.

import { cleanContacts, type ContactEntry } from '../contact.ts'
import { CHECKLIST_URL, TIMEZONE } from './config.ts'
import { bookingRef, sessionRef } from './events.ts'
import type { AtlasQa, AtlasRecording, AtlasSession } from './events.ts'
import { zonedIso } from './time.ts'
import type { ActionKind, BookingRow, EmailTemplate, QaStage } from './types.ts'

/** A booking as the app keeps it, with the fields only Atlas uses. */
export interface AtlasBooking extends AtlasSession {
  email?: string
  phone?: string
  notes?: string
  protocol?: string
  cancelReason?: string
  short?: string
  summary?: string
  history?: unknown[]
  rescheduledFrom?: unknown
  arrivedAt?: string
  arrivedBy?: string
  contactedAt?: string
  contactedBy?: string
  confirmedAt?: string
  confirmedBy?: string
  contacts?: ContactEntry[]
  participantEmailAt?: string
  participantEmailStatus?: string
  /** Highest OneForma revision used per entity and node kind, so any browser carries on from it. */
  revisions?: Record<string, number>
  [extra: string]: unknown
}

/** What only Atlas reads back: its activity log, recordings and QA, kept as one JSON text column. */
interface AtlasDetail {
  history?: unknown[]
  recordings?: AtlasRecording[]
  qa?: Partial<Record<QaStage, AtlasQa>>
  rescheduledFrom?: unknown
  revisions?: Record<string, number>
  short?: string
  summary?: string
  routeMilesSource?: string
  /** Participant contact trace (emails sent, calls made); see lib/contact.ts. */
  contacts?: ContactEntry[]
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  'booking.created': 'Booking created',
  'booking.updated': 'Details edited',
  'booking.rescheduled': 'Booking rescheduled',
  'booking.cancelled': 'Booking cancelled',
  'session.started': 'Session started',
  'session.interrupted': 'Session interrupted',
  'session.completed': 'Session completed',
  'session.cancelled': 'Session cancelled',
  'recording.completed': 'Recording logged',
  'recording.failed': 'Recording failed',
  'qa.updated': 'QA result',
  'email.resend': 'Email resent',
  'checklist.arrived': 'Arrived at location',
  'checklist.contacted': 'Called participant',
  'checklist.confirmed': 'Confirmed',
}

/** Which email each action can send (spec: book, reschedule and cancel only). */
export const EMAIL_FOR: Partial<Record<ActionKind, EmailTemplate>> = {
  'booking.created': 'booking-confirmed',
  'booking.rescheduled': 'booking-rescheduled',
  'booking.cancelled': 'booking-cancelled',
  'session.cancelled': 'booking-cancelled',
}

export const checklistUrlFor = (s: Pick<AtlasSession, 'id'>): string | null =>
  CHECKLIST_URL ? `${CHECKLIST_URL}${CHECKLIST_URL.includes('?') ? '&' : '?'}booking=${encodeURIComponent(bookingRef(s))}` : null

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function toBookingRow(s: AtlasBooking): BookingRow {
  const recording = s.recordings?.[s.recordings.length - 1] ?? null
  const qaFor = (stage: QaStage) => {
    const r = s.qa?.[stage]
    return r && recording && r.mediaVersion === recording.version ? r.result : null
  }
  const detail: AtlasDetail = {
    history: s.history ?? [],
    recordings: s.recordings ?? [],
    qa: s.qa ?? {},
    ...(s.rescheduledFrom ? { rescheduledFrom: s.rescheduledFrom } : {}),
    ...(s.revisions ? { revisions: s.revisions } : {}),
    ...(s.short ? { short: s.short } : {}),
    ...(s.summary ? { summary: s.summary } : {}),
    ...(s.routeMilesSource ? { routeMilesSource: s.routeMilesSource } : {}),
    ...(s.contacts?.length ? { contacts: s.contacts } : {}),
  }
  return {
    bookingId: bookingRef(s),
    externalSessionId: sessionRef(s),
    userId: text(s.participantId),
    requestId: text(s.requestId),
    participantName: s.name,
    participantEmail: text(s.email),
    participantPhone: text(s.phone),
    location: s.location ?? '',
    date: s.date,
    start: s.start,
    end: s.end,
    scheduledStart: zonedIso(s.date, s.start, TIMEZONE),
    scheduledEnd: zonedIso(s.date, s.end, TIMEZONE),
    timezone: TIMEZONE,
    moderatorEmail: s.moderator,
    routeMiles: typeof s.routeMiles === 'number' ? s.routeMiles : null,
    status: s.status,
    cancelReason: text(s.cancelReason),
    actualStart: text(s.actualStart),
    actualEnd: text(s.actualEnd),
    recordingVersion: recording?.version ?? null,
    mediaRef: recording?.mediaRef ?? null,
    recordingStatus: recording?.status ?? null,
    onsiteCheck: qaFor('onsite_check'),
    internalQa: qaFor('internal_qa'),
    protocol: text(s.protocol),
    notes: text(s.notes),
    checklistUrl: checklistUrlFor(s),
    arrivedAt: text(s.arrivedAt),
    arrivedBy: text(s.arrivedBy),
    contactedAt: text(s.contactedAt),
    contactedBy: text(s.contactedBy),
    confirmedAt: text(s.confirmedAt),
    confirmedBy: text(s.confirmedBy),
    checklistJson: null,
    historyJson: JSON.stringify(detail),
    updatedAt: new Date().toISOString(),
  }
}

/** A stored row back into an Atlas booking; null for rows that aren't Atlas bookings. */
export function fromBookingRow(row: Partial<BookingRow>): AtlasBooking | null {
  if (typeof row.bookingId !== 'string' || !row.bookingId.startsWith('atlas-bk-')) return null
  if (!row.date || !row.start || !row.end) return null
  let detail: AtlasDetail = {}
  try { detail = JSON.parse(row.historyJson || '{}') as AtlasDetail } catch { /* keep the columns */ }
  const name = row.participantName ?? ''
  const opt = (key: string, v: unknown) => (text(v) ? { [key]: v } : {})
  return {
    id: row.bookingId.slice('atlas-bk-'.length),
    date: row.date,
    start: row.start,
    end: row.end,
    moderator: row.moderatorEmail ?? '',
    ...(typeof row.routeMiles === 'number' ? { routeMiles: row.routeMiles } : {}),
    status: row.status || 'booked',
    name,
    short: detail.short ?? name,
    summary: detail.summary ?? name,
    location: row.location ?? '',
    ...opt('participantId', row.userId),
    ...opt('requestId', row.requestId),
    ...opt('email', row.participantEmail),
    ...opt('phone', row.participantPhone),
    ...opt('notes', row.notes),
    ...opt('protocol', row.protocol),
    ...opt('cancelReason', row.cancelReason),
    ...opt('actualStart', row.actualStart),
    ...opt('actualEnd', row.actualEnd),
    ...opt('arrivedAt', row.arrivedAt),
    ...opt('arrivedBy', row.arrivedBy),
    ...opt('contactedAt', row.contactedAt),
    ...opt('contactedBy', row.contactedBy),
    ...opt('confirmedAt', row.confirmedAt),
    ...opt('confirmedBy', row.confirmedBy),
    history: detail.history ?? [],
    recordings: detail.recordings ?? [],
    qa: detail.qa ?? {},
    ...(detail.rescheduledFrom ? { rescheduledFrom: detail.rescheduledFrom } : {}),
    ...(detail.revisions ? { revisions: detail.revisions } : {}),
    ...(detail.routeMilesSource ? { routeMilesSource: detail.routeMilesSource } : {}),
    ...(detail.contacts ? { contacts: cleanContacts(detail.contacts) } : {}),
    // The flow's last participant email (pa-bot v4.2), when the read flow returns it.
    ...opt('participantEmailAt', row.participantEmailAt),
    ...opt('participantEmailStatus', row.participantEmailStatus),
  }
}
