import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function baseExpoConfig() {
  return require('../mobile/app.json').expo;
}

function loadConfigFor(variant) {
  const previous = process.env.TAEJANG_APP_VARIANT;
  if (variant == null) delete process.env.TAEJANG_APP_VARIANT;
  else process.env.TAEJANG_APP_VARIANT = variant;
  delete require.cache[require.resolve('../mobile/app.config.js')];
  const applyConfig = require('../mobile/app.config.js');
  const result = applyConfig({ config: baseExpoConfig() });
  if (previous == null) delete process.env.TAEJANG_APP_VARIANT;
  else process.env.TAEJANG_APP_VARIANT = previous;
  return result;
}

test('production and QA variants share one source while keeping separate Android identities', () => {
  const production = loadConfigFor(undefined);
  const qa = loadConfigFor('qa');

  assert.deepEqual(loadConfigFor('production'), production);
  assert.equal(production.version, '0.1.3');
  assert.equal(production.android.versionCode, 4);
  assert.deepEqual(production.splash, baseExpoConfig().splash);
  assert.deepEqual(production.plugins, baseExpoConfig().plugins);
  assert.equal(production.icon, baseExpoConfig().icon);
  assert.equal(production.name, '태장');
  assert.equal(production.android.package, 'com.cetin072.taejang.staff');
  assert.equal(production.scheme, 'taejangstaff');
  assert.equal(production.extra.appVariant, 'production');
  assert.equal(production.android.adaptiveIcon.backgroundColor, '#FDFCFD');

  assert.equal(qa.name, '태장 QA');
  assert.equal(qa.android.package, 'com.cetin072.taejang.staff.qa');
  assert.equal(qa.scheme, 'taejangstaffqa');
  assert.equal(qa.extra.appVariant, 'qa');
  assert.equal(qa.android.adaptiveIcon.backgroundColor, '#F3E7A7');

  assert.equal(qa.version, production.version);
  assert.equal(qa.android.versionCode, production.android.versionCode);
});

test('QA runtime is visibly labeled and attendance fails closed to the no-write path', async () => {
  const [home, card, settings, support] = await Promise.all([
    text('mobile/app/index.tsx'),
    text('mobile/src/features/attendance/attendance-card.tsx'),
    text('mobile/app/settings.tsx'),
    text('mobile/app/support.tsx'),
  ]);

  assert.match(home, /isQaApp \? 'qa' : \(attendanceFeature\?\.attendanceMode \|\| 'record'\)/);
  assert.match(home, /태장 QA · 검수용 앱/);
  assert.match(home, /qaAppBadge/);
  assert.match(card, /const qaMode = mode === 'qa';/);
  assert.match(card, /if \(mode === 'qa' && !qaAttempt\)/);
  assert.match(card, /QA 앱에서는 실제 근태를 기록하지 않습니다/);
  assert.match(card, /validateAttendanceQa/);
  assert.match(card, /recordAttendanceEvent/);
  assert.match(settings, /태장 QA 검수용 앱/);
  assert.match(settings, /Google Play의 태장 앱과 별도로 설치됩니다/);
  assert.match(support, /앱 종류/);
  assert.match(support, /appVariantLabel/);
});

test('QA app avoids automatic production update and push enrollment', async () => {
  const [lifecycle, bridge] = await Promise.all([
    text('mobile/src/platform/update-lifecycle.tsx'),
    text('mobile/src/notifications/push-notification-bridge.tsx'),
  ]);

  assert.match(lifecycle, /const policy = isQaApp \? null :/);
  assert.match(bridge, /if \(!client \|\| !session \|\| isQaApp\) return/);
  assert.match(bridge, /registerCurrentPushDevice/);
});

test('mobile CI builds QA package side-by-side and protects production AAB identity', async () => {
  const workflow = await text('.github/workflows/mobile-app.yml');

  assert.match(workflow, /TAEJANG_APP_VARIANT: qa/);
  assert.ok(workflow.includes('dump badging'));
  assert.ok(workflow.includes("application-label:'태장 QA'"));
  assert.ok(workflow.includes("native-code: 'arm64-v8a'"));
  assert.ok(workflow.includes('verify --print-certs'));
  assert.ok(workflow.includes('dump xmltree'));
  assert.ok(workflow.includes('keytool -printcert -jarfile'));
  assert.ok(workflow.includes('! grep -q \'application-debuggable\''));
  assert.match(workflow, /com\.cetin072\.taejang\.staff\.qa/);
  assert.match(workflow, /태장 QA/);
  assert.match(workflow, /taejang-employee-mobile-qa-app-apk/);
  assert.match(workflow, /TAEJANG_APP_VARIANT: production/);
  assert.match(workflow, /package="com\.cetin072\.taejang\.staff"/);
  assert.match(workflow, /taejang-employee-mobile-play-aab/);
});
