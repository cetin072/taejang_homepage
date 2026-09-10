# Payroll AI Architecture Classification Note

Status: **REFERENCE ONLY / CENTRAL ISSUE #21 IS THE LIVE CANDIDATE SOURCE**

This note does not copy or freeze the central architecture candidate. For future AI-related payroll design, always re-read the latest:

`cetin072/ai-development-system` Issue #21
`architecture-candidate: low-cost AI integration with rules + ledger + batch AI`

Current payroll classification:

| Area | Current decision |
| --- | --- |
| Code | wages, weekly holiday, effective terms, lifecycle, validation, permissions, carryover, accounting basis, locks |
| Official ledger | Employee lifecycle, accepted attendance import, corrections, employment terms, runs/results, adjustments, comparisons, audit facts |
| Optional AI | anomaly explanation, exception-summary drafting, management briefing, semantic review prioritization |
| Realtime AI | not required for current payroll MVP |

Core rule: **Deterministic by Default, AI by Necessity.**

AI failure must not prevent payroll input, storage, deterministic validation, calculation, review, accounting comparison or month-state management. AI must not become an authoritative source of wage amounts or permissions.

This project must not be rewritten merely to fit the candidate architecture.
