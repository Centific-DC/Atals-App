import { CHIP_CLASS, CONTACT_LABEL, STAGES, STAGE_LABEL, contactSummary, contactTitle } from '../../lib/contact.ts'
import { useRole } from '../../state/RoleContext.jsx'

const Glyph = ({ children }) => (
  <svg className="atlas-contact-glyph" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const MailGlyph = () => (
  <Glyph><rect x="2" y="3.5" width="12" height="9" rx="1.6" /><path d="M2.5 4.5 8 8.6l5.5-4.1" /></Glyph>
)

export const PhoneGlyph = () => (
  <Glyph><path d="M5.6 2.5H3.9a1.4 1.4 0 0 0-1.4 1.5 10.4 10.4 0 0 0 9.5 9.5 1.4 1.4 0 0 0 1.5-1.4v-1.7l-2.6-1.1-1.3 1.3a7 7 0 0 1-3.1-3.1l1.3-1.3z" /></Glyph>
)

// Lookup map: one class per step state, never composed at runtime.
const SEG_CLASS = {
  done: 'atlas-contact-seg is-done',
  tried: 'atlas-contact-seg is-tried',
  none: 'atlas-contact-seg',
}

// Contact standing of a booked participant: three short segments for the three
// steps (availability, confirmation, moderator call), filled when done and half-lit
// when tried, plus one word for where it stands. Schedulers and Admins only;
// nothing shows once the session starts. `compact` drops the word (Week grid).
export default function ContactChip({ session, compact = false }) {
  const { canBook } = useRole()
  const sum = contactSummary(session)
  if (!canBook || !sum) return null
  const label = sum.stale && sum.state === 'needs' ? 'Re-confirm' : CONTACT_LABEL[sum.state]
  const title = contactTitle(sum)
  return (
    <span
      key={`${sum.state}${sum.stale ? '-stale' : ''}`}
      className={`${CHIP_CLASS[sum.state]}${compact ? ' atlas-contact-chip--compact' : ''} atlas-status-line`}
      title={title}
      aria-label={`Contact: ${label}. ${title}`}
    >
      <span className="atlas-contact-segs" aria-hidden="true">
        {STAGES.map((st) => <span key={st} className={SEG_CLASS[sum.steps[st]]} title={STAGE_LABEL[st]} />)}
      </span>
      {!compact && <span className="atlas-contact-chip-label">{label}</span>}
    </span>
  )
}
