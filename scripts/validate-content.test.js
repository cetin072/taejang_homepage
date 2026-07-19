#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadContentFromFile,
  validateContent,
  validateContentSource,
  validateIndexPreviews
} = require('./validate-content');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTENT_FILE = path.join(ROOT_DIR, 'assets/js/content.js');
const INDEX_FILE = path.join(ROOT_DIR, 'index.html');
const NOW = new Date('2026-07-19T00:00:00Z');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorsFor(content) {
  return validateContent(content, { now: NOW }).errors;
}

const { content, source } = loadContentFromFile(CONTENT_FILE);
const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');

assert.deepStrictEqual(errorsFor(clone(content)), []);
assert.ok(validateContent(clone(content), { now: NOW }).warnings.some(message => message.includes('미래 날짜 2026.08.12')));

const duplicateId = clone(content);
duplicateId.workplace[1].id = 'minhwa-one-stroke';
assert.ok(errorsFor(duplicateId).some(message => message.includes('중복된 id')));

const invalidDate = clone(content);
invalidDate.activities[1].date = '2026.13.02';
assert.ok(errorsFor(invalidDate).some(message => message.includes('실제 YYYY.MM.DD 날짜')));

const invalidCategory = clone(content);
invalidCategory.workplace[0].category = '민화';
assert.ok(errorsFor(invalidCategory).some(message => message.includes('허용 카테고리')));

const legacyFilename = clone(content);
legacyFilename.workplace[0].listingPhoto.filename = 'taejang-minhwa-work-01.jpg';
assert.ok(errorsFor(legacyFilename).some(message => message.includes('승인된 촬영 예정 파일명')));

const plannedPhotoOnly = clone(content);
plannedPhotoOnly.workplace[0].listingPhoto.filename = 'packing-2.jpg';
plannedPhotoOnly.workplace[0].photo.filename = 'packing-2.jpg';
assert.deepStrictEqual(errorsFor(plannedPhotoOnly), []);

const approvedPackingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taejang-content-'));
try {
  fs.mkdirSync(path.join(approvedPackingRoot, 'images'));
  fs.writeFileSync(path.join(approvedPackingRoot, 'images/packing-2.jpg'), 'approved replacement photo');
  const approvedPackingImage = clone(content);
  approvedPackingImage.workplace[0].thumb = 'images/packing-2.jpg';
  approvedPackingImage.workplace[0].alt = { thumb: '승인된 포장 작업 장면' };
  assert.deepStrictEqual(validateContent(approvedPackingImage, { now: NOW, rootDir: approvedPackingRoot }).errors, []);
} finally {
  fs.rmSync(approvedPackingRoot, { recursive: true, force: true });
}

const missingImage = clone(content);
missingImage.workplace[0].thumb = 'images/not-found.jpg';
missingImage.workplace[0].alt = { thumb: '존재하지 않는 테스트 이미지' };
assert.ok(errorsFor(missingImage).some(message => message.includes('실제 파일을 가리키지 않습니다')));

const missingRequiredId = clone(content);
missingRequiredId.workplace = missingRequiredId.workplace.slice(1);
assert.ok(errorsFor(missingRequiredId).some(message => message.includes('기존 공개 ID minhwa-one-stroke')));

assert.deepStrictEqual(validateContentSource(source).errors, []);
assert.deepStrictEqual(validateIndexPreviews(indexSource, content).errors, []);

console.log('validate-content tests: all cases passed');
