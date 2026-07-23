import { api, EMAIL_DOMAIN, PREFIX, readManifest, stagingConfig, printTarget, removeManifest } from './shared.mjs';
const confirm = process.argv.includes('--delete');
try {
  const config = stagingConfig({ serviceRole: true, mutation: confirm }); printTarget(config, confirm ? 'Phase 1 QA cleanup requested' : 'Phase 1 QA cleanup preview');
  const manifest = readManifest(); if (manifest?.project_ref && manifest.project_ref !== config.ref) throw new Error('Manifest belongs to a different project ref. Refuse cleanup.');
  const query = async table => api(config, `/rest/v1/${table}?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`);
  const tables = ['staff_guidance_items', 'notices', 'schedule_items', 'today_information_items', 'daily_work_assignments'];
  const counts = {}; for (const table of tables) counts[table] = (await query(table)).length;
  const groups = await api(config, `/rest/v1/work_groups?name=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`); const auth = await api(config, '/auth/v1/admin/users?per_page=1000'); const users = (auth.users || []).filter(user => user.email?.endsWith(`@${EMAIL_DOMAIN}`) && user.user_metadata?.staging_qa === true);
  console.log(JSON.stringify({ content: counts, work_groups: groups.length, virtual_auth_users: users.length }, null, 2));
  if (!confirm) { console.log('Preview only. To delete only these QA records, rerun with STAGING_CONFIRM=STAGING node scripts/staging/cleanup-phase1.mjs --delete'); process.exit(0); }
  const qaNotices = await query('notices');
  for (const notice of qaNotices) await api(config, `/rest/v1/notice_acknowledgements?notice_id=eq.${notice.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  for (const table of tables) if (counts[table]) await api(config, `/rest/v1/${table}?title=like.${encodeURIComponent(`${PREFIX}*`)}`, { method: 'DELETE', prefer: 'return=minimal' });
  const guides = await api(config, `/rest/v1/work_guides?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`);
  for (const guide of guides) await api(config, `/rest/v1/work_guide_steps?work_guide_id=eq.${guide.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (guides.length) await api(config, `/rest/v1/work_guides?title=like.${encodeURIComponent(`${PREFIX}*`)}`, { method: 'DELETE', prefer: 'return=minimal' });
  for (const group of groups) await api(config, `/rest/v1/work_group_members?work_group_id=eq.${group.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (groups.length) await api(config, `/rest/v1/work_groups?name=like.${encodeURIComponent(`${PREFIX}*`)}`, { method: 'DELETE', prefer: 'return=minimal' });
  console.log('Content and organization cleanup completed. QA Auth users/profiles are intentionally retained when append-only status history or audit logs restrict deletion; the tool never force-deletes those records. Dispose of the entire non-production project after review if complete Auth removal is required.');
  removeManifest();
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
