import { createServer } from 'node:http'

const port = Number(process.env.SIMULATOR_PORT || 7071)
const host = process.env.SIMULATOR_HOST || '127.0.0.1'
const clients = new Set()
let lastEventAt = null

// Events are drawn from a seeded generator so a rehearsed demo replays
// identically. Override with SIMULATOR_SEED to get a different sequence.
const seed = Number(process.env.SIMULATOR_SEED || 20260913)
const makeRandom = (value) => () => {
  value = (value + 0x6d2b79f5) | 0
  let t = Math.imul(value ^ (value >>> 15), 1 | value)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const random = makeRandom(seed)

// Route delays, dock waits and duty-cycle shifts, as the project brief's
// event generator requires. speedFactor scales the vehicle's speed while the
// event is active; a factor of zero holds the truck in place so dwell — and
// therefore detention — accrues.
const EVENT_TYPES = {
  traffic: {
    label: 'Highway 401 slowdown',
    detail: 'Congestion eastbound; expect a slower run to the next stop.',
    severity: 'warning',
    speedFactor: 0.35,
    ticks: 14,
  },
  closure: {
    label: 'Highway 401 lane closure',
    detail: 'Incident ahead has closed a lane; ETA and delivery margin are at risk.',
    severity: 'critical',
    speedFactor: 0.12,
    ticks: 20,
  },
  dock_wait: {
    label: 'Dock queue',
    detail: 'Holding at the dock; free time is being consumed.',
    severity: 'warning',
    speedFactor: 0,
    ticks: 24,
  },
  duty_change: {
    label: 'Duty status change',
    detail: 'Driver logged on-duty not driving; the HOS clock moved.',
    severity: 'info',
    speedFactor: 1,
    ticks: 2,
    hosDeltaHours: -0.5,
  },
}
const EVENT_KINDS = Object.keys(EVENT_TYPES)

const vehicles = [
  { truckId: 'T-067', progress: .68, speedKph: 92, distanceKm: 119, start: { lat: 42.9849, lng: -81.2453 }, end: { lat: 43.5183, lng: -79.8774 }, event: null, cooldown: 12 },
  { truckId: 'T-012', progress: .61, speedKph: 78, distanceKm: 43, start: { lat: 43.8563, lng: -79.5085 }, end: { lat: 43.8384, lng: -79.0868 }, event: null, cooldown: 30 },
]

let sequence = 0
const startEvent = (vehicle, kind) => {
  const type = EVENT_TYPES[kind]
  if (!type) return null
  sequence += 1
  vehicle.event = {
    id: `E-${sequence}`,
    kind,
    label: type.label,
    detail: type.detail,
    severity: type.severity,
    truckId: vehicle.truckId,
    startedAt: new Date().toISOString(),
    remainingTicks: type.ticks,
    hosDeltaHours: type.hosDeltaHours ?? 0,
  }
  console.log(`[SIMULATOR] ${vehicle.truckId}: ${type.label}`)
  return vehicle.event
}

// Roughly one event per vehicle every couple of minutes of wall clock, with a
// cooldown so two never stack on the same truck.
const maybeStartEvent = (vehicle) => {
  if (vehicle.event) return
  if (vehicle.cooldown > 0) {
    vehicle.cooldown -= 1
    return
  }
  if (random() > 0.014) return
  startEvent(vehicle, EVENT_KINDS[Math.floor(random() * EVENT_KINDS.length)])
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache',
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (url.pathname === '/api/telemetry/health') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      status: 'ok',
      provider: 'roadstar-simulator',
      vehicles: vehicles.length,
      seed,
      activeEvents: vehicles.filter((vehicle) => vehicle.event).map((vehicle) => vehicle.event),
      mode: 'demo',
      lastEventAt,
    }))
    return
  }

  // Lets a demo trigger a disruption on cue instead of waiting for the
  // scheduler: POST /api/telemetry/inject?kind=closure&truckId=T-067
  if (url.pathname === '/api/telemetry/inject' && request.method === 'POST') {
    const kind = url.searchParams.get('kind') || 'closure'
    const truckId = url.searchParams.get('truckId')
    const vehicle = truckId
      ? vehicles.find((item) => item.truckId === truckId)
      : vehicles[0]
    response.writeHead(vehicle && EVENT_TYPES[kind] ? 200 : 400, { ...headers, 'Content-Type': 'application/json' })
    if (!vehicle || !EVENT_TYPES[kind]) {
      response.end(JSON.stringify({ error: 'Unknown truckId or kind', kinds: EVENT_KINDS }))
      return
    }
    vehicle.event = null
    response.end(JSON.stringify({ injected: startEvent(vehicle, kind) }))
    return
  }

  if (url.pathname === '/api/telemetry/events') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    response.write(': connected\n\n')
    clients.add(response)
    request.on('close', () => clients.delete(response))
    return
  }

  response.writeHead(404, headers)
  response.end('Not found')
})

setInterval(() => {
  for (const vehicle of vehicles) {
    maybeStartEvent(vehicle)

    const type = vehicle.event ? EVENT_TYPES[vehicle.event.kind] : null
    const speedFactor = type ? type.speedFactor : 1

    vehicle.progress = vehicle.progress >= 1 ? 0 : Math.min(1, vehicle.progress + .012 * speedFactor)
    vehicle.speedKph = vehicle.progress >= 1
      ? 0
      : Math.round((76 + Math.sin(vehicle.progress * 20) * 14) * speedFactor)
    vehicle.distanceKm += vehicle.speedKph / 360

    const point = {
      lat: vehicle.start.lat + (vehicle.end.lat - vehicle.start.lat) * vehicle.progress,
      lng: vehicle.start.lng + (vehicle.end.lng - vehicle.start.lng) * vehicle.progress,
    }

    const event = JSON.stringify({
      truckId: vehicle.truckId,
      point,
      progress: vehicle.progress,
      speedKph: vehicle.speedKph,
      distanceKm: vehicle.distanceKm,
      recordedAt: new Date().toISOString(),
      simulatedMinutes: 2,
      event: vehicle.event,
    })
    lastEventAt = new Date().toISOString()
    for (const client of clients) client.write(`data: ${event}\n\n`)

    if (vehicle.event) {
      vehicle.event.remainingTicks -= 1
      if (vehicle.event.remainingTicks <= 0) {
        console.log(`[SIMULATOR] ${vehicle.truckId}: ${vehicle.event.label} cleared`)
        vehicle.event = null
        vehicle.cooldown = 45
      }
    }
  }
}, 1000)

server.listen(port, host, () => console.log(`[SIMULATOR] telemetry stream ready on http://${host}:${port} (seed ${seed})`))
