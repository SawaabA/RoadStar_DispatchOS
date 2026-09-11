# Security and data-integrity review

## Browser and secrets

- Only browser-safe Supabase URL and publishable/anon values use `VITE_` variables.
- No service-role key, database password, access token, private connection string, or populated environment file is committed, bundled, logged, screenshotted, or included in an error.
- Dependencies and third-party code have compatible licenses and no unexplained copied source.
- User-controlled text is rendered safely; links, redirects, uploads, and external URLs are constrained where applicable.

## Supabase and Postgres

When database work is involved, also use the repository's Supabase and Supabase Postgres best-practice skills.

- Verify RLS is enabled on exposed tables and policies enforce organization membership for read and write paths.
- Test unauthenticated, wrong-organization, ordinary-member, and privileged-role access. A hidden UI control is not authorization.
- Verify functions, views, triggers, grants, and `security definer` search paths do not bypass tenant isolation.
- Migrations are forward-only, repeatable in the intended workflow, ordered, reviewable, and do not assume production data is empty.
- Constraints, foreign keys, uniqueness, transactions, and indexes protect assignment and trip invariants under concurrent actions.
- Realtime subscriptions cannot reveal other organizations, do not multiply after reconnect, and reconcile stale local state.

## Dispatch integrity

- Prevent double assignment and impossible asset pairings at the durable-data boundary, not only in React state.
- Validate capacity, units, timestamps, stop order, HOS limits, and money calculations on trusted paths.
- Use explicit state transitions. Repeated, delayed, or reordered requests must be idempotent or fail safely.
- Store auditable timestamps and actor/context for consequential assignment, driver, detention, and recommendation decisions.
- Show whether solver/recommendation output is advisory and require approval before mutating live dispatch state.

## Operational resilience

- External service failures have timeouts, bounded retries, clear fallback behavior, and observable errors.
- Health checks distinguish alive from ready where relevant.
- Client errors do not expose stack traces or sensitive payloads to users.
- Logs contain enough correlation and operation context to diagnose failures without sensitive data.
- Startup and shutdown do not leave stale processes that block the next run.
