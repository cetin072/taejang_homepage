const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const capability = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911070219_payroll_shadow_mvp_capability.sql'),
  'utf8'
);
const nav = fs.readFileSync(path.join(root, 'app/assets/role-navigation-priority.js'), 'utf8');
const cards = fs.readFileSync(path.join(root, 'app/assets/dashboard-priority-cards.js'), 'utf8');

test('phase-1 payroll work access is operations_manager only', () => {
  assert.match(capability, /operations_manager only/i);
  assert.match(capability, /r\.code\s*=\s*'operations_manager'/i);
  assert.match(capability, /r\.code <> 'operations_manager'/i);
  assert.match(nav, /currentRole !== 'operations_manager'/i);
  assert.match(cards, /currentRoute !== 'operations_manager'/i);
});

test('promotion lead can keep attendance operations but does not get payroll-management entry yet', () => {
  const promotionBlock = nav.slice(nav.indexOf('promotion_lead:'), nav.indexOf('operations_manager:'));
  assert.match(promotionBlock, /'출근부'/);
  assert.doesNotMatch(promotionBlock, /'근태·급여관리'/);

  const cardBlock = cards.slice(cards.indexOf('const CARD_ORDER'), cards.indexOf('const OPERATIONS_DASHBOARD_HIDDEN'));
  assert.match(cardBlock, /operations_manager:\s*\['근태·급여관리'/);
  assert.doesNotMatch(cardBlock, /promotion_lead:\s*\[[^\]]*'근태·급여관리'/s);
});
