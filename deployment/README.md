# Batched Netlify Production releases

Production policy is 48 hours between releases and at most one release per KST
date. Deploy Previews continue to build. Only the dedicated Production release
job has `contents: write`; repository defaults and other workflows are unchanged.

The daily check runs at 09:20 KST. It compares actual deploy inputs against the
successful public Netlify deployment SHA and uses its `published_at` for the
48-hour window. A failed attempt's checked-in marker does not replace this public
source. Marker attempts also respect the same daily/window limits to avoid
repeated paid attempts. Documentation, tests, and marker-only changes do not
count as pending site updates.

Results:
- `NO_CHANGES`: no deploy input changed.
- `WAITING_WINDOW`: less than 48 hours since successful Production or last attempt.
- `WAITING_DAILY_LIMIT`: a successful release or attempt already occurred on this KST date.
- `READY`: the policy permits a release.
- `RETRY_NOOP`: main changed after planning, or the KST date changed; no push.
- `PROTECTION_BLOCKED`: existing main rules require a PR or CI; no marker mutation/push.
- `DRY_RUN_READY`: main and policy are current, but the requested dry-run publishes nothing.

Manual workflow dispatch defaults to `dry_run=true`. `force=true` is accepted
only on manual dispatch, still requires deploy input changes, and cannot bypass
the daily limit. It bypasses only the 48-hour window.

The release executor checks clean tracked state, fetches main again before
marker creation, stages only `app/release/production.json`, verifies
`git diff --cached --name-only`, checks main again before commit and push, and
uses a non-forced push. A concurrent merge or protection rule rejects the push.
The Netlify gate compares the current commit with its first parent and requires
a marker-only commit whose source SHA equals that parent. Introducing the first
marker does not publish the policy PR.

After push, the workflow polls public Netlify deployment metadata for the exact
release commit. Verification failure does not trigger an automatic redeploy.

## Integration holds before merge

The current active repository ruleset requires a PR and the two existing CI
checks, with no bypass actors. Direct GITHUB_TOKEN pushes are therefore blocked.
The workflow preserves these rules and explicitly reports PROTECTION_BLOCKED.
A marker-only release PR is an alternative requiring a separate workflow design;
this change does not grant pull-request write permission or modify Actions settings.

Authenticated Netlify API inspection on 2026-10-06 found zero external Build
Hooks. The Production branch is main and the base directory is the repository
root. No Hook was deleted or changed. The site setting
`prevent_non_git_prod_deploys` is false, so authenticated CLI/API uploads can
bypass the Git gate. This setting was not changed. The project cannot be marked
PASS until this remaining Production path is addressed. Enforcing Git-based
Production deployments can close it while preserving Preview deployments.

Functions, Forms, Supabase runtime behavior and application schedules are outside
this change. No Production deployment should be run solely to test this policy.
