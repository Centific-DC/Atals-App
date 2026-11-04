// Filter model (ux-behavior-spec.md section 6): picks inside one group are OR
// (they widen), groups are AND (they narrow). Booked + Cancelled + Bimo means
// "booked or cancelled, moderated by Bimo".

import { STATUS } from '../data/schedule.js'
import { UNASSIGNED, firstName } from '../data/moderators.js'
import { HOME_TYPES } from './home.js'
import { CONTACT_FILTER_LABEL, CONTACT_FILTER_TITLE, CONTACT_STATES, contactStateOf } from './contact.ts'

// Status is fixed; Moderator lists Unassigned, then the active moderators (useFilterGroups);
// Home type is the participant's OneForma answer (the session's value comes from useHomeOf).
export const filterGroups = (moderators) => [
  {
    id: 'status',
    label: 'Status',
    options: ['booked', 'insession', 'completed', 'cancelled'].map((id) => ({ id, label: STATUS[id].label })),
  },
  {
    id: 'moderator',
    label: 'Moderator',
    options: [
      { id: UNASSIGNED, label: 'Unassigned', title: 'Bookings waiting for an Admin to assign a moderator' },
      ...moderators.map((m) => ({ id: m.email, label: firstName(m), title: m.displayName })),
    ],
  },
  {
    id: 'home',
    label: 'Home type',
    options: HOME_TYPES.map((t) => ({ id: t.id, label: t.label, title: t.full })),
  },
  {
    // Booked sessions only: has the participant been emailed or called since it was booked?
    id: 'contact',
    label: 'Contact',
    options: CONTACT_STATES.map((id) => ({ id, label: CONTACT_FILTER_LABEL[id], title: CONTACT_FILTER_TITLE[id] })),
  },
]

export const optionLabel = (groups, group, value) =>
  groups.find((g) => g.id === group)?.options.find((o) => o.id === value)?.label ?? value

const byGroup = (picks) => {
  const groups = new Map()
  for (const p of picks) {
    if (!groups.has(p.group)) groups.set(p.group, new Set())
    groups.get(p.group).add(p.value)
  }
  return groups
}

// A session with moderator '' is Unassigned. A Month history chip ({ status }) has no
// moderator at all, so any moderator pick (Unassigned included) leaves it out.
// Contact is worked out from the booking's trace (lib/contact.ts), not stored.
const valueOf = (item, group) => {
  if (group === 'moderator' && item.moderator === '') return UNASSIGNED
  if (group === 'contact') return contactStateOf(item)
  return item[group]
}

// `item` is a session (with `home` resolved to a key), or a Month history chip ({ status })
// with no moderator or home, which any moderator or home pick leaves out.
export function matches(picks, item) {
  for (const [group, values] of byGroup(picks)) {
    if (!values.has(valueOf(item, group))) return false
  }
  return true
}

export const hasGroup = (picks, group) => picks.some((p) => p.group === group)
