import { STATUS, toMinutes } from '../../data/schedule.js'
import { needsModerator } from '../../lib/bookings.js'
import { timeRange } from '../../lib/dates.js'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { StatusDot } from '../StatusLegend.jsx'
import { useBookingTriggers } from '../../state/ScheduleContext.jsx'
import ContactChip from '../contact/ContactChip.jsx'

export const HOUR_HEIGHT = 5 // rem per hour row, matches .atlas-week-slot

// Status styling lives in index.css under .atlas-week-event--{status}.
const EVENT_CLASS = {
  completed: 'atlas-week-event atlas-week-event--completed',
  cancelled: 'atlas-week-event atlas-week-event--cancelled',
  insession: 'atlas-week-event atlas-week-event--insession',
  booked: 'atlas-week-event atlas-week-event--booked',
}

// An event block positioned inside the grid cell of its starting hour.
export default function CalendarEvent({ session, lane = 0, lanes = 1, style }) {
  const { name: moderatorName, fullName } = useModerators()
  const triggers = useBookingTriggers()
  const startMin = toMinutes(session.start)
  const top = ((startMin % 60) / 60) * HOUR_HEIGHT
  const height = ((toMinutes(session.end) - startMin) / 60) * HOUR_HEIGHT
  const live = session.status === 'insession'
  const when = timeRange(session.start, session.end)
  // Overlapping sessions share the cell side by side.
  const laneStyle = lanes > 1
    ? { left: `calc(4px + ${lane} * (100% - 8px) / ${lanes})`, right: 'auto', width: `calc((100% - 8px) / ${lanes} - 2px)` }
    : null

  return (
    <div
      className={`${EVENT_CLASS[session.status]} atlas-row-in`}
      style={{ top: `${top}rem`, height: `${height}rem`, ...laneStyle, ...style }}
      title={`${session.name} · ${when}`}
      {...triggers(session)}
      aria-label={`${session.name}, ${when}`}
    >
      <div className="atlas-week-event-status">
        <StatusDot status={session.status} pulse={live} />
        <span key={session.status} className="atlas-week-event-label atlas-status-line">{STATUS[session.status].label}</span>
        <ContactChip session={session} compact />
      </div>
      <div className="atlas-week-event-client">{session.short}</div>
      <div className="atlas-week-event-time">{when}</div>
      {needsModerator(session) ? (
        <div className="atlas-week-event-moderator atlas-needs-moderator-text" title="An Admin assigns the moderator">Needs moderator</div>
      ) : session.status !== 'cancelled' && session.moderator && (
        <div className="atlas-week-event-moderator" title={fullName(session.moderator)}>with {moderatorName(session.moderator)}</div>
      )}
    </div>
  )
}
