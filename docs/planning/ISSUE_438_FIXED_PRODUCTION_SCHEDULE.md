# Issue #438: fixed 48-hour Production checks

Status: confirmed 2026-10-19 by the user Goal; implementation on existing PR #481.
This replaces the earlier daily 09:20 / moving-interval schedule and manual force
exception. Existing architecture, GitHub App, CI, DB and Netlify gates are reused.
Shared deployment tooling remains repository-scoped; no new platform abstraction.

## Confirmed contract

- Anchor 2026-10-19 17:20 Asia/Seoul (08:20 UTC), first slot +48h on Oct 21.
  Future slots are anchor + N*48h for N>=1, independent of month/year boundaries,
  successful release time and NO_CHANGES. Daily 17:20 trigger wakes the planner.
- Only the first 24h of a slot admits its delayed trigger. A run's created_at
  owns its slot, and it cannot migrate into a later slot. Live run history and
  run_attempt suppress retries/concurrent checks, including after NO_CHANGES or
  failure. Dry-runs are observation only. No catch-up releases, force, empty
  commits, PR required-check substitutions, admin bypass or Netlify forced deploy.
- Diff actual ready/published Production SHA against latest main. Include static
  site/platform assets, Functions/shared code and web build dependencies/config.
  Exclude docs/tests/GitHub management/marker/native mobile-only changes. Draft
  PR code is never considered deployable; branch dry-run plans origin/main.
- NO_CHANGES: no branch/PR/marker/commit/Netlify write; Actions records status and
  next fixed check. No incident on an ordinary no-change/wait result.
- READY: DB migration history/compatibility preflight; marker-only branch/PR;
  genuine exact-head required CI; latest-main/public-time/DB recheck; protected
  squash; actual public Production ready + exact squash SHA. MERGED is not
  PUBLISHED. Bounded observation failures notify, never request another deploy.
- At most one publication per slot, minimum 48 actual hours since publication,
  and at most one per KST date. A late prior publication skips the next slot
  when needed; it never shifts the anchor.
- Dedicated App: only this repo; Contents write, Pull requests write, Actions
  read, implicit Metadata read. No third-party App key reuse. Human creates,
  installs and saves the PEM directly to GitHub Secrets. No credentials in logs.
- Retain Draft #480 until the new authenticated scheduler is active, then retire
  it without merging. Stale/open/unsafe PRs notify instead of silently blocking.
  Proven expired marker-only orphan refs are preserved and ignored read-only;
  ambiguous refs stop and notify. No generic automatic PR-close code is added.
- Auth/CI/DB/publication failure or release-job timeout updates the existing
  bot-owned #438 alert, without duplicate issues or blind retries.

## Implementation and verification mapping

- Implemented: schedule policy and pure calendar/history guards in
  scripts/production-release-schedule.mjs; daily trigger; web input classifier;
  existing orchestration/DB/genuine-CI/marker gates; exact publication observer;
  separate failure job; safe branch dry-run/App repository verification.
- Tests: production-release-schedule.test.mjs covers fixed slots, 900 slot
  transitions including leap/month/year, delayed/concurrent/rerun history,
  sequential NO_CHANGES, mobile-only exclusions, 48h cap and expired orphan
  classification. Existing policy/health tests cover genuine PR/squash happy
  path, stale heads/extra files, failed CI, pending DB, auth/report configuration,
  and Netlify failure after merge. All are registered in the public CI group.
- Pending rollout: exact final-head CI, human App provisioning/authenticated
  dry-run, protected #481 merge, active scheduler verification, #480 retirement.
  Do not report automation restored until those actual gates pass.

The 2026-10-19 reference Production is 8489a19980c12317337728d42ccdf84c07ed3a5e,
published 17:04:16 KST. That is historical evidence, not a substitute for live
published_deploy verification. Operational DB recovery and approved migrations
were completed under #474; this work performs no new operational DB mutation.

## Final implementation notes and rollout evidence

- Slot admission now precedes public Production fetch and git content comparison;
  off-day/duplicate/missed live slots stop before either operation. NO_CHANGES
  also skips the release step itself, including local git identity setup.
- Failure alerts use a fixed allowlist of safe categories (App configuration,
  authentication/scope, slot history, planning, DB/CI/protected merge,
  unconfirmed publication, timeout/setup). Arbitrary remote errors are not echoed.
- Unrelated open PRs are paginated (up to ten pages, fail closed on incomplete
  history). Normal archived release refs have no arbitrary 100-ref cutoff.
  Proven old marker-only orphan refs remain untouched; unknown refs still alert.
- Local release tests at code commit 28a6576990ffbf7a5ce5f8a10b77f397260bff88:
  40/40 PASS, including the >100 unrelated PR/archived-ref case.
  Earlier hosted CI at 8919c519 is separate evidence; it cannot substitute for
  exact final PR-head CI. Check the live PR before rollout.
- Human App provisioning, real read-only authentication and protected activation
  remain pending. Production and #480 are preserved until that transition.
