import { Fragment } from 'react'
import { STATUS } from '../../data/schedule.js'
import { needsModerator } from '../../lib/bookings.js'
import { timeRange } from '../../lib/dates.js'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { PinIcon } from '../Icons.jsx'
import { StatusDot } from '../StatusLegend.jsx'
import { useBookingTriggers } from '../../state/ScheduleContext.jsx'
import ContactChip from '../contact/ContactChip.jsx'

// Status styling lives in index.css under .atlas-session-card--{status}.
const CARD_CLASS = {
  completed: 'atlas-session-card atlas-session-card--completed',
  cancelled: 'atlas-session-card atlas-session-card--cancelled',
  insession: 'atlas-session-card atlas-session-card--insession',
  booked: 'atlas-session-card atlas-session-card--booked',
}

// onShowLive: given for an in-session card on the Day view; a click (or Enter) then
// shows or hides the live card instead of opening the booking. Right-click is unchanged.
export default function SessionCard({ session, style, selected = false, onShowLive, tour }) {
  const { name: moderatorName, fullName } = useModerators()
  const live = session.status === 'insession'
  const triggers = useBookingTriggers()
  // Who runs it, in words: "with Bimo", or that an Admin still has to assign someone.
  const unstaffed = needsModerator(session)
  const withText = unstaffed ? 'Needs moderator' : session.moderator ? `with ${moderatorName(session.moderator)}` : ''
  const withProps = {
    className: `atlas-session-with${unstaffed ? ' atlas-needs-moderator-text' : ''}`,
    title: unstaffed ? 'An Admin assigns the moderator' : `Moderator: ${fullName(session.moderator)}`,
  }
  const own = triggers(session)
  const props = onShowLive ? {
    ...own,
    'aria-haspopup': undefined,
    'aria-pressed': selected,
    onClick: () => onShowLive(session.id),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShowLive(session.id) } else own.onKeyDown(e)
    },
  } : own

  return (
    <article className={`${CARD_CLASS[session.status]}${selected ? ' is-selected' : ''} atlas-row-in`} style={style} {...props} data-tour={tour} aria-label={`${session.name}, ${timeRange(session.start, session.end)}`}>
      {live && <div className="atlas-session-glow" />}

      <div className="atlas-session-time">
        {/* Each end of the range stays whole, so a narrow column wraps at the dash, never inside "10:30 AM". */}
        <div className="atlas-session-start">
          {timeRange(session.start, session.end).split(' – ').map((part, i, all) => (
            <Fragment key={i}>
              <span className="atlas-session-start-part">{part}{i < all.length - 1 ? ' –' : ''}</span>
              {i < all.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="atlas-session-info">
        <div className="atlas-session-status">
          <StatusDot status={session.status} pulse={live} />
          <span key={session.status} className="atlas-session-status-label atlas-status-line">{STATUS[session.status].label}</span>
          <ContactChip session={session} />
        </div>
        <h3 className="atlas-session-client" title={session.name}>{session.name}</h3>
        <div className="atlas-session-meta">
          <span className="atlas-session-location">
            <PinIcon /> <span className="atlas-session-location-text" title={session.location}>{session.location}</span>
          </span>
        </div>
        {/* Phones: the moderator column folds in under the place. */}
        <div className="atlas-session-with-inline">
          {withText && <span {...withProps}>{withText}</span>}
        </div>
      </div>

      <div className="atlas-session-moderator">
        {withText && <div {...withProps}>{withText}</div>}
      </div>
    </article>
  )
}
