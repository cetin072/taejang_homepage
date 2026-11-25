const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const listeners = new Map(), events = [];
  let response = { version: 1, can_manage: false, decisions: [] };
  let fail = null;
  const app = { rpc: async () => { if (fail) throw fail; return response; } };
  const document = {
    visibilityState: 'visible',
    addEventListener(name, fn) { listeners.set(name, fn); },
    dispatchEvent(event) { events.push(event.type); }
  };
  const window = { TaejangApp: app, addEventListener() {}, setInterval() {} };
  vm.runInNewContext(fs.readFileSync('app/assets/menu-authority.js','utf8'), {
    window, document, CustomEvent: class { constructor(type) { this.type=type; } }, console
  });
  return { api:window.TaejangMenuAuthority,window,events,
    respond(value) { response=value; fail=null; }, reject(error) { fail=error; } };
}

test('personal grant opens the same menu without a legacy role, but not another menu', async () => {
  const f=fixture();
  f.respond({version:1,can_manage:false,decisions:[{menu_key:'employee.manage',allowed:true,revision:1}]});
  assert.equal(await f.api.beforeOpen('employee.manage',false),true);
  assert.equal(f.api.allowed('payroll.manage',false),false);
  assert.equal(f.api.hasDelegatedMenus(),true);
  assert.equal(f.api.isManager(),false);
});

test('revocation overrides legacy allow and publishes invalidation', async () => {
  const f=fixture();
  f.respond({version:1,can_manage:false,decisions:[{menu_key:'employee.manage',allowed:true,revision:1}]});
  await f.api.refresh();
  f.respond({version:1,can_manage:false,decisions:[{menu_key:'employee.manage',allowed:false,revision:2}]});
  assert.equal(await f.api.beforeOpen('employee.manage',true),false);
  assert.equal(f.api.hasDelegatedMenus(),false);
  assert.equal(f.events.filter(event=>event==='taejang-menu-authority-changed').length,2);
});

test('established contract failure cannot restore role fallback', async () => {
  const f=fixture(); await f.api.refresh();
  f.reject(Object.assign(new Error('missing'),{status:404}));
  await assert.rejects(f.api.beforeOpen('employee.manage',true));
  assert.equal(f.api.allowed('employee.manage',true),false);
});

test('unmigrated server does not invent personal grants', async () => {
  const f=fixture(); f.reject(Object.assign(new Error('missing'),{code:'PGRST202'}));
  assert.equal(await f.api.beforeOpen('employee.manage',true),true);
  assert.equal(f.api.allowed('employee.manage',false),false);
  assert.equal(f.api.hasDelegatedMenus(),false);
});

test('late old-account response cannot install authority on a new account', async () => {
  const f=fixture(); let release;
  f.window.TaejangApp={rpc:()=>new Promise(resolve=>{release=resolve;})};
  const old=f.api.refresh();
  f.window.TaejangApp={rpc:async()=>({version:1,can_manage:false,decisions:[]})};
  await f.api.refresh();
  release({version:1,can_manage:true,decisions:[{menu_key:'employee.manage',allowed:true}]});
  await old;
  assert.equal(f.api.isManager(),false);
  assert.equal(f.api.allowed('employee.manage',false),false);
});
