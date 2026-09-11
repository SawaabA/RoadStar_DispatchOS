# Usability and accessibility review

Target WCAG 2.2 AA for applicable web UI. Automated checks are a baseline; complete keyboard and visual inspection manually.

## Operator usability

- The current fleet state, urgent exceptions, and recommended next action are obvious within seconds.
- Primary actions use plain operational language and appear near the information needed to decide.
- Dense screens support search, filters, sorting, sensible defaults, and progressive disclosure without hiding critical risk.
- Status, units, timestamps, freshness, and whether data is demo/live/cloud are explicit.
- Color never carries meaning alone; labels and icons are consistent across boards, map, driver view, and 3D loader.
- Consequential actions prevent mistakes, show progress, prevent double submission, confirm success, and offer recovery when feasible.
- Empty, loading, offline, stale, permission-denied, validation, and server-error states explain what happened and what to do next.
- User input survives recoverable failures. Error messages appear next to the cause and preserve context.
- Verify realistic high-density data, long names, narrow desktop widths, zoom at 200%, and no accidental horizontal traps.

## Accessibility checks

- Page structure has a unique title, landmarks, ordered headings, and a bypass path where repeated navigation exists.
- Every control has an accessible name matching its visible label; icon-only controls have meaningful names.
- Native interactive elements are used when possible. Custom widgets expose correct name, role, value, state, and keyboard behavior.
- All workflows work with keyboard alone; focus order follows the visual task flow, focus is visible and never trapped or obscured.
- Modals move focus inside, keep it contained, close predictably, and restore focus to the trigger.
- Forms associate labels and instructions, identify errors programmatically, suggest corrections, and review consequential submissions.
- Text and non-text contrast meet WCAG AA; focus indicators and status changes remain perceivable.
- Dynamic success, error, loading, connection, and plan-result messages are announced without stealing focus.
- Maps, charts, canvas, and 3D scenes have equivalent textual summaries and operable alternatives for essential information/actions.
- Motion respects reduced-motion preferences; updates do not flash or shift focus unexpectedly.

## Task-based evaluation

For each core role, start from the normal entry screen without coaching and measure:

- Whether the task can be completed correctly.
- Time and interaction count relative to the task's complexity.
- Wrong turns, ambiguous labels, hidden dependencies, and recovery effort.
- Whether the user can explain the outcome and its consequences.

Do not call a flow user-friendly when it requires source-code knowledge, unexplained domain abbreviations, or invisible state assumptions.
