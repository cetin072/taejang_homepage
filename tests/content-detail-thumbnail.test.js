#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const listing = read('assets/js/listing.js');
const content = read('assets/js/content.js');
const hub = read('assets/js/content-hub.js');
const styles = read('assets/css/styles.css');
const workplace = read('workplace.html');
const workplaceContent = content.slice(content.indexOf('workplace: ['), content.indexOf('activities: ['));

assert.match(listing, /const hubItems = Array\.isArray\(window\.TAEJANG_CONTENT\?\.hub\)/);
assert.match(listing, /candidate\.detailUrl === `\$\{config\.page\}\?id=\$\{item\.id\}`/);
assert.match(listing, /const source = hubItem\?\.thumbnail \|\| item\.thumbnail \|\| item\.hero \|\| item\.thumb/);
assert.match(listing, /const alt = hubItem\?\.thumbnailAlt \|\| item\.thumbnailAlt \|\| item\.alt\?\.hero \|\| item\.alt\?\.thumb/);
assert.match(listing, /cardMedia\(item\)/);
assert.match(listing, /detailRepresentative = representativeMedia\(item\)/);
assert.match(listing, /class="article-representative-media(?:\s|\")/);
assert.match(listing, /contentPhoto\(item, 'detail'\)/);

const environmentStart = content.indexOf('id: "environment-cleanup-first"');
const environmentEnd = content.indexOf('\n    },', environmentStart);
const environment = content.slice(environmentStart, environmentEnd);
assert.match(environment, /thumb: null/);
assert.match(content, /id: "internal-environment-cleanup"[\s\S]*thumbnail: "assets\/images\/archive\/environment-cleanup-first\.webp"/);
assert.match(content, /thumbnailAlt: "지역사회 환경정비 활동 현수막 앞에 모인 태장 구성원들"/);
assert.match(content, /id: "internal-certification"[\s\S]*thumbnail: "assets\/images\/archive\/standard-workplace-certification\.webp"/);
assert.match(hub, /function createMedia\(item/);
assert.match(styles, /\.article-body \.article-representative-media\s*\{[\s\S]*aspect-ratio:16\/9/);
assert.match(styles, /\.article-body \.article-representative-media img\s*\{[\s\S]*object-fit:cover[\s\S]*object-position:center/);
assert.match(workplace, /data-workplace-overview/);
assert.match(workplace, /data-workplace-roles/);
assert.match(workplace, /data-workplace-process/);
assert.match(listing, /if \(type === 'workplace'\)/);
assert.match(listing, /workplaceOverview, workplaceRoles, workplaceProcess/);
assert.match(listing, /document\.body\.classList\.add\('workplace-detail-mode'\)/);
assert.match(listing, /backLabel: '← 일터 이야기 목록으로'/);
for (const [imagePath, alt] of [
  ['assets/images/workplace/minhwa-work-process.webp', '태장 작업자가 민화 문양을 채색하는 모습'],
  ['assets/images/workplace/main-workspace.webp', '태장 본점의 실무 작업 공간과 작업 테이블'],
  ['assets/images/workplace/packing-inspection.webp', '태장 작업자가 택배 상자를 포장하고 검수하는 모습']
]) {
  assert.equal(fs.existsSync(path.join(root, imagePath)), true);
  const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(workplaceContent, new RegExp(`thumbnail: "${escapedPath}"`));
  assert.match(workplaceContent, new RegExp(`thumbnailAlt: "${alt}"`));
}
assert.match(workplaceContent, /thumbnailObjectPosition: "50% 72%"/);
assert.match(workplaceContent, /thumbnailDetail: "natural"/);
assert.match(listing, /article-representative-media--\$\{detailRepresentative\.detailMode\}/);
assert.match(styles, /\.article-body \.article-representative-media--natural\s*\{[\s\S]*aspect-ratio:auto/);
assert.match(styles, /\.article-body \.article-representative-media--natural img\s*\{[\s\S]*height:auto/);

console.log('content-detail-thumbnail tests: all cases passed');
