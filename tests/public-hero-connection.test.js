#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const preconnect = index.indexOf('<link rel="preconnect" href="https://i.ytimg.com" crossorigin>');
const hero = index.indexOf('https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');

assert.ok(preconnect >= 0, 'LCP 후보 YouTube poster origin은 head에서 미리 연결합니다');
assert.ok(hero >= 0 && preconnect < hero, 'poster 요청 전에 연결 힌트가 파싱되어야 합니다');
assert.match(index, /<link rel="dns-prefetch" href="https:\/\/i\.ytimg\.com">/);

console.log('public-hero-connection tests: YouTube poster connection hint passed');
