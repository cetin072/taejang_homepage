import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep one maintained source while avoiding a parser-blocking network request
// for this small, first-paint-critical controller in published HTML.
export async function inlinePublicNavigation(outputRoot) {
  const tag = '<script src="assets/js/public-navigation.js"></script>';
  const source = await readFile(path.join(outputRoot, 'assets/js/public-navigation.js'), 'utf8');
  const inline = '<script data-public-navigation>\n' + source.replace(/<\/script/gi, '<\\/script') + '</script>';
  const files = [];
  for (const dir of ['', 'activities', 'workplace']) {
    const entries = await readdir(path.join(outputRoot, dir), { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    files.push(...entries.filter(entry => entry.isFile() && entry.name.endsWith('.html'))
      .map(entry => path.join(outputRoot, dir, entry.name)));
  }
  let count = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const parts = html.split(tag);
    if (parts.length === 1) continue;
    if (parts.length !== 2) throw new Error('Duplicate public navigation controller: ' + file);
    await writeFile(file, parts.join(inline));
    count++;
  }
  return count;
}
