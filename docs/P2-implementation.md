# RoadStar DispatchOS P2 implementation: AI features

P2 adds three AI features on top of the P0 operating picture and the P1 decision system:

1. **Dispatcher copilot**: plain-language answers to fixed dispatch questions, grounded in facts RoadStar already computed.
2. **Proof of delivery (POD) capture**: drivers photograph the POD, the photo is stored against the load, and a missing signature becomes an exception.
3. **AI document intake**: a dispatcher imports a rate confirmation (PDF or photo) and the new-load form is pre-filled for review.

All three use SPUR Compute (`https://ai.spuric.com/v1`, OpenAI-compatible) through the integration gateway. The original brief is `P2-AI-FEATURES-BRIEF.md` (kept outside the repository).

## Guiding rule

**The model narrates or extracts; code computes and decides.** Consequences that hold everywhere in P2:

- A model never creates, changes or deletes a load, assignment or record. The copilot only phrases facts. Extraction only fills a form that a person submits.
- Hours of service, ETAs, distances, detention minutes, charges, dates and signature status are computed or interpreted in code, never by the model.
- Every model call has a timeout and a non-AI fallback, so a SPUR outage degrades features without blocking work.
- The SPUR key never reaches the browser. The browser authenticates to RoadStar with its Supabase session, and the gateway calls SPUR.
- Only sovereign SPUR models are allowed (see [Models](#models)).

## Traceability

| Capability | Connected implementation | Verification |
|---|---|---|
| Authenticated AI gateway | `ai.mjs`: Supabase session check, org role lookup, per-user rate limit, sovereign allowlist, timeouts, metadata-only logging | `tests/aiFoundation.test.ts` (25) |
| Dispatcher copilot | Browser builds deterministic facts (`copilotContext.ts`); gateway narrates and validates citations, identifiers and numbers (`copilot.mjs`); falls back to the facts list | `tests/aiCopilot.test.ts` (17), `copilotContext.test.ts` (7), e2e fallback journey; live: 5/5 questions grounded |
| Load documents storage | `load_documents` table, private `load-documents` bucket, RLS and Storage policies, security-definer RPCs, Realtime | Postgres harness `supabase/tests/load-documents` (with mutation checks), `tests/loadDocumentsMigration.test.ts` (6) |
| POD capture | `PodCapture.tsx` → Storage upload → `attach_load_document` → `/api/ai/extract` (pod) → `record_load_document_extraction` | `tests/aiExtract.test.ts`; live: signed/unsigned detection 4/4 |
| Unsigned POD exception | `documentExceptions.ts` joins the P1 exceptions inbox | `documentExceptions.test.ts` (4) |
| Manual load creation | `NewLoadForm.tsx`, `loadDraft.ts`, `addLoad` transition | `loadDraft.test.ts` (12), e2e load-creation journey |
| AI document intake | `IntakeImporter.tsx` → `documentReader.ts` (pdf.js text layer or rendered pages / re-encoded photo) → `/api/ai/extract` (rate_confirmation) → `intakeMapping.ts` → form | `intakeMapping.test.ts` (10), `aiExtract.test.ts` (21), e2e reader journey; live: text 15/15, photo and scan 14/15 |
| Vision input budget | Browser encodes to 96,000 base64 chars; gateway refuses over 110,000; SPUR context refusal classified | 4 unit tests, each mutation-checked; e2e asserts the encoded size |

## Architecture

```
Browser (React)                     web-server :8080            integration-gateway :7072          SPUR / Supabase
────────────────                    ────────────────            ─────────────────────────          ───────────────
postAi("/api/ai/…")  ──Bearer──▶    /api/ai/* proxy       ──▶   authenticate(request)      ──▶     /auth/v1/user
  Supabase session token            forwards Authorization      organization_members lookup ──▶    PostgREST (caller's token)
                                    45 s timeout, 1 MB body     requireRole, checkRateLimit
                                                                handleCopilot / handleExtract ──▶  ai.spuric.com/v1/chat/completions
                                                                storage download (caller token) ──▶ Storage (RLS applies)
                                                                record_load_document_extraction ──▶ RPC (caller token)

Browser ──────────── files go directly ───────────────────────────────────────────────────────▶   Storage bucket load-documents
```

- In development Vite proxies `/api/ai` to `127.0.0.1:7072` (`vite.config.ts`); in production the web-server does (`services/web-server/server.mjs`).
- The web-server forwards `Authorization` **only** on `/api/ai/*`. Other upstreams still receive no credentials.
- The gateway never uses the Supabase `service_role` key. It calls Supabase with the caller's own token plus the publishable key, so RLS and Storage policies apply to every read and write it makes for a user.
- Files never pass through RoadStar servers on upload: the browser uploads to Storage directly. That avoids the proxy's 1 MB body cap.

## Shared AI plumbing: `services/integration-gateway/ai.mjs`

| Export | Purpose |
|---|---|
| `MODELS` | Model per task, from env: extract `spur-glm-5-2`, vision `spur-vision`, copilot `spur-glm-5-2`, copilot fallback `spur-glm-air` |
| `SOVEREIGN_MODELS` | Allowlist. `spurChat` refuses any other model with 503 `model_not_allowed` |
| `spurChat({model, messages, json, maxTokens, timeoutMs, requestId})` | One chat completion. Sends `temperature: 0`, `response_format: json_object` when `json`, and `chat_template_kwargs: {enable_thinking: false}` for GLM models |
| `authenticate(request)` | Validates the bearer token via `/auth/v1/user`, loads the caller's `organization_members` row, caches the identity for 60 s. Returns `{userId, token, organizationId, role}` |
| `requireRole`, `checkRateLimit` | Role gate per route; sliding one-minute window per user (`AI_RATE_LIMIT_PER_MINUTE`, default 20), 429 with `Retry-After` |
| `readJson` | Body reader with a 1 MB limit |
| `parseModelJson` | Parses model JSON, stripping the code fences `spur-vision` adds |
| `supabaseFetch(path, identity, init)` | Supabase request with the caller's token |
| `aiReadiness`, `aiMetrics` | `/api/ai/health` payload and counters |
| `AiError(status, code, message, details)` | Every expected failure; the server turns it into `{error, code, ...details}` |

Routes are registered in `server.mjs` (`aiRoutes`). POST is accepted only under `/api/ai/`.

| Route | Method | Roles | Handler |
|---|---|---|---|
| `/api/ai/copilot` | POST | admin, dispatcher, viewer | `handleCopilot` |
| `/api/ai/extract` | POST | admin, dispatcher, driver (further narrowed per schema) | `handleExtract` |
| `/api/ai/health` | GET | public | `status` (`not_configured`, `configured`, `connected`, `degraded`), `keyConfigured`, `authConfigured`, `models`, `misconfigured` (non-sovereign model names), `lastCall`; no secrets and no live model call |

`/api/integrations/health` also lists the AI provider.

**Logging.** `ai_call` log lines carry only `requestId`, `model`, `outcome` (`ok`, `http_<status>`, `empty`, `timeout`, `network_error`), `providerError` (a fixed classification such as `context_window_exceeded`, never provider free text), latency and token counts. Prompts, document contents, answers and the key are never logged.

**Error codes the browser may see:** `unauthenticated` (401); `forbidden`, `no_membership` (403); `rate_limited` (429); `invalid_json`, `invalid_question`, `invalid_context`, `invalid_schema`, `invalid_input`, `invalid_document` (400); `payload_too_large`, `input_too_large` (413); `unsupported_type`, `render_pdf_in_browser` (415); `document_not_found` (404); `storage_unavailable`, `auth_not_configured`, `auth_unavailable`, `not_configured`, `model_not_allowed` (503). `provider_error` and `invalid_output` (502) are raised inside the handlers and normally converted into fallbacks. Model failures are **not** errors: both handlers return a `fallback: true` result instead.

### Timeouts

| Layer | Budget |
|---|---|
| Browser `postAi` | 30 s default; 45 s for extraction |
| web-server proxy, `/api/ai/*` | 45 s (10 s for every other route) |
| Copilot, per model | `SPUR_TIMEOUT_MS`, default 8 s; primary then fallback model |
| Extraction | `SPUR_EXTRACT_TIMEOUT_MS`, default 25 s |

## Feature 1: dispatcher copilot

**Where:** Intelligence workspace, for every role except driver (`CopilotPanel.tsx` inside `IntelligenceWorkspace.tsx`).

**Flow.**
1. The dispatcher picks one of five fixed questions: `at_risk`, `unassigned`, `hos`, `detention`, `plan`. Free-text questions are deliberately not supported.
2. `buildCopilotRequest(questionId, state, insights, now)` in `src/features/intelligence/lib/copilotContext.ts` assembles the facts from P0/P1 logic (exceptions, HOS, detention, optimizer plan) and a directory of loads (bill number), drivers (name) and trucks (number). Times and money are pre-formatted, so the model never converts them. `unassigned` reasons are drawn only from units that are actually available; otherwise busy units dominate the explanation.
3. The gateway (`copilot.mjs`) sends the facts to the copilot model, then to the fallback model if the first fails.
4. `validateCopilotAnswer` checks the reply:
   - every citation resolves to a directory id or alias;
   - identifier-shaped tokens in the prose (`RS-4521`, `D-113`) exist in the directory;
   - every measured number (a decimal, or a whole number over 10) appears in the facts or directory. Small counts are allowed, and directory aliases are allowed so "Truck 67" is not flagged.
   The result carries `grounded` and `unverified: {citations, references, numbers}`.
5. Answers are cached per organization, question and facts for 5 minutes.
6. If every model fails, the response is `fallback: true` and the panel shows the deterministic facts list. The same list is what signed-out users see.

## Feature 2: load documents and proof of delivery

### Supabase model: `supabase/migrations/20260913082708_load_documents_and_storage.sql`

Applied to production on 13 Sept 2026. It sets `system_health.schema_version` to `20260913082708`.

**Table `public.load_documents`.** One row per stored file:

| Column | Notes |
|---|---|
| `id` uuid | primary key |
| `organization_id` | tenant |
| `load_external_id` | snapshot load id; loads live in `dispatch_snapshots.state`, so there is no foreign key |
| `storage_path` | unique, `<org id>/<load id \| intake>/<uuid>.<ext>` |
| `purpose` | `intake` or `pod` |
| `document_type` | `rate_confirmation`, `bol`, `pod`, `lumper_receipt`, `damage_photo`, `other`, `unknown` |
| `content_type`, `byte_size` | jpeg/png/webp/pdf, ≤ 10 MB (matches the bucket) |
| `uploaded_by`, `uploaded_at` | |
| `extraction_status` | `pending`, `complete`, `failed`, `skipped` |
| `extraction` jsonb | fields, confidence, sourceSpans, warnings, modelUsed, extractionPath (≤ 64 KB) |
| `signature_missing` | set only for documents read as a POD |
| `extracted_at`, `updated_at` | |

The table is in the Realtime publication; `useLoadDocuments` subscribes to it.

**Access.** Clients can `select` and `delete` only. Rows are created and updated exclusively through RPCs. Helpers live in the `private` schema, use `security definer` with `set search_path = ''`, and follow the P0 `transition_driver_assignment` pattern: a driver's ownership of a load is checked through the snapshot's `assignments[]` joined to `driver_user_links`.

| Helper (private) | Rule |
|---|---|
| `load_document_member_role(org)` | caller's role, or null |
| `is_assigned_driver_for_load(org, load)` | caller is the linked driver on any assignment for the load, in any status, because POD is captured after completion |
| `parse_load_document_path(name)` | splits a Storage path; a malformed path yields no row, so it is denied rather than erroring inside a policy |
| `can_write_load_document(org, segment)` | who may upload to a path segment |
| `can_read_load_document(org, segment, owner)` | who may read; drivers read only POD files they uploaded or that belong to loads assigned to them. Rate confirmations carry pricing |

| RPC (public, authenticated only) | Purpose |
|---|---|
| `attach_load_document(p_storage_path, p_load_external_id, p_purpose)` | Creates the row for an already-uploaded object after checking the path, org, load, role and object metadata |
| `record_load_document_extraction(p_document_id, p_status, p_document_type, p_extraction, p_signature_missing)` | Stores an extraction result; the caller must be allowed to write that document |

**Storage.** A private bucket `load-documents` (10 MB; jpeg/png/webp/pdf) with upload, read and operator-delete policies built on the same helpers. There is no update policy, so uploads are immutable.

**Harness.** `supabase/tests/load-documents/` runs the migration in a Postgres 17 container against Supabase stubs (`stubs.sql`) and asserts role scenarios with pinned SQLSTATEs (`scenarios.sql`). See its README. Each guard was mutation-tested. One mutant (M2, a redundant guard) survived and exposed a missing scenario: an assigned driver attaching a rate confirmation. That scenario and mutant M2b were added, and M2b is caught.

### POD capture flow

1. **Driver page** (`PodCapture.tsx`, shown on the driver's assignments that are `accepted` or `in_transit`). The driver picks or takes a photo. The database also allows a POD for a completed assignment; the UI does not offer it yet.
2. `uploadProofOfDelivery` (`src/features/documents/lib/documents.ts`) re-encodes the photo to fit the [vision budget](#vision-input-budget). A photo that cannot fit is stored at full size instead, so the proof is never lost.
3. It uploads to `<org>/<loadId>/<uuid>.jpg`, then calls `attach_load_document`. The upload is durable before any AI runs.
4. It posts `/api/ai/extract` with `{schema: "pod", storagePath, documentId}`. The gateway downloads the file **with the driver's token** (Storage policies apply), reads it with `spur-vision`, and writes the result through `record_load_document_extraction`.
5. **Signature logic.** The model reports only `signature_evidence`, one of `handwritten_mark | typed_or_printed_name_only | blank_line | no_signature_area`. Code derives `signature_present`: true for a handwritten mark, false for a blank line or printed name only, null otherwise. When asked directly for a boolean, the vision model called a blank line signed. `signature_missing` is stored only when the document type is `pod` and `signature_present === false`, so a damage photo is never flagged.
6. **Dispatcher side.** `LoadDocumentsPanel.tsx` on the Loads page lists documents in real time, with signed URLs (5 minutes). `documentExceptions()` turns each unsigned POD into a critical `DOCUMENT-<id>-signature` exception, passed into `useRoadIntelligence(state, extraExceptions)`, so it appears in the P1 inbox and can be acknowledged like any other exception.

## Feature 3: AI document intake

### Manual load creation (prerequisite)

Before P2, loads could not be created in the app. The Loads page now has **+ New load** for admins and dispatchers (`canManageDispatch`).

- `src/features/dispatch/lib/loadDraft.ts`: `LoadDraft` (string form values), `EMPTY_LOAD_DRAFT`, `EQUIPMENT_TYPES` (Dry Van, Reefer, Flatbed), `validateLoadDraft` (required fields, pickup/delivery ordering, weight 1–80,000 lb, pallets 0–30, rate ≤ 100,000, unique bill number), and `draftToLoad` (id `L-<BILL>` plus a suffix if needed).
- `src/features/dispatch/data/ontarioCities.ts`: 44 Southern Ontario city centres. `findOntarioCity` needs an exact normalized name, because RoadStar's distance model only knows these coordinates.
- `stateTransitions.addLoad` and `useDispatchOperations.createLoad` add the load unassigned through the normal snapshot save.
- `NewLoadForm.tsx` props: `onCreate`, `onClose`, `initial` (draft values), `evidence` (per-field source text and confidence, shown under the field), `notice` (review notes) and `importer` (slot for the importer).

### Intake flow

1. **In the new-load form**, `IntakeImporter.tsx` accepts a PDF, JPEG, PNG or WebP. Signed-out users see "Sign in to read documents automatically."
2. **`readDocumentForExtraction(file)`** (`src/features/documents/lib/documentReader.ts`) runs entirely in the browser:
   - **PDF with a text layer** (≥ 120 non-space characters in the first 3 pages): sends text.
   - **Scanned PDF**: renders up to 2 pages with pdf.js to canvases, then encodes them into the shared budget. If two pages cannot both fit, page 1 alone gets the whole budget.
   - **Photo**: re-encodes it to the budget.
   - **Failure cases**: password-protected, unreadable or unsupported files raise a `DocumentReadError` with a user-facing message.
   - `pdfjs-dist` 6.3.289 and its worker are lazy-loaded, so they only download when someone imports a document.
3. **`POST /api/ai/extract`** with `{schema: "rate_confirmation", text}` or `{schema: "rate_confirmation", images}`. Text goes to `spur-glm-5-2`, images to `spur-vision`.
4. **`normalizeExtraction`** (gateway) coerces types and enums. On the text path every populated value must quote source text that is really in the document, and a number must appear in its own quote; otherwise the value is blanked with a warning. A vision result with mean confidence under 0.5 is marked `manualReview`.
5. **`mapRateConfirmation`** (`src/features/dispatch/lib/intakeMapping.ts`) interprets values in code:
   - dates: `parseDocumentDate` handles ISO, month names and numeric dates; ambiguous day/month orders and impossible dates are left blank with a note;
   - time windows: `parseTimeWindow` handles "08:00-10:00" and "by 15:00";
   - equipment: normalized to Dry Van, Reefer or Flatbed;
   - cities: must match the Ontario list, otherwise left blank with a note;
   - currency: a USD rate is left blank with a note, never converted.
6. **App.tsx** opens the form with `initial` = draft, `evidence`, and a notice listing warnings and notes. **Nothing is created until the dispatcher clicks Create load.**
7. **After creation**, if signed in, `attachIntakeDocument(orgId, loadId, file)` stores the original file under `<org>/intake/` and attaches it with purpose `intake`. It is best effort: a failure is shown in a banner and the load is kept.

### Extraction schemas (`extract.mjs` `SCHEMAS`)

| Schema | Roles | Fields |
|---|---|---|
| `rate_confirmation` | admin, dispatcher | customer, reference_number, origin, destination, pickup_date, pickup_window, delivery_date, delivery_window, equipment, weight_lbs, pallets, rate_amount, currency, temperature_controlled, commodity |
| `bol` | admin, dispatcher | shipper, consignee, bol_number, pro_number, pickup_date, pallets, weight_lbs, commodity (no UI yet) |
| `pod` | admin, dispatcher, driver | document_type, consignee, reference_numbers, signature_evidence, signature_name, delivered_at, pallets_received, condition_notes, plus derived signature_present |

**Request rules.** The request carries exactly one of `text` (≤ 120,000 chars), `images` (1–3 data URLs, ≤ 110,000 chars in total) or `storagePath` (must start with the caller's `<org id>/`; a stored PDF returns 415 `render_pdf_in_browser`). Optionally it includes `documentId`, which stores the result on that row.

**Caching.** Results are cached for 30 minutes by org, schema and input hash.

The prompt tells the model to use null rather than infer, to key `source_text` by field name, that "Broker" and "Load #" labels map to customer and reference_number, and to leave `temperature_controlled` null unless a temperature is stated.

## Vision input budget

**Finding (13 Sept 2026).** SPUR's `spur-vision` tier refuses requests with HTTP 400 `{"detail": "input (~N tokens) exceeds this tier's 32768-token context window"}`. It **estimates tokens from the base64 text** (roughly 4 characters per token), not from the image. A 98 KB JPEG that actually costs about 2,900 tokens was refused. Small test photos had passed, so the problem only appeared with realistic photos.

**Handling.**
- **Browser.** `VISION_PAYLOAD_CHARS = 96_000` (`documents.ts`). `encodeImage` steps through edge/quality pairs from 1600 px/0.8 down to 760 px/0.5 until the data URL fits, painting a white background so transparent PNGs don't turn black.
- **Gateway.** `maxVisionPayloadChars = 110_000` (`extract.mjs`). Larger `images` requests get 413 `input_too_large` without a model call. An oversized stored POD is recorded as a failed read, so it never stays `pending`.
- **Classification.** `spurChat` maps SPUR's context-window refusal to `providerError: "context_window_exceeded"` and `AiError(413, "input_too_large")`. Extraction then falls back with the warning "The image is too large for the model to read".

If SPUR changes the tier, change **both** constants together, keeping the gateway limit above the browser budget.

## Configuration

Server-only values live in the gateway's environment. Locally that is `.env` (gitignored, loaded by `npm run integrations`); in production it is `/opt/roadstar/.env` on the droplet, consumed by `docker-compose.prod.yml`. Browser values (`VITE_*`) are compiled into the bundle from GitHub secrets.

| Variable | Where | Default | Notes |
|---|---|---|---|
| `SPUR_API_KEY` | gateway only | none | **Secret.** Never in a `VITE_` variable, the bundle, logs or chat. Without it AI routes return fallbacks and `/api/ai/health` reports not configured |
| `SPUR_BASE_URL` | gateway | `https://ai.spuric.com/v1` | |
| `SPUR_MODEL_EXTRACT` / `_VISION` / `_COPILOT` / `_COPILOT_FALLBACK` | gateway | `spur-glm-5-2` / `spur-vision` / `spur-glm-5-2` / `spur-glm-air` | must be on the sovereign allowlist |
| `SPUR_TIMEOUT_MS` | gateway | 8000 | copilot, per model |
| `SPUR_EXTRACT_TIMEOUT_MS` | gateway | 25000 | extraction |
| `AI_RATE_LIMIT_PER_MINUTE` | gateway | 20 | per user |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | gateway | fall back to the `VITE_` values | the same browser-safe values; used with the caller's token |

The Supabase `service_role` key is not used anywhere and must not be added.

## Models

| Model | Used for | Behaviour notes |
|---|---|---|
| `spur-glm-5-2` | copilot, text extraction | Thinking must be disabled (`chat_template_kwargs.enable_thinking=false`), otherwise it is about 10× slower and can return empty content. Copilot answers take 2–3.5 s; a rate confirmation takes about 8 s |
| `spur-glm-air` | copilot fallback | same thinking flag |
| `spur-vision` | photos and scanned pages | Wraps JSON in code fences (handled by `parseModelJson`). See the input budget above. About 8.4 s per page |
| `hari-verified` | not used | Ignores JSON mode, returned prose and disputed question premises during evaluation |

Models resold through OpenRouter (`spur-gpt-5-5`, `spur-claude-*`, `spur-gemini-3-flash`) are refused by policy and absent from `SOVEREIGN_MODELS`.

## Operations

- **Migrations are manual.** The deploy pipeline does not run them. Apply new SQL in the Supabase SQL editor **before** merging code that depends on it, then confirm `system_health.schema_version`. The anon role gets `permission denied` (not "not found") for `load_documents` once the migration is applied.
- **Health.** `GET /api/ai/health` returns `status`: `not_configured` (no key), `degraded` (auth not configured, a non-sovereign model configured, or the last call failed), `configured` (no call yet) or `connected`. `/api/integrations/health` lists the AI provider next to the others.
- **Static asset types.** The web gateway sends `nosniff`, so every script type must be in its MIME map. The first P2 release served the pdf.js worker (`pdf.worker.min-*.mjs`) as `application/octet-stream`, which breaks PDF import in production while working under Vite. `.mjs` is now mapped, and the quality gate step `scripts/check-served-assets.mjs` serves `dist/` through the production gateway and fails on any script or stylesheet with a non-executable type.
- **Logs.** Search the gateway logs for `ai_call`. `http_400` with `providerError: context_window_exceeded` means an image went over the budget. `timeout` means SPUR is slow and fallbacks were served.
- **Symptoms.**
  - Copilot shows only facts: check `/api/ai/health` and `ai_call` outcomes.
  - POD upload fails before "reading": Storage or RLS (migration, driver link, assignment).
  - POD stuck `pending`: extraction request never completed; the upload itself is safe.

## Testing

| Suite | Count | Covers |
|---|---|---|
| `tests/aiFoundation.test.ts` | 25 | key and allowlist checks, GLM parameters, provider failures and timeouts, log hygiene, auth and membership with the caller's token, session cache, roles, rate limit, body limit, readiness states, Authorization forwarded only to AI routes |
| `tests/aiCopilot.test.ts` | 17 | validation (citations, identifiers, numbers, aliases), model fallback chain, cache, fallback response |
| `tests/aiExtract.test.ts` | 21 | normalization, signature derivation, org path checks, caller-token download, PDF 415, fallback storage, cache, vision budget (request, stored file, provider refusal) |
| `tests/loadDocumentsMigration.test.ts` | 6 | static contract checks on the migration SQL |
| `copilotContext.test.ts`, `loadDraft.test.ts`, `intakeMapping.test.ts`, `documentExceptions.test.ts` | 7, 12, 10, 4 | deterministic browser logic |
| `supabase/tests/load-documents` | scenarios | real Postgres, per-role access with pinned SQLSTATEs |
| `tests/e2e/dispatchos.e2e.ts` | 13 journeys | P2 adds: copilot fallback facts, document features ask signed-out users to sign in, load creation, document reader (text PDF, scanned PDF, over-budget photo) |

The gateway tests spawn the real gateway against fake SPUR and Supabase HTTP servers. New guards were **mutation-tested**: each guard was disabled in turn, and the matching test had to fail (the vision budget mutants M1–M4 are all caught).

Browser journeys run against the Vite dev server, which does not reproduce production headers. The quality gate therefore also runs `scripts/check-served-assets.mjs` after the build (it caught the `.mjs` type bug when that entry was removed).

Fixtures live in `tests/fixtures/`: `rate-confirmation-text.pdf` (hand-written text layer), `rate-confirmation-scan.pdf` (image only) and `rate-confirmation-photo.jpg` (98 KB, deliberately over the budget before encoding).

**Live verification against SPUR (13 Sept 2026):**
- 49 models visible to the key;
- all 5 copilot questions grounded;
- rate confirmation text 15/15 fields, and the form accepts the draft unchanged;
- browser-encoded photo and scanned PDF 14/15 (temperature correctly left null);
- POD signed and unsigned detection 4/4;
- the built bundle contains no key, `SPUR_API_KEY`, `sk-spur` or `ai.spuric.com`.

## File map

```
services/integration-gateway/ai.mjs            shared AI plumbing (auth, roles, rate limit, spurChat)
services/integration-gateway/copilot.mjs       copilot handler and answer validation
services/integration-gateway/extract.mjs       extraction schemas, normalization, storage download, vision budget
services/integration-gateway/server.mjs        /api/ai routes and health
services/web-server/server.mjs                 /api/ai proxy: Authorization forwarding, 45 s timeout; .mjs MIME type
scripts/check-served-assets.mjs                release check: built scripts served with executable types
src/shared/lib/aiClient.ts                     postAi with the Supabase session token; AiRequestError
src/features/intelligence/lib/copilotContext.ts   deterministic copilot facts
src/features/intelligence/components/CopilotPanel.tsx
src/features/documents/types.ts                LoadDocument
src/features/documents/lib/documents.ts        image encoding and budget, POD upload, intake attach, signed URLs
src/features/documents/lib/documentReader.ts   PDF text layer / page rendering / photo preparation
src/features/documents/lib/documentExceptions.ts  unsigned POD → exception
src/features/documents/hooks/useLoadDocuments.ts  Realtime document list
src/features/documents/components/PodCapture.tsx, LoadDocumentsPanel.tsx, IntakeImporter.tsx
src/features/dispatch/lib/loadDraft.ts, intakeMapping.ts, stateTransitions.ts (addLoad)
src/features/dispatch/data/ontarioCities.ts
src/features/dispatch/components/NewLoadForm.tsx
src/app/App.tsx                                wiring: documents, exceptions, new-load form, importer, POD capture
supabase/migrations/20260913082708_load_documents_and_storage.sql
supabase/tests/load-documents/                 Postgres harness
```

## Extending

- **New extraction schema** (for example a BOL importer): add it to `SCHEMAS` with roles, fields and guidance, map it to form values in a new `…Mapping.ts` in code, and add normalization tests. The text path's source-quote check applies automatically.
- **New copilot question:** add the id to `COPILOT_QUESTIONS` in both `copilot.mjs` and `copilotContext.ts`, build its facts deterministically in `buildCopilotRequest`, and add validation tests with a fabricated number and an unknown identifier.
- **Any new image path:** encode with `encodeImage(source, VISION_PAYLOAD_CHARS)` or a share of it; never send an unbounded image to the gateway.

## Related change: password sign-in (13 Sept 2026)

Added after P2 so QA accounts and people without a reachable inbox can sign in. It is not an AI feature; it is recorded here so the full set of September changes is in one place.

- **UI.** The sign-in dialog (`AuthModal` in `src/app/App.tsx`) has a **Password** (default) / **Email link** switch.
  - The password form uses `autocomplete="username"` and `current-password`.
  - The show-password toggle sits outside the `<label>`, so the field's accessible name stays "Password".
  - The dialog closes once Supabase stores the session, and the existing `onAuthStateChange` listener switches the workspace.
- **Hook.** `useDispatchOperations().signInWithPassword(email, password)` returns a message, or null on success.
- **Messages.** `src/shared/lib/authMessages.ts` maps Supabase errors (`invalid_credentials`, `email_not_confirmed`, `over_*`/429, `user_banned`, network) to guidance. A wrong password and an unknown email produce the same message, so the form does not reveal which accounts exist.
- **Not included, deliberately.** There is no sign-up or password-reset form. Accounts are created in Supabase, and access still requires an `organization_members` row. Project-level sign-ups remain enabled in Supabase, which was already true for magic links. Repeated password guesses are limited by Supabase Auth's rate limits.
- **Tests.**
  - `authMessages.test.ts` (7 tests).
  - The browser journey `sign-in offers a password, explains a wrong password, and keeps the email link` stubs the Supabase token response and runs axe on the dialog. That check found the dialog's field labels at 4.05:1 contrast; they are now `#697871` (4.64:1).
  - The browser journey `a provisioned dispatcher signs in with a password and signs out` signs in for real with `dispatcher-a` from `.env.qa.local` or the environment, and is skipped when neither is present, so CI needs no credentials.
- **Merge note.** This branch was merged with `sawaab-v2` (PR #7: advanced cargo loads, load lifecycle actions, snapshot reconciliation polling, loading plan versions). The only conflict was both sides appending to the end of `src/app/styles.css`; both blocks were kept. On the Loads page, **+ New load** (P2 form with rate confirmation import, `createLoadFromDraft`) and **Advanced cargo load** (`NewLoadModal`, `createLoad`) now coexist.

## Honest boundaries

- Extraction is a reading aid. Every value is reviewed by a person, and scanned or photographed documents are not source-quote checked (there is no text to check against), so confidence and the review step carry that risk.
- Only Southern Ontario cities in `ontarioCities.ts` can be imported; others are left blank for the dispatcher.
- USD rates are not converted.
- The BOL schema has no UI yet.
- Signature detection is visual evidence, not verification of who signed.
- Stored intake PDFs are kept as the original file; stored POD photos are downscaled to the vision budget when possible.
- The SPUR vision budget is based on observed tier behaviour, not a published limit; it may change.
