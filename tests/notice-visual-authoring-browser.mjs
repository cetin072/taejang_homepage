import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const browser = await chromium.launch({
  args:['--allow-file-access-from-files'],
  ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'})
});
try {
  const page = await browser.newPage();
  const file = name => pathToFileURL(path.resolve(name)).href;
  await page.goto(file('tests/browser/notice-authoring-ux-gate.html')+'?capture');
  await page.waitForFunction(() => document.querySelector('#result').textContent === 'NOTICE_CAPTURE_READY');
  await page.addScriptTag({url:file('assets/js/promotion-document.js')});
  await page.addScriptTag({url:file('app/assets/promotion-visual-editor.js')});
  await page.evaluate(() => {
    const original = TaejangApp.rpc;
    TaejangApp.rpc = (name, args) => original(name === 'save_formatted_notice' ? 'save_notice' : name, args);
    TaejangNoticeMedia.upload = async (id, file, key) => ({storage_path:id+'/123-'+key+'.png',mime_type:file.type});
    window.confirm = () => true;
    TaejangNoticeAdmin.setView('create');
  });
  const body = page.getByRole('textbox',{name:'공지 내용',exact:true});
  await page.locator('#notice-title-input').fill('사진과 링크');
  await body.fill('교육 안내');
  await body.press('End');
  await body.press('Enter');
  await page.locator('#notice-photo-input').setInputFiles({name:'교육.png',mimeType:'image/png',buffer:Buffer.from('photo')});
  const picker = page.getByLabel('본문에 넣을 사진');
  await picker.locator('option').nth(1).waitFor({state:'attached'});
  await picker.selectOption({index:1});
  await page.getByRole('button',{name:'본문에 사진 넣기',exact:true}).click();
  await body.press('End');
  await body.press('Enter');
  await page.evaluate(() => { window.prompt = () => 'https://example.org/class'; });
  await page.getByRole('button',{name:'링크',exact:true}).click();
  await page.locator('#notice-publish').click();
  await page.waitForFunction(() => rows.some(row => row.status === 'published'));
  const result = await page.evaluate(async () => {
    const item = await TaejangApp.rpc('get_my_notice_detail',{p_notice_id:rows.at(-1).id});
    const detail = TaejangNoticeMedia.detailBody(item);
    await new Promise(resolve => setTimeout(resolve,20));
    const link = detail.querySelector('a');
    const img = detail.querySelector('img');
    const old = TaejangNoticeMedia.detailBody({body_easy:'기존 안내 https://example.org/old.'});
    return {href:link?.href,ordered:!!(img?.compareDocumentPosition(link)&Node.DOCUMENT_POSITION_FOLLOWING),
      photos:detail.querySelectorAll('img').length, old:old.querySelector('a')?.href,
      serialized:item.body_document,plain:item.body_easy};
  });
  assert.equal(result.href,'https://example.org/class');
  assert.equal(result.old,'https://example.org/old');
  assert.equal(result.photos,1);
  assert.ok(result.ordered);
  assert.ok(!result.serialized.includes('blob:') && !result.serialized.includes('token='));
  assert.match(result.plain,/교육 안내/);
  console.log('NOTICE_VISUAL_AUTHORING_PASS');
} finally { await browser.close(); }
