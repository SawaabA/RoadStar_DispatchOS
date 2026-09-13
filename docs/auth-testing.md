# Authenticated multi-user verification

RoadStar provides a read-only boundary verifier and a reversible workflow verifier. Together they open five independent Supabase sessions and confirm role membership, driver-link visibility, realtime updates, driver transitions, decision logging, stale-write conflicts, and organization isolation.

## 1. Create dedicated QA accounts

In Supabase **Authentication > Users**, create and auto-confirm these five password users:

- `dispatcher-a@roadstar.test`
- `dispatcher-a2@roadstar.test` (required for a genuine two-operator concurrency test)
- `driver-a@roadstar.test`
- `viewer-a@roadstar.test`
- `dispatcher-b@roadstar.test`

Do not use real employee accounts. Password login is used only by the automated verifier; the RoadStar UI continues to use magic links.

## 2. Provision roles

Run [`supabase/qa/provision-auth-test-users.sql`](../supabase/qa/provision-auth-test-users.sql) in the Supabase SQL Editor. It creates an empty second organization and assigns each user explicitly. Account creation by itself grants no RoadStar access.

The script fails and rolls back if an account or Organization A driver `D-131` is missing. Its final result must show five rows with the expected roles and only the driver account linked to `D-131`.

## 3. Configure local secrets

```powershell
Copy-Item .env.qa.example .env.qa.local
```

Put the five test emails and passwords in `.env.qa.local`. The file is ignored by Git. Keep the Supabase URL and publishable key in the existing `.env` file.

## 4. Verify

```powershell
npm run verify:auth
npm run verify:auth:workflow
```

Every line must report `PASS`. The workflow test restores the original Organization A workspace state in a `finally` block; accepted/started decision records remain as intentional audit evidence. Delete the QA accounts and the `roadstar-qa-b` organization after testing if they are no longer needed.
