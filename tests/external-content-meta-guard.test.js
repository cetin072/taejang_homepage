import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync('netlify/functions/external-content-meta.mjs', 'utf8');
const metaModule = await import('../netlify/functions/external-content-meta.mjs');

test('external metadata function uses capability-backed durable quota instead of legacy role list', () => {
  assert.match(source, /rpc\/consume_external_content_meta_quota/);
  assert.doesNotMatch(source, /rpc\/get_my_access_context/);
  assert.doesNotMatch(source, /promotion_staff['"],\s*['"]promotion_lead/);
});

test('external metadata function fails closed and distinguishes forbidden from rate limiting', () => {
  assert.match(source, /AUTHORIZATION_UNAVAILABLE/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /typeof quota\.allowed !== ['"]boolean['"]/);
  assert.match(source, /Number\.isFinite\(retryAfterSeconds\)/);
  assert.match(source, /RATE_LIMITED/);
  assert.match(source, /status:\s*429/);
  assert.match(source, /retry_after_seconds/);
  assert.match(source, /FORBIDDEN/);
});

test('existing SSRF and response-size defenses remain in place', () => {
  assert.match(source, /dns\.lookup/);
  assert.match(source, /BLOCKED_HOST/);
  assert.match(source, /redirect:\s*['"]manual['"]/);
  assert.match(source, /redirectCount\s*<=\s*3/);
  assert.match(source, /7000/);
  assert.match(source, /1_000_000/);
  assert.match(source, /text\/html/);
});

test('external metadata function remains syntactically valid', () => {
  const result = spawnSync(process.execPath, ['--check', 'netlify/functions/external-content-meta.mjs'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test('Naver blog URLs normalize to mobile fetch targets while keeping canonical desktop identity', () => {
  const direct = metaModule.normalizeNaverBlogTarget('https://blog.naver.com/taejang-official/224367547159');
  assert.deepEqual(direct, {
    blogId: 'taejang-official',
    logNo: '224367547159',
    fetchUrl: 'https://m.blog.naver.com/taejang-official/224367547159',
    canonicalUrl: 'https://blog.naver.com/taejang-official/224367547159'
  });

  const postView = metaModule.normalizeNaverBlogTarget('https://blog.naver.com/PostView.naver?blogId=taejang-official&logNo=224367547159');
  assert.equal(postView?.fetchUrl, 'https://m.blog.naver.com/taejang-official/224367547159');
  assert.equal(postView?.canonicalUrl, 'https://blog.naver.com/taejang-official/224367547159');
  assert.equal(metaModule.normalizeNaverBlogTarget('https://news.example.com/article/1'), null);
});

test('Naver blog and ordinary news body extraction both remain supported', () => {
  const naverHtml = `
    <html><head><meta property="og:title" content="태장 블로그 테스트"></head><body>
      <div class="se-main-container">
        <p>태장 네이버 블로그 본문입니다. 첫 번째 문단에는 현장 소식과 사진 이야기가 들어갑니다.</p>
        <p>두 번째 문단에는 직원과 지역사회 활동에 대한 충분한 설명이 이어집니다.</p>
      </div>
      <div class="post_footer">footer</div>
    </body></html>`;
  assert.match(metaModule.extractNaverBlogText(naverHtml) || '', /태장 네이버 블로그 본문/);

  const newsHtml = `
    <html><body><article>
      <h1>일반 인터넷 뉴스</h1>
      <p>일반 뉴스 기사 본문이 충분히 길게 들어갑니다. 외부 언론사 페이지의 article 요소를 기존 방식으로 계속 읽을 수 있어야 합니다.</p>
      <p>두 번째 문단도 포함하여 최소 길이 조건을 넘기고 기존 기사 파서 회귀를 방지합니다. 링크 메타 기능은 네이버 전용 처리 후에도 일반 뉴스에 영향을 주면 안 됩니다.</p>
    </article></body></html>`;
  assert.match(metaModule.extractArticleText(newsHtml) || '', /일반 뉴스 기사 본문/);
});
