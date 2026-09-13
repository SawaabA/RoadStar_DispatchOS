# Load documents migration: behaviour tests

These run migration `20260913082708_load_documents_and_storage.sql` in plain PostgreSQL 17, against
minimal stand-ins for Supabase Auth, Storage and Realtime, then sign in as each role and check what
it can and cannot do: a dispatcher, two drivers linked to different loads, a viewer, a dispatcher in
another organization, a signed-in user with no membership, and an anonymous caller.

Each denial asserts the specific SQLSTATE it expects, so a check cannot pass because it failed for an
unrelated reason.

```bash
docker run -d --name roadstar-pg-test -e POSTGRES_PASSWORD=test postgres:17-alpine
# Wait until `docker logs roadstar-pg-test` shows "init process complete".
docker cp supabase/tests/load-documents/. roadstar-pg-test:/tmp/t/
docker cp supabase/migrations/20260913082708_load_documents_and_storage.sql roadstar-pg-test:/tmp/t/migration.sql
docker exec roadstar-pg-test psql -U postgres -v ON_ERROR_STOP=1 -P pager=off \
  -f /tmp/t/stubs.sql -f /tmp/t/migration.sql -f /tmp/t/scenarios.sql
docker rm -f roadstar-pg-test
```

Every result must read `PASS`, and the summary must report `0 failed`.

The stand-ins reproduce only what this migration touches. They verify the SQL and the authorization
rules; they are not a substitute for applying the migration to a real Supabase project.
