import { CHIP_CLASS, CONTACT_LABEL, contactSummary, contactTitle } from '../../lib/contact.ts'
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

// Contact standing of a booked participant: a mail and a phone mark, each lit once
// done since the booking (or its latest move), plus a word. Schedulers and Admins
// only; nothing shows once the session starts. `compact` drops the word (Week grid).
export default function ContactChip({ session, compact = false }) {
  const { canBook } = useRole()
  const sum = contactSummary(session)
  if (!canBook || !sum) return null
  const label = sum.stale ? 'Re-confirm' : CONTACT_LABEL[sum.state]
  return (
    <span
      key={`${sum.state}${sum.stale ? '-stale' : ''}`}
      className={`${CHIP_CLASS[sum.state]}${compact ? ' atlas-contact-chip--compact' : ''} atlas-status-line`}
      title={contactTitle(sum)}
      aria-label={`Contact: ${label}. ${contactTitle(sum)}`}
    >
      <span className={`atlas-contact-mark${sum.emailed ? ' is-done' : ''}`}><MailGlyph /></span>
      <span className={`atlas-contact-mark atlas-contact-mark--call${sum.called ? ' is-done' : ''}`}><PhoneGlyph /></span>
      {!compact && <span className="atlas-contact-chip-label">{label}</span>}
    </span>
  )
}
