# Official Naver archive recovery — 2026-11-06

Scope: resume Draft #549, preserve the current renderer/data contract and fixed 72-hour release policy. No Ready transition, main merge, production deployment or settings changes.

## Cause and behavior

The old workflow collected against main, then discarded its working-tree additions whenever any archive PR was open. It now selects one same-repository, bot-authored, data-only Draft before collection, verifies every unmerged commit author, checks out its exact head and merges main. Existing pending records remain the collector's deduplication input. Ready, human-edited, mixed-code, multiple or changed-head proposals fail closed. Before a normal non-force push it rechecks Draft/open/head status. No new PR is created for a resumed Draft. Manual runs remain read-only.

Collection success is not publication. Pending review remains visible and cannot acknowledge a completed slot. This recovery PR includes code and human commits, so it is intentionally protected from later automated edits until reviewed/merged; future bot-only content Drafts can accumulate new entries.

## Source evidence

The parent task independently fetched the official RSS with HTTP 200 on 2026-11-06 and supplied title, pubDate, canonical URL and RSS thumbnail for all ten IDs. Nine new records use that evidence; the existing #549 record is preserved. Korean publication dates, not dates mentioned inside article text, are used.

| logNo | Publication date (KST) |
| --- | --- |
| 224462019863 | 2026-11-06 |
| 224461973296 | 2026-11-04 |
| 224457420719 | 2026-11-04 |
| 224456648628 | 2026-11-03 |
| 224456615594 | 2026-11-03 |
| 224456586600 | 2026-11-02 |
| 224456537984 | 2026-11-02 |
| 224443405480 | 2026-10-29 |
| 224451317599 | 2026-10-29 |
| 224443404484 | 2026-10-28 |

Source: https://rss.blog.naver.com/taejang-official.xml and https://blog.naver.com/taejang-official/{logNo}.

The execution environment's direct RSS request returned proxy CONNECT 403. Independent article OG/image-byte validation here is therefore not claimed. Existing build-time localization and local-image fallback are unchanged. This is archive card/link recovery, not copying full article bodies or expanding YouTube.

## Validation

Results and exact final HEAD are recorded in PR #549. Automated regressions cover eligible Draft resume, human/Ready/fork/mixed-file protection, changed-head protection, normal push, ten recovered IDs, preserved records and idempotent reruns. Required public tests and Netlify bundle build are run locally; external image availability and hosted checks must be reported separately.
