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

assert.match(listing, /const hubItems = Array\.isArray\(window\.TAEJANG_CONTENT\?\.hub\)/);
assert.match(listing, /candidate\.detailUrl === `\$\{config\.page\}\?id=\$\{item\.id\}`/);
assert.match(listing, /const source = hubItem\?\.thumbnail \|\| item\.thumbnail \|\| item\.hero \|\| item\.thumb/);
assert.match(listing, /const alt = hubItem\?\.thumbnailAlt \|\| item\.thumbnailAlt \|\| item\.alt\?\.hero \|\| item\.alt\?\.thumb/);
assert.match(listing, /cardMedia\(item\)/);
assert.match(listing, /detailRepresentative = representativeMedia\(item\)/);
assert.match(listing, /class="article-representative-media"/);
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

console.log('content-detail-thumbnail tests: all cases passed');
