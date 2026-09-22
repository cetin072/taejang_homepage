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

test('general worker recovery keeps the canonical common employee home visible', () => {
  assert.match(polish, /const employeeHome = document\.getElementById\('employee-common-home'\)/);
  assert.match(polish, /document\.body\.classList\.add\('employee-home-mode'\)/);
  assert.match(polish, /employeeHome\.hidden = false/);
  assert.match(polish, /if \(workerHome\) workerHome\.hidden = true/);
  assert.doesNotMatch(polish, /employeeHome\.hidden = true/);
  assert.match(polish, /Compatibility fallback only/);
});

test('role polish no longer owns role-specific sidebar suppression', () => {
  assert.doesNotMatch(polish, /function removeLegacyRevisionMenus\(nav\)/);
  assert.doesNotMatch(polish, /data-effective-role=.*revision/);
  assert.match(polish, /Sidebar visibility is capability-driven/);
  assert.doesNotMatch(polish, /data-effective-role=.*display:none !important/);
  assert.doesNotMatch(polish, /new MutationObserver/);
});

test('checking-only navigation is removed without role-specific menu cleanup', () => {
  assert.match(polish, /function removeCheckingNavigation\(\)/);
  assert.match(polish, /featureStatus === 'checking'/);
  assert.match(polish, /label === '신규 사업 기획'/);
  assert.match(polish, /if \(markedChecking\) node\.remove\(\)/);
  assert.doesNotMatch(polish, /obsoleteRevision/);
  assert.match(polish, /removeCheckingNavigation\(\);/);
});

test('all desktop roles share the operations master sidebar categories', () => {
  const master = nav.slice(nav.indexOf('const MASTER_ORDER'), nav.indexOf('const MASTER_SECTIONS'));
  assert.match(master, /'직원 관리', '신규 직원 등록', '가입 승인'/);
  assert.match(master, /'홍보 글 작성', '보완 요청받은 글', '보낸 글', '홍보 검토'/);
  assert.match(master, /'출근부', '근태 보정', '근태·급여관리', '외부 급여초안 상신', '외부 급여초안 검토'/);
  assert.match(nav, /DESKTOP_ROLES\.map\(role => \[role, MASTER_ORDER\]\)/);
  assert.doesNotMatch(nav, /role === 'operations_manager'\) return 165/);
});

test('undefined role labels are repaired from the effective route', () => {
  assert.match(polish, /\/undefined\|null\//);
  assert.match(polish, /label\.textContent = `\$\{displayName\} · \$\{roleLabel\}`/);
});
