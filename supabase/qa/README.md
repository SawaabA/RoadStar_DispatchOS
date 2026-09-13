# Supabase QA fixtures

These files are manual, disposable QA setup helpers, not production migrations.
They contain account email identifiers but never passwords or privileged keys.

Create and auto-confirm the five users named in `provision-auth-test-users.sql`,
run that file in the Supabase SQL Editor, then configure `.env.qa.local` and run:

```powershell
npm run verify:auth
npm run verify:auth:workflow
```

The workflow test changes and restores the Organization A snapshot. Its driver
decision records remain intentionally as audit evidence.

The fixture also materializes test driver `D-131` from the existing dispatch
snapshot when the normalized `drivers` table has not yet been populated. This
keeps the required `driver_user_links` foreign key intact without inventing a
second source value.
