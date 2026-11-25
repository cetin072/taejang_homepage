import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs only in the repository's isolated local Supabase integration container.
export async function operationsMissingPromotionPhotoChecks({ apiUrl, rpc, sql, binaryApi, admin, lead, staff, check, equal }) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname),
    'Published-photo write checks must use isolated Supabase');

  const draft = await rpc('save_promotion_draft', lead.token, {
    p_content_type: 'homepage_article', p_slug: 'ci-photo-correction-' + randomUUID(),
    p_title: 'CI 공개글 누락 사진 테스트', p_public_body: '원문 내용은 수정하지 않습니다.',
    p_byline_kind: 'company', p_public_media: [], p_people_photo: 'no', p_number_or_amount: 'no'
  });
  check(draft.ok && draft.data?.content_id, 'create isolated photo-less lead draft');
  check((await rpc('submit_promotion_revision', lead.token, { p_content_id: draft.data.content_id })).ok,
    'lead submits photo-less fixture');
  check((await rpc('review_promotion_revision', admin.token,
    { p_content_id: draft.data.content_id, p_action: 'approve', p_comment: 'CI 승인', p_revisit_at: null })).ok,
    'operations manager approves and publishes existing lead draft');

  const id = draft.data.content_id;
  const oldRevisionId = draft.data.revision_id;
  const publishedBefore = sql(`select published_at::text from public.promotion_contents where id='${id}'`);
  const reviewsBefore = sql(`select count(*) from public.promotion_review_requests where revision_id='${oldRevisionId}'`);
  const details = await rpc('get_operations_missing_promotion_photo', admin.token, { p_content_id: id });
  check(details.ok && details.data?.revision_id === oldRevisionId && details.data.public_media_count === 0,
    'authorized manager reads only an eligible photo-less revision');
  check(!(await rpc('get_operations_missing_promotion_photo', staff.token, { p_content_id: id })).ok,
    'ordinary employee cannot read photo-correction editor');
  check(!(await rpc('get_operations_missing_promotion_photo', lead.token, { p_content_id: id })).ok,
    'promotion lead cannot use operations correction editor');

  const overview = await rpc('get_promotion_publication_admin', admin.token, {});
  check(overview.ok && overview.data.items.some(x => x.content_id === id && x.can_operations_add_missing_photo === true),
    'canonical publication admin shows missing-photo action for eligible manager');

  const imageData = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
  const path = `${admin.id}/2026-10-28/${randomUUID()}.png`;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const upload = await binaryApi('/storage/v1/object/promotion-media/' + encodedPath, {
    method: 'POST', token: admin.token, headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' },
    body: imageData
  });
  check(upload.ok, 'manager uploaded verified test photo to isolated Storage');
  const photoUrl = 'https://jgsxpdflgkqroecfjzxq.supabase.co/storage/v1/object/public/promotion-media/' + encodedPath;
  const input = {
    p_content_id: id, p_expected_revision_id: oldRevisionId, p_photo_url: photoUrl,
    p_photo_alt: 'CI 공개 사진', p_reason: '누락 대표사진 검증',
    p_confirm_source: true
  };

  for (const [actor, label] of [[staff, 'staff'], [lead, 'lead']]) {
    check(!(await rpc('operations_add_missing_promotion_photo', actor.token, input)).ok,
      label + ' denied photo mutation');
  }
  check(!(await rpc('operations_add_missing_promotion_photo', null, input)).ok,
    'anonymous photo mutation denied');
  check(!(await rpc('operations_add_missing_promotion_photo', admin.token,
    { ...input, p_confirm_source: false })).ok,
    'cannot publish without explicit source-right confirmation');
  check(!(await rpc('operations_add_missing_promotion_photo', admin.token,
    { ...input, p_photo_url: 'https://cdn.other.example/photo.png' })).ok,
    'third-party image URL rejected');
  check(!(await rpc('operations_add_missing_promotion_photo', admin.token,
    { ...input, p_photo_url: photoUrl.replace(/\/[0-9a-f-]+[.]png$/, '/missing.png') })).ok,
    'nonexistent storage object rejected');

  const applied = await rpc('operations_add_missing_promotion_photo', admin.token, input);
  check(applied.ok && applied.data?.revision_id && applied.data.revision_id !== oldRevisionId,
    'manager appends one approved published photo via new immutable revision');
  const nextRevisionId = applied.data.revision_id;
  equal(sql(`select published_at::text from public.promotion_contents where id='${id}'`),
    publishedBefore, 'original publication timestamp unchanged');
  equal(sql(`select public_media->0->>'url' from public.promotion_content_revisions where id='${nextRevisionId}'`),
    photoUrl, 'single attached photo stored at known public URL');
  equal(sql(`select hero_image_url from public.promotion_content_revisions where id='${nextRevisionId}'`),
    photoUrl, 'approved photo becomes detail/card/OG hero');
  equal(sql(`select people_photo::text from public.promotion_content_revisions where id='${nextRevisionId}'`),
    'unsure', 'new photo has disclosure flag for future review');
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${oldRevisionId}'`),
    reviewsBefore, 'all prior approvals preserved unchanged');
  equal(sql(`select count(*) from public.promotion_review_requests where revision_id='${nextRevisionId}'`),
    '0', 'no fake approval row created');
  equal(sql(`select title || '|' || public_body from public.promotion_content_revisions where id='${nextRevisionId}'`),
    'CI 공개글 누락 사진 테스트|원문 내용은 수정하지 않습니다.',
    'published original text and title remain identical');
  equal(sql(`select count(*) from public.audit_logs where target_id='${id}' and action='promotion_missing_photo_corrected' and metadata->>'from_revision_id'='${oldRevisionId}' and metadata->>'to_revision_id'='${nextRevisionId}'`),
    '1', 'one provenance audit records before/after revision');
  const publicRead = await rpc('get_public_promotion_content', null, { p_content_id: id });
  check(publicRead.ok && publicRead.data[0].hero_image_url === photoUrl &&
    publicRead.data[0].public_media[0].url === photoUrl,
    'anonymous approved public detail immediately reads updated photo');

  check(!(await rpc('operations_add_missing_promotion_photo', admin.token, input)).ok,
    'stale revision rejected after published correction');
  check(!(await rpc('operations_add_missing_promotion_photo', admin.token,
    { ...input, p_expected_revision_id: nextRevisionId })).ok,
    'existing photo cannot be overwritten through add-only RPC');
  check(!(await rpc('get_operations_missing_promotion_photo', admin.token, { p_content_id: id })).ok,
    'corrected item is no longer editable with missing-photo RPC');

  // A CEO-required post must never use this route instead of the executive gate.
  const ceoDraft = await rpc('save_operations_promotion_draft', admin.token, {
    p_content_type: 'homepage_article', p_slug: 'ci-photo-ceo-denial-' + randomUUID(),
    p_title: 'CI 대표 승인 대상', p_public_body: '실제 대표이사 승인 대상 사진 우회 금지',
    p_byline_kind: 'company', p_public_media: [], p_people_photo: 'no', p_number_or_amount: 'no'
  });
  check(ceoDraft.ok, 'create isolated CEO guard fixture');
  sql(`update public.promotion_contents set lifecycle='published',published_at=now(),minimum_review_stage='ceo' where id='${ceoDraft.data.content_id}'`);
  const ceoInput = { ...input, p_content_id: ceoDraft.data.content_id, p_expected_revision_id: ceoDraft.data.revision_id };
  check(!(await rpc('get_operations_missing_promotion_photo', admin.token,
    { p_content_id: ceoDraft.data.content_id })).ok, 'CEO-required correction read denied');
  check(!(await rpc('operations_add_missing_promotion_photo', admin.token, ceoInput)).ok,
    'CEO-required correction write denied');
  console.log('OPERATIONS_MISSING_PROMOTION_PHOTO_AUTH_PASS');
}
