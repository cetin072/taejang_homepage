import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const outputRoot = path.resolve(process.env.TAEJANG_PUBLISH_DIR || path.join(repoRoot, 'dist'));

if (outputRoot === repoRoot) {
  throw new Error('Refusing to use the repository root as the Netlify publish directory.');
}

const PUBLIC_ROOT_FILES = Object.freeze([
  '404.html',
  'about.html',
  'activities.html',
  'archive.html',
  'business.html',
  'community-esg.html',
  'greeting.html',
  'index.html',
  'location.html',
  'partnership.html',
  'privacy.html',
  'promotion.html',
  'resources.html',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  'terms.html',
  'thanks.html',
  'why-minhwa.html',
  'workplace.html'
]);

const PUBLIC_DIRECTORIES = Object.freeze(['assets', 'images', 'app', 'staff']);
const ALLOWED_STATIC_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.webmanifest',
  '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico', '.avif',
  '.woff', '.woff2', '.mp4', '.webm'
]);

async function exists(source) {
  try {
    await stat(source);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function copyRequiredFile(relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!(await exists(source))) {
    throw new Error(`Required public file is missing: ${relativePath}`);
  }
  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

function staticAssetFilter(source) {
  const relative = path.relative(repoRoot, source);
  if (!relative || relative.startsWith('..')) return false;
  const extension = path.extname(source).toLowerCase();
  if (!extension) return true;
  return ALLOWED_STATIC_EXTENSIONS.has(extension);
}

async function copyRequiredDirectory(relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!(await exists(source))) {
    throw new Error(`Required public directory is missing: ${relativePath}`);
  }
  await cp(source, path.join(outputRoot, relativePath), {
    recursive: true,
    filter: staticAssetFilter
  });
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of PUBLIC_ROOT_FILES) await copyRequiredFile(file);
for (const directory of PUBLIC_DIRECTORIES) await copyRequiredDirectory(directory);

console.log(`Netlify publish bundle created at ${outputRoot}`);
