import AvailabilityContact, { AvailabilityLine } from '../contact/AvailabilityContact.jsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TODAY } from '../../data/schedule.js'
import { firstName } from '../../data/moderators.js'
import { useModerators } from '../../state/ModeratorContext.jsx'
import { HQ, boxAround, participantMiles } from '../../lib/geo.js'
import { driveTimesFrom, etaFrom, formatDrive, routeBetween } from '../../lib/routing.js'
import { matches } from '../../lib/filters.js'
import { homeKey, homeLabel } from '../../lib/home.js'
import { NEARBY_ASK, NEARBY_COUNT, closestTo, milesSaved, nearbyTo, nextSlot } from '../../lib/nearby.js'
import { MAX_SESSIONS_PER_MODERATOR_PER_DAY } from '../../lib/bookings.js'
import { useFilteredPicks } from '../../state/FilterContext.jsx'
import { clock12, longDayLabel, timeRange } from '../../lib/dates.js'
import { prefersReducedMotion } from '../../motion/motion.js'
import usePresence from '../../motion/usePresence.js'
import useFocusTrap, { returnFocus } from '../../motion/useFocusTrap.js'
import { useToast } from '../../motion/Toast.jsx'
import { MAP_LAYERS, useMap } from '../../state/MapContext.jsx'
import { useParticipants, useQueue } from '../../state/ParticipantContext.jsx'
import { useRole } from '../../state/RoleContext.jsx'
import { useSchedule } from '../../state/ScheduleContext.jsx'
import { useAuth } from '../../state/AuthContext.tsx'
import FilterBar from '../filter/FilterBar.jsx'
import FilterMenu from '../filter/FilterMenu.jsx'
import TourButton from '../../tour/TourButton.jsx'
import { DateRangePicker, MapDateBar } from './MapDateRange.jsx'
import MapBookingSheet from './MapBookingSheet.jsx'
import useMapQueue from './useMapQueue.js'

const SOURCE = '[data-map-source]'
const OPEN_BUTTON = '.atlas-map-tile'
const CLOSE_MS = 300 // matches .atlas-map[data-state="closing"]

// Same tiles as Twilight: MapLibre with OpenFreeMap (OpenMapTiles, OpenStreetMap data).
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
// Used when the tiles can't be reached, so the dots and routes still work.
const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'atlas-bg', type: 'background', paint: { 'background-color': '#151719' } }],
}
const START_MILES = 1 // the map opens showing about a mile around HQ
const ROUTE_MS = 700 // line draw (spec "reveal")
const CAMERA_MS = 900

const STATUS_TEXT = { open: 'Open to book', booked: 'Booked', insession: 'In session', completed: 'Completed' }

// Clip the full-screen map down to the mini route map it grows out of.
function sourceInset() {
  const el = document.querySelector(SOURCE)
  if (!el) return 'inset(0 round 0px)'
  const r = el.getBoundingClientRect()
  const w = window.innerWidth
  const h = window.innerHeight
  return `inset(${r.top}px ${w - r.right}px ${h - r.bottom}px ${r.left}px round 16px)`
}

// Full-screen live map. It expands out of the Day view's route map (450ms
// --ease-slide) and shrinks back into it on close (300ms --ease-exit).
export default function MapView({ open, onClose }) {
  const { mounted, state, onAnimationEnd } = usePresence(open, CLOSE_MS)
  const [from, setFrom] = useState('inset(0 round 0px)')
  const ref = useRef(null)

  // Measure the source just before each open and close, so the map grows from
  // (and returns to) wherever the route map sits right now.
  useLayoutEffect(() => { if (open || state === 'closing') setFrom(sourceInset()) }, [open, state])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      // Escape closes the map unless a menu or sheet on top of it takes it first.
      if (e.key === 'Escape' && !document.querySelector('.atlas-menu, .atlas-sheet-layer, .atlas-filter-panel')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const wasOpen = useRef(open)
  useEffect(() => {
    if (open) { wasOpen.current = true; return }
    if (wasOpen.current) { wasOpen.current = false; returnFocus(document.querySelector(OPEN_BUTTON)) }
  }, [open])

  useFocusTrap(ref, open && mounted, { autoFocus: false })
  // Start on "Return to schedule", the way out, once the map is up.
  useEffect(() => {
    if (!open || !mounted) return undefined
    const raf = requestAnimationFrame(() => ref.current?.querySelector('.atlas-map-back')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [open, mounted])

  if (!mounted) return null
  return (
    <div
      ref={ref}
      className="atlas-map"
      data-state={state}
      role="dialog"
      aria-modal="true"
      aria-label="Live map"
      style={{ '--atlas-map-from': from }}
      onAnimationEnd={onAnimationEnd}
    >
      <LiveMap onClose={onClose} />
    </div>
  )
}

// Room the side panels take, so HQ and routes land in the open part of the map.
// `route` also keeps clear of the info tile on the right.
function mapPadding(route = false) {
  if (window.innerWidth < 640) return { top: 80, bottom: window.innerHeight * (route ? 0.5 : 0.48), left: 30, right: 30 }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return { top: 8 * rem, bottom: 5 * rem, left: (route ? 33 : 27) * rem, right: (route ? 33 : 8) * rem }
}

const easeOut = (t) => 1 - (1 - t) ** 4

// "Book nearby next" timing: the ripple leads, then each road line draws out
// (nearest first) and its dot pops in on arrival. Matches .atlas-map-dot.is-suggested
// in index.css.
const NEARBY_LEAD = 200
const NEARBY_STEP = 120
const NEARBY_DRAW = 700

const lineOf = (pts) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } })
const EMPTY_LINE = lineOf([])

function addRouteLayers(map) {
  if (map.getSource('atlas-route')) return
  map.addSource('atlas-route', { type: 'geojson', data: EMPTY_LINE })
  map.addLayer({
    id: 'atlas-route-glow',
    type: 'line',
    source: 'atlas-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#00E5FF', 'line-width': 12, 'line-opacity': 0.22, 'line-blur': 6 },
  })
  map.addLayer({
    id: 'atlas-route-line',
    type: 'line',
    source: 'atlas-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#00E5FF', 'line-width': 4 },
  })
  // While the road route loads: a faint dashed straight line to the destination.
  map.addSource('atlas-route-pending', { type: 'geojson', data: EMPTY_LINE })
  map.addLayer({
    id: 'atlas-route-pending',
    type: 'line',
    source: 'atlas-route-pending',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#00E5FF', 'line-width': 2, 'line-opacity': 0.45, 'line-dasharray': [1, 2.5] },
  }, 'atlas-route-glow')
  // "Book nearby next": faint dashed lines from the booked place to each suggestion.
  map.addSource('atlas-nearby', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'atlas-nearby',
    type: 'line',
    source: 'atlas-nearby',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#FCD34D', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [1.5, 2.5] },
  }, 'atlas-route-pending')
}

// One MapLibre map for the life of the Map view.
function useLibreMap(containerRef) {
  const [map, setMap] = useState(null)
  const [baseZoom, setBaseZoom] = useState(null)
  const [tiles, setTiles] = useState('loading') // loading | ok | offline

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const start = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      center: [HQ.lng, HQ.lat],
      zoom: 14,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: prefersReducedMotion() ? 0 : 200,
    })
    start.touchZoomRotate.disableRotation()
    start.keyboard.disableRotation()

    let fellBack = false
    const fallBack = () => {
      if (fellBack || start.isStyleLoaded()) return
      fellBack = true
      setTiles('offline')
      start.setStyle(FALLBACK_STYLE)
    }
    const timer = setTimeout(fallBack, 8000)
    start.on('error', () => { if (!start.isStyleLoaded()) fallBack() })
    start.on('style.load', () => {
      clearTimeout(timer)
      if (!fellBack) setTiles('ok')
      addRouteLayers(start)
    })

    const fit = () => {
      const cam = start.cameraForBounds(boxAround(HQ, START_MILES), { padding: mapPadding() })
      if (cam) {
        start.jumpTo(cam)
        setBaseZoom(cam.zoom)
      }
    }
    fit()
    setMap(start)
    return () => { clearTimeout(timer); start.remove(); setMap(null) }
  }, [containerRef])

  return { map, baseZoom, tiles }
}

// Which dots show: everyone inside the part of the map on screen, so panning or
// zooming out brings more of the queue in. Updated when the map comes to rest.
function useViewBounds(map) {
  const [bounds, setBounds] = useState(null)
  useEffect(() => {
    if (!map) return undefined
    const update = () => setBounds(map.getBounds())
    update()
    map.on('moveend', update)
    return () => { map.off('moveend', update) }
  }, [map])
  return useCallback((p) => !bounds || bounds.contains([p.lng, p.lat]), [bounds])
}

// MapLibre markers whose contents React renders through portals.
function useMarkerHosts(map, items, className) {
  const hosts = useRef(new Map())
  const [, bump] = useState(0)
  useEffect(() => {
    if (!map) return
    const seen = new Set()
    let changed = false
    for (const it of items) {
      seen.add(it.id)
      const host = hosts.current.get(it.id)
      if (host) {
        host.marker.setLngLat([it.lng, it.lat])
        continue
      }
      const el = document.createElement('div')
      el.className = className
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([it.lng, it.lat]).addTo(map)
      hosts.current.set(it.id, { el, marker })
      changed = true
    }
    for (const [id, host] of hosts.current) {
      if (!seen.has(id)) { host.marker.remove(); hosts.current.delete(id); changed = true }
    }
    if (changed) bump((n) => n + 1)
  }, [map, items, className])
  useEffect(() => () => {
    for (const host of hosts.current.values()) host.marker.remove()
    hosts.current.clear()
  }, [map])
  return hosts.current
}

// Where a moderator is heading now: their live session, else their next one today.
function moderatorTarget(sessions, email) {
  const today = sessions.filter((s) => s.moderator === email && s.date === TODAY && s.participantId)
  return today.find((s) => s.status === 'insession')
    ?? today.filter((s) => s.status === 'booked').sort((a, b) => a.start.localeCompare(b.start))[0]
    ?? null
}

function LiveMap({ onClose }) {
  const containerRef = useRef(null)
  const { map, baseZoom, tiles } = useLibreMap(containerRef)
  const inView = useViewBounds(map)
  const { layers: mapLayers, focus, focusParticipant, selected, setSelected, clearFocus } = useMap()
  const queue = useQueue()
  const { sessions, removeSession, openBooking, setNote } = useSchedule()
  const { name: moderatorName } = useModerators()
  const toast = useToast()
  // { to, label, trip: null | { miles, minutes, eta, estimated, reason } }
  const [route, setRoute] = useState(null)
  const anim = useRef(0)
  // New booking over the map: { id, preset } (preset: a suggested slot), and the
  // Book button to return focus to.
  const [booking, setBooking] = useState(null)
  const bookTrigger = useRef(null)
  const request = useRef(null)

  const { onLayers, shown, visible } = useMapQueue()
  // People whose address has no map point yet stay in the list but get no pin.
  const located = useMemo(() => queue.filter((p) => p.distMi != null), [queue])
  const hosts = useMarkerHosts(map, located, 'atlas-map-pin')
  const hqItems = useMemo(() => [{ id: 'hq', lng: HQ.lng, lat: HQ.lat }], [])
  const hqHost = useMarkerHosts(map, hqItems, 'atlas-map-pin atlas-map-pin--hq')
  const routeItems = useMemo(() => (route ? [{ id: 'route', lng: route.to.lng, lat: route.to.lat }] : []), [route])
  const routeHost = useMarkerHosts(map, routeItems, 'atlas-map-pin atlas-map-pin--label')

  // Points every fit also keeps in view: the "Book nearby next" suggestions.
  const alsoFit = useRef([])
  const fit = useCallback((coords) => {
    const all = [...coords, ...alsoFit.current]
    const lngs = all.map((c) => c[0])
    const lats = all.map((c) => c[1])
    // Never closer than the opening view: picking someone zooms out to fit the trip.
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: mapPadding(true),
      maxZoom: baseZoom ?? 14,
      duration: prefersReducedMotion() ? 0 : CAMERA_MS,
      easing: easeOut,
    })
  }, [map, baseZoom])

  // Draw the road route from HQ: zoom out to the trip right away with a dashed
  // placeholder, then trace the real road path (700ms) once routing answers.
  const drawRoute = useCallback((to, label) => {
    if (!map) return
    cancelAnimationFrame(anim.current)
    request.current?.abort()
    const ctrl = new AbortController()
    request.current = ctrl
    const line = map.getSource('atlas-route')
    const pending = map.getSource('atlas-route-pending')
    const straight = [[HQ.lng, HQ.lat], [to.lng, to.lat]]
    setRoute({ to, label, trip: null })
    line?.setData(EMPTY_LINE)
    pending?.setData(lineOf(straight))
    fit(straight)

    routeBetween(HQ, to, ctrl.signal).then((trip) => {
      if (ctrl.signal.aborted) return
      const eta = etaFrom(trip.minutes)
      setRoute({ to, label, trip: { ...trip, eta } })
      pending?.setData(EMPTY_LINE)
      // An estimate is drawn dashed so it never passes for a real road path.
      if (map.getLayer('atlas-route-line')) {
        map.setPaintProperty('atlas-route-line', 'line-dasharray', trip.estimated ? [2, 1.5] : undefined)
        map.setPaintProperty('atlas-route-glow', 'line-opacity', trip.estimated ? 0 : 0.22)
      }
      fit(trip.coords)
      const pts = trip.coords
      if (!line) return
      if (prefersReducedMotion()) { line.setData(lineOf(pts)); return }
      const t0 = performance.now() + 120
      const step = (now) => {
        const t = Math.min(1, Math.max(0, (now - t0) / ROUTE_MS))
        const n = Math.max(2, Math.ceil(easeOut(t) * pts.length))
        line.setData(lineOf(pts.slice(0, n)))
        if (t < 1) anim.current = requestAnimationFrame(step)
      }
      anim.current = requestAnimationFrame(step)
    }).catch(() => { /* superseded by a newer route */ })
  }, [map, fit])

  const clearRoute = useCallback(() => {
    cancelAnimationFrame(anim.current)
    request.current?.abort()
    map?.getSource('atlas-route')?.setData(EMPTY_LINE)
    map?.getSource('atlas-route-pending')?.setData(EMPTY_LINE)
    setRoute(null)
  }, [map])

  // Travel to whatever was picked: a participant, or where a moderator is heading.
  useEffect(() => {
    if (!map || !focus) return
    const go = () => {
      if (focus.kind === 'participant') {
        const p = queue.find((q) => q.id === focus.id)
        if (!p) return
        drawRoute(p, p.name.toUpperCase())
        return
      }
      const who = moderatorName(focus.id)
      const s = moderatorTarget(sessions, focus.id)
      const p = s && queue.find((q) => q.id === s.participantId)
      if (!p) {
        toast(`${who} has nothing else booked today.`)
        return
      }
      setSelected(p.id)
      drawRoute(p, `${who.toUpperCase()} · ${s.status === 'insession' ? 'ON SITE' : `DUE ${clock12(s.start)}`}`)
    }
    if (map.isStyleLoaded()) go()
    else map.once('style.load', go)
  }, [map, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelAnimationFrame(anim.current); request.current?.abort() }, [])

  const recenter = () => {
    if (!map || baseZoom == null) return
    clearRoute()
    clearFocus()
    map.flyTo({ center: [HQ.lng, HQ.lat], zoom: baseZoom, duration: prefersReducedMotion() ? 0 : CAMERA_MS, essential: true })
  }
  const zoomBy = (d) => map?.easeTo({ zoom: map.getZoom() + d, duration: prefersReducedMotion() ? 0 : 300 })

  const inReach = shown.filter((p) => p.distMi != null && inView(p))
  const selectedItem = queue.find((p) => p.id === selected) ?? null
  const bookingItem = queue.find((p) => p.id === booking?.id) ?? null

  // "Book nearby next": the picked person (the anchor, open or booked) lights up the
  // closest people still open to book, within the Home type filter and Range from HQ.
  // From a booked place each comes with a time right after it.
  const { canBook } = useRole()
  const picks = useFilteredPicks()
  const homePicks = useMemo(() => picks.filter((p) => p.group === 'home'), [picks])
  const anchor = canBook && selectedItem?.lat != null
    && (selectedItem.status === 'open' || (selectedItem.status === 'booked' && selectedItem.session)) ? selectedItem : null
  // Ranked by road: the 12 nearest in a straight line go to routing in ONE table
  // request, the 5 shortest drives win, then their 5 road routes are fetched (cached,
  // dropped on a new anchor). Routing down: the straight-line 5, drawn dashed.
  const anchorKey = anchor ? `${anchor.id}@${anchor.lat},${anchor.lng}` : ''
  const shortlist = useMemo(() => {
    if (!anchor) return []
    const open = queue.filter((p) => p.status === 'open' && matches(homePicks, { home: homeKey(p.home?.type) }))
    return closestTo(anchor, open, NEARBY_ASK)
  }, [anchorKey, queue, homePicks]) // eslint-disable-line react-hooks/exhaustive-deps
  const shortKey = shortlist.map((r) => r.participant.id).join(',')
  // { key, loading, items: [{ participant, miles, minutes, coords, estimated }] }
  const [road, setRoad] = useState(null)
  useEffect(() => {
    if (!anchor || !shortlist.length) { setRoad(anchor ? { key: anchorKey, loading: false, items: [] } : null); return undefined }
    const key = `${anchorKey}|${shortKey}`
    const ctrl = new AbortController()
    setRoad({ key, loading: true, items: [] })
    const from = { lat: anchor.lat, lng: anchor.lng }
    ;(async () => {
      const times = await driveTimesFrom(from, shortlist.map((r) => r.participant), ctrl.signal)
      const picked = times
        ? shortlist
          .map((r, i) => times[i] && { participant: r.participant, miles: times[i].miles, minutes: times[i].minutes, estimated: false })
          .filter(Boolean)
          .sort((x, y) => x.minutes - y.minutes || x.miles - y.miles)
          .slice(0, NEARBY_COUNT)
        : nearbyTo(from, shortlist.map((r) => r.participant)).map((r) => ({ participant: r.participant, miles: r.miles, minutes: r.minutes, estimated: true }))
      const routes = times
        ? await Promise.all(picked.map((r) => routeBetween(from, r.participant, ctrl.signal).catch(() => null)))
        : picked.map(() => null)
      if (ctrl.signal.aborted) return
      setRoad({
        key,
        loading: false,
        items: picked.map((r, i) => ({
          ...r,
          coords: routes[i]?.estimated === false ? routes[i].coords : [[from.lng, from.lat], [r.participant.lng, r.participant.lat]],
          estimated: r.estimated || routes[i]?.estimated !== false,
        })),
      })
    })().catch(() => { /* a newer anchor took over */ })
    return () => ctrl.abort()
  }, [anchorKey, shortKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const roadReady = Boolean(anchor && road && !road.loading && road.key.startsWith(anchorKey))
  const nearby = useMemo(() => (roadReady ? road.items.map((r) => ({
    ...r,
    slot: anchor.session ? nextSlot(anchor.session, r.minutes, sessions) : null,
    saved: milesSaved(anchor, r.participant),
  })) : []), [roadReady, road, anchor, sessions])
  const rankOf = useMemo(() => new Map(nearby.map((r, i) => [r.participant.id, i + 1])), [nearby])

  // Keep the anchor and its suggestions in any route fit, and bring them into view
  // now only if one is off screen (so picking a dot never jumps the map needlessly).
  const nearbyKey = roadReady ? road.key : ''
  useEffect(() => {
    alsoFit.current = nearby.map((r) => [r.participant.lng, r.participant.lat])
    if (!map || !anchor || !nearby.length) return
    const bounds = map.getBounds()
    const off = [anchor, ...nearby.map((r) => r.participant)].some((p) => !bounds.contains([p.lng, p.lat]))
    if (off) fit([[anchor.lng, anchor.lat]])
  }, [map, nearbyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each line draws out from the anchor along its road, nearest first, NEARBY_STEP
  // apart; its numbered dot pops in as the line arrives (index.css). Estimates are
  // dashed. Reduced motion: drawn at once.
  useEffect(() => {
    const src = map?.getSource('atlas-nearby')
    if (!src) return undefined
    const dashed = nearby.some((r) => r.estimated)
    if (map.getLayer('atlas-nearby')) {
      map.setPaintProperty('atlas-nearby', 'line-dasharray', dashed ? [1.5, 2.5] : undefined)
      map.setPaintProperty('atlas-nearby', 'line-opacity', dashed ? 0.5 : 0.7)
    }
    const lines = (t) => ({
      type: 'FeatureCollection',
      features: nearby.map((r, i) => {
        const k = easeOut(Math.min(1, Math.max(0, (t - NEARBY_LEAD - i * NEARBY_STEP) / NEARBY_DRAW)))
        const pts = r.coords
        if (pts.length === 2) {
          const [[x0, y0], [x1, y1]] = pts
          return lineOf([[x0, y0], [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]])
        }
        return lineOf(pts.slice(0, Math.max(k > 0 ? 2 : 1, Math.ceil(k * pts.length))))
      }),
    })
    if (!nearby.length || prefersReducedMotion()) { src.setData(lines(Infinity)); return undefined }
    let raf = 0
    const t0 = performance.now()
    const end = NEARBY_LEAD + nearby.length * NEARBY_STEP + NEARBY_DRAW
    const step = (now) => {
      src.setData(lines(now - t0))
      if (now - t0 < end) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [map, nearbyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc, or a click on empty map, puts the picked dot (and its suggestions) away.
  useEffect(() => {
    if (!map || !selected) return undefined
    const clear = () => setSelected(null)
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]:not(.atlas-map)')) clear() }
    map.on('click', clear)
    document.addEventListener('keydown', onKey)
    return () => { map.off('click', clear); document.removeEventListener('keydown', onKey) }
  }, [map, selected, setSelected])

  const closeBooking = useCallback(() => {
    setBooking(null)
    returnFocus(bookTrigger.current)
  }, [])
  // Saved: stay on the map with the person still picked. Their dot turns Booked,
  // and the tile's Book button becomes View booking, which takes focus.
  // Booked from the map: open its details, like the Day view does, so the
  // "Send emails" buttons and Undo are right there. The map stays behind it.
  // The new booking becomes the anchor, so its own nearby suggestions follow.
  const booked = useCallback((created, summary) => {
    setBooking(null)
    if (created.participantId) setSelected(created.participantId)
    openBooking(created.id)
    setNote({ id: created.id, text: `Booked ${summary}`, undo: () => removeSession(created.id), closes: true })
  }, [openBooking, setNote, removeSession, setSelected])

  return (
    <>
      <div ref={containerRef} className="atlas-map-canvas" data-tour="map-canvas" aria-label="Map of participants around Centific HQ" />

      {hqHost.get('hq') && createPortal(
        <div className="atlas-map-hq" title={HQ.address}>
          <span className="atlas-map-hq-mark" aria-hidden="true" />
          <span className="atlas-map-hq-label">CENTIFIC HQ</span>
        </div>,
        hqHost.get('hq').el,
      )}
      {route && routeHost.get('route') && createPortal(
        <span key={route.label} className={`atlas-map-marker atlas-map-marker--destination${route.to.lat < HQ.lat ? ' atlas-map-marker--below' : ''}`}>
          {route.label}
          <span key={route.trip ? 'trip' : 'wait'} className="atlas-map-marker-eta atlas-status-line">
            {route.trip ? ` · ETA ${route.trip.eta} · ${formatDrive(route.trip.minutes).toUpperCase()}` : ' · ROUTING…'}
          </span>
        </span>,
        routeHost.get('route').el,
      )}

      {queue.map((p) => {
        const host = hosts.get(p.id)
        if (!host) return null
        const on = p.distMi != null && visible(p) && (inView(p) || p.id === selected)
        return createPortal(
          <ParticipantDot
            participant={p}
            revealed={on || rankOf.has(p.id)}
            selected={p.id === selected}
            rank={rankOf.get(p.id)}
            anchorKey={p.id === anchor?.id ? anchor.id : null}
            dimmed={Boolean(anchor) && p.status === 'open' && !rankOf.has(p.id)}
            onPick={() => setSelected(p.id === selected ? null : p.id)}
          />,
          host.el,
        )
      })}

      <QueuePanel shown={shown} total={onLayers.length} onClose={onClose} />

      <MapDateBar map={map} booked={shown.filter((p) => p.session).length} />

      <div className="atlas-map-tools atlas-map-chrome">
        <TourButton />
        <FilterMenu before={<DateRangePicker />} beforeLabel="Booking dates" />
      </div>

      {selectedItem && (
        <InfoTile
          participant={selectedItem}
          trip={route?.to.id === selectedItem.id ? route.trip ?? 'loading' : null}
          onRoute={() => focusParticipant(selectedItem.id)}
          onDismiss={() => setSelected(null)}
          onBook={(e) => { bookTrigger.current = e.currentTarget; setBooking({ id: selectedItem.id }) }}
          nearby={anchor ? nearby : null}
          nearbyLoading={Boolean(anchor) && !roadReady}
          onBookNearby={(e, id, preset) => { bookTrigger.current = e.currentTarget; setBooking({ id, preset }) }}
          onPickNearby={(id) => setSelected(id)}
        />
      )}

      <MapBookingSheet
        participant={bookingItem}
        preset={booking?.preset ?? null}
        trip={bookingItem && route?.to.id === bookingItem.id ? route.trip ?? 'loading' : null}
        onClose={closeBooking}
        onBooked={booked}
      />

      <div className={`atlas-map-zoom-status${inReach.length ? ' is-on' : ''}`} role="status" aria-live="polite">
        <span key={`${inReach.length}-${shown.length}`} className="atlas-eyebrow atlas-map-zoom-status-text atlas-status-line">
          {inReach.length} OF {shown.length} IN VIEW
          {inReach.length < shown.length ? ' · MOVE OR ZOOM OUT FOR MORE' : ''}
        </span>
      </div>
      {tiles === 'offline' && (
        <div className="atlas-map-offline" role="status">Map tiles couldn’t load, so streets are hidden. Dots and routes still work.</div>
      )}

      <div className="atlas-map-zoom-controls">
        <button type="button" className="atlas-map-zoom-btn" aria-label="Zoom in" onClick={() => zoomBy(1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button type="button" className="atlas-map-zoom-btn" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button type="button" className="atlas-map-zoom-btn" aria-label="Back to Centific HQ" title="Back to Centific HQ" onClick={recenter}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
        </button>
      </div>
    </>
  )
}

function ParticipantDot({ participant: p, revealed, selected, rank, anchorKey, dimmed, onPick }) {
  const when = p.session ? `${p.session.date === TODAY ? 'Today' : longDayLabel(p.session.date)} ${clock12(p.session.start)}` : null
  return (
    <button
      type="button"
      className={`atlas-map-dot atlas-map-dot--${p.status}${revealed ? ' is-revealed' : ''}${selected ? ' is-selected' : ''}${rank ? ' is-suggested' : ''}${dimmed ? ' is-dimmed' : ''}`}
      tabIndex={revealed ? 0 : -1}
      aria-hidden={!revealed}
      aria-pressed={selected}
      aria-label={`${rank ? `Suggestion ${rank}: ` : ''}${p.name}, ${STATUS_TEXT[p.status]}${when ? `, ${when}` : ''}, ${participantMiles(p)} from HQ`}
      style={rank ? { '--rank': rank } : undefined}
      onClick={(e) => { e.stopPropagation(); onPick() }}
    >
      {anchorKey && <span key={anchorKey} className="atlas-map-dot-ripple" aria-hidden="true" />}
      <span className="atlas-map-dot-core" />
      {rank && <span className="atlas-map-dot-rank" aria-hidden="true">{rank}</span>}
      <span className="atlas-map-dot-label" aria-hidden="true">
        {p.name.toUpperCase()} · <span className="atlas-map-dot-status">{STATUS_TEXT[p.status].toUpperCase()}</span>
      </span>
    </button>
  )
}

// Spec section 7: the four-dot chasing glyph and a running seconds count.
function useSeconds(running, startedAt) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    const tick = () => setSecs(Math.floor((performance.now() - startedAt) / 1000))
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [running, startedAt])
  return secs
}

// No-break space inside the time, so a wrapped status line never leaves "AM" on its own.
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '\u00a0') : '')

function SyncLine() {
  const { sync, fetchedAt, participants, stats, hasData, syncNow, usingSample } = useParticipants()
  const { isAdmin } = useRole()
  const busy = sync.state === 'loading'
  const secs = useSeconds(busy, sync.startedAt)

  let text
  if (busy) text = hasData ? `Showing the ${timeOf(fetchedAt)} copy · refreshing` : 'Loading the OneForma queue'
  else if (sync.state === 'failed') text = hasData ? `Refresh failed · showing the ${timeOf(fetchedAt)} copy` : 'Couldn’t reach OneForma'
  else text = `${participants.filter((p) => p.active).length} endorsed · ${stats?.removed ?? 0} removed · ${timeOf(fetchedAt)}`

  return (
    <div className="atlas-queue-sync">
      <div
        className={`atlas-queue-sync-line is-${sync.state}`}
        role="status"
        aria-live="polite"
        title={sync.state === 'failed' ? sync.error : usingSample ? 'Sample OneForma messages until the read flow is connected' : 'From Atlas_Participants (OneForma Event Hub)'}
      >
        <span className="atlas-queue-sync-dot" aria-hidden="true" />
        <span key={text} className="atlas-queue-sync-text atlas-status-line">{text}</span>
        {usingSample && <span className="atlas-queue-mock">SAMPLE</span>}
      </div>
      {isAdmin && (
        <button
          type="button"
          className={`atlas-sync-btn${busy ? ' is-busy' : ''}`}
          aria-disabled={busy}
          onClick={() => { if (!busy) syncNow() }}
        >
          <span className="atlas-sync-icon" aria-hidden="true">
            <svg className="atlas-sync-icon-idle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            <span className="atlas-sync-dots"><i /><i /><i /><i /></span>
          </span>
          {busy ? `Syncing ${secs}s` : sync.state === 'loaded' && sync.manual ? 'Sync again' : 'Sync'}
        </button>
      )}
    </div>
  )
}

// Left panel: the OneForma queue, closest to HQ first, plus moderator shortcuts and
// the layer switches (Completed is off until switched on).
function QueuePanel({ shown, total, onClose }) {
  const { layers, toggleLayer, focusModerator, focusParticipant, selected } = useMap()
  const { moderators } = useModerators()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = q
    ? shown.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    : shown

  return (
    <>
      <button type="button" className="atlas-map-back atlas-map-chrome" data-tour="map-back" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span className="atlas-map-back-label">RETURN TO SCHEDULE</span>
      </button>

      <section className="atlas-queue atlas-map-chrome" data-tour="map-queue" aria-label="OneForma participant queue">
        <div className="atlas-queue-head">
          <div>
            <div className="atlas-eyebrow atlas-queue-eyebrow">ONEFORMA · ENDORSED</div>
            <h2 className="atlas-queue-title">Participant queue</h2>
          </div>
        </div>
        <SyncLine />

        <div className="atlas-queue-moderators atlas-no-scrollbar" role="group" aria-label="Follow a moderator">
          {moderators.map((m) => (
            <button key={m.email} type="button" className="atlas-queue-moderator" title={`Follow ${m.displayName}`} onClick={() => focusModerator(m.email)}>
              {firstName(m)}
            </button>
          ))}
        </div>

        <label className="atlas-queue-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="search"
            className="atlas-queue-search-input"
            value={query}
            placeholder="Name, address or OF id"
            aria-label="Search the queue"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <FilterBar shown={shown.length} total={total} noun="people" />

        <ol className="atlas-queue-list atlas-no-scrollbar">
          {rows.map((p, i) => (
            <li key={p.id} className="atlas-queue-item atlas-row-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
              <button
                type="button"
                className={`atlas-queue-row${p.id === selected ? ' is-selected' : ''}`}
                aria-current={p.id === selected}
                onClick={() => focusParticipant(p.id)}
              >
                <span className={`atlas-queue-dot atlas-queue-dot--${p.status}`} aria-hidden="true" />
                <span className="atlas-queue-text">
                  <span className="atlas-queue-name">{p.name}</span>
                  <span className="atlas-queue-meta">{p.address.split(',')[0]} · {STATUS_TEXT[p.status]}</span>
                  {p.status === 'open' && <AvailabilityLine participantId={p.id} />}
                </span>
                <span className="atlas-queue-dist">{participantMiles(p)}</span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="atlas-empty atlas-row-in">No one in the queue matches.</li>}
        </ol>

        <div className="atlas-queue-layers" role="group" aria-label="Show on map" data-tour="map-layers">
          {MAP_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`atlas-layer-toggle${layers[l.id] ? ' is-on' : ''}`}
              aria-pressed={layers[l.id]}
              onClick={() => toggleLayer(l.id)}
            >
              <span className={`atlas-queue-dot atlas-queue-dot--${l.id}`} aria-hidden="true" />
              {l.id === 'completed' ? 'Show completed' : l.label}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

// Drive from HQ: time, distance and arrival if the moderator left now.
function TripPanel({ trip }) {
  const loading = trip === 'loading'
  return (
    <div className={`atlas-trip${loading ? ' is-loading' : ''}${trip.estimated ? ' is-estimated' : ''}`} role="status" aria-live="polite">
      <div className="atlas-trip-head">
        <span className="atlas-eyebrow atlas-trip-eyebrow">DRIVE FROM HQ</span>
        {!loading && (
          <span className="atlas-trip-source" title={trip.estimated ? trip.reason : 'Road route from OpenStreetMap data (OSRM). No live traffic.'}>
            {trip.estimated ? 'ESTIMATE' : 'ROAD ROUTE'}
          </span>
        )}
      </div>
      {loading ? (
        <div className="atlas-trip-wait"><span className="atlas-queue-sync-dot" aria-hidden="true" />Finding the road route…</div>
      ) : (
        <div key={`${trip.minutes}-${trip.miles}`} className="atlas-trip-grid atlas-swap-in">
          <div>
            <div className="atlas-trip-value atlas-trip-value--accent">{trip.eta}</div>
            <div className="atlas-trip-label">ETA if leaving now</div>
          </div>
          <div>
            <div className="atlas-trip-value">{formatDrive(trip.minutes)}</div>
            <div className="atlas-trip-label">drive</div>
          </div>
          <div>
            <div className="atlas-trip-value">{trip.miles.toFixed(1)} mi</div>
            <div className="atlas-trip-label">{trip.estimated ? 'approx.' : 'by road'}</div>
          </div>
        </div>
      )}
      {!loading && trip.estimated && (
        <div className="atlas-trip-note">{trip.reason?.startsWith('No routing server') ? 'No routing server is set up yet, so this is a straight-line estimate.' : 'Routing service unreachable, so this is a straight-line estimate.'}</div>
      )}
    </div>
  )
}

// The participant's address, and for Admins and Schedulers a way to correct it.
// A correction is saved in Atlas and wins over every later OneForma pull.
function AddressFix({ participant: p }) {
  const { canBook } = useRole()
  const { correctAddress } = useParticipants()
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const save = async (fix) => {
    setSaving(true)
    const result = await correctAddress(p, fix, user?.email ?? null)
    setSaving(false)
    if (!result.ok) { toast(result.message ?? 'The address wasn’t saved.', 'error'); return }
    setForm(null)
    const back = !fix.address?.trim() && !fix.postalCode?.trim()
    toast(result.sent ? (back ? 'Back to the OneForma address' : 'Address corrected') : 'Dry run: address changed in this browser only')
  }

  if (form) {
    return (
      <form className="atlas-address-fix" onSubmit={(e) => { e.preventDefault(); save(form) }}>
        <label className="atlas-field">
          <span className="atlas-eyebrow">ADDRESS</span>
          <input className="atlas-input" value={form.address} autoFocus onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="atlas-field atlas-address-fix-zip">
          <span className="atlas-eyebrow">ZIP</span>
          <input className="atlas-input" value={form.postalCode} inputMode="numeric" maxLength={10} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </label>
        <div className="atlas-address-fix-actions">
          <button type="submit" className="atlas-btn-primary atlas-btn-primary--compact" disabled={saving || (!form.address.trim() && !form.postalCode.trim())}>{saving ? 'Saving…' : 'Save address'}</button>
          <button type="button" className="atlas-link" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="atlas-map-info-address">
      <span>{p.address || 'No address'}{p.postalCode && !p.address?.includes(p.postalCode) ? ` ${p.postalCode}` : ''}</span>
      {p.corrected && (
        <span className="atlas-address-fix-note" title={`OneForma has: ${p.corrected.ofAddress || 'no address'}${p.corrected.ofPostalCode ? ` ${p.corrected.ofPostalCode}` : ''}`}>
          Corrected in Atlas{p.corrected.by ? ` by ${p.corrected.by}` : ''}
        </span>
      )}
      {canBook && (
        <span className="atlas-address-fix-links">
          <button type="button" className="atlas-link" onClick={() => setForm({ address: p.address ?? '', postalCode: p.postalCode ?? '' })}>Fix address</button>
          {p.corrected && (
            <button type="button" className="atlas-link" disabled={saving} onClick={() => save({ address: '', postalCode: '' })}>Use OneForma’s</button>
          )}
        </span>
      )}
    </div>
  )
}

// Info and actions for the dot that was clicked.
function InfoTile({ participant: p, trip, onRoute, onDismiss, onBook, nearby = null, nearbyLoading = false, onBookNearby, onPickNearby }) {
  const { openBooking, triggerRef } = useSchedule()
  const { canBook } = useRole()
  const { label: moderatorLabel } = useModerators()
  const s = p.session

  return (
    <section key={p.id} className="atlas-map-info atlas-raised atlas-swap-in" aria-label={`${p.name} details`}>
      <div className="atlas-map-info-head">
        <div className="atlas-map-info-head-text">
          <div className={`atlas-eyebrow atlas-map-info-status atlas-map-info-status--${p.status}`}>
            <span className={`atlas-queue-dot atlas-queue-dot--${p.status}`} aria-hidden="true" />
            {STATUS_TEXT[p.status].toUpperCase()}
          </div>
          <h3 className="atlas-map-info-name">{p.name}</h3>
          <div className="atlas-map-info-id">{p.id} · {p.locale}</div>
          {nearby?.length > 0 && (
            <button
              type="button"
              className="atlas-link atlas-nearby-jump"
              onClick={(e) => e.currentTarget.closest('.atlas-map-info')?.querySelector('.atlas-nearby')?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
            >
              {nearby.length} {nearby.length === 1 ? 'person' : 'people'} nearby{p.session ? ' to book next' : ' to book together'} ↓
            </button>
          )}
        </div>
        <button type="button" className="atlas-map-info-close" aria-label="Close details" onClick={onDismiss}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="atlas-map-info-body atlas-well">
        <AddressFix participant={p} />
        <div className="atlas-map-info-grid">
          <div>
            <div className="atlas-eyebrow atlas-map-detail-label">FROM HQ</div>
            <div className="atlas-map-detail-value">{participantMiles(p)}</div>
          </div>
          <div className="atlas-map-detail-assigned">
            <div className="atlas-eyebrow atlas-map-detail-label">{s ? 'BOOKING' : 'ENDORSED'}</div>
            <div className="atlas-map-detail-value atlas-map-detail-value--accent">
              {s ? `${s.date === TODAY ? 'Today' : longDayLabel(s.date)} ${clock12(s.start)} · ${moderatorLabel(s.moderator)}` : (p.joinTime?.slice(0, 10) ?? '—')}
            </div>
          </div>
        </div>
        {p.home && (
          <div className="atlas-map-info-home">
            <div className="atlas-eyebrow atlas-map-detail-label">HOME</div>
            <div className="atlas-map-detail-value">{[p.home.type, p.home.size].filter(Boolean).join(' · ') || '—'}</div>
            {p.home.features.length > 0 && <div className="atlas-map-info-home-features">{p.home.features.join(', ')}</div>}
          </div>
        )}
      </div>

      {trip && <TripPanel trip={trip} />}

      <div className="atlas-map-detail-actions">
        <button type="button" className="atlas-map-detail-contact" onClick={onRoute}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
          Route from HQ
        </button>
        {s ? (
          <button
            type="button"
            className="atlas-map-detail-expand"
            onClick={(e) => { triggerRef.current = e.currentTarget; openBooking(s.id) }}
          >
            View booking
          </button>
        ) : (
          <button
            type="button"
            className="atlas-map-detail-expand"
            disabled={!canBook}
            title={canBook ? undefined : 'Only Admins and Schedulers can book'}
            onClick={onBook}
          >
            Book
          </button>
        )}
      </div>
      {!s && <div className="atlas-map-info-avail"><AvailabilityContact participant={p} compact /></div>}
      {nearby && <NearbyList anchor={p} nearby={nearby} loading={nearbyLoading} onBook={onBookNearby} onPick={onPickNearby} />}
      {(p.phone || p.email) && (
        <div className="atlas-map-info-contact">
          {p.phone && <a className="atlas-link" href={`tel:${p.phone}`}>{p.phone}</a>}
          {p.email && <a className="atlas-link" href={`mailto:${p.email}`}>{p.email}</a>}
        </div>
      )}
    </section>
  )
}

// "Book nearby next": the closest people still open to book. From a booked place
// each has a time right after it (same moderator, unless they're at the daily limit)
// and a one-click booking; from an open person, they're the ones to book together.
// Clicking a name makes that person the new starting point. Distances are estimates.
function NearbyList({ anchor, nearby, loading, onBook, onPick }) {
  const { name: moderatorName } = useModerators()
  const s = anchor.session
  const first = firstWord(anchor.name)
  const title = s ? 'BOOK NEARBY NEXT' : `CLOSEST TO ${first.toUpperCase()}`
  if (loading || !nearby.length) {
    return (
      <section className="atlas-nearby" aria-label={title} aria-busy={loading}>
        <div className="atlas-eyebrow atlas-nearby-title">{title}</div>
        <p className="atlas-nearby-empty" role="status">{loading ? 'Finding the nearest by road…' : 'No one else open to book nearby. Try a wider Range from HQ in Filters.'}</p>
      </section>
    )
  }
  const top = nearby[0]
  const topName = firstWord(top.participant.name)
  return (
    <section className="atlas-nearby" aria-label={title}>
      <div className="atlas-eyebrow atlas-nearby-title">{title}</div>
      {!s && <p className="atlas-nearby-saving">Book these together on the same day to save driving.</p>}
      {top.saved >= 1 && (
        <p className="atlas-nearby-saving">
          {s
            ? `Booking ${topName} right after ${first} saves about ${Math.round(top.saved)} mi of driving compared with a separate trip from HQ.`
            : `${first} and ${topName} on the same trip saves about ${Math.round(top.saved)} mi compared with two trips from HQ.`}
        </p>
      )}
      <ol className="atlas-nearby-list">
        {nearby.map(({ participant: q, miles, minutes, slot, estimated }, i) => (
          <li key={q.id} className="atlas-nearby-row atlas-row-in" style={{ animationDelay: `${i * 35}ms` }}>
            <span className="atlas-nearby-rank" aria-hidden="true">{i + 1}</span>
            <div className="atlas-nearby-text">
              <button type="button" className="atlas-nearby-name" title={`Show who’s near ${q.name}`} onClick={() => onPick(q.id)}>{q.name}</button>
              <span className="atlas-nearby-meta">
                {estimated ? 'about ' : ''}{miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi {estimated ? '' : 'by road '}{s ? `from ${first} ` : ''}· {estimated ? 'about ' : ''}{formatDrive(minutes)} drive{estimated ? ' (estimate)' : ''}
                {q.home?.type ? ` · ${homeLabel(q.home.type)}` : ''}
              </span>
              {slot?.full && <span className="atlas-nearby-note">{moderatorName(s.moderator)} already has {MAX_SESSIONS_PER_MODERATOR_PER_DAY} sessions that day, so this one starts without a moderator.</span>}
            </div>
            <div className="atlas-nearby-actions">
              {!s ? (
                <button type="button" className="atlas-nearby-book" onClick={(e) => onBook(e, q.id, null)}>Book</button>
              ) : slot ? (
                <button
                  type="button"
                  className="atlas-nearby-book"
                  title={`${s.date === TODAY ? 'Today' : longDayLabel(s.date)}, ${timeRange(slot.start, slot.end)}${slot.moderator ? ` with ${moderatorName(slot.moderator)}` : ''}`}
                  onClick={(e) => onBook(e, q.id, slot)}
                >
                  Book at {clock12(slot.start)}
                </button>
              ) : (
                <span className="atlas-nearby-none">No time left that day</span>
              )}
              {s && <button type="button" className="atlas-link atlas-nearby-other" onClick={(e) => onBook(e, q.id, null)}>Other day</button>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

const firstWord = (name) => name.replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, '').split(' ')[0]

