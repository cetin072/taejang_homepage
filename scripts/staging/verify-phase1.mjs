import { api, EMAIL_DOMAIN, PREFIX, stagingConfig, printTarget } from './shared.mjs';
try {
  const config = stagingConfig({ serviceRole: true }); printTarget(config, 'Phase 1 QA verification');
  const count = async path => (await api(config, path, { prefer: 'count=exact' })).length;
  const checks = [
    ['virtual Auth users', `/auth/v1/admin/users?per_page=1000`],
    ['QA profiles', `/rest/v1/profiles?work_email=like.*%40${EMAIL_DOMAIN}&select=id`],
    ['QA work groups', `/rest/v1/work_groups?name=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA Today items', `/rest/v1/today_information_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA schedules', `/rest/v1/schedule_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA notices', `/rest/v1/notices?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`],
    ['QA guidance', `/rest/v1/staff_guidance_items?title=like.${encodeURIComponent(`${PREFIX}*`)}&select=id`]
  ];
  const authUsers = await api(config, checks[0][1]); const virtualUsers = (authUsers.users || []).filter(user => user.email?.endsWith(`@${EMAIL_DOMAIN}`) && user.user_metadata?.staging_qa === true);
  if (virtualUsers.length !== 9) throw new Error(`Expected 9 virtual Auth users, found ${virtualUsers.length}.`);
  for (const [label, path] of checks.slice(1)) { const found = await count(path); if (!found) throw new Error(`Missing ${label}.`); console.log(`PASS ${label}: ${found}`); }
  const admins = await api(config, "/rest/v1/profiles?account_status=eq.active&select=id,profile_roles!inner(role_id,roles!inner(code))");
  const adminCount = admins.filter(profile => profile.profile_roles?.some(assignment => assignment.roles?.code === 'super_admin')).length;
  if (adminCount < 2) throw new Error(`Expected at least 2 active super admins; found ${adminCount}.`);
  console.log('PASS active super admins: 2 or more'); console.log('Verification completed without printing passwords, tokens, or keys.');
} catch (error) { console.error(`STOP: ${error.message}`); process.exitCode = 2; }
