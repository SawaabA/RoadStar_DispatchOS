# Audit report format

Lead with the release decision and verified scope.

## Executive result

- Decision: `ready`, `ready with known limitations`, or `not ready`.
- Environment and commit/branch.
- Features passed / failed / blocked / not tested.
- S0 / S1 / S2 / S3 counts.
- Highest residual risks.

## Findings

Order by severity, then user impact. For each finding include:

| Field | Required content |
|---|---|
| ID / severity | Stable ID and S0-S3 |
| Feature / role | Affected workflow and user |
| Impact | Concrete operational consequence |
| Reproduction | Preconditions and minimal numbered steps |
| Expected / actual | Observable difference |
| Evidence | Test, log, screenshot, request, or clickable source location |
| Root cause | Verified cause or clearly labeled inference |
| Resolution | Fix and regression test, or recommended action |
| Status | Open, fixed and verified, blocked, or accepted limitation |

## Feature traceability

Include every scoped feature with requirement source, verification performed, result, and evidence. Do not collapse untested features into a general pass.

## Verification record

List exact commands and browser journeys with their results. Summarize output; do not paste secrets or huge logs.

## Remaining limitations and next actions

Distinguish product limitations already documented from new defects. Give the smallest ordered set of next actions, with S0/S1 first.
