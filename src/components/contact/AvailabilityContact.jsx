import { AVAIL_CLASS, OUTCOME_LABEL, OUTCOME_TONE, availabilityCall, newestFirst } from '../../lib/contact.ts'
import { useToast } from '../../motion/Toast.jsx'
import { useRole } from '../../state/RoleContext.jsx'
import { useSchedule } from '../../state/ScheduleContext.jsx'
import CallLogger from './CallLogger.jsx'
import ContactLog from './ContactLog.jsx'

const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "Available · Nov 3, 4:10 PM · Dana": the latest availability call, or null. */
export function AvailabilityLine({ participantId }) {
  const { participantContacts } = useSchedule()
  const call = availabilityCall(participantContacts(participantId))
  if (!call?.outcome) return null
  return (
    <span key={call.id} className={`${AVAIL_CLASS[OUTCOME_TONE[call.outcome]]} atlas-status-line`} title={call.note || undefined}>
      {OUTCOME_LABEL[call.outcome]} · {when(call.at)}{call.byName ? ` · ${call.byName}` : ''}
    </span>
  )
}

// Before booking: call the participant to check they're available, log how it went.
// Shown on the map's participant card and in New Booking once someone is picked.
export default function AvailabilityContact({ participant, compact = false }) {
  const { participantContacts, logParticipantContact } = useSchedule()
  const { canBook } = useRole()
  const toast = useToast()
  if (!canBook || !participant) return null
  const entries = newestFirst(participantContacts(participant.id))

  const save = (outcome, note) => {
    const undo = logParticipantContact(participant.id, { outcome, note })
    toast(`Availability call logged: ${OUTCOME_LABEL[outcome]}`, 'info', { label: 'Undo', onAction: undo })
  }

  return (
    <section className={`atlas-contact atlas-contact--prebook${compact ? ' atlas-contact--compact' : ''}`} aria-label="Availability calls">
      <div className="atlas-contact-head">
        <span className="atlas-eyebrow">AVAILABILITY CALL</span>
        <AvailabilityLine participantId={participant.id} />
      </div>
      <CallLogger id={`avail-${participant.id}`} phone={participant.phone} stage="availability" onLog={save} />
      {entries.length > 0 && <ContactLog entries={entries.slice(0, compact ? 2 : 5)} />}
    </section>
  )
}
