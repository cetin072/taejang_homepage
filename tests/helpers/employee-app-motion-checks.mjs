import assert from 'node:assert/strict';
import path from 'node:path';

export async function exerciseMotion(page, output, assertLayout) {
  const hero = page.locator('[data-hero-motion]');
  const replay = hero.locator('[data-hero-replay]');
  await replay.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-hero-motion]').dataset.state === 'playing');
  await page.waitForTimeout(900);
  await hero.locator('[data-hero-pause]').click();
  const paused = await hero.getAttribute('data-time');
  await page.waitForTimeout(200);
  assert.equal(await hero.getAttribute('data-time'), paused, 'pause freezes the actual SVG');
  await hero.locator('[data-hero-pause]').click();
  await page.waitForFunction(() => document.querySelector('[data-hero-motion]').dataset.state === 'ended');
  assert.equal(await hero.getAttribute('data-time'), '5200');
  assert.equal(await page.locator('#hero-record-line').getAttribute('d'), 'M253.000 190.000 L269.000 205.000 L300.000 169.000');
  await assertLayout(page, 'hero-ended');
  await page.screenshot({ path: path.join(output, 'hero-v21-ended.png') });

  for (const card of await page.locator('[data-comparison]').all()) {
    const id = await card.evaluate(el => el.closest('article').id);
    await card.scrollIntoViewIfNeeded();
    await card.locator('[data-card-replay]').focus(); await page.keyboard.press('Enter');
    const bounds = () => card.boundingBox();
    const before = await bounds();
    assert.equal(await card.getAttribute('data-state'), 'playing');
    const tree = await card.ariaSnapshot();
    assert.match(tree, /BEFORE/); assert.match(tree, /AFTER/);
    assert.equal(await card.locator('dd').count(), 3, 'both faces and principle remain in DOM');
    await page.screenshot({ path: path.join(output, id + '-before.png') });
    await page.waitForTimeout(1650);
    assert.equal(await card.locator('.employee-app-flip-inner').evaluate(el => getComputedStyle(el).transform), 'matrix(1, 0, 0, 1, 0, 0)', 'front has a real reading hold');
    await page.waitForTimeout(750);
    await assertLayout(page, id + '-turning');
    await page.screenshot({ path: path.join(output, id + '-turning.png') });
    await page.waitForFunction(id => document.querySelector('#' + id + ' [data-comparison]').dataset.state === 'ended', id);
    assert.deepEqual(await bounds(), before, 'turn does not shift surrounding content');
    await page.waitForTimeout(300);
    assert.equal(await card.locator('.employee-app-flip-inner').evaluate(el => el.getAnimations().length), 0, 'no recurring animation or retained animation');
    await page.screenshot({ path: path.join(output, id + '-after.png') });
    await card.locator('[data-card-compare]').focus(); await page.keyboard.press('Enter');
    assert.equal(await card.getAttribute('data-state'), 'comparison');
    const faces = await card.locator('.employee-app-face').evaluateAll(els => els.map(el => ({ transform: getComputedStyle(el).transform, b: el.getBoundingClientRect().toJSON() })));
    assert.ok(faces.every(face => face.transform === 'none'));
    assert.ok(faces[0].b.bottom <= faces[1].b.top || faces[0].b.right <= faces[1].b.left, 'static faces do not overlap');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.is-flipping').count(), 0, 'live reduced-motion change reveals both sides');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.is-flipping').count(), 0, 'preference change does not replay');
  await hero.scrollIntoViewIfNeeded();
  await replay.click();
  await page.waitForTimeout(250);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('[data-hero-motion]').dataset.time === '5200', undefined, { timeout: 1000 });
  assert.equal(await hero.getAttribute('data-time'), '5200', 'live reduce interrupts SVG to its final frame');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await hero.getAttribute('data-state'), 'ended');
  const firstCard = page.locator('[data-comparison]').first();
  await firstCard.scrollIntoViewIfNeeded();
  await firstCard.locator('[data-card-replay]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('.is-flipping'), undefined, { timeout: 1000 });
  assert.equal(await page.locator('.is-flipping').count(), 0, 'live reduce cancels a running card');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await firstCard.locator('[data-card-replay]').click();
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('.is-flipping').count(), 0, 'print fixture restores both faces');
  await page.emulateMedia({ media: 'screen' });
  // Capture the page from its real top; fixed header/focus must not be painted
  // halfway down a full-page image after inspecting the lower cards.
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
  await page.waitForFunction(() => scrollY === 0);
  await page.screenshot({ path: path.join(output, 'employee-app-motion-finished.png'), fullPage: true });
}


/** A card must start only when scrolled into view; leaving must not consume its one replay. */
export async function exerciseScrollTriggeredCards(page) {
  const cards = page.locator('[data-comparison]');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(180);
  for (const card of await cards.all()) {
    assert.equal(await card.getAttribute('data-state'), 'comparison',
      'below-the-fold card must not auto-play on initial navigation');
  }

  const card = cards.first();
  const face = card.locator('.employee-app-flip');
  await face.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('[data-comparison]').dataset.state === 'playing');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('[data-comparison]').dataset.state === 'paused');
  const getTime = () => card.locator('.employee-app-flip-inner')
    .evaluate(el => el.getAnimations()[0]?.currentTime);
  const atExit = await getTime();
  assert.ok(Number.isFinite(atExit), 'animation remains pending after leaving viewport');
  await page.waitForTimeout(250);
  assert.ok(Math.abs((await getTime()) - atExit) < 12,
    'scrolling away pauses instead of skipping directly to After');

  await face.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('[data-comparison]').dataset.state === 'playing');
  await card.locator('[data-card-compare]').click();
  assert.equal(await card.getAttribute('data-state'), 'comparison');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await face.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(180);
  assert.equal(await card.getAttribute('data-state'), 'comparison',
    'explicit two-sides comparison should not restart the flip on re-entry');
}
