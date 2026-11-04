import { MS } from '../../motion/motion.js'
import { OUTCOME_LABEL, STAGE_LABEL, TEMPLATE_LABEL, entryClass, stageOf } from '../../lib/contact.ts'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { MailGlyph, PhoneGlyph } from './ContactChip.jsx'

const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function title(c) {
  if (c.kind === 'email') return c.source === 'flow' ? 'Email sent' : `${TEMPLATE_LABEL[c.template] ?? 'Booking'} email`
  if (c.source === 'checklist') return 'Moderator called (checklist)'
  return `${STAGE_LABEL[stageOf(c)]} call · ${OUTCOME_LABEL[c.outcome]}`
}

// Every email and call, newest first, with when and who.
export default function ContactLog({ entries, empty = 'No emails or calls yet.' }) {
  const { fullName } = useModerators()
  if (!entries.length) return <div className="atlas-contact-empty">{empty}</div>
  const who = (c) => c.byName || (c.by ? fullName(c.by) : '')
  return (
    <ol className="atlas-contact-log">
      {entries.map((c, i) => (
        <li key={c.id} className={`${entryClass(c)} atlas-row-in`} style={{ animationDelay: `${Math.min(i, 8) * MS.rowStep}ms` }}>
          <span className="atlas-contact-entry-icon">{c.kind === 'email' ? <MailGlyph /> : <PhoneGlyph />}</span>
          <div className="atlas-contact-entry-text">
            <span className="atlas-contact-entry-title">{title(c)}</span>
            {c.note && <span className="atlas-contact-entry-note">“{c.note}”</span>}
            <span className="atlas-contact-entry-meta">{when(c.at)}{who(c) ? ` · ${who(c)}` : ''}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}
