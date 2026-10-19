
const test=require('node:test'),assert=require('node:assert/strict');
test('browser gate rejects PASS strings in scripts when rendered result failed or never completed',async()=>{
 const {browserGateResult}=await import('../scripts/browser-gate-result.mjs');
 for(const result of ['RUNNING','UI_GATE_FAIL:mock contract changed','']){
  const dom='<pre id="result">'+result+'</pre><script>const expected="UI_GATE_PASS";</script>';
  assert.equal(browserGateResult(dom,'UI_GATE_PASS').passed,false);
 }
});
test('browser gate accepts only completed exact result markers with optional viewport suffix',async()=>{
 const {browserGateResult}=await import('../scripts/browser-gate-result.mjs');
 assert.equal(browserGateResult('<pre id="result">UI_GATE_PASS:390</pre>','UI_GATE_PASS').passed,true);
 assert.equal(browserGateResult('<pre id="result">UI_GATE_PASS</pre>','UI_GATE_PASS').passed,true);
 assert.equal(browserGateResult('<pre id="result">UI_GATE_PASS_FAKE</pre>','UI_GATE_PASS').passed,false);
});
