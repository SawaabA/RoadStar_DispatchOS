# RoadStar database setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste `migrations/202609100001_initial_dispatch_schema.sql`, and run it once.
3. Copy `.env.example` to `.env.local`.
4. From **Project Settings > API**, copy the project URL and publishable key into `.env.local`.
5. Restart `npm run dev:full` after changing environment variables.

Never place the Supabase service-role key in a `VITE_` environment variable. Values prefixed with
`VITE_` are bundled into browser code. The publishable key is intended for browser use and must be
combined with Row Level Security policies.

The migration uses ordinary PostgreSQL plus PostGIS and is intentionally portable to the later Docker setup.
