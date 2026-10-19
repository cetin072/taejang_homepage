# Batched Netlify Production releases

Current contract: [NETLIFY_48H_PRODUCTION.md](../docs/operations/NETLIFY_48H_PRODUCTION.md).
Confirmed planning: [ISSUE_438_FIXED_PRODUCTION_SCHEDULE.md](../docs/planning/ISSUE_438_FIXED_PRODUCTION_SCHEDULE.md), revised by the user's three-project normalization request on 2026-10-19.

Daily 17:20 KST wake-ups admit fixed 48-hour slots anchored at 2026-10-19 17:20.
The first is Oct 21, then Oct 23, Oct 25, including month/year transitions.
Only approved latest main web-input differences from actual published Production can
request one Git Build Hook. Require at least 48 actual hours after publication.
No changes means no POST, Git mutation, release marker commit or release PR.

GitHub uses read-only Contents/Actions permissions. No dedicated GitHub App,
new PAT, direct main commit, automatic PR merge or deployment upload is needed.
The only new secret is the repository's Netlify build-hook URL; never print it.
Manual dispatch is always read-only, including on a Draft branch.

Ordinary main Git builds stop via ignore; Preview stays enabled. Because Netlify
hooks bypass ignore, build.command independently checks exact SHA, main branch,
site/repository, fixed slot, issued time, hook title and last publication time.
A moving main or stale payload fails before producing new public output.
The marker is generated only inside the build and preserves the public metadata contract.

Failure leaves the last published version authoritative. Never retry the POST in
the same run; retry at the next fixed slot. Observe exact public SHA before reporting
PUBLISHED. Concurrent, late and rerun attempts cannot release twice.
DB readiness remains a read-only preflight; no DB migration or operational write.

Activation: configure NETLIFY_PRODUCTION_BUILD_HOOK, finish PR CI/Preview,
merge through existing protection, run a read-only main dispatch, then set
NETLIFY_PRODUCTION_RELEASE_ENABLED=true. This does not itself publish.
Retire obsolete Draft #480 without merging after activation.

The old marker-only publisher CLI is disabled. Its helpers/tests remain historical
regression evidence, not an alternative deployment route. Existing Netlify
prevent_non_git_prod_deploys=true, main protection and PR Preview are retained.
