import { seedModerator } from './moderators.js'
import { READ_URL } from '../lib/oneforma/config.ts'

// Seed data for the prototype. Everything here mirrors the Day, Week and Month
// designs: one booked week (Oct 21 - Oct 27, 2024) with Thursday Oct 24 as "today".

export const STATUS = {
  insession: { label: 'In session' },
  booked: { label: 'Booked' },
  completed: { label: 'Completed' },
  cancelled: { label: 'Cancelled' },
}


/** Today in Pacific time (YYYY-MM-DD), what OneForma and the moderators work in. */
const pacificToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

// Real data (a read flow is set) uses the real date. The sample data (demo mode, or no
// flows on localhost) keeps its fixed week, Thursday Oct 24 2024, so it always looks the same.
export const TODAY = READ_URL ? pacificToday() : '2024-10-24'


// moderator: the assigned moderator's email (one moderator per session).
// name: full name (Day view), short: Week view abbreviation, summary: Month summary bar.
// Every booking points at its OneForma participant: participantId is the OneForma
// userId and requestId the recruitment request (see src/data/oneFormaFeedSample.ts).
export const SESSIONS = [
  {
    id: 's6', date: '2024-10-24', start: '08:00', end: '08:45', status: 'completed', moderator: seedModerator(0),
    name: 'Priya Nair', short: 'P. Nair', summary: 'Priya Nair', location: '1488 151st Ave NE',
    participantId: '1836058700010265', requestId: '712000010265',
  },
  {
    id: 's1', date: '2024-10-24', start: '09:00', end: '10:30', status: 'completed', moderator: seedModerator(1),
    name: 'Sarah Jenkins', short: 'S. Jenkins', summary: 'Sarah Jenkins', location: '3024 145th Ave NE',
    participantId: '1836058700010230', requestId: '712000010230',
  },
  {
    id: 's2', date: '2024-10-24', start: '11:00', end: '12:00', status: 'cancelled', moderator: seedModerator(2),
    name: 'Robert Chen', short: 'R. Chen', summary: 'Robert Chen', location: '3412 161st Ave NE',
    participantId: '1836058700010237', requestId: '712000010237',
  },
  {
    id: 's7', date: '2024-10-24', start: '12:15', end: '13:30', status: 'completed', moderator: seedModerator(3),
    name: 'Omar Haddad', short: 'O. Haddad', summary: 'Omar Haddad', location: '17440 NE 42nd St',
    participantId: '1836058700010272', requestId: '712000010272',
  },
  {
    id: 's3', date: '2024-10-24', start: '14:30', end: '16:00', status: 'insession', moderator: seedModerator(4),
    name: 'Evelyn Vance', short: 'E. Vance', summary: 'Evelyn Vance', location: '13802 NE 34th St',
    participantId: '1836058700010244', requestId: '712000010244',
    protocol: 'Assessment', eta: '14:25', timezone: 'PT',
  },
  {
    id: 's4', date: '2024-10-24', start: '16:30', end: '17:45', status: 'booked', moderator: seedModerator(5),
    name: 'Marcus Thorne', short: 'M. Thorne', summary: 'Marcus Thorne', location: '3915 139th Ave NE',
    participantId: '1836058700010251', requestId: '712000010251',
    phone: '(425) 555-0151',
    // Sample contact trace (lib/contact.ts): emailed, then reached by phone.
    contacts: [
      { id: 'c-s4-1', kind: 'email', template: 'booking-confirmed', at: '2024-10-22T17:05:00Z', by: '', byName: 'Dana' },
      { id: 'c-s4-2', kind: 'call', outcome: 'reached', at: '2024-10-23T21:40:00Z', by: '', byName: 'Dana', note: 'Confirmed, gate code 4417' },
    ],
  },
  {
    id: 's8', date: '2024-10-24', start: '17:00', end: '18:00', status: 'booked', moderator: seedModerator(6),
    name: 'Ethan Brooks', short: 'E. Brooks', summary: 'Ethan Brooks', location: '3374 143rd Ave NE',
    participantId: '1836058700010370', requestId: '712000010370',
    phone: '(425) 555-0170',
    contacts: [
      { id: 'c-s8-1', kind: 'email', template: 'booking-confirmed', at: '2024-10-22T18:10:00Z', by: '', byName: 'Dana' },
      { id: 'c-s8-2', kind: 'call', outcome: 'voicemail', at: '2024-10-24T16:15:00Z', by: '', byName: 'Dana' },
    ],
  },
  {
    id: 's5', date: '2024-10-24', start: '19:00', end: '20:30', status: 'booked', moderator: seedModerator(7),
    name: 'Dr. Alana Rivera', short: 'A. Rivera', summary: 'Dr. Rivera', location: '16257 NE 35th St',
    participantId: '1836058700010258', requestId: '712000010258',
    phone: '(425) 555-0158',
  },
  {
    id: 's9', date: '2024-10-25', start: '10:00', end: '11:30', status: 'booked', moderator: seedModerator(8),
    name: 'Lena Fischer', short: 'L. Fischer', summary: 'Lena Fischer', location: '1605 125th Ave NE',
    participantId: '1836058700010279', requestId: '712000010279',
    contacts: [{ id: 'c-s9-1', kind: 'email', template: 'booking-confirmed', at: '2024-10-23T16:00:00Z', by: '', byName: 'Dana' }],
  },
  {
    id: 's10', date: '2024-10-25', start: '14:00', end: '15:00', status: 'booked', moderator: seedModerator(9),
    name: 'June Park', short: 'J. Park', summary: 'June Park', location: '1463 114th Ave NE',
    participantId: '1836058700010293', requestId: '712000010293',
  },
  {
    id: 's11', date: '2024-10-22', start: '13:00', end: '14:00', status: 'completed', moderator: seedModerator(10),
    name: 'Grace Okafor', short: 'G. Okafor', summary: 'Grace Okafor', location: '15319 NE 1st St',
    participantId: '1836058700010307', requestId: '712000010307',
  },
  {
    id: 's12', date: '2024-10-23', start: '10:00', end: '11:00', status: 'completed', moderator: seedModerator(11),
    name: 'Sofia Rossi', short: 'S. Rossi', summary: 'Sofia Rossi', location: '3937 136th Ave NE',
    participantId: '1836058700010377', requestId: '712000010377',
  },
  {
    id: 's13', date: '2024-10-26', start: '09:30', end: '11:00', status: 'booked', moderator: seedModerator(12),
    name: 'Kwame Mensah', short: 'K. Mensah', summary: 'Kwame Mensah', location: '17509 NE 26th St',
    participantId: '1836058700010384', requestId: '712000010384',
  },
]

// Earlier October sessions shown as status chips in the Month view
// (date -> statuses). The Oct 21 - Oct 27 week is driven by SESSIONS below.
export const HISTORY = {
  '2024-10-01': ['completed'],
  '2024-10-02': ['completed', 'cancelled'],
  '2024-10-03': ['completed'],
  '2024-10-05': ['booked'],
  '2024-10-07': ['completed'],
  '2024-10-08': ['completed', 'completed'],
  '2024-10-09': ['completed'],
  '2024-10-11': ['completed'],
  '2024-10-12': ['booked'],
  '2024-10-14': ['completed'],
  '2024-10-16': ['completed', 'completed'],
  '2024-10-17': ['completed'],
  '2024-10-18': ['completed'],
  '2024-10-20': ['booked'],
  '2024-10-21': ['completed'],
  '2024-10-22': ['completed', 'completed'],
  '2024-10-23': ['completed'],
  '2024-10-25': ['booked'],
  '2024-10-27': ['booked'],
  '2024-10-29': ['booked'],
  '2024-10-30': ['booked'],
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
