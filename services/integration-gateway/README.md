# RoadStar integration gateway

Server-side adapter for providers that do not allow direct browser requests. It currently normalizes and caches the official Ontario 511 events feed for 60 seconds, respecting the provider's limit of ten calls per minute.

```powershell
npm run integrations
```

Health: `GET http://127.0.0.1:7072/api/traffic/health`

Incidents: `GET http://127.0.0.1:7072/api/traffic/incidents`
