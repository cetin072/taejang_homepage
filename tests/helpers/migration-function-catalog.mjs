import { readdirSync, readFileSync } from 'node:fs';

// Test-only: replay explicit function declarations and ALTER ... RENAME in
// chronological repository migrations. Production functions are not copied into fixtures.
export function migrationFunctions({ before = null } = {}) {
  const catalog = new Map();
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\([\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\2\s*;|alter\s+function\s+((?:public|private)\.\w+)\s*\([\s\S]*?\)\s+rename\s+to\s+(\w+)\s*;/ig;
  for (const file of readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql') && (!before || name.slice(0,14)<before)).sort()) {
    for (const match of readFileSync(`supabase/migrations/${file}`,'utf8').matchAll(pattern)) {
      if (match[1]) catalog.set(match[1],match[0]);
      else {
        const old=match[3], next=old.split('.')[0]+'.'+match[4];
        if (!catalog.has(old)) throw new Error(`Missing original function ${old} for rename in ${file}`);
        catalog.set(next,catalog.get(old).replace(old,next)); catalog.delete(old);
      }
    }
  }
  return catalog;
}
