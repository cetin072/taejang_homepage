# Issue #438 — Production release recovery, 2026-10-19

## Authorized scope and current outcome

The user approved release of current already-merged main, preserving protected
main, marker-only squash and Netlify Production gate. Production DB migrations,
real employee/account changes, permissions expansion and new credential/security
provisioning are excluded. Automation fixes are a separate Draft PR.

Stage 1 is SAFETY HOLD, not deployed. Read-only Netlify API confirms:

- latest main: 7983c988f19a6c10fa96fee808babe1ebc996614
- published Production: c754f8999c45b3a7b920ced359441c03c412d34c
- ready deploy: 6ad05eda043a65b50117e8d5
- actual published_at: 2026-10-15T05:04:40.911Z (14:04:40 KST)
- PR #480 is open, non-Draft, only app/release/production.json, head 91754e6e56d851eb3430a1a6d7a48c673a902c84
- failed release run: https://github.com/cetin072/taejang_homepage/actions/runs/39097783369

## Database safety evidence (read-only catalog/aggregate queries)

Production public staff-config connects to jgsxpdflgkqroecfjzxq, an operational/QA
shared DB despite its staging name. It contains other applications' migrations;
never apply/repair the complete local-vs-remote migration difference.

New main migrations are not in live history by version or name:

- 20261016033659_lead_compensation_access_denial.sql (#474/#475)
- 20261016100000_lead_staff_roster_resident_number.sql (#471/#472)

Read-only aggregates show lead payroll grants still present, the narrow
employee.resident_number_manage capability absent, and
get_employee_resident_registration_number(uuid,text) absent. These results
contradict assuming the merged UI's new authorization/server contract is ready.
Do not fix this by hiding buttons, granting roles or applying SQL without the
separate encrypted-backup/isolated-restore approval gate.

save_lead_notice now exists; the older notice-readiness document's historical
absence is not the current state. A current date/name match alone must never
replace catalog readback. No operational rows were queried or modified.

## Undeployed scope and rollback boundary

Seven main commits since the published release cover employee-app public links,
lead payroll exclusion, employee management/resident-number UI, notice missing-RPC
handling, promotion authoring simplification/role parity and notice default expiry.
Employee/payroll server dependencies make an all-main release unsafe today.
No partial branch deployment was substituted for the authorized latest-main scope.

The existing ready published release stays active. No DB mutation or deploy was
performed, so no restore is required. Recovery after a future bad publication is
a reviewed revert/forward fix through existing protected CI/marker release.
Authenticated real administrator read-flow verification is not claimed; no new
login/employee account or test data was created. Local synthetic browser checks
cover notice/promotion desktop/mobile widths, not real operational data.

PR #480 is retained for investigation; its marker date is 2026-10-18 and must be
revalidated/replanned before a later release. It is not merged, approved, closed
or given an empty commit. Closing it now could unblock the old scheduler, which
has no DB gate; this Draft implementation is not active protection.

## Root cause and implementation

Bot-created genuine PR runs 39097797220 and 39097797302 at the exact #480 head
completed action_required with no required jobs. Dispatch success did not fulfill
Protect main ruleset 22501014. Its required names remain:
Public source and launch regression; Migration, pgTAP, Auth and RLS.

Repo secret names/variables have no release App identity. The connected CLI
credential cannot list GitHub App installations (403); absence of an App itself
is not asserted. No credential values were printed or copied. Human approval and
provisioning are required before live unattended verification.

Implementation keeps existing planner/gate, replaces dispatch substitutes with
bounded genuine-PR checks, supports repository-limited App tokens, detects
stale/stalled/failed/approval-required PRs, checks DB history twice, retains exact
public SHA verification and updates existing Issue #438 on failure. No new
service, paid dependency, protected-rule edit or main/Production modification.

## Verification and rollout status

| Requirement | Current evidence/status |
| --- | --- |
| no changes / 48h / KST daily / READY | existing planner fixture tests PASS |
| real PR CI / protected squash | orchestration fixtures PASS; live App reproduction pending provisioning |
| failed/missing/approval-required CI | classification and orchestration fixtures PASS, no merge/rerun/dispatch |
| open duplicate/stale/stalled PR | fixtures PASS, read-only reporting/no duplicate |
| DB incompatibility | fixture PASS before branch and before merge; actual missing contracts confirmed |
| Netlify failure/wrong SHA/Preview | exact published-deploy predicate fixture PASS |
| remote main/marker-only gate | isolated Git fixture PASS, existing Netlify gate unchanged |
| notifications | mock GET/POST/PATCH dedup and human-comment preservation PASS; no live failure manufactured |
| exact final HEAD hosted CI/browser | record on Draft PR after push; not inferred from local tests |
| operational automation rollout | not merged, no App setup, not live |
| current pending Production release | SAFETY HOLD; DB approval/readback and valid PR checks needed |

Commands and final exact-head results belong in the linked Draft PR. The planning
source is the user's 2026-10-19 Production recovery instruction plus Issue #438
and deployment/release-policy.json; this document records its approved scope.
