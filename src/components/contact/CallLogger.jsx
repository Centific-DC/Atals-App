import { useEffect, useRef, useState } from 'react'
import Collapse from '../../motion/Collapse.jsx'
import { OUTCOMES_FOR, OUTCOME_LABEL, OUTCOME_TONE } from '../../lib/contact.ts'
import { PhoneGlyph } from './ContactChip.jsx'

const OUTCOME_BTN = {
  good: 'atlas-contact-outcome atlas-contact-outcome--good',
  bad: 'atlas-contact-outcome atlas-contact-outcome--bad',
  '': 'atlas-contact-outcome',
}

// Dial + "Log call" + the outcome picker. Tapping the number opens the picker too,
// so logging is one tap after hanging up. `stage` picks the outcomes that make
// sense (Available / Not available before booking, Reached after).
export default function CallLogger({ id, phone, stage, onLog, startOpen = false, label = 'Log call' }) {
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState('')
  const noteRef = useRef(null)

  useEffect(() => {
    if (!startOpen) return undefined
    const raf = requestAnimationFrame(() => noteRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [startOpen])

  const save = (outcome) => {
    onLog(outcome, text)
    setText('')
    setOpen(false)
  }

  return (
    <>
      <div className="atlas-contact-actions">
        {phone && (
          <a className="atlas-contact-dial atlas-raised-sm" href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={() => setOpen(true)}>
            <PhoneGlyph /> <span className="atlas-contact-dial-number">{phone}</span>
          </a>
        )}
        <button
          type="button"
          className={`atlas-btn-ghost atlas-contact-log-btn${open ? ' is-active' : ''}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
      </div>
      <Collapse open={open} id={id}>
        <div className="atlas-contact-picker atlas-well-sm">
          <input
            ref={noteRef}
            className="atlas-input atlas-contact-note"
            placeholder={stage === 'availability' ? 'Note (optional): free weekday evenings' : 'Note (optional): asked for a call after 5 PM'}
            aria-label="Call note"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
          />
          <div className="atlas-contact-outcomes" role="group" aria-label="How did the call go?">
            {OUTCOMES_FOR[stage].map((o) => (
              <button key={o} type="button" className={OUTCOME_BTN[OUTCOME_TONE[o]]} onClick={() => save(o)}>{OUTCOME_LABEL[o]}</button>
            ))}
          </div>
        </div>
      </Collapse>
    </>
  )
}
