import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function officialBlogPublicationChecks({apiUrl, rpc, sql, binaryApi, admin, lead, staff, check, equal}) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname),
    'Official blog publications must use isolated Supabase');
  const publish = (token, postId, extra = {}) => rpc('publish_official_blog_link', token, {
    p_blog_post_id: postId, p_title: 'CI 공식 블로그 링크', ...extra
  });
  const save = async (token, extra = {}) => {
    const result = await rpc('save_promotion_draft', token, {
      p_title: 'CI 홍보 초안', p_number_or_amount: 'no', p_people_photo: 'no', ...extra
    });
    check(result.ok && result.data?.content_id, 'created an isolated draft');
    return result.data;
  };
  const draftInput = item => ({
    p_draft_id: item.content_id,
    p_draft_updated_at: sql(`select updated_at::text from public.promotion_contents where id='${item.content_id}'`)
  });
  const postId = '224420000020';

  for (const token of [null, staff.token, admin.token]) {
    check(!(await publish(token, postId)).ok, 'direct RPC requires the promotion lead role');
  }
  const simulation = await rpc('set_role_simulation_mode', admin.token, {p_role_code: 'promotion_lead'});
  check(simulation.ok, 'administrator enters existing lead role simulation');
  try {
    check(!(await publish(admin.token, postId)).ok, 'simulated role cannot publish a real blog link');
  } finally {
    check((await rpc('set_role_simulation_mode', admin.token, {p_role_code: null})).ok, 'exit role simulation');
  }
  check(!(await publish(lead.token, 'https://blog.naver.com/other/224420000020')).ok,
    'arbitrary URLs are outside the RPC input contract');
  check(!(await publish(lead.token, postId, {p_public_body: '새 홈페이지 본문'})).ok,
    'RPC has no homepage body parameter');
  check(!(await publish(lead.token, postId, {p_cover_url: 'https://example.test/cover.png'})).ok,
    'cover cannot be a third-party URL');

  const exact = `https://blog.naver.com/taejang-official/${postId}`;
  const results = await Promise.all([publish(lead.token, postId), publish(lead.token, postId)]);
  equal(results.filter(result => result.ok).length, 1, 'concurrent requests publish only once');
  equal(results.find(result => !result.ok).data?.message, 'PROMOTION_BLOG_DUPLICATE', 'duplicate is reported');
  const {content_id: id, revision_id: revision} = results.find(result => result.ok).data;
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${revision}'`), '0',
    'direct publication creates no approval request or simulated approval');
  equal(sql(`select count(*) from public.audit_logs where target_id='${id}' and actor_profile_id='${lead.id}'
    and action='promotion_official_blog_link_published'`), '1', 'one audit event identifies the publisher');
  equal(sql(`select count(*) from public.promotion_content_revisions where id='${revision}' and locked_at is not null
    and public_body is null and external_url='${exact}'`), '1', 'immutable public card refers to the canonical post only');
  const feed = await rpc('list_public_promotion_feed', null, {});
  check(feed.data.some(row => row.content_id === id && row.external_url === exact
    && row.link_source_type === 'taejang_blog' && row.content_type === 'external_content'), 'public feed has the official link immediately');

  const other = await save(staff.token);
  check(!(await publish(lead.token, '224420000021', draftInput(other))).ok, 'foreign draft is denied');
  for (const fields of [
    {p_public_body: '새 홈페이지 본문'},
    {p_content_type: 'press_release'},
    {p_byline_kind: 'ceo'},
    {p_number_or_amount: 'yes'},
    {p_requested_publish_date: '2099-01-01'}
  ]) {
    const draft = await save(lead.token, fields);
    check(!(await publish(lead.token, '224420000021', draftInput(draft))).ok, 'review-required draft is denied');
    equal(sql(`select lifecycle::text from public.promotion_contents where id='${draft.content_id}'`), 'draft', 'rejected write preserves draft');
  }

  const submitted = await save(lead.token, {
    p_external_url: 'https://m.blog.naver.com/PostView.naver?logNo=224420000022&blogId=taejang-official'
  });
  check((await rpc('submit_promotion_revision', lead.token, {p_content_id: submitted.content_id})).ok,
    'lead can still submit a blog link to operations');
  equal(sql(`select stage::text from public.promotion_review_requests where revision_id='${submitted.revision_id}'
    and decision='pending'`), 'operations', 'ordinary submission still reaches operations approval');
  check(!(await publish(lead.token, '224420000022', draftInput(submitted))).ok, 'pending draft cannot skip its approval');
  equal((await publish(lead.token, '224420000022')).data?.message, 'PROMOTION_BLOG_DUPLICATE',
    'old PostView links already in the queue do not create duplicate public cards');

  const draft = await save(lead.token, {p_content_type: 'external_content'});
  const input = draftInput(draft);
  equal((await publish(lead.token, '224420000023', {...input, p_draft_updated_at: '2026-11-01T00:00:00Z'})).data?.message,
    'PROMOTION_BLOG_DRAFT_CHANGED', 'stale editor may not publish over a newer draft');
  const path = `${lead.id}/2026-11-27/official-blog-224420000023-${randomUUID()}.png`;
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAE0lEQVR4nGNkaGDACpiwCw9WCQBqCACQJ5at+QAAAABJRU5ErkJggg==', 'base64');
  check((await binaryApi('/storage/v1/object/promotion-media/' + path, {
    method: 'POST', token: lead.token, headers: {'Content-Type': 'image/png', 'x-upsert': 'false'}, body: image
  })).ok, 'lead uploads an isolated representative photo');
  const cover = 'https://jgsxpdflgkqroecfjzxq.supabase.co/storage/v1/object/public/promotion-media/' + path;
  equal((await publish(lead.token, '224420000024', {...input, p_cover_url: cover})).data?.message,
    'PROMOTION_BLOG_COVER_INVALID', 'a thumbnail for a different blog post is rejected');
  const applied = await publish(lead.token, '224420000023', {...input, p_cover_url: cover});
  check(applied.ok && applied.data.content_id === draft.content_id, 'eligible saved link publishes in place');
  equal(sql(`select hero_image_url from public.promotion_content_revisions where id='${applied.data.revision_id}'`),
    cover, 'the official imported thumbnail is preserved');
  console.log('PROMOTION_OFFICIAL_BLOG_PUBLICATION_AUTH_PASS');
}
