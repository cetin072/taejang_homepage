import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const PREFIX = '[STAGING-QA]';
export const EMAIL_DOMAIN = 'staging.invalid';
export const MANIFEST = resolve(import.meta.dirname, '.qa-manifest.json');
export const qaEmail = slug => `qa-${slug}@${EMAIL_DOMAIN}`;

export class StagingSafetyError extends Error { constructor(message) { super(message); this.name = 'StagingSafetyError'; } }
const required = name => { if (!process.env[name]) throw new StagingSafetyError(`${name} is required. Stop without changing the remote project.`); return process.env[name]; };
const hidden = value => value ? `${value.slice(0, 4)}…${value.slice(-3)}` : '(missing)';

export function stagingConfig({ serviceRole = false, mutation = false } = {}) {
  const url = new URL(required('STAGING_SUPABASE_URL'));
  const ref = required('STAGING_SUPABASE_PROJECT_REF');
  const allowed = required('STAGING_ALLOWED_PROJECT_REFS').split(',').map(value => value.trim()).filter(Boolean);
  const blocked = (process.env.STAGING_BLOCKED_PROJECT_REFS || '').split(',').map(value => value.trim()).filter(Boolean);
  required('STAGING_SUPABASE_PUBLISHABLE_KEY');
  if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co`) throw new StagingSafetyError('URL must be the HTTPS default Supabase URL for STAGING_SUPABASE_PROJECT_REF.');
  if (!allowed.includes(ref) || blocked.includes(ref)) throw new StagingSafetyError('Project ref is not explicitly allow-listed for staging, or is locally blocked.');
  if (/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(url.hostname)) throw new StagingSafetyError('Project URL looks like production/live. Refuse to continue.');
  if (mutation && process.env.STAGING_CONFIRM !== 'STAGING') throw new StagingSafetyError('Set STAGING_CONFIRM=STAGING for this mutating command.');
  const serviceRoleKey = serviceRole ? required('STAGING_SUPABASE_SERVICE_ROLE_KEY') : null;
  if (serviceRole && serviceRoleKey.length < 20) throw new StagingSafetyError('STAGING_SUPABASE_SERVICE_ROLE_KEY is not plausible.');
  return { url: url.origin, ref, publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY, serviceRoleKey, confirmation: process.env.STAGING_CONFIRM };
}

export function printTarget(config, action) {
  console.log(`${action}: ref=${config.ref} url=${config.url}`);
  console.log(`git: branch=${process.env.GIT_BRANCH || 'run git branch --show-current'} head=${process.env.GIT_HEAD || 'run git rev-parse HEAD'}`);
  console.log('Keys, passwords, tokens, and full environment values are never printed.');
}

export async function api(config, path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${config.url}${path}`, { method, headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text(); let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(`Supabase ${method} ${path} failed (${response.status}). ${typeof data === 'object' ? JSON.stringify(data) : String(data).slice(0, 180)}`);
  return data;
}

export function migrations() {
  const dir = resolve(ROOT, 'supabase/migrations');
  return readdirSync(dir).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sha256: createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex') }));
}
export function writeManifest(value) { writeFileSync(MANIFEST, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
export function readManifest() { return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null; }
export function removeManifest() { if (existsSync(MANIFEST)) writeFileSync(MANIFEST, JSON.stringify({ cleaned_at: new Date().toISOString() }) + '\n', { mode: 0o600 }); }
export function secretHint(name) { return `${name}=${hidden(process.env[name])}`; }
