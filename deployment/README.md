# Batched Netlify Production releases

Production releases require actual deployment input changes, at least 48 hours
between regular releases, and at most one release per KST date. Preview builds
remain enabled. The daily planner runs at 09:20 KST.

Only the dedicated Production release job grants contents: write,
pull-requests: write and actions: write to the default GITHUB_TOKEN. Repository
default permissions remain read, and other workflow permissions are unchanged.
The separately approved "Allow GitHub Actions to create and approve pull
requests" setting is enabled for PR creation. The workflow never approves
reviews, changes protection, creates a PAT or adds bypass actors.

The planner compares deployment inputs with the successful public Netlify SHA
and uses its published_at. Documentation, tests and marker changes alone do
not count. NO_CHANGES and WAITING_WINDOW / WAITING_DAILY_LIMIT create no release
branch or PR. Manual workflow_dispatch defaults to dry_run=true. Manual
force=true bypasses only 48 hours; changes and the KST daily cap remain required.

READY creates a new codex/production-release-* branch at exact current main,
modifies only app/release/production.json, checks cached filenames before commit,
checks main again before push, and pushes exclusively to that new branch.
An existing open release PR blocks duplicate creation.

The workflow creates a marker-only PR to main, explicitly dispatches
public-homepage-checks.yml and phase1a-supabase-integration.yml, and verifies
new workflow_dispatch runs and required jobs at the exact release head SHA.
It never relies on pull_request events triggered by GITHUB_TOKEN or reuses
past CI success. Failed or timed-out CI leaves the PR open for inspection,
blocks merge, and prevents automatic creation of repeated release PRs.

Immediately before squash merge it rechecks both runs, the PR head, remote diff
and marker content, actual public Production time, KST date, and current main.
The diff must contain exactly app/release/production.json. The marker must have
interval_days=2, previous release_attempt + 1, and source_main_sha=current main.
Stale releases are closed without merge and replanned by a later run.

GitHub's merge API pins the PR head but has no atomic expected-base parameter.
The workflow checks main immediately before merge; the Netlify gate additionally
requires the squash commit's first parent to equal marker source_main_sha.
A main race therefore blocks Production even if GitHub accepted the squash.
Existing required checks and protection remain enforced by GitHub.

Only a marker-only squash commit passes the Git Production gate. Ordinary main
commits and the initial policy PR skip Production. After merge the workflow
checks that public Netlify Production is ready at the exact squash SHA. A failed
deployment is not retried: an unpublished previous marker attempt blocks future
automatic attempts until investigated. No emergency CLI/API upload is used.

## Verified service configuration, 2026-10-06

- Main retains Protect main: required PR, both existing required CI checks,
  approving review count 0, no bypass actors.
- Netlify Production branch remains main; base directory remains the repo root.
- Authenticated Build Hook count is 0.
- prevent_non_git_prod_deploys=true, explicitly approved by the user.
- An authenticated non-Git Production API request with an unuploaded file digest
  was rejected with Forbidden. No files were uploaded or Production published.
- This setting restricts deployment methods. Existing Functions, Forms,
  Supabase and public runtime configuration are unchanged.

## Verification boundary

Local Git fixtures test unchanged remote main, marker-only branch commits,
stale planning, ordinary Production skips and marker-only squash allowance.
API fixtures test PR creation, explicit dispatch, exact-head success, failure,
duplicates, stale main, changed marker/head/files and daily revalidation.
PR #397 CI and Deploy Preview are checked separately at its latest head.
Live automated marker PR/CI/squash/Production verification must occur only after
the user reviews the final report and authorizes proceeding with the policy PR.
No Production force release is part of pre-merge verification.
