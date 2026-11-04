import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { SESSIONS, toMinutes } from '../data/schedule.js'
import { seedModerator } from '../data/moderators.js'
import { fromBookingRow } from '../lib/oneforma/actions.ts'
import { READ_URL, storageKey } from '../lib/oneforma/config.ts'
import { QA_STAGE_LABEL } from '../lib/oneforma/events.ts'
import { fetchRead } from '../lib/oneforma/readFlow.ts'
import { OUTCOME_LABEL, STAGE_LABEL, TEMPLATE_LABEL, cleanContacts } from '../lib/contact.ts'
import { nowIso } from '../lib/oneforma/time.ts'
import { useToast } from '../motion/Toast.jsx'
import { useAuth } from './AuthContext.tsx'
import { useSync } from './SyncContext.tsx'

// Schedule shared by every view. With the read flow set, bookings load from
// SharePoint (Atlas_Bookings) and every change goes back through the Atlas action
// flow (SyncContext), which also emails people and tells OneForma. This browser's
// copy shows at once and is replaced when SharePoint answers.
const ScheduleContext = createContext(null)

// v4: one moderator per session (moderator: email) instead of a team.
// v3 copies are carried over; older ones are ignored.
const STORAGE_KEY = storageKey('atlas_schedule_v4')
const V3_KEY = storageKey('atlas_schedule_v3')
const TEAM_TO_SEED = { alpha: 0, beta: 1, gamma: 2 }

const QA_RESULT_LABEL = { passed: 'Passed', failed: 'Failed', pending: 'Started', not_required: 'Not required' }

// A v3 booking keeps its sample moderator if it is a sample session, else its
// old team maps onto one of the seed moderators.
function fromTeam({ team, ...s }) {
  const sample = SESSIONS.find((x) => x.id === s.id)
  return { ...s, moderator: sample?.moderator ?? seedModerator(TEAM_TO_SEED[team] ?? 0) }
}

function loadSessions() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    if (saved?.version === 4 && Array.isArray(saved.sessions)) return saved.sessions
    const old = JSON.parse(window.localStorage.getItem(V3_KEY))
    if (old?.version === 3 && Array.isArray(old.sessions)) return old.sessions.map(fromTeam)
  } catch {
    // Unreadable or blocked storage: start from the seed data.
  }
  return SESSIONS
}

// Returns false when this browser refuses to store (private mode, full storage).
function saveSessions(sessions) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, sessions }))
    return true
  } catch {
    return false
  }
}

// Availability calls made before a participant is booked. Kept in this browser until
// Atlas_Participants has a column for them; copied onto the booking when it is made,
// from where the action flow saves them for everyone.
const PREBOOK_KEY = storageKey('atlas_prebook_contacts_v1')
function loadPrebook() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREBOOK_KEY) ?? '{}')
    if (!saved || typeof saved !== 'object') return {}
    return Object.fromEntries(Object.entries(saved).map(([pid, list]) => [pid, cleanContacts(list)]))
  } catch {
    return {}
  }
}

/** Refresh from SharePoint when the tab comes back, at most this often. */
const REFRESH_MS = 30000

// Checklist steps (moderator) and the action each one saves.
const CHECK_STEP = {
  arrived: { action: 'checklist.arrived', text: 'Arrived at location' },
  contacted: { action: 'checklist.contacted', text: 'Called participant' },
  confirmed: { action: 'checklist.confirmed', text: 'Confirmed' },
}

/** Who a booking, reschedule or cancellation email can go to. */
const BOTH = ['participant', 'moderator']

const newId = () => `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const stamp = (type, text) => ({ at: new Date().toISOString(), type, text })

export function ScheduleProvider({ children }) {
  const [sessions, setSessions] = useState(loadSessions)
  const [prebook, setPrebook] = useState(loadPrebook)
  useEffect(() => {
    try { window.localStorage.setItem(PREBOOK_KEY, JSON.stringify(prebook)) } catch { /* lasts for this tab */ }
  }, [prebook])
  const prebookRef = useRef(prebook)
  prebookRef.current = prebook
  // Which booking the details panel shows: { id, mode } or { date } for a day's list.
  const [panel, setPanel] = useState(null)
  // Right-click menu on a booking: { id, x, y }.
  const [menu, setMenu] = useState(null)
  // Inline "Saved" note in the details panel: { id, text, undo }.
  const [note, setNote] = useState(null)
  // A participant handed to the New Booking form from elsewhere (the map): { participantId, key }.
  const [draft, setDraftState] = useState(null)
  // The card that opened the panel or menu, so focus can go back to it.
  const triggerRef = useRef(null)
  const toast = useToast()
  const { record, withdraw, unsavedRows } = useSync()
  const { user } = useAuth()
  const warned = useRef(false)

  useEffect(() => {
    if (saveSessions(sessions) || warned.current) return
    // Say so once instead of failing silently; the app keeps working in memory.
    warned.current = true
    toast('Changes can’t be saved in this browser. They last until you close this tab.', 'error')
  }, [sessions, toast])

  // The latest sessions, so an action can report the booking exactly as it ends up.
  const current = useRef(sessions)
  current.current = sessions

  // Apply a change to one booking, record it in its history, and return the result.
  const apply = useCallback((id, change, entry) => {
    const before = current.current.find((s) => s.id === id)
    if (!before) return null
    const next = { ...before, ...change, history: [...(before.history ?? []), entry] }
    current.current = current.current.map((s) => (s.id === id ? next : s))
    setSessions(current.current)
    return next
  }, [])

  // Load from SharePoint, keeping changes made here that it hasn't saved yet.
  const lastLoad = useRef(0)
  const loadRemote = useCallback(async () => {
    if (!READ_URL) return
    lastLoad.current = Date.now()
    try {
      const body = await fetchRead()
      const byId = new Map()
      for (const row of [...(body.bookings ?? []), ...unsavedRows()]) {
        const s = fromBookingRow(row)
        if (s) byId.set(s.id, s)
      }
      current.current = [...byId.values()]
      setSessions(current.current)
    } catch {
      toast('Couldn’t load bookings from SharePoint. Showing the copy saved in this browser.', 'error')
    }
  }, [toast, unsavedRows])

  useEffect(() => {
    void loadRemote()
    const onShow = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > REFRESH_MS) void loadRemote()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [loadRemote])

  // Emails are never sent with a change. Each change records what it can offer
  // (`offerEmail`); the booking drawer shows a button per recipient, and a click sends it.
  const addSession = useCallback((session) => {
    // Availability calls made before booking travel with the booking from now on.
    const before = session.participantId ? prebookRef.current[session.participantId] ?? [] : []
    const created = { id: newId(), ...session, ...(before.length ? { contacts: before } : {}), history: [stamp('created', 'Booked')] }
    current.current = [...current.current, created]
    setSessions(current.current)
    record('booking.created', created, { event: 'booking.created', offerEmail: { template: 'booking-confirmed', to: BOTH } })
    return created
  }, [record])

  // Every edit is saved. Moderator and location are also part of what OneForma holds.
  const updateSession = useCallback((id, change) => {
    const before = current.current.find((s) => s.id === id)
    const next = apply(id, change, stamp('edited', 'Details edited'))
    if (!before || !next) return
    const moved = [before.moderator !== next.moderator && 'moderator', (before.location ?? '') !== (next.location ?? '') && 'location'].filter(Boolean)
    if (moved.length && next.status === 'booked') {
      record('booking.updated', next, { event: 'booking.rescheduled', input: { reason: `Updated ${moved.join(' and ')}` }, label: 'Details edited' })
    } else {
      record('booking.updated', next)
    }
  }, [apply, record])

  // Admin only: assign, change or clear the moderator once the booking is ready.
  // The drawer then offers to email the moderator the booking.
  const assignModerator = useCallback((id, email) => {
    const before = current.current.find((s) => s.id === id)
    if (!before || before.moderator === email) return
    const text = !email ? 'Moderator unassigned' : before.moderator ? 'Moderator changed' : 'Moderator assigned'
    const next = apply(id, { moderator: email }, stamp('assigned', text))
    const options = { label: text, ...(email ? { offerEmail: { template: 'booking-confirmed', to: ['moderator'] } } : {}) }
    if (next.status === 'booked') {
      record('booking.updated', next, { ...options, event: 'booking.rescheduled', input: { reason: 'Updated moderator' } })
    } else {
      record('booking.updated', next, options)
    }
  }, [apply, record])

  // Contact trace: log an email sent or a call made to the participant, with when and
  // who. Saved on the booking (HistoryJson) like any edit, so every Scheduler sees it.
  const logContact = useCallback((id, contact) => {
    const before = current.current.find((s) => s.id === id)
    if (!before) return null
    const { note, ...rest } = contact
    const entry = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      at: nowIso(), by: user?.email ?? '', byName: user?.shortName || user?.displayName || '',
      ...rest,
      ...(note?.trim() ? { note: note.trim() } : {}),
    }
    const text = contact.kind === 'call'
      ? `${STAGE_LABEL[contact.stage ?? 'confirmation']} call: ${OUTCOME_LABEL[contact.outcome]}`
      : `${TEMPLATE_LABEL[contact.template] ?? 'Booking'} email sent to participant`
    const next = apply(id, { contacts: [...(before.contacts ?? []), entry] },
      { ...stamp('contact', text), ...(entry.note ? { reason: entry.note } : {}) })
    if (next) record('booking.updated', next, { label: contact.kind === 'call' ? 'Call logged' : 'Email logged' })
    return next
  }, [apply, record, user?.email, user?.shortName, user?.displayName])

  // Availability call to a participant who isn't booked yet. Returns an undo.
  const logParticipantContact = useCallback((participantId, { outcome, note }) => {
    const entry = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      kind: 'call', stage: 'availability', outcome, at: nowIso(),
      by: user?.email ?? '', byName: user?.shortName || user?.displayName || '',
      ...(note?.trim() ? { note: note.trim() } : {}),
    }
    setPrebook((all) => ({ ...all, [participantId]: [...(all[participantId] ?? []), entry] }))
    return () => setPrebook((all) => ({ ...all, [participantId]: (all[participantId] ?? []).filter((c) => c.id !== entry.id) }))
  }, [user?.email, user?.shortName, user?.displayName])

  // Every availability call for a participant: this browser's plus any saved on their bookings.
  const participantContacts = useCallback((participantId) => {
    if (!participantId) return []
    const byId = new Map()
    for (const c of prebook[participantId] ?? []) byId.set(c.id, c)
    for (const s of sessions) {
      if (s.participantId !== participantId) continue
      for (const c of s.contacts ?? []) if (c.stage === 'availability') byId.set(c.id, c)
    }
    return [...byId.values()]
  }, [prebook, sessions])

  // Send one recipient an email about the booking (first send or again). Nothing about
  // the booking changes; a participant email is also written to the contact trace.
  const resendEmail = useCallback((id, to, template, { again = false } = {}) => {
    const booking = current.current.find((s) => s.id === id)
    if (!booking) return null
    const sent = record('email.resend', booking, {
      notify: { [to]: true, template },
      resend: { to, template },
      label: `Email ${again ? 'resent' : 'sent'} to ${to}`,
    })
    if (to === 'participant' && sent.status !== 'rejected') logContact(id, { kind: 'email', stage: 'confirmation', template })
    return sent
  }, [record, logContact])

  // Admin correction of a booking's round-trip miles (billing); saved like any edit.
  const setRouteMiles = useCallback((id, miles) => {
    const next = apply(id, { routeMiles: miles, routeMilesSource: 'admin' }, stamp('edited', `Miles set to ${miles} by admin`))
    if (next) record('booking.updated', next)
  }, [apply, record])

  const rescheduleSession = useCallback((id, slot, reason) => {
    const before = current.current.find((s) => s.id === id)
    if (!before) return
    const from = { date: before.date, start: before.start, end: before.end }
    const next = apply(id, { ...slot, rescheduledFrom: from }, { ...stamp('rescheduled', 'Rescheduled'), from, to: slot, reason })
    record('booking.rescheduled', next, { event: 'booking.rescheduled', input: { reason }, offerEmail: { template: 'booking-rescheduled', to: BOTH } })
  }, [apply, record])

  // Before it starts this cancels the booking; once in session it cancels the session.
  const cancelSession = useCallback((id, reason) => {
    const wasLive = current.current.find((s) => s.id === id)?.status === 'insession'
    const next = apply(id, { status: 'cancelled', cancelReason: reason, cancelledAt: new Date().toISOString() },
      { ...stamp('cancelled', wasLive ? 'Session cancelled' : 'Cancelled'), reason })
    const type = wasLive ? 'session.cancelled' : 'booking.cancelled'
    record(type, next, { event: type, input: { reason }, offerEmail: { template: 'booking-cancelled', to: BOTH } })
  }, [apply, record])

  const startSession = useCallback((id) => {
    const at = nowIso()
    const next = apply(id, { status: 'insession', actualStart: at }, stamp('started', 'Session started'))
    record('session.started', next, { event: 'session.started', input: { occurredAt: at } })
  }, [apply, record])

  const completeSession = useCallback((id) => {
    const at = nowIso()
    const before = current.current.find((s) => s.id === id)
    const next = apply(id, { status: 'completed', actualEnd: at, actualStart: before?.actualStart ?? at },
      stamp('completed', 'Marked completed'))
    record('session.completed', next, { event: 'session.completed', input: { occurredAt: at } })
  }, [apply, record])

  // Saved in SharePoint; OneForma's callback API has no interruption event yet.
  const interruptSession = useCallback((id, reason) => {
    const next = apply(id, {}, { ...stamp('interrupted', 'Session interrupted'), reason })
    if (next) record('session.interrupted', next)
  }, [apply, record])

  // Checklist (moderator): each step stamps the time and who did it. The flow
  // records the signed-in person as "by" on its side, whatever the app sends.
  const checkStep = useCallback((id, step) => {
    const { action, text } = CHECK_STEP[step]
    const at = nowIso()
    const by = user?.email ?? ''
    const next = apply(id, { [`${step}At`]: at, [`${step}By`]: by }, stamp(action, text))
    if (next) record(action, next)
    return next
  }, [apply, record, user?.email])

  // A recording lives in the client's app; Atlas reports a reference to it, never the file.
  // Each new recording of the same session is the next media version and needs its own QA.
  const logRecording = useCallback((id, { mediaRef, durationSeconds, failed, reason }) => {
    const before = current.current.find((s) => s.id === id)
    if (!before) return
    const version = (before.recordings?.length ?? 0) + 1
    const recording = {
      version, status: failed ? 'failed' : 'completed', mediaRef, durationSeconds, at: nowIso(),
      ...(reason ? { reason } : {}),
    }
    const next = apply(id, { recordings: [...(before.recordings ?? []), recording], qa: version > 1 ? {} : before.qa },
      { ...stamp(failed ? 'recording-failed' : 'recording', failed ? `Recording v${version} failed` : `Recording v${version} logged`), ...(reason ? { reason } : {}) })
    const type = failed ? 'recording.failed' : 'recording.completed'
    record(type, next, { event: type, input: reason ? { reason } : {} })
  }, [apply, record])

  const setQa = useCallback((id, stage, result, reason) => {
    const before = current.current.find((s) => s.id === id)
    const recording = before?.recordings?.[before.recordings.length - 1]
    if (!before || !recording) return
    const qa = { ...(before.qa ?? {}), [stage]: { result, mediaVersion: recording.version, at: nowIso(), ...(reason ? { reason } : {}) } }
    const next = apply(id, { qa }, { ...stamp('qa', `${QA_STAGE_LABEL[stage]}: ${QA_RESULT_LABEL[result]}`), ...(reason ? { reason } : {}) })
    record('qa.updated', next, { event: 'qa.result.updated', input: { stage, ...(reason ? { reason } : {}) } })
  }, [apply, record])

  // Undo: put back the booking exactly as it was before the change and pull back
  // what that change queued. If it was already saved, save the restored booking.
  const restoreSession = useCallback((snapshot) => {
    const now = current.current.find((s) => s.id === snapshot.id)
    const since = now?.history?.[snapshot.history?.length ?? 0]?.at
    current.current = current.current.map((s) => (s.id === snapshot.id ? snapshot : s))
    setSessions(current.current)
    if (since && withdraw(snapshot.id, since)) record('booking.updated', snapshot, { label: 'Change undone' })
  }, [withdraw, record])

  // Undo of a new booking. One already saved can't be deleted from here, so it is cancelled instead.
  const removeSession = useCallback((id) => {
    if (!withdraw(id, '')) {
      current.current = current.current.filter((s) => s.id !== id)
      setSessions(current.current)
      return
    }
    const next = apply(id, { status: 'cancelled', cancelReason: 'Undone right after booking' },
      { ...stamp('cancelled', 'Cancelled'), reason: 'Undone right after booking' })
    if (next) record('booking.cancelled', next, { event: 'booking.cancelled', input: { reason: 'Undone right after booking' } })
  }, [withdraw, apply, record])

  const openBooking = useCallback((id, mode = 'view') => { setMenu(null); setPanel({ id, mode }) }, [])
  const openDay = useCallback((date) => { setMenu(null); setPanel({ date }) }, [])
  const closePanel = useCallback(() => { setPanel(null); setNote(null) }, [])
  const openMenu = useCallback((id, x, y) => setMenu({ id, x, y }), [])
  const closeMenu = useCallback(() => setMenu(null), [])

  const clearNote = useCallback(() => setNote(null), [])
  const startDraft = useCallback((participantId) => setDraftState({ participantId, key: Date.now() }), [])

  const value = useMemo(() => ({
    sessions, addSession, updateSession, assignModerator, resendEmail, logContact, logParticipantContact, participantContacts, setRouteMiles, rescheduleSession, cancelSession, startSession, completeSession,
    interruptSession, logRecording, setQa, restoreSession, removeSession, checkStep,
    panel, openBooking, openDay, closePanel, menu, openMenu, closeMenu,
    note, setNote, clearNote, triggerRef, draft, startDraft,
  }), [draft, startDraft, sessions, addSession, updateSession, assignModerator, resendEmail, logContact, logParticipantContact, participantContacts, setRouteMiles, rescheduleSession, cancelSession, startSession, completeSession,
    interruptSession, logRecording, setQa, restoreSession, removeSession, checkStep,
    panel, openBooking, openDay, closePanel, menu, openMenu, closeMenu, note, clearNote])
  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>
}

export const useSchedule = () => useContext(ScheduleContext)

// Click opens the booking's details; right-click (or Shift+F10) opens the action menu.
export function useBookingTriggers() {
  const { openBooking, openMenu, triggerRef } = useSchedule()
  return (session) => ({
    role: 'button',
    tabIndex: 0,
    'aria-haspopup': 'dialog',
    'data-booking-id': session.id,
    onClick: (e) => {
      triggerRef.current = e.currentTarget
      openBooking(session.id)
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        triggerRef.current = e.currentTarget
        openBooking(session.id)
      } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
        e.preventDefault()
        triggerRef.current = e.currentTarget
        const r = e.currentTarget.getBoundingClientRect()
        openMenu(session.id, r.left + 16, r.top + 16)
      }
    },
    onContextMenu: (e) => {
      e.preventDefault()
      triggerRef.current = e.currentTarget
      openMenu(session.id, e.clientX, e.clientY)
    },
  })
}

export const sessionsOn = (sessions, date) =>
  sessions
    .filter((s) => s.date === date)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

export const overlaps = (a, b) =>
  toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)
