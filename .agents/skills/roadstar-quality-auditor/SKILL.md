---
name: roadstar-quality-auditor
description: Audit RoadStar DispatchOS end to end for functional bugs, regressions, usability problems, accessibility gaps, data-integrity risks, security mistakes, and deployment blockers. Use when asked to audit, QA, bug-hunt, test all features, improve user friendliness, prepare a release, or find and fix defects across the RoadStar app. Do not invoke for a small isolated edit or a narrow question that does not request broader quality review.
---

# RoadStar Quality Auditor

Treat product claims as hypotheses until verified. Work from observable evidence, preserve unrelated user changes, and never report a feature as passing solely because it compiles or renders.

## Choose the operating mode

Infer the narrowest authorized mode from the request:

- **Audit:** inspect and report; do not modify product code.
- **Audit and fix:** reproduce confirmed defects, implement scoped fixes, and retest them.
- **Release gate:** audit and fix, then run the complete regression and deployment-readiness checks.

Creating test data and starting local services are normal verification steps. Do not mutate production data, weaken authorization, expose secrets, apply remote migrations, or deploy without explicit authorization.

## Execute the audit

1. Read `README.md`, `docs/P0-implementation.md`, `docs/architecture.md`, and relevant product references before judging completeness. Read [references/roadstar-feature-matrix.md](references/roadstar-feature-matrix.md).
2. Inspect `git status`, the repository layout, package scripts, environment examples, migrations, and service documentation. Preserve existing work and keep secrets out of output.
3. Build a traceability matrix containing every in-scope feature, its promised behavior, code path, verification method, evidence, and result: `pass`, `fail`, `blocked`, or `not tested`. Never silently omit a feature.
4. Run `scripts/run-quality-gate.ps1` from the repository root for deterministic baseline checks. A failed check is evidence to investigate, not permission to erase or bypass it.
5. Follow [references/audit-protocol.md](references/audit-protocol.md). Test the smallest risky core first: authentication and organization isolation, dispatch feasibility and state transitions, persistence/realtime behavior, then the remaining journeys.
6. Exercise user journeys in a real browser when browser interaction is available. Use accessible roles or labels, verify user-visible outcomes, and cover normal, empty, loading, error, retry, stale-data, and invalid-input states. Inspect the console and network failures. Do not rely only on snapshots or implementation selectors.
7. Apply [references/usability-accessibility.md](references/usability-accessibility.md) and [references/security-data.md](references/security-data.md) to every relevant journey.
8. In audit-and-fix mode, reproduce each defect before editing. Prefer the smallest root-cause fix, add or improve a regression test when practical, rerun the nearest check, then rerun the full quality gate. Do not disguise a product bug by weakening a test.
9. Deliver the report using [references/report-format.md](references/report-format.md). Include evidence, residual risk, blocked checks, and exact next actions.

## Evidence and completion rules

- Record the environment, command, route, account/data state, steps, expected result, actual result, and supporting log, screenshot, or code location for every failure.
- Assign severity by impact, not inconvenience: `S0` release blocker or security/data-loss risk; `S1` core workflow unusable or seriously wrong; `S2` meaningful degradation with a workaround; `S3` polish or low-risk friction.
- A fix is complete only when its reproduction no longer fails and relevant regression checks pass.
- An audit is complete only when all in-scope matrix rows have a result and evidence. Name anything not tested and why.
- Stop and report rather than inventing credentials, bypassing RLS, changing live data, or claiming unavailable external systems worked.
