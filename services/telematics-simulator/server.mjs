import { createServer } from 'node:http'

const port = Number(process.env.SIMULATOR_PORT || 7071)
const host = process.env.SIMULATOR_HOST || '127.0.0.1'
const clients = new Set()
const vehicles = [
  { truckId: 'T-067', progress: .68, speedKph: 92, distanceKm: 119, start: { lat: 42.9849, lng: -81.2453 }, end: { lat: 43.5183, lng: -79.8774 } },
  { truckId: 'T-012', progress: .61, speedKph: 78, distanceKm: 43, start: { lat: 43.8563, lng: -79.5085 }, end: { lat: 43.8384, lng: -79.0868 } },
]

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache',
}

const server = createServer((request, response) => {
  if (request.url === '/api/telemetry/health') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', provider: 'roadstar-simulator', vehicles: vehicles.length }))
    return
  }
  if (request.url === '/api/telemetry/events') {
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
    vehicle.progress = vehicle.progress >= 1 ? 0 : Math.min(1, vehicle.progress + .012)
    vehicle.speedKph = vehicle.progress >= 1 ? 0 : 76 + Math.round(Math.sin(vehicle.progress * 20) * 14)
    vehicle.distanceKm += vehicle.speedKph / 360
    const point = {
      lat: vehicle.start.lat + (vehicle.end.lat - vehicle.start.lat) * vehicle.progress,
      lng: vehicle.start.lng + (vehicle.end.lng - vehicle.start.lng) * vehicle.progress,
    }
    const event = JSON.stringify({ ...vehicle, point, recordedAt: new Date().toISOString(), simulatedMinutes: 2 })
    for (const client of clients) client.write(`data: ${event}\n\n`)
  }
}, 1000)

server.listen(port, host, () => console.log(`[SIMULATOR] telemetry stream ready on http://${host}:${port}`))
