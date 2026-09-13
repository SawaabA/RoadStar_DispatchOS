# RoadStar integration gateway

Server-side adapter for providers that must not expose credentials to the browser. It normalizes and caches Ontario 511 events, proxies an OSRM-compatible road-routing provider, and reports whether production TMS and ELD endpoints are configured and healthy.

```powershell
npm run integrations
```

Health: `GET http://127.0.0.1:7072/api/traffic/health`

Incidents: `GET http://127.0.0.1:7072/api/traffic/incidents`

Readiness: `GET http://127.0.0.1:7072/readyz`

Provider status: `GET http://127.0.0.1:7072/api/integrations/health`

Vendor-neutral demo TMS health: `GET http://127.0.0.1:7072/api/tms/health`

Vendor-neutral synthetic loads: `GET http://127.0.0.1:7072/api/tms/loads`

Road route: `GET http://127.0.0.1:7072/api/routing/route?origin=-79.4,43.6&destination=-79.1,43.8`

Prometheus metrics: `GET http://127.0.0.1:7072/metrics`

## Production provider variables

- `ROUTING_BASE_URL` must expose the OSRM route contract at `/route/v1/driving/...`.
- `ROUTING_API_TOKEN` is sent as a bearer token when present.
- `REQUIRE_ROUTING=true` makes readiness fail closed if routing is missing.
- `TMS_HEALTH_URL` / `TMS_API_TOKEN` check the configured TMS adapter.
- `ELD_HEALTH_URL` / `ELD_API_TOKEN` check the configured ELD adapter.
- `TMS_DEMO_MODE=true` and `ELD_DEMO_MODE=true` label synthetic providers as demo rather than live. Set each to `false` only when the corresponding real adapter is configured.

Provider credentials are server-only. Never prefix them with `VITE_`. A vendor adapter must normalize its data to RoadStar's documented load and SSE telemetry contracts before it is called production-ready.

The demo TMS endpoint is deliberately read-only and its records are clearly marked synthetic. A future two-way adapter writes through a private worker and the `external_record_links`, `integration_sync_events`, and `integration_outbox` tables. External IDs plus idempotency keys prevent duplicate imports; failed or conflicting records remain observable without exposing provider credentials to the browser.
