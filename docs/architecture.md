# RoadStar DispatchOS architecture

## Repository layout

```text
src/
  app/                         Application shell and global styling
  features/loading/            3D loading UI, domain types, and planning clients
  shared/lib/                  Shared external-service clients
services/loading-solver/       Java service wrapping the xflp planning library
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

## Data handling

Files in `data/raw` are immutable inputs. Import and normalization scripts should write to the database or
to a future `data/processed` directory rather than changing the original workbook.

