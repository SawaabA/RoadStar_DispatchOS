# Audit protocol

## 1. Establish truth and scope

- Read product documentation before inferring requirements from the UI.
- Turn each promised capability and limitation into a traceability row.
- Note the commit, branch, working-tree state, browser, viewport, service mode, and whether data is local demo or Supabase-backed.
- Separate missing requirements, broken implementations, unverified behavior, and intentional limitations.

## 2. Baseline the system

- Run the quality-gate script and retain its command-level results.
- Start the web app alone, then the full stack when Java and service ports are available.
- Verify startup, shutdown, health endpoints, fallback behavior, console output, and failed-network behavior.
- Do not treat successful compilation as behavioral coverage.

## 3. Test risk-first journeys

For each feature, test a realistic journey from its entry point through persistence and the resulting UI. Cover:

1. Happy path with valid realistic data.
2. Boundary values, including zero, exact limits, one over, and one under.
3. Invalid, incomplete, duplicate, stale, and conflicting input.
4. Empty, loading, timeout, offline, server-error, retry, and recovery states.
5. Refresh, back/forward navigation, repeated actions, and double submission.
6. Cross-feature effects: counts, maps, assignments, HOS, alerts, detention, and cloud state remain consistent.
7. Keyboard-only completion and visible focus for operator-critical actions.

Prioritize:

1. Secrets, authentication, tenant isolation, and destructive actions.
2. Data correctness, persistence, state transitions, and realtime conflicts.
3. Dispatch feasibility, HOS, assignments, and solver results.
4. Availability, startup, fallbacks, error recovery, and deployability.
5. Usability, accessibility, visual consistency, and performance.

## 4. Reproduce and triage

A valid defect has deterministic reproduction or strong diagnostic evidence. Record:

- ID and severity.
- Affected feature and user role.
- Preconditions and minimal steps.
- Expected and actual behavior.
- Frequency and scope.
- Screenshot, log excerpt, failing assertion, request/response, or source location.
- Suspected root cause, clearly labeled as an inference until proven.

Severity:

- **S0:** security breach, tenant leak, secret exposure, data loss/corruption, unsafe dispatch decision, or release cannot start.
- **S1:** a P0/core journey is unusable, produces materially wrong results, or lacks a safe recovery path.
- **S2:** meaningful functional, accessibility, or usability degradation with a practical workaround.
- **S3:** cosmetic inconsistency, minor friction, or low-impact improvement.

## 5. Fix safely when authorized

- Confirm the failing behavior first.
- Identify the root cause and the smallest coherent correction.
- Keep domain rules centralized rather than duplicating them in the UI.
- Add a regression test at the lowest useful layer; include an end-to-end test for critical cross-layer journeys when tooling exists.
- Preserve API and database compatibility unless the requirement authorizes a migration.
- Never weaken RLS, expose service credentials to the client, or edit generated/build output as the source fix.
- Retest the reproduction, adjacent state transitions, full tests, build, and working-tree whitespace.

## 6. Exit criteria

Complete only when:

- Every scoped feature has `pass`, `fail`, `blocked`, or `not tested` plus evidence.
- Every confirmed fix was retested.
- The full deterministic gate was rerun after fixes.
- Remaining S0/S1 findings and blockers are explicit.
- The report distinguishes verified facts from inferences and recommendations.

## Standards basis

- W3C WCAG 2.2 Quick Reference: https://www.w3.org/WAI/WCAG22/quickref/
- Playwright testing best practices: https://playwright.dev/docs/best-practices
- OWASP Web Security Testing Guide: https://owasp.org/www-project-web-security-testing-guide/
- Web Vitals: https://web.dev/articles/vitals
