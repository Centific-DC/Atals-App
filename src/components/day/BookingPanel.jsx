import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TODAY } from '../../data/schedule.js'
import { addDays, longDayLabel, timeRange, weekOf, weekRangeLabel } from '../../lib/dates.js'
import {
  activeBookingFor, checkDetails, checkTimes, conflictMessage, dailyLimitProblem, displayNames, findConflict, moderatorDayCounts, slotLabel,
  withEnd, withStart,
} from '../../lib/bookings.js'
import Collapse from '../../motion/Collapse.jsx'
import useSlidingPill from '../../motion/useSlidingPill.js'
import { useToast } from '../../motion/Toast.jsx'
import { useSchedule } from '../../state/ScheduleContext.jsx'
import { RANGE_OPTIONS, rangeText, useParticipants, useQueue, withinRange } from '../../state/ParticipantContext.jsx'
import { participantMiles } from '../../lib/geo.js'
import { bookingRouteMiles } from '../../lib/mileage.js'
import { PlusIcon } from '../Icons.jsx'
import AvailabilityContact from '../contact/AvailabilityContact.jsx'
import QueueSyncStatus from '../sync/QueueSyncStatus.jsx'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { useRole } from '../../state/RoleContext.jsx'
import { ModeratorPicker, TextField, TimeField } from '../booking/Fields.jsx'

const DEFAULTS = {
  date: TODAY, start: '17:00', end: '19:00', moderator: '',
  name: '', location: '', email: '', phone: '', notes: '', participantId: '', requestId: '',
}

// "New Booking" form: pick a day, a time range and the participant, then book. The
// moderator is optional: left Unassigned, an Admin assigns one once it is ready.
// On the Day view it is a panel. The map's booking sheet passes `participant`
// (fixed, so the queue picker hides) and `onBooked`, and supplies its own header;
// `preset` ({ date, start, moderator }) fills a suggested slot from "Book nearby next".
export default function BookingPanel({ participant = null, onBooked = null, preset = null }) {
  const { sessions, addSession, removeSession, openBooking, setNote, triggerRef, draft } = useSchedule()
  const queue = useQueue({ rangeMi: null })
  const { rangeMi, setRangeMi } = useParticipants()
  const openAll = queue.filter((p) => p.status === 'open')
  const openQueue = openAll.filter((p) => withinRange(p, rangeMi))
  // No one open in range: offer the next range that has someone.
  const widenTo = openQueue.length ? undefined : RANGE_OPTIONS
    .filter((mi) => rangeMi != null && (mi == null || mi > rangeMi))
    .find((mi) => openAll.some((p) => withinRange(p, mi)))
  const panelRef = useRef(null)
  const toast = useToast()
  const [form, setForm] = useState(DEFAULTS)
  const { label: moderatorLabel, name: moderatorName } = useModerators()
  const { isAdmin } = useRole()
  const [slide, setSlide] = useState({ dir: null, key: 0 })
  const [shakeKey, setShakeKey] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const [more, setMore] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const week = weekOf(form.date)
  // Who already has a booking in this slot, so the picker can say so.
  const busy = useMemo(() => new Set(sessions
    .filter((s) => findConflict([s], { ...form, moderator: s.moderator }))
    .map((s) => s.moderator)), [sessions, form])
  const dayCounts = useMemo(() => moderatorDayCounts(sessions, form.date), [sessions, form.date])
  const { trackRef, pillProps } = useSlidingPill(`${slide.key}:${form.date}`)

  // Fill name, address and contact from a OneForma participant.
  const pickParticipant = (id) => {
    const p = queue.find((q) => q.id === id)
    if (!p) { set({ participantId: '', requestId: '' }); return }
    set({ participantId: p.id, requestId: p.requestId, name: p.name, location: p.address.split(',')[0], email: p.email ?? '', phone: p.phone ?? '' })
  }

  // The map's sheet books one known person: fill the form from them once, plus the
  // suggested day, time and moderator when it came from "Book nearby next".
  useEffect(() => {
    if (!participant) return
    pickParticipant(participant.id)
    if (preset) set({ date: preset.date, ...withStart(preset.start), moderator: preset.moderator ?? '' })
  }, [participant?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A participant handed over from elsewhere: fill the form and bring it into view.
  useEffect(() => {
    if (!draft || participant) return
    pickParticipant(draft.participantId)
    const el = panelRef.current
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    requestAnimationFrame(() => el?.querySelector('.atlas-booking-pt-select')?.focus({ preventScroll: true }))
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const shiftWeek = (dir) => {
    set({ date: addDays(form.date, dir * 7) })
    setSlide((s) => ({ dir: dir > 0 ? 'next' : 'prev', key: s.key + 1 }))
  }

  const reset = () => {
    const weekChanged = weekOf(DEFAULTS.date)[0].date !== week[0].date
    setForm(DEFAULTS)
    setResetKey((k) => k + 1)
    if (weekChanged) setSlide((s) => ({ dir: DEFAULTS.date < form.date ? 'prev' : 'next', key: s.key + 1 }))
  }

  const fail = (message) => {
    setShakeKey((k) => k + 1)
    toast(message, 'error')
  }

  const book = () => {
    const clash = form.moderator && findConflict(sessions, form)
    // One live booking per participant: reschedule that one rather than booking twice.
    const already = activeBookingFor(sessions, form.participantId)
    const problem = checkTimes(form) ?? checkDetails(form) ?? (clash && conflictMessage(clash, moderatorName))
      ?? dailyLimitProblem(sessions, form, moderatorName)
      ?? (already && `${already.name} is already booked for ${slotLabel(already)}. Open that booking to reschedule it.`)
    if (problem) return fail(problem)
    const miles = bookingRouteMiles(queue.find((p) => p.id === form.participantId))
    const created = addSession({
      date: form.date,
      start: form.start,
      end: form.end,
      moderator: form.moderator,
      status: 'booked',
      ...displayNames(form.name),
      location: form.location.trim() || 'Location to be confirmed',
      email: form.email.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      ...(form.participantId ? { participantId: form.participantId, requestId: form.requestId } : {}),
      ...(miles ?? {}),
    })
    const summary = `${longDayLabel(form.date)} · ${timeRange(form.start, form.end)} · ${moderatorLabel(form.moderator)}`
    if (onBooked) {
      onBooked(created, summary)
      return
    }
    setForm((f) => ({ ...DEFAULTS, date: f.date }))
    setMore(false)
    triggerRef.current = document.activeElement
    openBooking(created.id)
    // The new booking's panel opens with an inline "Saved" note and Undo.
    setNote({
      id: created.id,
      text: `Booked ${summary}`,
      undo: () => removeSession(created.id),
      closes: true,
    })
  }

  const fields = (
    <>
      <div className="atlas-booking-week">
        <div className="atlas-booking-week-head">
          <span className="atlas-booking-range">{weekRangeLabel(week)}</span>
          <div className="atlas-booking-week-nav">
            <button type="button" className="atlas-booking-week-btn atlas-icon-btn atlas-raised-sm" aria-label="Previous week" onClick={() => shiftWeek(-1)}>&lt;</button>
            <button type="button" className="atlas-booking-week-btn atlas-icon-btn atlas-raised-sm" aria-label="Next week" onClick={() => shiftWeek(1)}>&gt;</button>
          </div>
        </div>
        <div
          key={slide.key}
          ref={trackRef}
          role="group"
          aria-label="Booking date"
          className={`atlas-date-strip atlas-no-scrollbar${slide.dir ? ` atlas-slide-${slide.dir}` : ''}`}
        >
          <div {...pillProps} className={`${pillProps.className} atlas-date-pill`} />
          {week.map((d) => {
            const active = d.date === form.date
            return (
              <button
                key={d.date}
                type="button"
                className={`atlas-date-chip${active ? ' is-active' : ''}`}
                data-pill-active={active}
                aria-pressed={active}
                aria-label={longDayLabel(d.date)}
                onClick={() => set({ date: d.date })}
              >
                <span className="atlas-date-chip-dow">{d.dow}</span>
                <span className="atlas-date-chip-day">{d.day}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div key={shakeKey} className={`atlas-booking-times${shakeKey ? ' atlas-shake' : ''}`}>
        <TimeField label="START TIME" value={form.start} onChange={(v) => set(withStart(v))} />
        <TimeField label="END TIME" value={form.end} onChange={(v) => set(withEnd(v))} />
      </div>

      <div className="atlas-booking-participant">
        {!participant && (
          <label className="atlas-field">
            <span className="atlas-booking-queue-head">
              <span className="atlas-eyebrow">CHOOSE A PARTICIPANT</span>
              <QueueSyncStatus />
            </span>
            <select
              className="atlas-input atlas-booking-pt-select"
              value={form.participantId}
              onChange={(e) => pickParticipant(e.target.value)}
            >
              <option value="">Pick an endorsed participant ({openQueue.length} open {rangeText(rangeMi)})</option>
              {form.participantId && !openQueue.some((p) => p.id === form.participantId) && (
                <option value={form.participantId}>{form.name}</option>
              )}
              {openQueue.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {participantMiles(p)} · {p.id}</option>
              ))}
            </select>
          </label>
        )}
        {!participant && widenTo !== undefined && (
          <span className="atlas-booking-widen atlas-row-in">
            No one open {rangeText(rangeMi)}.{' '}
            <button type="button" className="atlas-link" onClick={() => setRangeMi(widenTo)}>
              Widen to {widenTo == null ? 'any distance' : `${widenTo} mi`}
            </button>
          </span>
        )}
        {!participant && form.participantId && (
          <div key={form.participantId} className="atlas-booking-avail atlas-swap-in">
            <AvailabilityContact participant={queue.find((q) => q.id === form.participantId)} compact />
          </div>
        )}
        <TextField label="PARTICIPANT" value={form.name} placeholder="Full name" onChange={(v) => set({ name: v, participantId: '', requestId: '' })} />
        <TextField label="LOCATION" value={form.location} placeholder="Address or meeting link" onChange={(v) => set({ location: v })} />
        <button
          type="button"
          className="atlas-booking-more atlas-link"
          aria-expanded={more}
          aria-controls="atlas-booking-extra"
          onClick={() => setMore((m) => !m)}
        >
          {more ? '− HIDE CONTACT & NOTES' : '+ CONTACT & NOTES'}
        </button>
        <Collapse open={more} id="atlas-booking-extra">
          <div className="atlas-booking-extra">
            <TextField label="EMAIL" type="email" value={form.email} placeholder="name@example.com" onChange={(v) => set({ email: v })} />
            <TextField label="PHONE" type="tel" value={form.phone} placeholder="Optional" onChange={(v) => set({ phone: v })} />
            <TextField label="NOTES" multiline value={form.notes} placeholder="Access, parking, anything the moderator should know" onChange={(v) => set({ notes: v })} />
          </div>
        </Collapse>
      </div>

      <div className="atlas-booking-moderators" data-tour="booking-moderator">
        <div className="atlas-booking-moderators-head">
          <span className="atlas-eyebrow">MODERATOR (OPTIONAL)</span>
          {isAdmin && <Link to="/admin/users" className="atlas-moderator-create atlas-link">MANAGE</Link>}
        </div>
        {!isAdmin && <p className="atlas-booking-moderators-hint">Leave it Unassigned if you don’t know yet. An Admin assigns one once the booking is ready.</p>}
        <ModeratorPicker optional value={form.moderator} busy={busy} counts={dayCounts} onChange={(moderator) => set({ moderator })} />
      </div>
    </>
  )
  const footer = (
    <div className="atlas-booking-footer">
      <button type="button" className="atlas-btn-primary" onClick={book}>Book session</button>
      <p className="atlas-booking-foot-hint">Nothing is emailed yet. You choose who to email once it’s booked.</p>
    </div>
  )

  if (participant) {
    return (
      <div ref={panelRef} className="atlas-booking atlas-booking--sheet">
        <div className="atlas-sheet-body">{fields}</div>
        <div className="atlas-sheet-foot">{footer}</div>
      </div>
    )
  }

  return (
    <section ref={panelRef} className="atlas-booking atlas-raised" data-tour="new-booking">
      <div className="atlas-booking-head">
        <h2 className="atlas-booking-title">New Booking</h2>
        <button
          key={resetKey}
          type="button"
          className={`atlas-booking-reset atlas-icon-btn atlas-raised-sm${resetKey ? ' atlas-spin-once' : ''}`}
          title="Start a new booking"
          aria-label="Start a new booking"
          onClick={reset}
        >
          <PlusIcon />
        </button>
      </div>

      {fields}
      {footer}
    </section>
  )
}
