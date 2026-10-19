# Batched Netlify Production releases

Production requires web deployment input changes, at least 48 actual hours since
successful public publication, and at most one release per Asia/Seoul date.
The daily 17:20 KST trigger is only a wake-up: fixed slots are counted from
2026-10-19 17:20 KST, with the first check on **2026-10-21 17:20 KST**, then
Oct 23/25/27 and every 48 hours across month/year boundaries. The anchor is not
a release. Never use day-of-month `*/2` or reset the clock after NO_CHANGES.

A trigger may evaluate only the first 24 hours of its fixed slot. Its actual
Actions created_at must belong to that slot; a delayed old/off-day trigger never
catches up in another slot. Current/earlier live Actions runs (including failed,
cancelled and queued checks) consume that slot. Reruns cannot release again.
Read-only dry-runs do not consume it. Actions concurrency serializes execution;
the public 48-hour/KST cap is rechecked before merge. Late publication may make
the next fixed slot WAITING_WINDOW; later slots stay anchored, not postponed.

Compare actual published_deploy.commit_ref with latest main, excluding Draft
PRs. Static published assets, Netlify Functions/shared code, root dependencies,
Netlify configuration and both the publish builder and its article-generator
import count. Documentation/tests/.github/mobile/ios/android/release-marker-only
changes do not. NO_CHANGES creates no branch, PR, marker, commit or Netlify API
write. Only the Actions result/summary records it; the next fixed slot is unchanged.

Manual dispatch defaults to `dry_run=true`, including App authentication checks.
There is no force/48-hour bypass. A dispatch on an unmerged branch is allowed only
in dry-run and evaluates origin/main, never that Draft PR as deployable content.

## Release identity and required checks (Issue #438)

The default GITHUB_TOKEN cannot provide unattended PR checks: PRs created with
it enter approval-required state. A successful workflow_dispatch is not a
substitute for the PR's required check. Do not add empty commits, fake statuses,
bypass actors, approve checks automatically, or weaken Protect main.

After explicit administrator approval, install a repository-scoped GitHub App
with Contents write, Pull requests write, Actions read and implicit Metadata read.
No administration, workflow-write or bypass permission is requested. Configure:

- repository variable `PRODUCTION_RELEASE_APP_ID`
- repository secret `PRODUCTION_RELEASE_APP_PRIVATE_KEY`

Use GitHub settings to enter the private key; never paste it into issues or logs.
`actions/create-github-app-token@v2` restricts the installation token to this repo
and revokes it at job end. The checkout does not persist credentials; authenticated
Git uses the job's App token. Missing App configuration fails before creating a
release branch/PR. Dry-run verifies a real repository-limited App token using GETs and never creates a release.

The default token has Contents read, Actions read for slot history, and Issues write solely for updating the
existing incident #438. Other workflows and repository default permissions stay
unchanged. App creation/installation and secret provisioning require a human;
this implementation does not create them or assume they are already configured.

Official sources:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://github.com/actions/create-github-app-token

## Database compatibility

Before branch creation and again just before merge, compare added migrations
between the actual public Production SHA and planned main with live migration
history. `SUPABASE_ACCESS_TOKEN` is the existing credential; the preflight makes
only a catalog SELECT through the Supabase Management API. It does not read
employee data, create accounts or apply migrations. The configured backend ref
must be confirmed against public staff-config before rollout.

Missing migrations return DB_NOT_READY. Modified/deleted/renamed migrations
require explicit review. A live timestamp may differ from Git history, so match
the exact normalized migration name; unrelated foreign migrations do not qualify.
The history gate is conservative evidence of application, not proof of correct
ACL/RLS/function bodies or permission to apply anything. Separate sensitive DB
backup, isolated restore and post-application readback approvals still apply.

## Execution and failure handling

READY creates one codex/production-release-* branch from exact latest main and
changes only app/release/production.json. Genuine pull_request runs must identify
the exact head, PR number and both required successful jobs. Polls are bounded
(15 minutes per workflow, at most 30 minutes total); no rerun/dispatch substitutes.
Failed, missing, wrong-source or approval-required checks block the merge.

A pushed release branch without any associated PR blocks further branch creation
(ORPHAN_RELEASE_BRANCH), preventing infinite retries after PR-creation failure.
A marker-only orphan at least 24 hours before the new slot, with the expected
single parent and an ancestor source proven through compare, is preserved but
no longer blocks a later slot. No ref is deleted or rewritten. Ambiguous/new
orphans remain incidents. An existing release PR prevents duplicates. Its source/date, required checks and
age are inspected: stale, approval-required, failed, not-started or stalled (>30
minutes) releases become incidents, rather than silently returning a healthy no-op.
Existing PRs are never automatically merged just because an earlier run passed.
The operator repairs the cause and revalidates all gates before resuming.

Before squash merge, recheck remote head, exact marker-only diff/content, latest
main, both required runs, public release time/date and database readiness. The
Netlify first-parent marker gate remains unchanged and blocks a stale-base race.
Only Git marker-only squash releases can publish. Ordinary main commits skip.

After merge, poll actual published_deploy for ready + production + exact squash
SHA, for a bounded time. Preview, main merge, build readiness and a previous
published SHA never count as success. Timeout/failure does not redeploy; an
unpublished marker blocks subsequent automatic attempts pending investigation.

A separate failure job also handles release-job cancellation/timeouts. Failures update one bot-owned comment on existing Issue #438 and write the run
URL to the Actions job summary. Comments use a fixed non-sensitive message and
do not include environment/credentials or remote error bodies. Repeated failures
update the existing alert, not a new issue/comment each time. GitHub notification
preferences control delivery; this is not an external paging service.

## Production protection and recovery

Preserve Protect main, exact required check names, no bypass actors, marker-only
squash and Netlify prevent_non_git_prod_deploys. No CLI/manual Production upload.
If a deploy fails, the previous published deploy remains active. A bad published
release requires a reviewed forward fix/revert and the normal CI/marker release
path; do not silently restore deploys or mutate the DB as recovery.

Transition order: finish #481 CI, configure and authenticate the dedicated App
with a read-only branch dry-run, then protected-merge #481, verify the active
schedule/authenticated main dry-run, and only then retire stale Draft #480.
Never merge #480 or remove its old-scheduler safety barrier early.

This change is not active until its Draft PR is reviewed and merged. App setup
and live automatic-PR reproduction remain separate rollout gates. See
`docs/operations/ISSUE_438_PRODUCTION_RELEASE_RECOVERY.md` for current evidence.
