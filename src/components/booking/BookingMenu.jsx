import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isLocked } from '../../lib/bookings.js'
import { MS } from '../../motion/motion.js'
import usePresence from '../../motion/usePresence.js'
import { returnFocus } from '../../motion/useFocusTrap.js'
import { clock12 } from '../../lib/dates.js'
import { useSchedule } from '../../state/ScheduleContext.jsx'
import { useRole } from '../../state/RoleContext.jsx'

// Right-click menu on a booking, as in Twilight's calendar: View is always there,
// changes are hidden once a booking is completed or cancelled. It pops from the
// click point (160ms) and fades out fast; arrow keys move between items.
export default function BookingMenu() {
  const { menu, closeMenu, openBooking, sessions, triggerRef } = useSchedule()
  const ref = useRef(null)
  // Keep showing the last menu while it fades out.
  const last = useRef(menu)
  if (menu) last.current = menu
  const shown = last.current
  const [pos, setPos] = useState(null)
  const { mounted, state, onAnimationEnd } = usePresence(Boolean(menu), MS.menuExit)
  const restore = useRef(true)
  const { canBook } = useRole()

  useEffect(() => { if (menu) restore.current = true }, [menu])

  // Keep the menu inside the viewport, flipping above the cursor near the bottom edge.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    let left = menu.x + 4
    let top = menu.y + 4
    let origin = 'top left'
    if (left + r.width > window.innerWidth - 8) { left = window.innerWidth - r.width - 8; origin = 'top right' }
    if (top + r.height > window.innerHeight - 8) {
      top = menu.y - r.height - 4
      origin = origin.replace('top', 'bottom')
    }
    setPos({ left: Math.max(8, left), top: Math.max(8, top), transformOrigin: origin })
  }, [menu, mounted])

  // Focus the first item once the menu is actually on the page.
  useEffect(() => {
    if (!menu || !mounted) return undefined
    const raf = requestAnimationFrame(() => ref.current?.querySelector('button')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [menu, mounted])

  useEffect(() => {
    if (!menu) return undefined
    const close = (back) => { restore.current = back; closeMenu() }
    const onKey = (e) => { if (e.key === 'Escape') close(true) }
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close(false) }
    const onAway = () => close(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onAway, true)
    window.addEventListener('resize', onAway)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onAway, true)
      window.removeEventListener('resize', onAway)
    }
  }, [menu, closeMenu])

  // Escape gives focus back to the booking that opened the menu.
  useEffect(() => {
    if (!menu && shown && restore.current) returnFocus(triggerRef.current)
  }, [menu, shown, triggerRef])

  const session = mounted && shown && sessions.find((s) => s.id === shown.id)
  if (!session) return null
  const locked = isLocked(session.status)
  const items = [
    { mode: 'view', label: 'View booking' },
    ...(canBook && !locked ? [{ mode: 'call', label: 'Log call' }] : []),
    ...(locked ? [] : [{ mode: 'edit', label: 'Edit booking' }]),
    ...(session.status === 'booked' ? [{ mode: 'reschedule', label: 'Reschedule' }] : []),
    ...(locked ? [] : [{ mode: 'cancel', label: 'Cancel booking', danger: true }]),
  ]

  const onKeyDown = (e) => {
    const buttons = [...ref.current.querySelectorAll('[role="menuitem"]')]
    const i = buttons.indexOf(document.activeElement)
    const go = (n) => { e.preventDefault(); buttons[(n + buttons.length) % buttons.length]?.focus() }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(buttons.length - 1)
    else if (e.key === 'Tab') { e.preventDefault(); restore.current = true; closeMenu() }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${session.name}`}
      className="atlas-menu atlas-raised-sm"
      data-state={pos ? state : 'measuring'}
      style={pos ?? { left: shown.x, top: shown.y }}
      onKeyDown={onKeyDown}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="atlas-eyebrow atlas-menu-title">{session.name} · {clock12(session.start)}</div>
      {items.map((it) => (
        <button
          key={it.mode}
          type="button"
          role="menuitem"
          className={`atlas-menu-item${it.danger ? ' atlas-menu-item--danger' : ''}`}
          onClick={() => openBooking(session.id, it.mode)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
