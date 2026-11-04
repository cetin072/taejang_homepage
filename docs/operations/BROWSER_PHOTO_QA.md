# Browser photo QA transport

Public UI regression tests use `tests/helpers/photo-safe-browser.mjs` before creating pages. Storage image GETs receive a 68-byte synthetic PNG; other Storage requests abort. The matcher covers public/signed/render paths, custom domains and encoded Image CDN source URLs. Service workers are disabled so they cannot bypass context routing. Popups inherit the route. Later broad routes must use `route.fallback()` for reads; `route.continue()` bypasses earlier routes.

This verifies layout, navigation, fallback state and image decoding with fixtures. It does **not** verify the existence, pixels, authorization or download cost of production photos. Same-origin checked-in photos (including official Naver snapshots) remain real assets.

## Audit scope

- #561 already guarded archive-initial-render, but blog-card still loaded the real initial archive snapshot before the delayed fixture feed.
- Latest main and remote branches/open PRs were checked before implementation. #563 is a separate, disabled R2 runtime pilot; #555/#549 are archive content and #546 is missing-photo authoring. None supplies this shared test transport. #567 is unrelated Preview asset retry work.
- Guarded runners: promotion-blog-card, archive-initial-render, hero-article, employee-app and its public-header helper (including navigation to index), official-archive-thumbnails, homepage-about-photo08, partnership, community-esg, attendance-vendor-xls (its hosted about-page check).
- Other browser runners use internal app/gate fixtures, synthetic photo URLs, local mock APIs or explicit all-network interception. This change does not replace their Auth/Storage integration fixtures or mutate operational data.
- The manually invoked `scripts/check-public-promotion-images.mjs` now defaults to fixtures and reports `photoMode=fixture`, `ogStatus=fixture-not-probed`. Its API/HTML reads remain real when a hosted base is supplied. It does not claim live image validation in fixture mode.

## Deliberate live exception

Only the audit script accepts `PUBLIC_IMAGE_QA_LIVE_PHOTOS=1`, with 1–3 explicit `PUBLIC_IMAGE_QA_REQUIRED_IDS`. It checks only those details at three widths, admits only exact selected representative-image URLs, and shares a maximum of 12 Storage image GETs across all contexts. Unselected gallery images abort; whole-home/archive sweeps are omitted. This is a request-count ceiling, not a byte ceiling. Live use still requires a deliberate approved audit; routine CI never sets this flag. No live photo audit was used to validate this change.

The guard covers browser requests whose URL identifies Storage (including encoded proxies). It cannot intercept Node/server-side fetches, arbitrary opaque image proxy URLs, or a permitted non-Storage URL redirecting to Storage. New proxy/CDN transports must add fixture interception before navigation. The unmerged R2 pilot has its own synthetic browser tests.

## Safe regression commands

- `node --test tests/photo-safe-browser.test.mjs tests/test-manifest-coverage.test.js`
- `CHROME_PATH=/usr/bin/chromium node tests/photo-safe-browser-regression.mjs`
- `CHROME_PATH=/usr/bin/chromium node tests/promotion-blog-card-browser.mjs`
- `CHROME_PATH=/usr/bin/chromium node tests/archive-initial-render-browser.mjs`

The standalone guard regression serves only loopback fixture HTML and asserts **zero upstream Storage/proxy hits** for initial HTML, JavaScript off, popups, lazy signed images, encoded proxies, GET/HEAD/POST. It runs in Promotion Browser QA before the existing card/archive tests. Unit tests cover the shared live request budget and runner adoption. Public tests include the unit regression.
