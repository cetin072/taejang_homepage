import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const requireMobile = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = requireMobile('typescript');
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function load(path, require) {
  const exports = {};
  const code = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require });
  return exports;
}

const registry = load('mobile/src/features/common/employee-feature-registry.ts', () => { throw new Error('unexpected registry dependency'); });
const qaState = load('mobile/src/features/qa/qa-preview-state.ts', () => { throw new Error('unexpected QA state dependency'); });
const jsx = (type, props) => ({ type, props });
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Image', 'KeyboardAvoidingView', 'TextInput'].map(name => [name, name]));
native.StyleSheet = { create: styles => styles };
native.useWindowDimensions = () => ({ width: 360, height: 800 });
const brand = load('mobile/src/features/common/brand-loading-view.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-native') return native;
  if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
  if (name.endsWith('.png')) return name;
  throw new Error(`unexpected brand dependency: ${name}`);
});

function renderHome(access, phase = 'ready', qa = false, persona = 'operations_lead') {
  const home = load('mobile/app/index.tsx', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useState: initial => [initial === null ? access : initial === 'operations_lead' ? persona : initial, () => {}],
      useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {},
    };
    if (name === 'react-native') return native;
    if (name === 'expo-router') return { useRouter: () => ({ push: () => {} }) };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name.endsWith('platform-provider')) return { usePlatform: () => ({ phase, session: { user: { id: 'fixture' } } }) };
    if (name.endsWith('employee-feature-registry')) return registry;
    if (name.endsWith('qa-preview-state')) return qaState;
    if (name.endsWith('qa-preview-controls')) return { QaPreviewControls: 'QaPreviewControls' };
    if (name.endsWith('brand-loading-view')) return brand;
    if (name.endsWith('attendance-card')) return { AttendanceCard: 'AttendanceCard' };
    if (name.endsWith('notice-home-action')) return { NoticeHomeAction: 'NoticeHomeAction' };
    if (name.endsWith('official-channels-footer')) return { OfficialChannelsFooter: 'OfficialChannelsFooter' };
    if (name.endsWith('policy-links')) return { PolicyLinks: 'PolicyLinks' };
    if (name.endsWith('app-variant')) return { isQaApp: qa, appVariantLabel: () => qa ? '태장 QA' : '태장' };
    if (name.endsWith('friendly-error')) return { friendlyError: (_error, fallback) => fallback };
    if (name === 'expo-linking' || name === '@react-native-community/datetimepicker') return {};
    throw new Error(`unexpected home dependency (hidden features must not load): ${name}`);
  });
  const visit = node => {
    if (node == null || node === false) return [];
    if (Array.isArray(node)) return node.flatMap(visit);
    if (typeof node !== 'object') return [node];
    if (typeof node.type === 'function') return visit(node.type(node.props));
    return [node, ...visit(node.props?.children)];
  };
  return visit(home.default());
}

test('rendered employee home only mounts attendance, notice and eligible work-platform entry', () => {
  for (const capabilities of [[], ['unrelated.read'], ['promotion.write'], ['promotion.review_lead'], ['employee.view_all']]) {
    const nodes = renderHome({ account_status: 'active', capabilities });
    const cards = nodes.filter(node => ['AttendanceCard', 'NoticeHomeAction'].includes(node?.type));
    assert.deepEqual(cards.map(node => node.type), ['AttendanceCard', 'NoticeHomeAction']);
    const platform = nodes.filter(node => node?.props?.accessibilityLabel === '업무 플랫폼 열기');
    assert.equal(platform.length, capabilities.some(code => ['promotion.write', 'promotion.review_lead', 'employee.view_all'].includes(code)) ? 1 : 0);
    assert.equal(nodes.filter(node => node?.type === 'OfficialChannelsFooter').length, 1);
    assert.equal(nodes.filter(node => node?.props?.accessibilityLabel === '설정').length, 1);
  }
});

test('registry uses server capabilities, ignores role names and keeps promotion implementation available', () => {
  const roleOnly = registry.resolveEmployeeAppFeatures({ account_status: 'active', actual_roles: [{ code: 'operations_manager' }] });
  assert.equal(roleOnly.get('work-platform.open').state, 'disabled');
  assert.equal(registry.canUsePromotionAuthoring({ account_status: 'active', capabilities: ['promotion.write'] }), true);
  assert.equal(registry.canUsePromotionAuthoring({ account_status: 'pending', capabilities: ['promotion.write'] }), false);
});

test('connection and first access load render only the same proportional logo with no visible text', () => {
  const app = JSON.parse(source('mobile/app.json')).expo;
  const splash = app.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1];
  for (const phase of ['loading', 'ready']) {
    const nodes = renderHome(null, phase);
    const image = nodes.find(node => node?.type === 'Image');
    assert.ok(image.props.source.endsWith(splash.image.replace('./', '/')));
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.style.width, splash.imageWidth);
    assert.equal(image.props.style.height, splash.imageWidth);
    assert.equal(nodes.find(node => node?.type === 'View').props.style.backgroundColor, splash.backgroundColor);
    assert.equal(nodes.some(node => node?.type === 'Text'), false);
    assert.equal(nodes.some(node => node?.type === 'ActivityIndicator'), false);
  }
});

test('QA defaults to operations team lead and previews the actual employee attendance card', () => {
  for (const capabilities of [[], ['attendance.qa_validate'], ['employee.view_all']]) {
    const rendered = renderHome({ account_status: 'active', capabilities }, 'ready', true);
    const card = rendered.find(node => node?.type === 'AttendanceCard');
    const toolbar = rendered.find(node => node?.type === 'QaPreviewControls');
    const platform = rendered.find(node => node?.props?.accessibilityLabel === '업무 플랫폼 열기');
    assert.equal(card.props.mode, 'preview');
    assert.equal(card.props.previewScenario, 'today');
    assert.equal(toolbar.props.persona, 'operations_lead');
    assert.equal(toolbar.props.inspection, 'preview');
    assert.equal(Boolean(platform), true);
    assert.equal(platform.props.disabled, !capabilities.includes('employee.view_all'));
  }
});

test('QA general employee perspective hides work platform without changing account capabilities', () => {
  const access = { account_status: 'active', capabilities: ['employee.view_all'] };
  const staff = renderHome(access, 'ready', true, 'employee');
  assert.equal(staff.some(node => node?.props?.accessibilityLabel === '업무 플랫폼 열기'), false);
  assert.equal(staff.find(node => node?.type === 'AttendanceCard').props.mode, 'preview');
  assert.equal(staff.find(node => node?.type === 'NoticeHomeAction')?.type, 'NoticeHomeAction');
  const production = renderHome(access);
  assert.equal(production.find(node => node?.type === 'AttendanceCard').props.mode, 'record');
  assert.equal(production.some(node => node?.type === 'QaPreviewControls'), false);
});
