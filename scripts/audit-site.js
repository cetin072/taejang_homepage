#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico']);
const SITE_EXTENSIONS = new Set(['.html', '.css', '.js']);
const LEGACY_PHOTO_FILENAMES = [
  'taejang-minhwa-work-01.jpg',
  'taejang-minhwa-work-02.jpg',
  'taejang-packing-work-01.jpg',
  'taejang-packing-work-02.jpg',
  'taejang-packing-work-03.jpg',
  'taejang-palyong-workplace-01.jpg',
  'taejang-palyong-exterior-01.jpg',
  'taejang-company-cooperation-01.jpg',
  'taejang-environment-activity-01.jpg'
];
const PRESERVED_UNUSED_IMAGES = new Set([
  'assets/images/partners/bumhan.svg',
  'assets/images/partners/bumhan.png',
  'assets/images/partners/samhyun.jpg',
  'assets/images/partners/cheungwoo-bj.png'
]);
const B2B_PUBLIC_PAGES = ['partnership.html', 'resources.html'];
const LEGACY_UNSUITABLE_PACKING_2_SHA256 = '3f56e0285804ec587f0fa5adb7541dcc06927906cb2608b7263a9a2c02781523';

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createResult(options = {}) {
  return {
    errors: [],
    warnings: [],
    passes: [],
    imageFiles: [],
    imageReferences: new Map(),
    unusedImages: [],
    preservedUnusedImages: [],
    placeholderCount: 0,
    placeholderCommentCount: 0,
    canonicalUrls: [],
    openGraphUrls: [],
    sitemapEntries: [],
    publicReady: Boolean(options.publicReady)
  };
}

function addReference(result, imagePath, sourceFile) {
  if (!result.imageReferences.has(imagePath)) result.imageReferences.set(imagePath, new Set());
  result.imageReferences.get(imagePath).add(sourceFile);
}

function localPathFromReference(reference, sourceFile, rootDir) {
  const cleanReference = reference.trim().replace(/^['"]|['"]$/g, '');
  if (!cleanReference || cleanReference.startsWith('data:')) return null;

  let pathname = cleanReference.split('#')[0].split('?')[0];
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }

  if (!IMAGE_EXTENSIONS.has(path.extname(pathname).toLowerCase())) return null;
  const absolutePath = pathname.startsWith('/')
    ? path.resolve(rootDir, pathname.slice(1))
    : path.resolve(path.dirname(sourceFile), pathname);
  const relativePath = relative(rootDir, absolutePath);
  if (relativePath.startsWith('../')) return null;
  return relativePath;
}

function extractImageReferences(source, sourceFile, rootDir) {
  const references = new Set();
  const patterns = [
    /\b(?:src|href|content|poster)=["']([^"']+)["']/gi,
    /\bsrcset=["']([^"']+)["']/gi,
    /url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi,
    /["']((?:\.\.\/|\.\/|\/)?(?:images|assets\/images)\/[^"']+\.(?:png|jpe?g|webp|svg|gif|ico)(?:[?#][^"']*)?)["']/gi
  ];

  patterns.forEach(pattern => {
    for (const match of source.matchAll(pattern)) {
      const candidates = pattern.source.includes('srcset')
        ? match[1].split(',').map(value => value.trim().split(/\s+/)[0])
        : [match[1]];
      candidates.forEach(candidate => {
        const imagePath = localPathFromReference(candidate, sourceFile, rootDir);
        if (imagePath) references.add(imagePath);
      });
    }
  });
  return references;
}

function inspectHtml(result, source, filePath, rootDir) {
  const sourceName = relative(rootDir, filePath);
  const ids = [...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const seen = new Set();
  ids.forEach(id => {
    if (seen.has(id)) result.errors.push(`${sourceName}: 중복 id ${id}`);
    seen.add(id);
  });

  for (const match of source.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href || href === '#') {
      result.errors.push(`${sourceName}: 빈 링크 ${href || '(빈 값)'}`);
      continue;
    }
    if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
    const target = href.split('#')[0].split('?')[0];
    if (!target) continue;
    const targetPath = path.resolve(path.dirname(filePath), target);
    if (!fs.existsSync(targetPath)) result.errors.push(`${sourceName}: 존재하지 않는 내부 링크 ${href}`);
  }

  result.placeholderCount += [...source.matchAll(/class=["'][^"']*\bdev-photo-placeholder\b[^"']*["']/g)].length;
  result.placeholderCommentCount += (source.match(/DEV-PHOTO-PLACEHOLDER/g) || []).length;

  const canonical = source.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || source.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (canonical) result.canonicalUrls.push({ file: sourceName, url: canonical[1] });

  const ogUrl = source.match(/<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i)
    || source.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["']/i);
  if (ogUrl) result.openGraphUrls.push({ file: sourceName, url: ogUrl[1] });
}

function inspectB2bPage(result, source, filePath, rootDir) {
  const sourceName = relative(rootDir, filePath);
  if (!/<title>[^<]+<\/title>/i.test(source)) result.errors.push(`${sourceName}: title이 없습니다.`);
  if (!/<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']+["]/i.test(source)) {
    result.errors.push(`${sourceName}: meta description이 없습니다.`);
  }
}

function inspectSitemap(result, rootDir) {
  const existingB2bPages = B2B_PUBLIC_PAGES.filter(page => fs.existsSync(path.join(rootDir, page)));
  if (!existingB2bPages.length) return;
  const sitemapPath = path.join(rootDir, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    result.errors.push('sitemap.xml: 공개 페이지 경로를 확인할 수 없습니다.');
    return;
  }
  const source = fs.readFileSync(sitemapPath, 'utf8');
  result.sitemapEntries = [...source.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  existingB2bPages.forEach(page => {
    if (!result.sitemapEntries.some(entry => entry.endsWith(`/${page}`))) {
      result.errors.push(`sitemap.xml: ${page} 경로가 없습니다.`);
    }
  });
}

function checkLegacyPackingReference(result, rootDir, options) {
  const imagePath = 'images/packing-2.jpg';
  if (!result.imageReferences.has(imagePath)) return;
  const localPath = path.join(rootDir, imagePath);
  if (!fs.existsSync(localPath)) return;
  const legacyHash = options.legacyPacking2Hash || LEGACY_UNSUITABLE_PACKING_2_SHA256;
  if (sha256(localPath) === legacyHash) {
    result.errors.push(`${imagePath}: 과거 공개 부적합 파일이 사이트 코드에서 다시 참조됩니다.`);
  }
}

function auditRepository(rootDir = ROOT_DIR, options = {}) {
  const result = createResult(options);
  const preservedUnusedImages = options.preservedUnusedImages || PRESERVED_UNUSED_IMAGES;
  const siteFiles = walk(rootDir).filter(filePath => {
    const name = relative(rootDir, filePath);
    if (name.startsWith('.git/') || name.startsWith('docs/') || name.startsWith('scripts/')) return false;
    return SITE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  });
  const htmlFiles = siteFiles.filter(filePath => path.extname(filePath).toLowerCase() === '.html');
  result.imageFiles = ['images', 'assets/images']
    .flatMap(directory => walk(path.join(rootDir, directory)))
    .filter(filePath => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map(filePath => relative(rootDir, filePath))
    .sort();

  siteFiles.forEach(filePath => {
    const sourceName = relative(rootDir, filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    extractImageReferences(source, filePath, rootDir).forEach(imagePath => addReference(result, imagePath, sourceName));
    if (path.extname(filePath).toLowerCase() === '.html') {
      inspectHtml(result, source, filePath, rootDir);
      if (B2B_PUBLIC_PAGES.includes(sourceName)) inspectB2bPage(result, source, filePath, rootDir);
    }

    LEGACY_PHOTO_FILENAMES.forEach(filename => {
      if (source.includes(filename)) result.errors.push(`${sourceName}: 과거 긴 사진 파일명 ${filename}`);
    });
    for (const match of source.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"']*/gi)) {
      result.warnings.push(`${sourceName}: 임시 로컬 URL ${match[0]}`);
    }
  });

  inspectSitemap(result, rootDir);

  result.imageReferences.forEach((sources, imagePath) => {
    if (!fs.existsSync(path.join(rootDir, imagePath))) {
      result.errors.push(`${imagePath}: 참조됐지만 파일이 없습니다. 참조: ${[...sources].join(', ')}`);
    }
  });
  checkLegacyPackingReference(result, rootDir, options);

  result.unusedImages = result.imageFiles.filter(imagePath => !result.imageReferences.has(imagePath));
  result.unusedImages.forEach(imagePath => {
    if (preservedUnusedImages.has(imagePath)) result.preservedUnusedImages.push(imagePath);
    else result.warnings.push(`${imagePath}: 사이트 코드에서 참조되지 않는 이미지 후보`);
  });

  if (result.placeholderCount || result.placeholderCommentCount) {
    const message = `개발 사진 안내 ${result.placeholderCount}개 · 교체 주석 ${result.placeholderCommentCount}개`;
    if (result.publicReady) result.errors.push(`${message}: 공개 준비 모드에서는 모두 제거 또는 실제 사진으로 교체해야 합니다.`);
    else result.warnings.push(`${message}: 개발 모드에서는 허용되지만 공개 전 교체가 필요합니다.`);
  }

  if (!result.errors.some(message => message.includes('참조됐지만') || message.includes('내부 링크'))) {
    result.passes.push('깨진 로컬 이미지·내부 링크 없음');
  }
  if (!result.errors.some(message => message.includes('중복 id'))) result.passes.push('HTML 중복 id 없음');
  if (!result.errors.some(message => message.includes('과거 긴 사진 파일명'))) result.passes.push('사이트 코드에 과거 긴 사진 파일명 없음');
  result.passes.push(`사이트 이미지 ${result.imageFiles.length}개 · 실제 참조 ${result.imageReferences.size}개 · 미참조 후보 ${result.unusedImages.length - result.preservedUnusedImages.length}개`);
  if (result.preservedUnusedImages.length) result.passes.push(`보존 미참조 공식 자산 ${result.preservedUnusedImages.length}개`);
  result.passes.push(`공개 준비 모드: ${result.publicReady ? '예' : '아니오'}`);
  if (htmlFiles.length) result.passes.push(`HTML ${htmlFiles.length}개 검사`);
  if (result.sitemapEntries.length) result.passes.push(`sitemap 경로 ${result.sitemapEntries.length}개 검사`);
  return result;
}

function printResult(result) {
  result.passes.forEach(message => console.log(`[PASS] ${message}`));
  result.warnings.forEach(message => console.log(`[WARNING] ${message}`));
  result.errors.forEach(message => console.error(`[ERROR] ${message}`));

  if (result.preservedUnusedImages.length) {
    console.log('\n[INFO] 보존 미참조 자산');
    result.preservedUnusedImages.forEach(imagePath => console.log(`  - ${imagePath}`));
  }
  if (result.canonicalUrls.length) {
    console.log('\n[INFO] canonical');
    result.canonicalUrls.forEach(item => console.log(`  - ${item.file}: ${item.url}`));
  }
  if (result.openGraphUrls.length) {
    console.log('\n[INFO] og:url');
    result.openGraphUrls.forEach(item => console.log(`  - ${item.file}: ${item.url}`));
  }
  console.log(`\n결과: PASS ${result.passes.length} · WARNING ${result.warnings.length} · ERROR ${result.errors.length}`);
}

if (require.main === module) {
  const result = auditRepository(ROOT_DIR, { publicReady: process.argv.includes('--public-ready') });
  printResult(result);
  if (result.errors.length) process.exitCode = 1;
}

module.exports = {
  IMAGE_EXTENSIONS,
  LEGACY_PHOTO_FILENAMES,
  LEGACY_UNSUITABLE_PACKING_2_SHA256,
  PRESERVED_UNUSED_IMAGES,
  B2B_PUBLIC_PAGES,
  auditRepository,
  extractImageReferences,
  localPathFromReference
};
