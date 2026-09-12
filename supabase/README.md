# RoadStar database setup

1. Create a Supabase project.
2. Prefer the Supabase CLI workflow in `docs/deployment.md` and apply every migration in timestamp order. The SQL Editor is suitable for a one-off setup only when each file is recorded and applied exactly once.
3. Copy `.env.example` to `.env.local`.
4. From **Project Settings > API**, copy the project URL and publishable key into `.env.local`.
5. Restart `npm run dev:full` after changing environment variables.

Never place the Supabase service-role key in a `VITE_` environment variable. Values prefixed with
`VITE_` are bundled into browser code. The publishable key is intended for browser use and must be
combined with Row Level Security policies.

The migration uses ordinary PostgreSQL plus PostGIS and is intentionally portable to the later Docker setup.

The latest migration adds explicit user-to-driver links and a narrowly scoped driver transition RPC. Creating an auth account alone never grants RoadStar organization access.
