import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('.');
const output = process.env.PHOTO_QA_OUTPUT || '/tmp/taejang-photo-qa';
await mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + path.sep));
    const body = file === path.join(root, 'index.html') ? '<div data-photo-slot="04"><img alt="test"></div>' : await readFile(file);
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.webp$/.test(file) ? 'image/webp' : 'text/html');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const photos = await Promise.all(['home/gonggam-taejang-team.webp', 'archive/partner-company-plaques-v3.webp'].map(async name => ({ name, base64: (await readFile(path.join(root, 'assets/images', name))).toString('base64') })));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/tests/browser/promotion-authoring-upload-gate.html');
    await page.waitForFunction(() => /GATE_(PASS|FAIL)/.test(document.getElementById('result').textContent));
    assert.equal(await page.locator('#result').innerText(), 'PROMOTION_AUTHORING_UPLOAD_GATE_PASS');
    const report = await page.evaluate(async repoPhotos => {
      state.uploadFailureStatus = null;
      const check = (value, label) => { if (!value) throw Error(label); };
      const module = await import('/app/assets/photo-optimizer.mjs');
      window.photoModule = module;
      const fileFromCanvas = (canvas, type = 'image/jpeg', quality = 0.98) => new Promise(resolve => canvas.toBlob(blob => resolve(new File([blob], 'sample.' + module.MIME_EXTENSIONS[blob.type], { type: blob.type })), type, quality));
      const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        pixels.data[i] = seed & 255; pixels.data[i + 1] = seed >>> 8 & 255; pixels.data[i + 2] = seed >>> 16 & 255; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      window.largePhoto = await fileFromCanvas(canvas, 'image/jpeg', 0.96);
      const rows = [];
      async function inspect(file) {
        const bitmap = await createImageBitmap(file);
        const dims = [bitmap.width, bitmap.height]; bitmap.close();
        return { bytes: file.size, dimensions: dims, type: file.type };
      }
      async function optimize(file, label) {
        const result = await module.optimizeForUpload(file);
        const before = await inspect(file), after = await inspect(result);
        check(after.bytes <= 1048576 && after.bytes <= before.bytes, label + ' bounded bytes');
        check(Math.max(...after.dimensions) <= 1600, label + ' bounded edge');
        check(Math.abs(before.dimensions[0] / before.dimensions[1] - after.dimensions[0] / after.dimensions[1]) < 0.003, label + ' ratio');
        rows.push({ label, before, after });
        return result;
      }
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      let encodes = 0;
      HTMLCanvasElement.prototype.toBlob = function (...args) { encodes++; return originalToBlob.apply(this, args); };
      const [large, same] = await Promise.all([optimize(largePhoto, 'synthetic 12MP JPG'), module.optimizeForUpload(largePhoto)]);
      check(large === same && encodes >= 1 && encodes <= 3, 'same File preparation shared; encoder rounds bounded');
      const beforeRetry = encodes;
      state.uploadUnauthorizedOnce = true;
      const start = state.storageCalls.length;
      await TaejangPromotionWorkspaceV2Api.uploadImage(largePhoto);
      const retry = state.storageCalls.slice(start);
      check(retry.length === 2 && retry[0].url === retry[1].url && retry[0].options.body === large && retry[1].options.body === large, '401 identical optimized body and key');
      check(encodes === beforeRetry, 'auth retry never recompresses');
      check(retry.every(call => call.options.headers['Content-Type'] === large.type && call.url.endsWith('.jpg')), 'uploaded MIME extension body agree');
      state.uploadFailureStatus = 403;
      try { await TaejangPromotionWorkspaceV2Api.uploadImage(largePhoto); throw Error('must reject'); } catch (error) { check(error.message.includes('사진 저장 권한'), '403 safe error'); }
      state.uploadFailureStatus = null;
      await TaejangPromotionWorkspaceV2Api.uploadImage(largePhoto);
      check(state.storageCalls.at(-1).url === retry[0].url, 'manual retry preserves non-upsert key');
      check(encodes === beforeRetry && state.storageCalls.at(-1).options.body === large, 'manual retry optimized body');
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      canvas.width = 2400; canvas.height = 1800;
      for (const [color, x, y] of [['red', 0, 0], ['lime', 1200, 0], ['blue', 0, 900], ['yellow', 1200, 900]]) { ctx.fillStyle = color; ctx.fillRect(x, y, 1200, 900); }
      const plain = await fileFromCanvas(canvas);
      // Minimal EXIF APP1, little-endian IFD0 orientation; test all 8 directions.
      const orientationCorners = [0, 1, 3, 2, 0, 2, 3, 1];
      const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
      for (let orientation = 1; orientation <= 8; orientation++) {
        const app1 = Uint8Array.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
        const bytes = new Uint8Array(await plain.arrayBuffer());
        const file = new File([bytes.slice(0, 2), app1, bytes.slice(2)], 'rotation.jpg', { type: 'image/jpeg' });
        const result = await optimize(file, 'EXIF ' + orientation);
        const bitmap = await createImageBitmap(result);
        const sample = document.createElement('canvas'); sample.width = sample.height = 1;
        sample.getContext('2d').drawImage(bitmap, 50, 50, 1, 1, 0, 0, 1, 1); bitmap.close();
        const pixel = sample.getContext('2d').getImageData(0, 0, 1, 1).data;
        check(colors[orientationCorners[orientation - 1]].every((c, index) => Math.abs(c - pixel[index]) < 20), 'EXIF visual orientation ' + orientation);
      }
      canvas.width = canvas.height = 200;
      ctx.clearRect(0, 0, 200, 200); ctx.fillStyle = 'red'; ctx.fillRect(50, 50, 100, 100);
      const small = await fileFromCanvas(canvas, 'image/png');
      check(await module.optimizeForUpload(small) === small, 'small PNG passes through unchanged');
      const smallWebp = await fileFromCanvas(canvas, 'image/webp');
      check(await module.optimizeForUpload(smallWebp) === smallWebp, 'small WebP passes unchanged');
      canvas.width = 2400; canvas.height = 1000;
      ctx.clearRect(0, 0, 2400, 1000); ctx.fillStyle = 'red'; ctx.fillRect(500, 300, 400, 400);
      const transparent = await fileFromCanvas(canvas, 'image/png');
      const alpha = await optimize(transparent, 'transparent PNG');
      const bitmap = await createImageBitmap(alpha); ctx.clearRect(0, 0, 2400, 1000); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      check(ctx.getImageData(0, 0, 1, 1).data[3] === 0, 'alpha retained');
      const gifBytes = Uint8Array.from(atob('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQACgAAACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7'), c => c.charCodeAt(0));
      const gif = new File([gifBytes], 'animated.gif', { type: 'image/gif' });
      check(await module.optimizeForUpload(gif) === gif, 'animated GIF preserved byte for byte');
      async function rejected(file, phrase) {
        const count = state.storageCalls.length;
        let error; try { await TaejangPromotionWorkspaceV2Api.uploadImage(file); } catch (e) { error = e; }
        check(error?.message.includes(phrase) && state.storageCalls.length === count, 'reject without upload: ' + phrase);
      }
      await rejected(new File(['invalid'], 'broken.jpg', { type: 'image/jpeg' }), '손상');
      await rejected(new File([gifBytes.slice(0, 13)], 'truncated.gif', { type: 'image/gif' }), '읽지');
      await rejected(new File(['HEIC'], 'phone.heic', { type: 'image/heic' }), 'HEIC');
      await rejected(new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'oversize.jpg', { type: 'image/jpeg' }), '15MB');
      await rejected(new File([gifBytes, new Uint8Array(1048576)], 'large.gif', { type: 'image/gif' }), '움직이는');
      const huge = new Uint8Array(await transparent.arrayBuffer()); new DataView(huge.buffer).setUint32(16, 50000);
      await rejected(new File([huge], 'huge.png', { type: 'image/png' }), '해상도');
      const mustCompress = new File([await largePhoto.arrayBuffer()], 'failure.jpg', { type: 'image/jpeg' });
      HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
      await rejected(mustCompress, '압축에 실패');
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      await module.optimizeForUpload(mustCompress); // failed preparation can be retried
      const padded = new Blob([await plain.arrayBuffer(), new Uint8Array(1100000)], { type: 'image/jpeg' });
      let rounds = 0;
      HTMLCanvasElement.prototype.toBlob = function (callback) { rounds++; callback(padded); };
      await rejected(new File([await largePhoto.arrayBuffer()], 'too-large.jpg', { type: 'image/jpeg' }), '1MB');
      check(rounds === 3, 'compression stops after 3 attempts');
      HTMLCanvasElement.prototype.toBlob = function (callback) { originalToBlob.call(this, callback, 'image/png'); };
      const fallback = await module.optimizeForUpload(new File([await transparent.arrayBuffer()], 'fallback.png', { type: 'image/png' }));
      check(fallback.type === 'image/png' && fallback.name.endsWith('.png'), 'unsupported WebP encoder fallback keeps real MIME');
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      // Approved repository photos, fetched from this local checkout only.
      const gallery = document.createElement('section'); gallery.style.cssText = 'display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))';
      for (const { name, base64 } of repoPhotos) {
        const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name.split('/').pop(), { type: 'image/webp' });
        const result = await optimize(file, name);
        for (const [label, data] of [['원본', file], ['홈페이지용', result]]) {
          const card = document.createElement('figure'), image = document.createElement('img');
          image.src = URL.createObjectURL(data); image.style.width = '100%'; image.alt = name + label;
          const caption = document.createElement('figcaption'); caption.textContent = name + ' ' + label + ' ' + data.size + ' bytes';
          card.append(image, caption); gallery.append(card);
        }
      }
      document.getElementById('dashboard-main').replaceChildren(gallery);
      window.photoRows = rows;
      return rows;
    }, photos);
    await writeFile(path.join(output, `results-${width}.json`), JSON.stringify(report, null, 2));
    await page.waitForFunction(() => [...document.querySelectorAll('#dashboard-main img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: path.join(output, `comparison-${width}.png`), fullPage: true });
    // Actual notice upload and both homepage UI upload adapters use the same preparation.
    await page.addScriptTag({ url: origin + '/app/assets/notice-media.js' });
    await page.addScriptTag({ url: origin + '/app/assets/issue-146-end-to-end.js' });
    await page.addScriptTag({ url: origin + '/app/assets/operations-homepage-direct.js' });
    await page.evaluate(async () => {
      window.captured = [];
      const nativeFetch = window.fetch;
      const cfg = { url: 'https://supabase.example.test', publishableKey: 'fixture' };
      window.fetch = async (url, options) => {
        if (String(url).includes('/storage/v1/object/')) { captured.push({ url, options }); return Response.json({ Key: 'ok' }); }
        return nativeFetch(url, options);
      };
      TaejangApp.getConfig = () => cfg;
      const uploaded = await TaejangNoticeMedia.upload('11111111-1111-4111-8111-111111111111', largePhoto);
      const check = (v, m) => { if (!v) throw Error(m); };
      const prepared = await photoModule.optimizeForUpload(largePhoto);
      check(captured.at(-1).options.body === prepared && uploaded.uploaded_size === prepared.size, 'notice optimized actual upload');
      TaejangApp.getRoute = () => 'operations_manager'; TaejangApp.can = () => true;
      TaejangApp.rpc = async name => name === 'get_homepage_content_slots' ? [{ slot_key: 'home.photo.04', page_key: 'home', slot_kind: 'image', public_path: 'index.html', selector: '[data-photo-slot="04"] > img' }] : [];
      await TaejangIssue146.openHomepageSlots();
      const input = document.querySelector('.issue146-form input[type=file]');
      const data = new DataTransfer(); data.items.add(largePhoto); input.files = data.files; input.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => document.querySelector('.issue146-form')?.textContent.includes('사진 업로드 완료'));
    assert.equal(await page.evaluate(async () => captured.at(-1).options.body === await photoModule.optimizeForUpload(largePhoto)), true);
    await page.evaluate(async () => {
      await TaejangOperationsHomepageDirect.openEditor('image');
      const input = document.querySelector('.operations-homepage-form input[type=file]');
      const data = new DataTransfer(); data.items.add(largePhoto); input.files = data.files; input.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => document.querySelector('.operations-homepage-form')?.textContent.includes('업로드 완료'));
    assert.equal(await page.evaluate(async () => captured.at(-1).options.body === await photoModule.optimizeForUpload(largePhoto)), true);
    console.log('PHOTO_OPTIMIZER_BROWSER_PASS:' + width + ':' + JSON.stringify(report));
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
