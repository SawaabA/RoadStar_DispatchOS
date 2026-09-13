# RoadStar DispatchOS architecture

## Repository layout

```text
src/
  app/                         Application shell and global styling
  features/loading/            3D loading UI, domain types, and planning clients
  features/intelligence/       Exceptions, re-planning, traffic, backhaul, KPI replay
  shared/lib/                  Shared external-service clients
services/loading-solver/       Java service wrapping the xflp planning library
services/integration-gateway/  Server-side Ontario 511 adapter and cache
services/telematics-simulator/ Swappable SSE telematics development provider
services/web-server/           Production static host and same-origin API gateway
supabase/migrations/           Portable PostgreSQL/PostGIS schema migrations
data/raw/                      Original source datasets; treat as read-only
docs/reference/                Original project briefs and supporting documents
```

## Dependency direction

- `app` composes features.
- A feature owns its components, domain types, and feature-specific integration code.
- `shared` contains infrastructure that is useful across multiple features.
- Features must not import from `app`.
- The Java loading solver communicates with the web application through HTTP; it does not depend on frontend code.
- Database changes are versioned as forward-only migrations under `supabase/migrations`.
- Development and production expose the same same-origin `/api` contracts.
- Cloud snapshots use revision-checked writes so stale operators cannot silently overwrite newer state.

## Data handling

Files in `data/raw` are immutable inputs. Import and normalization scripts should write to the database or
to a future `data/processed` directory rather than changing the original workbook.

