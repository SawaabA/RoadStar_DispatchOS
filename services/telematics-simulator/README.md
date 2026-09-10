# RoadStar telematics simulator

Independent accelerated telemetry provider for the DispatchOS demo. It exposes:

- `GET /api/telemetry/health` — service status
- `GET /api/telemetry/events` — Server-Sent Events stream

Each real second advances a vehicle by roughly two simulated minutes and emits its coordinates, speed, distance, and route progress. Run it with `npm run simulator`; `npm run dev:full` starts it with the web app and xflp service.
