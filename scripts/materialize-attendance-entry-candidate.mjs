import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Local/CI preparation only. Never calls db push, link, deploy, or a hosted DB.
const directory = join(process.cwd(), 'supabase/migrations');
const suffix = '_attendance_register_lead_entry.sql';
const candidate = readFileSync('prototypes/attendance-register/lead-entry.sql', 'utf8');
let files = readdirSync(directory).filter(name => name.endsWith(suffix));
assert.ok(files.length <= 1, 'Multiple attendance-entry migrations require manual review');
if (files.length === 0) {
  execFileSync('supabase', ['migration', 'new', 'attendance_register_lead_entry'], { stdio: 'inherit' });
  files = readdirSync(directory).filter(name => name.endsWith(suffix));
  assert.equal(files.length, 1, 'Supabase CLI did not generate exactly one migration');
  writeFileSync(join(directory, files[0]), candidate);
} else {
  assert.equal(readFileSync(join(directory, files[0]), 'utf8'), candidate,
    'Committed migration differs from candidate; never rewrite an applied migration');
}
console.log('GENERATED_ATTENDANCE_MIGRATION=' + files[0]);
