const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures', 'support-radar-golden-set-v1.json');
const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const PRIORITY_TERMS = ['고용', '문화', '문화예술', '원예', 'AI·디지털', 'AI', '직무개발'];

function derivedAlertTriggers(item) {
  const triggers = [];
  if (Number(item.cash || 0) >= 5_000_000) triggers.push('amount_5m');
  if (item.inKind) triggers.push('in_kind');
  if (Number.isFinite(item.deadlineDays) && item.deadlineDays >= 0 && item.deadlineDays <= 7) triggers.push('deadline_7');
  if ((item.categories || []).some(category => PRIORITY_TERMS.some(term => String(category).includes(term)))) triggers.push('priority_domain');
  return triggers;
}

test('Golden Set v1 contains 24 unique, minimally complete cases', () => {
  assert.equal(cases.length, 24);
  assert.equal(new Set(cases.map(item => item.id)).size, 24);
  for (const item of cases) {
    assert.ok(item.id && item.title, `missing identity: ${JSON.stringify(item)}`);
    assert.ok(Array.isArray(item.region), `${item.id}: region must be array`);
    assert.ok(Array.isArray(item.categories), `${item.id}: categories must be array`);
    assert.equal(typeof item.expected, 'object', `${item.id}: expected contract required`);
  }
});

test('Golden Set alert examples match deterministic trigger facts', () => {
  for (const item of cases) {
    if (!item.expected.alertTrigger) continue;
    const triggers = derivedAlertTriggers(item);
    assert.ok(triggers.includes(item.expected.alertTrigger), `${item.id}: expected ${item.expected.alertTrigger}, got ${triggers.join(',')}`);
  }
});

test('Golden Set includes required Taejang eligibility edge cases', () => {
  const ids = new Set(cases.map(item => item.id));
  [
    'direct-standard-workplace-equipment',
    'sme-confirmation-conditional',
    'nonprofit-only',
    'jinjeon-rural',
    'vehicle-in-kind',
    'deadline-3days',
    'wrong-region',
    'high-money-irrelevant',
    'co-pay-high',
    'unknown-eligibility'
  ].forEach(id => assert.ok(ids.has(id), `missing Golden Set case: ${id}`));
});

test('duplicate notice pair is explicitly grouped', () => {
  const grouped = cases.filter(item => item.expected.duplicateGroup === 'disability-facility-2026');
  assert.equal(grouped.length, 2);
  assert.equal(new Set(grouped.map(item => item.title)).size, 1);
  assert.equal(new Set(grouped.map(item => item.sourceKey)).size, 2);
});

test('SME-dependent examples stay conditional rather than silently excluded', () => {
  const smeCases = cases.filter(item => item.expected.qualificationGap === 'sme_confirmation');
  assert.ok(smeCases.length >= 3);
  for (const item of smeCases) {
    if (item.expected.hardGate) assert.ok(item.expected.hardGate.includes('conditional'), `${item.id}: SME gap must allow conditional state`);
  }
});
