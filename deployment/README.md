# Batched Netlify Production releases

Production requires real deployment input changes, at least 48 hours between
regular published releases, and at most one release per Asia/Seoul date.
The planner checks daily at 09:20 KST; that schedule is not a promise of an exact
48-hour publication time. Actions may start late. Manual dispatch defaults to
`dry_run=true`; `force=true` bypasses only 48 hours, never daily limits or gates.

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
release branch/PR. Dry-run uses read access and never creates a release.

The default token has Contents read and Issues write solely for updating the
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

An existing release PR prevents duplicates. Its source/date, required checks and
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

Failures update one bot-owned comment on existing Issue #438 and write the run
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

This change is not active until its Draft PR is reviewed and merged. App setup
and live automatic-PR reproduction remain separate rollout gates. See
`docs/operations/ISSUE_438_PRODUCTION_RELEASE_RECOVERY.md` for current evidence.
