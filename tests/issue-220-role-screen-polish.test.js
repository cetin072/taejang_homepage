const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const appUi = read('app/assets/app-ui.js');
const polish = read('app/assets/role-screen-polish.js');
const nav = read('app/assets/role-navigation-priority.js');
const stability = read('app/assets/navigation-visual-stability.js');

test('role screen polish loads before the final navigation reveal', () => {
  const polishIndex = appUi.indexOf("['assets/role-screen-polish.js', 'role-screen-polish']");
  const stabilityIndex = appUi.indexOf("['assets/navigation-visual-stability.js', 'navigation-visual-stability']");
  assert.ok(polishIndex >= 0, 'role screen polish module is loaded');
  assert.ok(stabilityIndex > polishIndex, 'role screen polish loads before visual stability finalization');
  assert.match(stability, /TaejangRoleScreenPolish\?\.apply\?\.\(\)/);
});

test('general worker screen has a deterministic visual fallback instead of browser defaults', () => {
  assert.match(polish, /general-worker-mode/);
  assert.match(polish, /worker-mobile-home/);
  assert.match(polish, /worker-card/);
  assert.match(polish, /employee-role-switch-grid/);
  assert.match(polish, /classList\.add\('general-worker-mode'\)/);
  assert.match(polish, /employeeHome\.hidden = true/);
});

test('legacy duplicate promotion menus are cleaned without a DOM observer loop', () => {
  assert.match(polish, /function removeLegacyRevisionMenus\(nav\)/);
  assert.match(polish, /phaseCV2Nav === 'revision'/);
  assert.match(polish, /label === '수정·보완 요청'/);
  assert.match(polish, /node\.remove\(\)/);
  assert.match(polish, /cleanLabel\(node\) === '홍보 작성'/);
  assert.match(polish, /node\.dataset\.navSuppressed = '1'/);
  assert.doesNotMatch(polish, /new MutationObserver/);
});

test('lead and operations revision navigation has a late-injection visibility guard', () => {
  assert.match(polish, /data-effective-role=\"promotion_lead\"/);
  assert.match(polish, /data-effective-role=\"operations_manager\"/);
  assert.match(polish, /data-phase-c-v2-nav=\"revision\"/);
  assert.match(polish, /display:none !important/);
  assert.match(polish, /nav\.dataset\.effectiveRole = route\(\) \|\| ''/);
});

test('checking-only navigation is removed instead of shown as a checking section', () => {
  assert.match(polish, /function removeCheckingNavigation\(\)/);
  assert.match(polish, /featureStatus === 'checking'/);
  assert.match(polish, /label === '신규 사업 기획'/);
  assert.match(polish, /currentRoute !== 'promotion_staff'/);
  assert.match(polish, /phaseCV2Nav === 'revision'/);
  assert.match(polish, /if \(markedChecking \|\| obsoleteRevision\) node\.remove\(\)/);
  assert.match(polish, /removeCheckingNavigation\(\);/);
});

test('operations add-on menus belong to their business categories before support work', () => {
  const operations = nav.slice(nav.indexOf('operations_manager:'), nav.indexOf('department_lead:'));
  assert.match(operations, /'가입 승인', '복구·계정 관리'/);
  assert.match(operations, /'홍보 검토', '홍보 글 작성', '기존 글 관리', '홍보글 관리·복구'/);
  assert.match(operations, /'근태·급여관리', '외부 급여초안 검토', '출근부', '근태 보정'/);
  assert.match(nav, /role === 'operations_manager'\) return 165/);
  assert.match(nav, /role === 'operations_manager' && current === '홍보글 보관·복구'/);
});

test('undefined role labels are repaired from the effective route', () => {
  assert.match(polish, /\/undefined\|null\//);
  assert.match(polish, /label\.textContent = `\$\{displayName\} · \$\{roleLabel\}`/);
});
