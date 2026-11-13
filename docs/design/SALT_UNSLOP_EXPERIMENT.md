# Salt / Unslop experiment

Base: 23551c8d6bc5956f03d8456b9c2dfdaa23ad8696. Comparator: PR #665 HEAD 0882b08ceb344ead8f612cf442acd088ab6e7638. Independent experiment; no main/QA/production update.

Skill loaded from /home/agent/.codex/skills/unslop/SKILL.md, including signs, tokens, visuals and references. Method by Damir Sokolovsky (@heydamir), Unslop, CC BY 4.0.

## Audit and direction (recorded before implementation)
- Hero: scenic arch dominates, product packaging is below fold; buyer must scroll before seeing actual packs.
- Product: weights share a small English subtitle; visual hierarchy favors promotional adjective over the product specification.
- Type: 700/800 weights and tracked uppercase labels compete with the product.
- Details: green-tinted surfaces, drop shadows and small captions add emphasis without helping comparison.
- Inquiry: valid static Netlify form; preserve its exact HTML, fields, consent, honeypot and POST action.

Product: Grade 27 edible solar salt for enterprise/institution procurement.
Character: grounded, exact, approachable.
World: salt, paper sacks, a practical supplier's product sheet; existing Taejang green stays.
Moments: real 10kg/25kg packaging side by side; original attributed saltworks photography in origin section.
Signature: aligned, tabular weight labels repeated in product overview and comparison.

## Passes
1. Spacing: 4px rhythm; explicit grouping for product name, grade, weights, actions.
2. Color: paper/white/ink; green for actions, neutral hairlines.
3. Icons: remove decorative CTA arrows; shared site navigation retained.
4. Copy: product-first title and descriptive links; all specification, certification caveats and form data retained.
5. Type: normal case section labels, 400/500 weights, larger weight figures.
6. Layout: physical product preview in hero, sections keep original order; origin photos/credits preserved together.
7. Details: equal-height contain images, baseline captions, row-based specifications, consistent controls/focus.
8. Visuals: reuse real existing photos; no generated product imagery or new claims. Equal photo slots do not imply physical scale (explicit caption).
9. Motion: no new entrance, looping or layout animation; restrained hover color.

Comparison screenshots: PC 1440×1000 and mobile 390×844, Chromium deviceScaleFactor=1, identical blocked external network and installed system fonts. Raw first-fold, whole-page and packaging screenshots are retained for each version. Browser checks do not submit real inquiries. Conversion improvement is a design hypothesis, not measured sales evidence.

No-JS mobile inspection also found the shared expanded sticky menu covering the hero CTA. Only this page now uses a non-sticky header when js-nav-ready is absent; all menu links remain available.

## Reading the comparison
- Original: scenic provenance is strong, but both product photos are below the first fold. Grade/weight sit in a small English line.
- PR #665: the most concise hero; weight and CTA appear earlier, while the landscape remains the main visual. Best if immediate contact matters more than viewing the packaging first.
- Experiment: at 1440×1000, both pack photos and weight captions are visible in the hero. At 390×844 the same two photos/weights appear before the fixed inquiry control. The hero uses more vertical space than #665; detailed comparison remains in the next section.
- Detailed comparison: shared image heights preserve uncropped labels, caption baselines align, specification rows put labels and values in consistent columns. The presentation does not imply true physical size ratios.
- Inquiry: one primary CTA and one comparison anchor; the original complete form HTML is unchanged. A less decorative, left-aligned form groups the three required inputs and consent. Any conversion gain remains unmeasured.

Open [the three-column comparison](salt-comparison/index.html) to switch PC/mobile, first fold, packaging and whole-page screenshots. Only the experiment branch is updated; this is a static comparison artifact, not a request to accept a hosted QA deployment.

## Validation evidence
- `node tests/new-zealand-salt.test.cjs`: passed, updated hero/photo-location assertions match the experiment while retaining factual/form checks.
- `npm run test:public`: 193 passed, 0 failed.
- `npm run build:netlify`: passed with existing external archive thumbnail/live-feed fallbacks (network restrictions); local salt photos loaded in all screenshot variants.
- Chromium 320/390/768/1440, JS enabled/disabled: 8 flows passed, no horizontal overflow, inquiry anchor reached, three fields + consent produced valid form. Consent exercised with keyboard; no request submitted. `verification.json` records the cases.
- Full original `<form>…</form>` string compared to git base and is byte-identical. Browser/native validity checked; hosted Netlify submission, hosted CI, production and fixed QA were not exercised.
- PC/mobile first-fold screenshots are real captures at 1440×1000 and 390×844. The overview contact sheets uniformly downscale PC captures; raw captures linked by index.html preserve original resolution. Entire-page heights vary naturally; no page was shortened for comparison.
