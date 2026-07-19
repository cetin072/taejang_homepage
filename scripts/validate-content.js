#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTENT_FILE = path.join(ROOT_DIR, 'assets/js/content.js');
const INDEX_FILE = path.join(ROOT_DIR, 'index.html');

const REQUIRED_IDS = {
  workplace: ['minhwa-one-stroke', 'packing-care', 'work-together'],
  activities: ['new-workplace-opening', 'minhwa-class', 'packing-start']
};

const ALLOWED_CATEGORIES = {
  workplace: ['민화·문화 굿즈', '포장·검수', '일터 운영'],
  activities: ['공지', '일터 소식', '기업·지역 협력', '행사']
};

const PLANNED_PHOTO_FILENAMES = [
  'office-1.jpg',
  'office-2.jpg',
  'minhwa-1.jpg',
  'minhwa-2.jpg',
  'packing-1.jpg',
  'packing-2.jpg',
  'packing-3.jpg',
  'partner-1.jpg',
  'activity-1.jpg'
];

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
const LEGACY_UNSUITABLE_PACKING_2_SHA256 = '3f56e0285804ec587f0fa5adb7541dcc06927906cb2608b7263a9a2c02781523';

function createResult() {
  return { errors: [], warnings: [], passes: [] };
}

function addError(result, message) {
  result.errors.push(message);
}

function addWarning(result, message) {
  result.warnings.push(message);
}

function addPass(result, message) {
  result.passes.push(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value) {
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('.').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateAtUtcStart(value) {
  const [year, month, day] = value.split('.').map(Number);
  return Date.UTC(year, month - 1, day);
}

function containsHtml(value) {
  return /<\/?[a-z][^>]*>/i.test(value);
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadContentFromFile(filePath = CONTENT_FILE) {
  const source = fs.readFileSync(filePath, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: filePath });
  return { content: context.window.TAEJANG_CONTENT, source };
}

function validateTextField(result, item, type, field) {
  if (!isNonEmptyString(item[field])) {
    addError(result, `${type}/${item.id || 'unknown'}: ${field} 값이 비어 있습니다.`);
  }
}

function validateSections(result, item, type) {
  const label = `${type}/${item.id || 'unknown'}`;
  if (Array.isArray(item.sections) && item.sections.length) {
    item.sections.forEach((section, index) => {
      if (!section || typeof section !== 'object') {
        addError(result, `${label}: sections[${index}]가 객체가 아닙니다.`);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(section, 'heading') && !isNonEmptyString(section.heading)) {
        addError(result, `${label}: sections[${index}].heading이 빈 중간 제목입니다.`);
      }
      if (!Array.isArray(section.paragraphs) || !section.paragraphs.some(isNonEmptyString)) {
        addError(result, `${label}: sections[${index}]에 본문 문단이 없습니다.`);
      }
      (section.paragraphs || []).forEach((paragraph, paragraphIndex) => {
        if (isNonEmptyString(paragraph) && containsHtml(paragraph)) {
          addWarning(result, `${label}: sections[${index}].paragraphs[${paragraphIndex}]에 HTML 문자열이 있습니다.`);
        }
      });
    });
    return;
  }

  if (Array.isArray(item.body) && item.body.length && item.body.some(entry => {
    if (isNonEmptyString(entry)) return true;
    return entry && Array.isArray(entry.paragraphs) && entry.paragraphs.some(isNonEmptyString);
  })) {
    item.body.forEach((entry, index) => {
      if (isNonEmptyString(entry) && containsHtml(entry)) {
        addWarning(result, `${label}: body[${index}]에 HTML 문자열이 있습니다.`);
      }
    });
    return;
  }

  addError(result, `${label}: body 또는 sections에 표시할 본문이 없습니다.`);
}

function validatePhotoGuide(result, item, type, rootDir = ROOT_DIR) {
  const label = `${type}/${item.id || 'unknown'}`;
  const guides = [
    ['listingPhoto', item.listingPhoto],
    ['photo', item.photo]
  ].filter(([, value]) => value !== undefined && value !== null);

  const imageFields = [
    ['thumb', item.thumb],
    ['hero', item.hero],
    ['gallery', item.gallery]
  ];
  const actualImages = [];

  imageFields.forEach(([field, value]) => {
    if (field === 'gallery') {
      if (value !== undefined && !Array.isArray(value)) {
        addError(result, `${label}: gallery는 배열이어야 합니다.`);
        return;
      }
      (value || []).forEach((imagePath, index) => actualImages.push({ field: `gallery[${index}]`, imagePath }));
      return;
    }
    if (value !== undefined && value !== null && value !== '') actualImages.push({ field, imagePath: value });
  });

  if (actualImages.length) {
    actualImages.forEach(({ field, imagePath }) => {
      if (!isNonEmptyString(imagePath)) {
        addError(result, `${label}: ${field} 이미지 경로가 올바른 문자열이 아닙니다.`);
        return;
      }
      const normalizedPath = imagePath.replace(/\\/g, '/');
      const localPath = path.resolve(rootDir, normalizedPath);
      if (!localPath.startsWith(rootDir + path.sep) || !fs.existsSync(localPath)) {
        addError(result, `${label}: ${field} 이미지 경로 ${imagePath}가 실제 파일을 가리키지 않습니다.`);
      } else if (normalizedPath === 'images/packing-2.jpg' && fileSha256(localPath) === LEGACY_UNSUITABLE_PACKING_2_SHA256) {
        addError(result, `${label}: ${field}에 과거 공개 부적합 images/packing-2.jpg 파일을 연결할 수 없습니다.`);
      }
    });

    const alt = item.alt || {};
    if (actualImages.some(image => image.field === 'thumb') && !isNonEmptyString(alt.thumb)) {
      addError(result, `${label}: thumb 이미지에는 alt.thumb 설명이 필요합니다.`);
    }
    if (actualImages.some(image => image.field === 'hero') && !isNonEmptyString(alt.hero)) {
      addError(result, `${label}: hero 이미지에는 alt.hero 설명이 필요합니다.`);
    }
    if (actualImages.some(image => image.field.startsWith('gallery['))) {
      const galleryAlts = Array.isArray(alt.gallery) ? alt.gallery : [];
      actualImages.filter(image => image.field.startsWith('gallery[')).forEach(image => {
        const index = Number(image.field.match(/\d+/)[0]);
        if (!isNonEmptyString(galleryAlts[index])) {
          addError(result, `${label}: ${image.field} 이미지에는 alt.gallery[${index}] 설명이 필요합니다.`);
        }
      });
    }
    return;
  }

  if (!guides.length) {
    addError(result, `${label}: 실제 이미지가 없으면 photo 또는 listingPhoto 안내 데이터가 필요합니다.`);
    return;
  }

  guides.forEach(([field, guide]) => {
    if (!guide || typeof guide !== 'object') {
      addError(result, `${label}: ${field} 안내 데이터가 객체가 아닙니다.`);
      return;
    }
    ['title', 'filename', 'orientation'].forEach(property => {
      if (!isNonEmptyString(guide[property])) addError(result, `${label}: ${field}.${property} 값이 필요합니다.`);
    });
    if (isNonEmptyString(guide.filename) && !PLANNED_PHOTO_FILENAMES.includes(guide.filename)) {
      addError(result, `${label}: ${field}.filename 값 ${guide.filename}은 승인된 촬영 예정 파일명이 아닙니다.`);
    }
  });
}

function validateContent(content, options = {}) {
  const result = createResult();
  const rootDir = options.rootDir || ROOT_DIR;
  const now = options.now || new Date();
  const allIds = new Map();

  ['workplace', 'activities'].forEach(type => {
    const items = content?.[type];
    const typeStartErrors = result.errors.length;
    if (!Array.isArray(items)) {
      addError(result, `${type} 데이터가 배열이 아닙니다.`);
      return;
    }

    const seenIds = new Set();
    items.forEach((item, index) => {
      const label = `${type}/${item?.id || `index-${index}`}`;
      if (!item || typeof item !== 'object') {
        addError(result, `${type}[${index}]가 콘텐츠 객체가 아닙니다.`);
        return;
      }
      if (!isNonEmptyString(item.id)) {
        addError(result, `${label}: id 값이 필요합니다.`);
      } else {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
          addError(result, `${label}: id ${item.id}는 영문 소문자·숫자·하이픈만 사용할 수 있습니다.`);
        }
        if (seenIds.has(item.id)) addError(result, `${label}: 같은 ${type} 안에 중복된 id ${item.id}가 있습니다.`);
        seenIds.add(item.id);
        if (allIds.has(item.id) && allIds.get(item.id) !== type) {
          addWarning(result, `${label}: ${allIds.get(item.id)}와 id ${item.id}가 중복됩니다.`);
        }
        allIds.set(item.id, type);
      }

      validateTextField(result, item, type, 'category');
      validateTextField(result, item, type, 'title');
      validateTextField(result, item, type, 'summary');
      if (!ALLOWED_CATEGORIES[type].includes(item.category)) {
        addError(result, `${label}: category 값 ${item.category || '(빈 값)'}은 허용 카테고리가 아닙니다. 허용값: ${ALLOWED_CATEGORIES[type].join(', ')}`);
      }

      if (!isNonEmptyString(item.date) || !isValidDate(item.date)) {
        addError(result, `${label}: date 값 ${item.date || '(빈 값)'}은 실제 YYYY.MM.DD 날짜여야 합니다.`);
      } else if (dateAtUtcStart(item.date) > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
        addWarning(result, `${label}: 미래 날짜 ${item.date}입니다. 예정 문구와 공개 시제를 확인하세요.`);
      }

      if (isNonEmptyString(item.title) && isNonEmptyString(item.summary) && item.title.trim() === item.summary.trim()) {
        addWarning(result, `${label}: title과 summary가 동일합니다.`);
      }
      validateSections(result, item, type);
      validatePhotoGuide(result, item, type, rootDir);
    });

    REQUIRED_IDS[type].forEach(id => {
      if (!seenIds.has(id)) addError(result, `${type}: 기존 공개 ID ${id}가 없습니다.`);
    });
    if (result.errors.length === typeStartErrors) addPass(result, `${type} 콘텐츠 ${items.length}건`);
  });

  if (!result.errors.some(message => message.includes('기존 공개 ID'))) addPass(result, '기존 공개 ID 유지');
  if (!result.errors.some(message => message.includes('date 값'))) addPass(result, '날짜 형식');
  if (!result.errors.some(message => message.includes('category 값'))) addPass(result, '카테고리');
  if (!result.errors.some(message => message.includes('filename'))) addPass(result, '사진 안내 파일명');
  return result;
}

function validateContentSource(source) {
  const result = createResult();
  LEGACY_PHOTO_FILENAMES.forEach(filename => {
    if (source.includes(filename)) addError(result, `assets/js/content.js: 긴 과거 사진 파일명 ${filename}이 다시 사용되었습니다.`);
  });
  if (!result.errors.length) addPass(result, '긴 과거 사진 파일명 없음');
  return result;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function validateIndexPreviews(indexSource, content) {
  const result = createResult();
  const dynamicContainers = [...indexSource.matchAll(/data-home-preview=["'](workplace|activities)["'][^>]*data-home-preview-count=["'](\d+)["']/g)];
  const dynamicTypes = new Set();
  dynamicContainers.forEach(([, type, count]) => {
    dynamicTypes.add(type);
    if (Number(count) < 1) addError(result, `index.html: ${type} 메인 미리보기 수가 올바르지 않습니다.`);
    if (!Array.isArray(content?.[type]) || !content[type].length) {
      addError(result, `index.html: ${type} 메인 미리보기에 사용할 콘텐츠가 없습니다.`);
    }
  });
  ['workplace', 'activities'].forEach(type => {
    const count = dynamicContainers.filter(([, containerType]) => containerType === type).length;
    if (count > 1) addError(result, `index.html: ${type} 메인 미리보기 컨테이너가 중복됩니다.`);
  });

  const links = [...indexSource.matchAll(/<a\b[^>]*href="(workplace|activities)\.html\?id=([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  links.forEach(([, type, id, body]) => {
    const items = content?.[type] || [];
    const item = items.find(entry => entry.id === id);
    if (!item) {
      addError(result, `index.html: ${type}.html?id=${id} 링크가 ${type} 데이터에 없습니다.`);
      return;
    }
    const heading = body.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    if (heading && stripTags(heading[1]) !== item.title) {
      addWarning(result, `index.html: ${type}.html?id=${id} 카드 제목이 콘텐츠 제목과 다릅니다.`);
    }
  });
  if (!result.errors.length) {
    addPass(result, dynamicTypes.size ? '메인 미리보기 데이터 컨테이너' : '메인 미리보기 링크');
  }
  return result;
}

function mergeResults(...results) {
  return results.reduce((merged, result) => ({
    errors: merged.errors.concat(result.errors),
    warnings: merged.warnings.concat(result.warnings),
    passes: merged.passes.concat(result.passes)
  }), createResult());
}

function printResult(result) {
  result.passes.forEach(message => console.log(`[PASS] ${message}`));
  result.warnings.forEach(message => console.log(`[WARNING] ${message}`));
  result.errors.forEach(message => console.error(`[ERROR] ${message}`));
  console.log(`\n결과: PASS ${result.passes.length} · WARNING ${result.warnings.length} · ERROR ${result.errors.length}`);
}

function run() {
  const { content, source } = loadContentFromFile();
  const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');
  const result = mergeResults(
    validateContent(content),
    validateContentSource(source),
    validateIndexPreviews(indexSource, content)
  );
  printResult(result);
  if (result.errors.length) process.exitCode = 1;
}

if (require.main === module) run();

module.exports = {
  ALLOWED_CATEGORIES,
  LEGACY_PHOTO_FILENAMES,
  LEGACY_UNSUITABLE_PACKING_2_SHA256,
  PLANNED_PHOTO_FILENAMES,
  REQUIRED_IDS,
  isValidDate,
  loadContentFromFile,
  mergeResults,
  validateContent,
  validateContentSource,
  validateIndexPreviews
};
