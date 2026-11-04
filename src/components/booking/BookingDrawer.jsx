import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS, TODAY } from '../../data/schedule.js'
import { billableHours, formatHours, isBillable, sessionHours } from '../../lib/billing.js'
import { longDayLabel, timeRange } from '../../lib/dates.js'
import {
  checkDetails, checkTimes, conflictMessage, dailyLimitProblem, displayNames, findConflict, isLocked, moderatorDayCounts, needsModerator,
  slotLabel, withEnd, withStart,
} from '../../lib/bookings.js'
import { MS, prefersReducedMotion } from '../../motion/motion.js'
import usePresence from '../../motion/usePresence.js'
import useAutoDismiss from '../../motion/useAutoDismiss.js'
import useFocusTrap, { returnFocus } from '../../motion/useFocusTrap.js'
import { useToast } from '../../motion/Toast.jsx'
import { useMatches } from '../../state/FilterContext.jsx'
import { sessionsOn, useBookingTriggers, useSchedule } from '../../state/ScheduleContext.jsx'
import { CloseIcon } from '../Icons.jsx'
import { StatusDot } from '../StatusLegend.jsx'
import { ModeratorPicker, TextField, TimeField } from './Fields.jsx'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { useParticipant, useParticipants } from '../../state/ParticipantContext.jsx'
import HomeSummary from '../HomeSummary.jsx'
import { useRole } from '../../state/RoleContext.jsx'
import { MILES_SOURCE, formatMi, roundTrip, useOneWayMiles } from '../../lib/mileage.js'
import { ExecutionSection, OneFormaLine } from './Execution.jsx'
import { QA_STAGE_LABEL, bookingRef, isLinked } from '../../lib/oneforma/events.ts'
import { checklistUrlFor } from '../../lib/oneforma/actions.ts'
import { EMAIL_TEXT, EMAIL_TONE, TONE_CLASS, lastEmail, offeredEmails } from '../../lib/oneforma/outboxStatus.ts'
import { useSync } from '../../state/SyncContext.tsx'
import Collapse from '../../motion/Collapse.jsx'
import { ENTRY_CLASS, OUTCOMES, OUTCOME_LABEL, TEMPLATE_LABEL, contactLog } from '../../lib/contact.ts'
import ContactChip, { MailGlyph, PhoneGlyph } from '../contact/ContactChip.jsx'

const PILL_CLASS = {
  completed: 'atlas-status-pill atlas-status-pill--completed',
  cancelled: 'atlas-status-pill atlas-status-pill--cancelled',
  insession: 'atlas-status-pill atlas-status-pill--insession',
  booked: 'atlas-status-pill atlas-status-pill--booked',
}

const TITLES = {
  edit: 'Edit booking',
  assign: 'Assign moderator',
  reschedule: 'Reschedule',
  cancel: 'Cancel booking',
  'cancel-session': 'Cancel session',
  interrupt: 'Interruption',
  recording: 'Log recording',
  'recording-failed': 'Recording failed',
  'qa-fail': 'QA result',
}

// Side drawer for one booking (view, edit, reschedule, cancel) or one day's bookings.
// It slides in from the right (a bottom sheet on phones), keeps showing the last
// record while it slides out, then unmounts. Tab stays inside while it is open,
// and focus goes back to the card that opened it.
export default function BookingDrawer() {
  const { panel, closePanel, sessions, triggerRef } = useSchedule()
  // Keep showing the last record while the drawer slides out.
  const last = useRef(panel)
  if (panel) last.current = panel
  const shown = last.current
  const { mounted, state, onAnimationEnd } = usePresence(Boolean(panel), MS.sheetExit)
  const sheetRef = useRef(null)
  const closedByOutside = useRef(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (panel) { wasOpen.current = true; closedByOutside.current = false; return undefined }
    if (wasOpen.current) {
      wasOpen.current = false
      if (!closedByOutside.current) returnFocus(triggerRef.current)
    }
    return undefined
  }, [panel, triggerRef])

  useEffect(() => {
    if (!panel) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, closePanel])

  useFocusTrap(sheetRef, Boolean(panel) && mounted)

  if (!mounted || !shown) return null
  const session = shown.id ? sessions.find((s) => s.id === shown.id) : null

  return (
    <div className="atlas-sheet-layer" data-state={state}>
      <div className="atlas-sheet-scrim" onClick={() => { closedByOutside.current = true; closePanel() }} />
      <aside
        ref={sheetRef}
        className="atlas-sheet atlas-raised"
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={session ? `Booking: ${session.name}` : 'Bookings for the day'}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="atlas-sheet-grab" aria-hidden="true" />
        {session
          ? (
            <div key={`${session.id}-${shown.mode}`} className="atlas-sheet-content atlas-swap-in">
              <BookingSheet session={session} mode={shown.mode} />
            </div>
          )
          : shown.date && (
            <div key={shown.date} className="atlas-sheet-content atlas-swap-in">
              <DaySheet date={shown.date} />
            </div>
          )}
      </aside>
    </div>
  )
}

function SheetHead({ eyebrow, title, children }) {
  const { closePanel } = useSchedule()
  const closeRef = useRef(null)
  // Focus moves in once the sheet is on screen (next frame), unless a field took it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const sheet = closeRef.current?.closest('.atlas-sheet')
      if (sheet && !sheet.contains(document.activeElement)) closeRef.current.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <header className="atlas-sheet-head">
      <div className="atlas-sheet-head-text">
        {eyebrow}
        <h2 className="atlas-sheet-title">{title}</h2>
        {children}
      </div>
      <button ref={closeRef} type="button" className="atlas-sheet-close atlas-icon-btn atlas-raised-sm" aria-label="Close" onClick={closePanel}>
        <CloseIcon />
      </button>
    </header>
  )
}

// Inline "Saved: ..." note with Undo after a change (spec section 7). It fades in
// and out in place (180ms), stays 6s, and pauses while hovered or focused.
function SavedNote({ sessionId }) {
  const { note, clearNote, setNote, closePanel } = useSchedule()
  const [leaving, setLeaving] = useState(false)
  const mine = note && note.id === sessionId ? note : null
  const key = mine ? `${mine.text}` : null

  useEffect(() => { setLeaving(false) }, [key])

  const dismiss = () => {
    if (prefersReducedMotion()) clearNote()
    else setLeaving(true)
  }
  const hold = useAutoDismiss(dismiss, leaving ? null : key)
  if (!mine) return null

  const undo = () => {
    mine.undo()
    if (mine.closes) {
      clearNote()
      closePanel()
    } else {
      setNote({ id: mine.id, text: 'Change undone', undo: null })
    }
  }

  return (
    <div
      key={key}
      className="atlas-saved-note"
      data-state={leaving ? 'closing' : 'open'}
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) clearNote() }}
      {...hold}
    >
      <span className="atlas-saved-note-text">
        {mine.undo ? 'Saved: ' : ''}{mine.text}
      </span>
      {mine.undo && (
        <button type="button" className="atlas-link atlas-saved-note-undo" onClick={undo}>Undo</button>
      )}
    </div>
  )
}

const StatusPill = ({ status }) => (
  <span key={status} className={`${PILL_CLASS[status]} atlas-status-line`}>
    <StatusDot status={status} pulse={status === 'insession'} />
    {STATUS[status].label}
  </span>
)

function BookingSheet({ session, mode }) {
  const { isAdmin } = useRole()
  // Session, recording and QA steps (they also apply to completed bookings).
  if (mode === 'interrupt' && session.status === 'insession') return <InterruptForm session={session} />
  if ((mode === 'recording' || mode === 'recording-failed') && session.status === 'completed') {
    return <RecordingForm session={session} failed={mode === 'recording-failed'} />
  }
  if (mode?.startsWith('qa-fail:') && session.status === 'completed') return <QaFailForm session={session} stage={mode.slice(8)} />
  if (isLocked(session.status)) return <BookingDetails session={session} />
  if (mode === 'reschedule' && session.status !== 'booked') return <BookingDetails session={session} />
  if (mode === 'edit') return <EditForm session={session} />
  // Only an Admin assigns or changes the moderator.
  if (mode === 'assign' && isAdmin) return <AssignForm session={session} />
  if (mode === 'reschedule') return <RescheduleForm session={session} />
  if (mode === 'cancel') return <CancelForm session={session} />
  return <BookingDetails session={session} logCall={mode === 'call'} />
}

/* ---------- View ---------- */

function BookingDetails({ session: s, logCall = false }) {
  const homeParticipant = useParticipant(s.participantId)
  const { openBooking, startSession, completeSession, restoreSession, setNote, sessions } = useSchedule()
  const toast = useToast()
  const locked = isLocked(s.status)
  const { name, fullName } = useModerators()
  const { isAdmin } = useRole()

  const start = () => {
    const live = sessions.find((o) => o.status === 'insession' && o.id !== s.id)
    if (live) return toast(`Finish ${live.name}’s session first.`, 'error')
    startSession(s.id)
    setNote({ id: s.id, text: 'In session', undo: () => restoreSession(s) })
  }

  const complete = () => {
    completeSession(s.id)
    setNote({ id: s.id, text: 'Completed', undo: () => restoreSession(s) })
  }

  return (
    <>
      <SheetHead eyebrow={<StatusPill status={s.status} />} title={s.name}>
        <div className="atlas-sheet-sub">{slotLabel(s)}</div>
        {s.rescheduledFrom && (
          <div className="atlas-sheet-note">Rescheduled from {slotLabel(s.rescheduledFrom)}</div>
        )}
        <OneFormaLine session={s} />
        <SavedNote sessionId={s.id} />
      </SheetHead>

      <div className="atlas-sheet-body">
        <SendEmails session={s} />

        <ContactSection session={s} startOpen={logCall} />

        {s.status === 'cancelled' && (
          <div className="atlas-sheet-alert">
            <div className="atlas-eyebrow atlas-sheet-alert-title">CANCELLED</div>
            {s.cancelReason || 'No reason given.'}
          </div>
        )}

        <dl className="atlas-detail-grid">
          <Detail label="MODERATOR">
            <span className="atlas-detail-moderator" title={fullName(s.moderator)}>
              {s.moderator ? name(s.moderator) : needsModerator(s) ? <span className="atlas-needs-moderator">Needs moderator</span> : '—'}
              {s.moderator && <span className="atlas-detail-moderator-full">{fullName(s.moderator)}</span>}
              {isAdmin && !locked && (
                <button type="button" className="atlas-link atlas-detail-assign" onClick={() => openBooking(s.id, 'assign')}>
                  {s.moderator ? 'Change' : 'Assign'}
                </button>
              )}
            </span>
          </Detail>
          <Detail label="BILLABLE HOURS">
            {isBillable(s)
              ? formatHours(billableHours(s))
              : <span className="atlas-detail-muted">None yet · {formatHours(sessionHours(s))} once completed</span>}
          </Detail>
          <Detail label="ROUND-TRIP MILES"><MilesDetail session={s} /></Detail>
          <Detail label="LOCATION">{s.location || '—'}</Detail>
          <Detail label="EMAIL">
            {s.email ? <a className="atlas-detail-link" href={`mailto:${s.email}`}>{s.email}</a> : '—'}
          </Detail>
          <Detail label="PHONE">
            {s.phone ? <a className="atlas-detail-link" href={`tel:${s.phone}`}>{s.phone}</a> : '—'}
          </Detail>
          <Detail label="HOME" wide><HomeSummary home={homeParticipant?.home} features /></Detail>
          <Detail label="NOTES" wide>{s.notes || '—'}</Detail>
        </dl>

        {s.status !== 'cancelled' && <ChecklistLink session={s} />}

        <EmailsSection session={s} />

        <ExecutionSection session={s} />

        <Activity session={s} />
      </div>

      <footer className="atlas-sheet-foot">
        {locked ? (
          <div className="atlas-sheet-locked">
            {s.status === 'completed' ? 'Completed bookings are kept as a record.' : 'Cancelled bookings stay on the calendar for reference.'}
          </div>
        ) : (
          <>
            {s.status === 'booked' && s.date === TODAY && (
              <button type="button" className="atlas-btn-primary" onClick={start}>Start session</button>
            )}
            {s.status === 'insession' && (
              <button type="button" className="atlas-btn-primary" onClick={complete}>Mark completed</button>
            )}
            <div className="atlas-sheet-actions">
              <button type="button" className="atlas-btn-ghost" onClick={() => openBooking(s.id, 'edit')}>Edit</button>
              {s.status === 'booked' && (
                <button type="button" className="atlas-btn-ghost" onClick={() => openBooking(s.id, 'reschedule')}>Reschedule</button>
              )}
              {s.status === 'insession' && (
                <button type="button" className="atlas-btn-ghost" onClick={() => openBooking(s.id, 'interrupt')}>Interrupt</button>
              )}
              <button type="button" className="atlas-btn-danger" onClick={() => openBooking(s.id, 'cancel')}>Cancel</button>
            </div>
          </>
        )}
      </footer>
    </>
  )
}

// The moderators' checklist for this booking. The checklist app finds it in Atlas_Bookings by BookingId.
function ChecklistLink({ session }) {
  const url = checklistUrlFor(session)
  if (!url) {
    return (
      <div className="atlas-checklist-link is-off">
        <span>Checklist</span>
        <span className="atlas-checklist-link-meta">Link appears once VITE_CHECKLIST_URL is set</span>
      </div>
    )
  }
  return (
    <a className="atlas-checklist-link" href={url} target="_blank" rel="noopener noreferrer">
      <span>Open checklist</span>
      <span className="atlas-checklist-link-meta">{bookingRef(session)}</span>
    </a>
  )
}

// Miles HQ -> participant -> HQ for billing, with how they were found. An Admin
// can correct them; the correction is saved on the booking like any edit.
function MilesDetail({ session: s }) {
  const { setRouteMiles } = useSchedule()
  const { isAdmin } = useRole()
  const { participants } = useParticipants()
  const toast = useToast()
  const mine = useMemo(() => participants.filter((p) => p.id === s.participantId), [participants, s.participantId])
  const trip = roundTrip(useOneWayMiles(mine), s)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const open = () => { setValue(trip ? String(Math.round(trip.miles * 10) / 10) : ''); setEditing(true) }
  const save = (e) => {
    e.preventDefault()
    const miles = Number(value)
    if (!value.trim() || !Number.isFinite(miles) || miles < 0 || miles > 1000) return toast('Enter the round-trip miles, 0 to 1000.', 'error')
    setRouteMiles(s.id, Math.round(miles * 100) / 100)
    setEditing(false)
    toast(`Miles set to ${miles} for ${s.name}`)
  }

  if (editing) {
    return (
      <form className="atlas-miles-edit atlas-swap-in" onSubmit={save}>
        <input
          className="atlas-input atlas-miles-input"
          type="number" inputMode="decimal" min="0" max="1000" step="0.1"
          aria-label="Round-trip miles" value={value} autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
        />
        <button type="submit" className="atlas-link atlas-miles-save">Save</button>
        <button type="button" className="atlas-link-quiet atlas-miles-cancel" onClick={() => setEditing(false)}>Cancel</button>
      </form>
    )
  }
  return (
    <span className="atlas-miles" title={trip ? MILES_SOURCE[trip.source] : 'No map point, ZIP code or saved miles to go on'}>
      {trip ? formatMi(trip.miles) : '—'}
      {trip?.approx && <span className="atlas-miles-tag">approx.</span>}
      {trip?.source === 'admin' && <span className="atlas-miles-tag">set by admin</span>}
      {isAdmin && <button type="button" className="atlas-link atlas-miles-fix" onClick={open}>{trip ? 'Correct' : 'Add'}</button>}
    </span>
  )
}

const Detail = ({ label, wide, children }) => (
  <div className={`atlas-detail${wide ? ' atlas-detail--wide' : ''}`}>
    <dt className="atlas-eyebrow">{label}</dt>
    <dd className="atlas-detail-value">{children}</dd>
  </div>
)

const when = (iso) => new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

function Activity({ session }) {
  const history = [...(session.history ?? [])].reverse()
  return (
    <section className="atlas-activity">
      <div className="atlas-eyebrow">ACTIVITY</div>
      {history.length === 0 && <div className="atlas-activity-empty">Imported with the schedule.</div>}
      <ol className="atlas-activity-list">
        {history.map((h, i) => (
          <li key={history.length - i} className="atlas-activity-item atlas-row-in" style={{ animationDelay: `${Math.min(i, 8) * MS.rowStep}ms` }}>
            <span className="atlas-activity-dot" />
            <div className="atlas-activity-text">
              <span className="atlas-activity-label">{h.text}</span>
              {h.from && <span className="atlas-activity-meta">{slotLabel(h.from)} → {slotLabel(h.to)}</span>}
              {h.reason && <span className="atlas-activity-meta">“{h.reason}”</span>}
              <span className="atlas-activity-time">{when(h.at)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// Participant contact trace: every confirmation email and call, newest first, and a
// quick way to log a call. Calling from here (tel: link) opens the outcome picker,
// so the log is one click after hanging up. Saved on the booking for every Scheduler.
const OUTCOME_BTN = {
  reached: 'atlas-contact-outcome atlas-contact-outcome--reached',
  voicemail: 'atlas-contact-outcome',
  'no-answer': 'atlas-contact-outcome',
  'wrong-number': 'atlas-contact-outcome atlas-contact-outcome--bad',
}

function ContactSection({ session: s, startOpen = false }) {
  const { logContact, restoreSession, setNote } = useSchedule()
  const { canBook } = useRole()
  const { fullName } = useModerators()
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState('')
  const noteRef = useRef(null)
  const log = contactLog(s)
  const canLog = canBook && (s.status === 'booked' || s.status === 'insession')

  // Opened from the right-click menu: focus the note so the picker is ready.
  useEffect(() => {
    if (!startOpen) return undefined
    const raf = requestAnimationFrame(() => noteRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [startOpen])

  if (!canBook && !log.length) return null

  const save = (outcome) => {
    const before = s
    logContact(s.id, { kind: 'call', outcome, note: text })
    setNote({ id: s.id, text: `call logged · ${OUTCOME_LABEL[outcome]}`, undo: () => restoreSession(before) })
    setText('')
    setOpen(false)
  }

  const who = (c) => c.byName || (c.by ? fullName(c.by) : '')
  const title = (c) => {
    if (c.kind === 'email') return c.source === 'flow' ? 'Email sent' : `${TEMPLATE_LABEL[c.template] ?? 'Booking'} email`
    return c.source === 'checklist' ? 'Called by moderator' : `Call · ${OUTCOME_LABEL[c.outcome]}`
  }

  return (
    <section className="atlas-contact" aria-label="Participant contact">
      <div className="atlas-contact-head">
        <span className="atlas-eyebrow">PARTICIPANT CONTACT</span>
        <ContactChip session={s} />
      </div>

      {canLog && (
        <div className="atlas-contact-actions">
          {s.phone && (
            <a className="atlas-contact-dial atlas-raised-sm" href={`tel:${s.phone}`} onClick={() => setOpen(true)}>
              <PhoneGlyph /> <span className="atlas-contact-dial-number">{s.phone}</span>
            </a>
          )}
          <button
            type="button"
            className={`atlas-btn-ghost atlas-contact-log-btn${open ? ' is-active' : ''}`}
            aria-expanded={open}
            aria-controls={`contact-log-${s.id}`}
            onClick={() => setOpen((o) => !o)}
          >
            Log call
          </button>
        </div>
      )}

      {canLog && (
        <Collapse open={open} id={`contact-log-${s.id}`}>
          <div className="atlas-contact-picker atlas-well-sm">
            <input
              ref={noteRef}
              className="atlas-input atlas-contact-note"
              placeholder="Note (optional): asked for a call after 5 PM"
              aria-label="Call note"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
            />
            <div className="atlas-contact-outcomes" role="group" aria-label="How did the call go?">
              {OUTCOMES.map((o) => (
                <button key={o} type="button" className={OUTCOME_BTN[o]} onClick={() => save(o)}>{OUTCOME_LABEL[o]}</button>
              ))}
            </div>
          </div>
        </Collapse>
      )}

      {log.length === 0 ? (
        <div className="atlas-contact-empty">No emails or calls yet.</div>
      ) : (
        <ol className="atlas-contact-log">
          {log.map((c, i) => (
            <li key={c.id} className={`${ENTRY_CLASS[c.kind === 'email' ? 'email' : c.outcome]} atlas-row-in`} style={{ animationDelay: `${Math.min(i, 8) * MS.rowStep}ms` }}>
              <span className="atlas-contact-entry-icon">{c.kind === 'email' ? <MailGlyph /> : <PhoneGlyph />}</span>
              <div className="atlas-contact-entry-text">
                <span className="atlas-contact-entry-title">{title(c)}</span>
                {c.note && <span className="atlas-contact-entry-note">“{c.note}”</span>}
                <span className="atlas-contact-entry-meta">{when(c.at)}{who(c) ? ` · ${who(c)}` : ''}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// Last email per recipient and a way to send it again. Schedulers resend to the
// participant; only an Admin resends to the moderator (they staff the booking).
const RECIPIENTS = [
  { to: 'participant', label: 'Participant' },
  { to: 'moderator', label: 'Moderator', adminOnly: true },
]

const TEMPLATE_WORD = {
  'booking-confirmed': 'booking',
  'booking-rescheduled': 'new time',
  'booking-cancelled': 'cancellation',
}

// Who may send to whom, and whether there is anyone to send to.
function useRecipients(s) {
  const { isAdmin, canBook } = useRole()
  return (to) => {
    const allowed = to === 'participant' ? canBook : isAdmin
    const reachable = to === 'participant' ? Boolean(s.email?.trim()) : Boolean(s.moderator)
    return { allowed, reachable }
  }
}

// After a book, reschedule, cancel or moderator assignment: a button per recipient.
// Nothing is emailed until someone clicks (participants are real people). The strip
// stays while the drawer is open, so a click shows its result in place.
function SendEmails({ session: s }) {
  const { entries } = useSync()
  const { resendEmail } = useSchedule()
  const { label: moderatorLabel } = useModerators()
  const toast = useToast()
  const can = useRecipients(s)
  const offer = useMemo(() => offeredEmails(entries, s.id), [entries, s.id])
  const [shownFor, setShownFor] = useState(null)

  const rows = (offer?.recipients ?? []).filter((r) => can(r.to).allowed)
  const pending = rows.some((r) => !r.sent && can(r.to).reachable)
  // Show while something is unsent, and keep showing for this change after a click.
  if (!offer || (!pending && shownFor !== offer.at)) return null

  const send = (to) => {
    setShownFor(offer.at)
    const entry = resendEmail(s.id, to, offer.template)
    if (!entry) return
    if (entry.status === 'rejected') toast(entry.message ?? 'That email couldn’t be queued.', 'error')
    else toast(entry.status === 'built' ? `Dry run: email to the ${to} built, not sent` : `Email to the ${to} queued`)
  }

  const word = TEMPLATE_WORD[offer.template] ?? 'booking'
  return (
    <section className="atlas-send-emails atlas-swap-in" aria-label="Send emails">
      <div className="atlas-send-emails-head">
        <span className="atlas-eyebrow">SEND EMAILS</span>
        <span className="atlas-send-emails-note">
          {rows.some((r) => r.sent) ? `Anyone else to tell about this ${word}?` : `Nothing has been emailed about this ${word} yet.`}
        </span>
      </div>
      <div className="atlas-send-emails-actions">
        {rows.map(({ to, sent }) => {
          const { reachable } = can(to)
          const who = to === 'participant' ? 'participant' : `moderator${s.moderator ? ` (${moderatorLabel(s.moderator)})` : ''}`
          if (sent) {
            return (
              <span key={to} className={`atlas-send-emails-done ${TONE_CLASS[EMAIL_TONE[sent.state]]}`}>
                {sent.state === 'failed' ? '✕' : '✓'} Email {who}: {EMAIL_TEXT[sent.state]}
              </span>
            )
          }
          return (
            <button
              key={to}
              type="button"
              className="atlas-btn-primary atlas-btn-primary--compact atlas-send-emails-btn"
              disabled={!reachable}
              title={reachable ? undefined : to === 'participant' ? 'No participant email on file' : 'No moderator assigned yet'}
              onClick={() => send(to)}
            >
              Email {who}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const fallbackTemplate = (s) =>
  s.status === 'cancelled' ? 'booking-cancelled' : s.rescheduledFrom ? 'booking-rescheduled' : 'booking-confirmed'

function EmailsSection({ session: s }) {
  const { entries } = useSync()
  const { resendEmail } = useSchedule()
  const { isAdmin, canBook } = useRole()
  const toast = useToast()
  const offer = useMemo(() => offeredEmails(entries, s.id), [entries, s.id])
  if (!canBook) return null

  const resend = (to, template) => {
    const entry = resendEmail(s.id, to, template, { again: true })
    if (!entry) return
    if (entry.status === 'rejected') toast(entry.message ?? 'That email couldn’t be queued.', 'error')
    else toast(entry.status === 'built' ? `Dry run: resend to the ${to} built, not sent` : `Resend to the ${to} queued`)
  }

  return (
    <section className="atlas-emails" aria-label="Emails">
      <div className="atlas-eyebrow">EMAILS</div>
      <ul className="atlas-emails-list">
        {RECIPIENTS.map(({ to, label, adminOnly }) => {
          const last = lastEmail(entries, s.id, to)
          // The latest change offered this recipient an email nobody has sent yet.
          const unsent = offer?.recipients.some((r) => r.to === to && !r.sent)
          const reachable = to === 'participant' ? Boolean(s.email?.trim()) : Boolean(s.moderator)
          const why = to === 'participant' ? 'No email on file' : 'No moderator yet'
          return (
            <li key={to} className="atlas-emails-row">
              <span className="atlas-emails-who">{label}</span>
              <span className="atlas-emails-state">
                {!reachable ? <span className="atlas-detail-muted">{why}</span>
                  : unsent ? <span className={TONE_CLASS.warn}>Not emailed about the latest change</span>
                    : last ? <span className={TONE_CLASS[EMAIL_TONE[last.state]]}>{EMAIL_TEXT[last.state]} · {when(last.at)}</span>
                      : <span className="atlas-detail-muted">None sent</span>}
              </span>
              {reachable && (!adminOnly || isAdmin) && (
                <button type="button" className="atlas-link atlas-emails-resend" onClick={() => resend(to, (unsent && offer?.template) || last?.template || fallbackTemplate(s))}>
                  {last ? 'Resend' : 'Send'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ---------- Edit ---------- */

function useFormSheet(session) {
  const { openBooking, restoreSession, setNote } = useSchedule()
  const toast = useToast()
  const [shakeKey, setShakeKey] = useState(0)
  const back = () => openBooking(session.id)
  const fail = (message) => {
    setShakeKey((k) => k + 1)
    toast(message, 'error')
  }
  // Back to the details with an inline "Saved" note that can undo the change.
  const saved = (text) => {
    const before = session
    setNote({ id: session.id, text, undo: () => restoreSession(before) })
    back()
  }
  return { back, fail, saved, shakeKey }
}

function EditForm({ session }) {
  const { sessions, updateSession, rescheduleSession } = useSchedule()
  const { name: moderatorName } = useModerators()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  // The moderator isn't edited here: an Admin assigns or changes it from the details.
  // Date and time can change while the booking is still booked; that saves as a reschedule.
  const canMove = session.status === 'booked'
  const linked = isLinked(session)
  const [form, setForm] = useState({
    name: session.name, location: session.location ?? '', email: session.email ?? '',
    phone: session.phone ?? '', protocol: session.protocol ?? '', notes: session.notes ?? '',
  })
  const [slot, setSlot] = useState({ date: session.date, start: session.start, end: session.end })
  const [reason, setReason] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setTime = (patch) => setSlot((f) => ({ ...f, ...patch }))
  const moved = canMove && (slot.date !== session.date || slot.start !== session.start || slot.end !== session.end)

  const save = () => {
    const problem = checkDetails(form)
    if (problem) return fail(problem)
    if (moved) {
      const clash = findConflict(sessions, { ...slot, moderator: session.moderator }, session.id)
      const timeProblem = checkTimes(slot) ?? (clash && conflictMessage(clash, moderatorName))
        ?? dailyLimitProblem(sessions, { ...slot, moderator: session.moderator }, moderatorName, session.id) ?? (linked && !reason.trim() && 'Add a reason for the new time. OneForma records it with the change.')
      if (timeProblem) return fail(timeProblem)
    }
    const details = {
      ...displayNames(form.name),
      location: form.location.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      protocol: form.protocol.trim(),
      notes: form.notes.trim(),
    }
    const detailsChanged = Object.entries(details).some(([k, v]) => (session[k] ?? '') !== v)
    if (detailsChanged || !moved) updateSession(session.id, details)
    if (moved) rescheduleSession(session.id, slot, reason.trim())
    saved(moved ? `moved to ${slotLabel(slot)}` : 'details updated')
  }

  return (
    <FormShell session={session} mode="edit" onBack={back} onSave={save} saveLabel="Save changes" shakeKey={shakeKey}>
      <TextField label="PARTICIPANT" value={form.name} onChange={(v) => set({ name: v })} autoFocus />
      {canMove && (
        <>
          <TextField label="DATE" type="date" value={slot.date} onChange={(v) => setTime({ date: v })} />
          <div className="atlas-booking-times atlas-booking-times--sheet">
            <TimeField label="START TIME" value={slot.start} onChange={(v) => setTime(withStart(v))} />
            <TimeField label="END TIME" value={slot.end} onChange={(v) => setTime(withEnd(v))} />
          </div>
          {moved && (
            <TextField label={linked ? 'REASON FOR NEW TIME' : 'REASON FOR NEW TIME (OPTIONAL)'} multiline value={reason} placeholder="e.g. Participant asked for a later slot" onChange={setReason} />
          )}
        </>
      )}
      <TextField label="LOCATION" value={form.location} placeholder="Address or meeting link" onChange={(v) => set({ location: v })} />
      <div className="atlas-field-row">
        <TextField label="EMAIL" type="email" value={form.email} onChange={(v) => set({ email: v })} />
        <TextField label="PHONE" type="tel" value={form.phone} onChange={(v) => set({ phone: v })} />
      </div>
      <TextField label="NOTES" multiline value={form.notes} onChange={(v) => set({ notes: v })} />
    </FormShell>
  )
}

/* ---------- Assign moderator (Admin) ---------- */

function AssignForm({ session }) {
  const { sessions, assignModerator } = useSchedule()
  const { label: moderatorLabel, name: moderatorName } = useModerators()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const [moderator, setModerator] = useState(session.moderator ?? '')
  const busy = useMemo(() => new Set(sessions
    .filter((s) => findConflict([s], { ...session, moderator: s.moderator }, session.id))
    .map((s) => s.moderator)), [sessions, session])
  const dayCounts = useMemo(() => moderatorDayCounts(sessions, session.date, session.id), [sessions, session])

  const save = () => {
    if (moderator === (session.moderator ?? '')) return fail(moderator ? 'Pick a different moderator.' : 'Pick a moderator.')
    const clash = findConflict(sessions, { ...session, moderator }, session.id)
    if (clash) return fail(conflictMessage(clash, moderatorName))
    const full = dailyLimitProblem(sessions, { ...session, moderator }, moderatorName, session.id)
    if (full) return fail(full)
    assignModerator(session.id, moderator)
    saved(moderator ? `moderator ${moderatorLabel(moderator)}` : 'moderator unassigned')
  }

  return (
    <FormShell session={session} mode="assign" onBack={back} onSave={save} saveLabel={session.moderator ? 'Change moderator' : 'Assign'} shakeKey={shakeKey}>
      <div className="atlas-sheet-current">
        <span className="atlas-eyebrow">CURRENTLY</span>
        <span className="atlas-sheet-current-slot">{moderatorLabel(session.moderator)}</span>
      </div>
      <div className="atlas-field">
        <span className="atlas-eyebrow">MODERATOR</span>
        <ModeratorPicker optional value={moderator} busy={busy} counts={dayCounts} onChange={setModerator} />
      </div>
    </FormShell>
  )
}

/* ---------- Reschedule ---------- */

function RescheduleForm({ session }) {
  const { sessions, rescheduleSession } = useSchedule()
  const { name: moderatorName } = useModerators()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const [slot, setSlot] = useState({ date: session.date, start: session.start, end: session.end })
  const [reason, setReason] = useState('')
  const linked = isLinked(session)
  const set = (patch) => setSlot((f) => ({ ...f, ...patch }))

  const save = () => {
    if (slot.date === session.date && slot.start === session.start && slot.end === session.end) {
      return fail('Pick a new date or time.')
    }
    const clash = findConflict(sessions, { ...slot, moderator: session.moderator }, session.id)
    const problem = checkTimes(slot) ?? (clash && conflictMessage(clash, moderatorName))
      ?? dailyLimitProblem(sessions, { ...slot, moderator: session.moderator }, moderatorName, session.id) ?? (linked && !reason.trim() && 'Add a reason. OneForma records it with the change.')
    if (problem) return fail(problem)
    rescheduleSession(session.id, slot, reason.trim())
    saved(`moved to ${slotLabel(slot)}`)
  }

  return (
    <FormShell session={session} mode="reschedule" onBack={back} onSave={save} saveLabel="Reschedule" shakeKey={shakeKey}>
      <div className="atlas-sheet-current">
        <span className="atlas-eyebrow">CURRENTLY</span>
        <span className="atlas-sheet-current-slot">{slotLabel(session)}</span>
      </div>
      <TextField label="NEW DATE" type="date" value={slot.date} onChange={(v) => set({ date: v })} autoFocus />
      <div className="atlas-booking-times atlas-booking-times--sheet">
        <TimeField label="START TIME" value={slot.start} onChange={(v) => set(withStart(v))} />
        <TimeField label="END TIME" value={slot.end} onChange={(v) => set(withEnd(v))} />
      </div>
      <TextField label={linked ? 'REASON' : 'REASON (OPTIONAL)'} multiline value={reason} placeholder="e.g. Participant asked for a later slot" onChange={setReason} />
    </FormShell>
  )
}

/* ---------- Cancel ---------- */

function CancelForm({ session }) {
  const { cancelSession } = useSchedule()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const [reason, setReason] = useState('')
  const live = session.status === 'insession'
  // OneForma needs a reason for every cancellation it receives.
  const required = isLinked(session)

  const confirm = () => {
    if (required && !reason.trim()) return fail('Add a reason. OneForma needs one for a cancellation.')
    cancelSession(session.id, reason.trim())
    saved(live ? 'session cancelled' : 'cancelled')
  }

  return (
    <FormShell
      session={session}
      mode={live ? 'cancel-session' : 'cancel'}
      onBack={back}
      onSave={confirm}
      saveLabel={live ? 'Cancel session' : 'Cancel booking'}
      backLabel={live ? 'Keep session' : 'Keep booking'}
      shakeKey={shakeKey}
      danger
    >
      <div className="atlas-sheet-alert">
        {live ? 'This session is in progress. It will be' : 'This booking will be'} marked <strong className="atlas-sheet-alert-strong">Cancelled</strong>. It stays on the calendar for reference and can’t be edited afterwards.
      </div>
      <TextField label={required ? 'REASON' : 'REASON (OPTIONAL)'} multiline value={reason} placeholder="e.g. Participant unavailable, moderator reassigned…" onChange={setReason} autoFocus />
    </FormShell>
  )
}

/* ---------- Session interruption ---------- */

function InterruptForm({ session }) {
  const { interruptSession } = useSchedule()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const [reason, setReason] = useState('')

  const save = () => {
    if (!reason.trim()) return fail('Say what interrupted the session.')
    interruptSession(session.id, reason.trim())
    saved('interruption noted')
  }

  return (
    <FormShell session={session} mode="interrupt" onBack={back} onSave={save} saveLabel="Note interruption" shakeKey={shakeKey}>
      <div className="atlas-sheet-current">
        <span className="atlas-eyebrow">WHERE IT GOES</span>
        <span className="atlas-sheet-current-slot">The session stays in progress. This is saved with the booking in SharePoint. OneForma’s callback API has no interruption event yet, so it isn’t sent there.</span>
      </div>
      <TextField label="WHAT HAPPENED" multiline value={reason} placeholder="e.g. Participant stepped out, device battery" onChange={setReason} autoFocus />
    </FormShell>
  )
}

/* ---------- Recording ---------- */

// The recording stays in the client's app; Atlas only keeps its reference.
function RecordingForm({ session, failed }) {
  const { logRecording } = useSchedule()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const version = (session.recordings?.length ?? 0) + 1
  const [mediaRef, setMediaRef] = useState('')
  const [mins, setMins] = useState('')
  const [reason, setReason] = useState('')

  const save = () => {
    const ref = mediaRef.trim()
    if (!ref) return fail('Add the recording’s reference from the client app.')
    if (/^[a-z]+:\/\/[^/]*@/i.test(ref) || /[?&](sig|token|key)=/i.test(ref)) return fail('Use a reference without passwords or access keys.')
    const minutes = Number(mins)
    if (!failed && !(minutes > 0)) return fail('Add how long the recording runs, in minutes.')
    if (failed && !reason.trim()) return fail('Say why the recording failed.')
    logRecording(session.id, {
      mediaRef: ref,
      durationSeconds: failed ? Math.max(0, Math.round((minutes || 0) * 60)) : Math.round(minutes * 60),
      failed,
      ...(failed ? { reason: reason.trim() } : {}),
    })
    saved(failed ? `recording v${version} failed` : `recording v${version} logged`)
  }

  return (
    <FormShell session={session} mode={failed ? 'recording-failed' : 'recording'} onBack={back} onSave={save} saveLabel={failed ? 'Report failure' : 'Log recording'} danger={failed} shakeKey={shakeKey}>
      {version > 1 && (
        <div className="atlas-sheet-current">
          <span className="atlas-eyebrow">RE-RECORD</span>
          <span className="atlas-sheet-current-slot">This becomes version {version}. Its checklist and QA start over.</span>
        </div>
      )}
      <TextField label="MEDIA REFERENCE" value={mediaRef} placeholder="ID or link from the client app" onChange={setMediaRef} autoFocus />
      <TextField label={failed ? 'MINUTES RECORDED (OPTIONAL)' : 'LENGTH (MINUTES)'} type="number" value={mins} placeholder="e.g. 45" onChange={setMins} />
      {failed && <TextField label="WHAT WENT WRONG" multiline value={reason} placeholder="e.g. Upload failed in the client app" onChange={setReason} />}
    </FormShell>
  )
}

/* ---------- QA failure ---------- */

function QaFailForm({ session, stage }) {
  const { setQa } = useSchedule()
  const { back, fail, saved, shakeKey } = useFormSheet(session)
  const [reason, setReason] = useState('')
  const label = QA_STAGE_LABEL[stage] ?? 'QA'

  const save = () => {
    if (!reason.trim()) return fail('Say why it didn’t pass.')
    setQa(session.id, stage, 'failed', reason.trim())
    saved(`${label.toLowerCase()} failed`)
  }

  return (
    <FormShell session={session} mode="qa-fail" onBack={back} onSave={save} saveLabel={stage === 'internal_qa' ? 'Reject' : 'Mark failed'} danger shakeKey={shakeKey}>
      <div className="atlas-sheet-current">
        <span className="atlas-eyebrow">{label.toUpperCase()}</span>
        <span className="atlas-sheet-current-slot">For recording v{session.recordings?.[session.recordings.length - 1]?.version ?? 1}</span>
      </div>
      <TextField label="REASON" multiline value={reason} placeholder="e.g. Room not fully covered, audio clipped" onChange={setReason} autoFocus />
    </FormShell>
  )
}

function FormShell({ session, mode, onBack, onSave, saveLabel, backLabel = 'Back', danger = false, shakeKey = 0, children }) {
  return (
    <>
      <SheetHead eyebrow={<StatusPill status={session.status} />} title={TITLES[mode]}>
        <div className="atlas-sheet-sub">{session.name} · {slotLabel(session)}</div>
      </SheetHead>
      <form
        className="atlas-sheet-form"
        onSubmit={(e) => { e.preventDefault(); onSave() }}
      >
        <div key={shakeKey} className={`atlas-sheet-body${shakeKey ? ' atlas-shake' : ''}`}>{children}</div>
        <footer className="atlas-sheet-foot">
          <div className="atlas-sheet-actions">
            <button type="button" className="atlas-btn-ghost" onClick={onBack}>{backLabel}</button>
            <button type="submit" className={danger ? 'atlas-btn-danger atlas-btn-danger--solid' : 'atlas-btn-primary atlas-btn-primary--compact'}>{saveLabel}</button>
          </div>
        </footer>
      </form>
    </>
  )
}

/* ---------- One day's bookings (from the Month grid) ---------- */

function DaySheet({ date }) {
  const { sessions } = useSchedule()
  const { label: moderatorLabel } = useModerators()
  const matches = useMatches()
  const triggers = useBookingTriggers()
  const list = sessionsOn(sessions, date).filter(matches)

  return (
    <>
      <SheetHead eyebrow={<span className="atlas-eyebrow">BOOKINGS</span>} title={longDayLabel(date)} />
      <div className="atlas-sheet-body">
        {list.length === 0 && <div className="atlas-activity-empty">No bookings on this day.</div>}
        {list.map((s, i) => (
          <div key={s.id} className="atlas-day-item atlas-row-in" style={{ animationDelay: `${Math.min(i, 8) * MS.rowStep}ms` }} {...triggers(s)}>
            <StatusDot status={s.status} pulse={s.status === 'insession'} />
            <div className="atlas-day-item-text">
              <span className="atlas-day-item-name">{s.name}</span>
              <span className="atlas-day-item-meta">{timeRange(s.start, s.end)} · {moderatorLabel(s.moderator)}</span>
            </div>
            <span className="atlas-day-item-status">{STATUS[s.status].label}</span>
          </div>
        ))}
      </div>
    </>
  )
}
