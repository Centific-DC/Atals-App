// OneForma integration types, from "OneForma External Project and Resource
// Integration Guide" v1 (2026-10-27). Section numbers below refer to that guide.
// Every OneForma ID is a string: they are large integers that lose precision as numbers.

/* ---------- Inbound: Event Hub feed (sections 2 and 3) ---------- */

export type FeedDataType = 'project' | 'projectUserRelation'

export interface FeedEnvelope<T = unknown> {
  dataType: FeedDataType | string
  messageId: string
  /** "yyyy-MM-dd HH:mm:ss" with no timezone; the source timezone is still unconfirmed. */
  syncTimestamp: string
  payload: T[]
}

export interface ProjectItem {
  projectId: string
  projectName?: string | null
  taskPlatform?: string | null
  operationType?: 'ADD' | 'EDIT' | string
  status?: 'Active' | 'Ending' | 'Closed' | 'Under Revision' | string
}

export interface DemographicAnswer {
  questionId: string
  question: string
  answer: string[]
  answerItems?: { answerCode: string | null; answerItem: string | null }[]
}

/** Fields of one recruitment relationship (the ones Atlas uses). */
export interface RelationFields {
  projectId: string
  userId: string
  requestId: string
  jobId?: string | null
  status?: string | null
  email?: string | null
  /** OneForma's display name; prefer it, since not every record has a first/last split. */
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  phoneNumber?: string | null
  address?: string | null
  postalCode?: string | null
  /** An address an Admin or Scheduler corrected in Atlas. The pull never writes these, so they win. */
  addressOverride?: string | null
  postalCodeOverride?: string | null
  overrideBy?: string | null
  overrideAt?: string | null
  role?: string | null
  locale?: string | null
  country?: string | null
  state?: string | null
  city?: string | null
  jobName?: string | null
  joinTime?: string | null
  /** Screening answers Atlas keeps (OneForma questions 132, 1835090119425025, 1835090172828673). */
  homeType?: string | null
  homeSize?: string | null
  /** Every selected feature, joined with "; ". */
  homeFeatures?: string | null
  taskPlatform?: string | null
  demographicQuestionAnswer?: DemographicAnswer[] | null
}

/** One relationship as it arrives. Only `add` and `remove` are sent today; extra fields are accepted. */
export interface ProjectUserRelation extends RelationFields {
  type: 'add' | 'remove' | string
  [extra: string]: unknown
}

/** What the read flow (Power Automate) returns: feed fields plus Atlas's own. */
export interface ParticipantRow extends RelationFields {
  active: boolean
  lat?: number | null
  lng?: number | null
  /** The address's point from the US Census geocoder (the pull flow looks each address up once). */
  geoLat?: number | null
  geoLng?: number | null
}

/* ---------- Atlas's participant model ---------- */

export interface Participant {
  /** OneForma userId; also what bookings store as participantId. */
  id: string
  userId: string
  requestId: string
  jobId: string | null
  projectId: string
  name: string
  email: string | null
  phone: string | null
  address: string
  postalCode: string | null
  /** Set when the address was corrected in Atlas: who and when. OneForma's own address stays below. */
  corrected: { by: string | null; at: string | null; ofAddress: string; ofPostalCode: string | null } | null
  city: string | null
  state: string | null
  locale: string | null
  joinTime: string | null
  home: { type: string | null; size: string | null; features: string[] } | null
  /** false after a `remove`: kept for history, never bookable. */
  active: boolean
  lat: number | null
  lng: number | null
  /** 'zip' when lat/lng is the ZIP centre (an estimate), not OneForma's own point. */
  pointSource?: 'oneforma' | 'zip' | null
  /** Miles from HQ, or null while the address has no map point. */
  distMi: number | null
}

export interface FeedStats {
  messages: number
  duplicates: number
  items: number
  otherProject: number
  stale: number
  removed: number
  malformed: number
}

/* ---------- Outbound: execution callback API (section 5) ---------- */

export type Attendance = 'attended' | 'no_show' | 'cancelled' | 'unknown'

export interface ParticipantRef {
  userId: string
  requestId: string
  attendance?: Attendance
}

export interface BookingData {
  participants: ParticipantRef[]
  scheduledStart: string
  scheduledEnd: string
  /** IANA name, e.g. America/Los_Angeles. */
  timezone: string
  location: string
  moderatorRefs?: string[]
  reason?: string
}

export interface SessionData {
  participants: ParticipantRef[]
  actualStart?: string
  actualEnd?: string
  reason?: string
}

export interface RecordingData {
  provider: string
  mediaVersion: number
  mediaRef: string
  durationSeconds: number
  participants: ParticipantRef[]
  reason?: string
}

export type QaStage = 'onsite_check' | 'internal_qa' | 'client_acceptance'
export type QaResult = 'passed' | 'failed' | 'not_required' | 'pending'

export interface QaData {
  recordingId: string
  mediaVersion: number
  stage: QaStage
  result: QaResult
  sourceResultId: string
  reviewerRef?: string
  reason?: string
}

interface EventBase<T extends string, D> {
  schemaVersion: 1
  eventId: string
  sourceSystem: string
  projectId: string
  externalSessionId: string
  entityId: string
  eventType: T
  revision: number
  occurredAt: string
  data: D
}

export type BookingEventType = 'booking.created' | 'booking.rescheduled' | 'booking.cancelled'
export type SessionEventType = 'session.started' | 'session.completed' | 'session.cancelled'
export type RecordingEventType = 'recording.completed' | 'recording.failed'

export type CallbackEvent =
  | EventBase<BookingEventType, BookingData>
  | EventBase<SessionEventType, SessionData>
  | EventBase<RecordingEventType, RecordingData>
  | EventBase<'qa.result.updated', QaData>

export type CallbackEventType = CallbackEvent['eventType']

/** Node kinds that each keep their own revision count (section 5). */
export type NodeKind = 'booking' | 'session' | 'recording' | 'qa'

/* ---------- Atlas action flow (Power Automate) ---------- */

/** One booking as it is stored in the Atlas_Bookings SharePoint list. */
export interface BookingRow {
  bookingId: string
  externalSessionId: string
  userId: string | null
  requestId: string | null
  participantName: string
  participantEmail: string | null
  participantPhone: string | null
  location: string
  date: string
  start: string
  end: string
  scheduledStart: string
  scheduledEnd: string
  timezone: string
  /** The one moderator assigned to the session (their Atlas account email). */
  moderatorEmail: string
  /** Round trip HQ -> participant -> HQ in miles, filled in by the app at booking time. */
  routeMiles: number | null
  status: string
  cancelReason: string | null
  actualStart: string | null
  actualEnd: string | null
  recordingVersion: number | null
  mediaRef: string | null
  recordingStatus: 'completed' | 'failed' | null
  onsiteCheck: QaResult | null
  internalQa: QaResult | null
  protocol: string | null
  notes: string | null
  checklistUrl: string | null
  /** Checklist (moderator): when they reached the location, called the participant, confirmed. */
  arrivedAt: string | null
  arrivedBy: string | null
  contactedAt: string | null
  contactedBy: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  /** Checklist steps beyond these, kept as JSON text (filled once the SOP is in). */
  checklistJson: string | null
  /** Atlas's own activity log for the booking, kept as JSON text. */
  historyJson: string
  updatedAt: string
  /** Read flow only (pa-bot v4.2): the last participant email the flow sent. */
  participantEmailStatus?: string | null
  participantEmailAt?: string | null
}

export type ActionKind =
  | 'booking.created'
  | 'booking.updated'
  | 'booking.rescheduled'
  | 'booking.cancelled'
  | 'session.started'
  | 'session.interrupted'
  | 'session.completed'
  | 'session.cancelled'
  | 'recording.completed'
  | 'recording.failed'
  | 'qa.updated'
  | 'email.resend'
  | 'checklist.arrived'
  | 'checklist.contacted'
  | 'checklist.confirmed'

export type EmailTemplate = 'booking-confirmed' | 'booking-rescheduled' | 'booking-cancelled'

/** Who gets which email. The moderator is only emailed when one is assigned. */
export interface NotifyRequest {
  template: EmailTemplate
  participant: boolean
  moderator: boolean
}

export type EmailRecipient = 'participant' | 'moderator'

/** Action v7's per-recipient email result. */
export interface EmailedItem {
  to: EmailRecipient | 'moderators'
  status?: string | null
  message?: string | null
}

/** email.resend: send one recipient the last email again, nothing else changes. */
export interface ResendRequest {
  bookingId: string
  to: EmailRecipient
  template: EmailTemplate
}

/** What the app posts to the Atlas action flow: save the row, send emails, tell OneForma. */
/** participant.corrected: an address fix that wins over the OneForma pull. Nulls clear it. */
export interface ParticipantCorrection {
  schemaVersion: 1
  actionId: string
  action: 'participant.corrected'
  environment: 'uat' | 'prod'
  occurredAt: string
  participant: { projectId: string; userId: string; requestId: string; address: string | null; postalCode: string | null }
}

export interface ActionRequest {
  schemaVersion: 1
  /** The flow skips an actionId it has already done (safe retries, no double emails). */
  actionId: string
  action: ActionKind
  environment: 'uat' | 'prod'
  occurredAt: string
  booking: BookingRow
  notify: NotifyRequest | null
  /** Set on email.resend only. */
  resend?: ResendRequest
  /** Forwarded to OneForma exactly as is; null when OneForma has no event for this. */
  oneforma: CallbackEvent | null
}

/** OneForma's answer to the forwarded event, as the flow relays it. */
export interface RelayReply {
  eventId?: string
  httpStatus: number
  status?: ReceiptStatus | string | null
  duplicate?: boolean
  message?: string | null
}

export interface ActionReply {
  actionId: string
  saved: boolean
  /**
   * Who was emailed: plain words, or (Action v7) one object per recipient.
   * Older flows answer 'moderators'; transport reads it as 'moderator'.
   */
  emailed?: (EmailRecipient | 'moderators' | EmailedItem)[]
  oneforma?: RelayReply | null
  /** true when the flow had already done this actionId and skipped it. */
  duplicate?: boolean
  message?: string | null
}

/* ---------- Atlas outbox ---------- */

/** Receipt states OneForma returns, plus Atlas's own delivery states. */
export type ReceiptStatus = 'APPLIED' | 'WAITING_REFERENCE' | 'IGNORED_STALE'

export type OutboxStatus =
  | 'built' // dry run: checked and kept here, nothing sent
  | 'pending' // live: waiting out the undo window, then sent
  | 'sending'
  | 'saved' // saved in SharePoint; nothing for OneForma
  | ReceiptStatus // saved, and OneForma's receipt
  | 'rejected' // refused (4xx or our own checks); needs a fix, not a retry
  | 'failed' // network or 5xx; safe to retry with the same actionId
  | 'withdrawn' // undone in Atlas before it was sent

export interface OutboxEntry {
  key: string
  request: ActionRequest
  label: string
  sessionId: string
  participantName: string
  status: OutboxStatus
  message: string | null
  createdAt: string
  notBefore: number
  sentAt: string | null
  attempts: number
  saved: boolean
  emailed: EmailRecipient[]
  duplicate: boolean
  /** Set on a change people may be told about: which email, and to whom. Nothing is sent until someone clicks. */
  offerEmail?: { template: EmailTemplate; to: EmailRecipient[] }
}
