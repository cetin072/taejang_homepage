#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const NORMAL_BUDGET = 200 * 1024;
const REPRESENTATIVE_BUDGET = 400 * 1024;
const rasterPattern = /(?:assets|images)\/[A-Za-z0-9_./-]+\.(?:avif|gif|jpe?g|png|webp)/gi;

const publicSourceFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'assets/css')).filter((name) => name.endsWith('.css')).map((name) => `assets/css/${name}`),
  'assets/js/content.js',
  'assets/js/external-content.js',
  'assets/js/content-hub.js',
  'assets/js/home-previews.js',
  'assets/js/listing.js',
  'assets/js/photo-slots.js',
  'assets/js/hero-video.js',
  'assets/js/site.js'
].filter((relativePath) => fs.existsSync(path.join(root, relativePath)));

const active = new Map();
function remember(relativePath, representative, sourceFile) {
  const normalized = relativePath.replaceAll('\\', '/');
  const current = active.get(normalized) || { representative: false, sources: new Set() };
  current.representative ||= representative;
  current.sources.add(sourceFile);
  active.set(normalized, current);
}

for (const sourceFile of publicSourceFiles) {
  const source = fs.readFileSync(path.join(root, sourceFile), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const representativeLine = /(?:og:image|twitter:image|\bhero\s*:|article-representative|hero-)/i.test(line);
    for (const match of line.matchAll(rasterPattern)) remember(match[0], representativeLine, sourceFile);
  }
}

const missing = [];
const overBudget = [];
const activeRows = [];
for (const [relativePath, meta] of [...active.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(relativePath);
    continue;
  }
  const bytes = fs.statSync(absolutePath).size;
  const budget = meta.representative ? REPRESENTATIVE_BUDGET : NORMAL_BUDGET;
  const row = {
    path: relativePath,
    bytes,
    budget,
    role: meta.representative ? 'representative' : 'normal',
    sources: [...meta.sources].sort()
  };
  activeRows.push(row);
  if (bytes > budget) overBudget.push(row);
}

function walkRaster(dirRelative) {
  const dir = path.join(root, dirRelative);
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.posix.join(dirRelative, entry.name);
    if (entry.isDirectory()) found.push(...walkRaster(relative));
    else if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(entry.name)) found.push(relative);
  }
  return found;
}

const repositoryRaster = [...new Set([...walkRaster('images'), ...walkRaster('assets/images')])];
const inactiveOversized = repositoryRaster
  .filter((relativePath) => !active.has(relativePath))
  .map((relativePath) => ({ path: relativePath, bytes: fs.statSync(path.join(root, relativePath)).size }))
  .filter((row) => row.bytes > NORMAL_BUDGET)
  .sort((a, b) => b.bytes - a.bytes);

console.log('\n[public image budget] active repository-served raster assets');
for (const row of activeRows) {
  console.log(`${row.role.padEnd(14)} ${String(row.bytes).padStart(8)} / ${String(row.budget).padStart(8)}  ${row.path}`);
}
if (inactiveOversized.length) {
  console.log('\n[public image budget] oversized but not referenced by current public sources (report only; do not delete)');
  for (const row of inactiveOversized) console.log(`inactive       ${String(row.bytes).padStart(8)}  ${row.path}`);
}

assert.deepEqual(missing, [], `공개 소스가 참조하는 이미지 파일이 모두 존재해야 합니다: ${missing.join(', ')}`);
assert.deepEqual(overBudget, [], `현재 공개 화면에서 사용하는 이미지가 용량 기준을 초과했습니다:\n${overBudget.map((row) => `- ${row.path}: ${row.bytes} > ${row.budget}`).join('\n')}`);

console.log('\npublic-image-budget tests: all active image budgets passed');
