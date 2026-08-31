import { api, EMAIL_DOMAIN, PREFIX, readManifest, stagingConfig, printTarget } from './shared.mjs';
try {
  const config = stagingConfig({ serviceRole: true }); printTarget(config, 'Phase 1 QA verification');
  const manifest = readManifest();
  if (!manifest?.seed_mode || !['minimal', 'full'].includes(manifest.seed_mode)) throw new Error('A current minimal or full QA manifest is required before verification.');
  if (manifest.project_ref !== config.ref) throw new Error('Manifest belongs to a different project ref. Refuse verification.');
  const expectedUsers = manifest.seed_mode === 'full' ? 9 : 2;
  const count = async path => (await api(config, path, { prefer: 'count=exact' })).length;
  const checks = [
    ['virtual Auth users', `/auth/v1/admin/users?per_page=1000`],
    ['QA profiles', `/rest/v1/profiles?work_email=like.*%40${EMAIL_DOMAIN}&select=id`],
    ['QA work groups', `/rest/v1/work_groups?name=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA today work', `/rest/v1/daily_work_assignments?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA work guides', `/rest/v1/work_guides?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA schedules', `/rest/v1/schedule_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA notices', `/rest/v1/notices?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA guidance', `/rest/v1/staff_guidance_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`]
  ];
  if (manifest.seed_mode === 'full') checks.splice(3, 0, ['QA Today information', `/rest/v1/today_information_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`]);
  const authUsers = await api(config, checks[0][1]); const virtualUsers = (authUsers.users || []).filter(user => user.email?.endsWith(`@${EMAIL_DOMAIN}`) && user.user_metadata?.staging_qa === true);
  const seededUsers = virtualUsers.filter(user => Object.values(manifest.user_ids || {}).includes(user.id));
  if (seededUsers.length !== expectedUsers) throw new Error(`Expected ${expectedUsers} ${manifest.seed_mode} virtual Auth users from the manifest, found ${seededUsers.length}.`);
  for (const [label, path] of checks.slice(1)) { const found = await count(path); if (!found) throw new Error(`Missing ${label}.`); console.log(`PASS ${label}: ${found}`); }
  const admins = await api(config, "/rest/v1/profiles?account_status=eq.active&select=id,profile_roles!inner(role_id,roles!inner(code))");
  const adminCount = admins.filter(profile => Object.values(manifest.user_ids || {}).includes(profile.id) && profile.profile_roles?.some(assignment => assignment.roles?.code === 'super_admin')).length;
  const expectedAdmins = manifest.seed_mode === 'full' ? 2 : 1;
  if (adminCount < expectedAdmins) throw new Error(`Expected at least ${expectedAdmins} active super admins for ${manifest.seed_mode} QA, found ${adminCount}.`);
  console.log(`PASS active super admins: ${expectedAdmins} or more`); console.log('Verification completed without printing passwords, tokens, or keys.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
