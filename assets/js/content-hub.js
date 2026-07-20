(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const baseItems = Array.isArray(content?.hub) ? content.hub : [];
  const sampleXItem = {
    id: 'external-x-field-note',
    type: 'external',
    source: 'x',
    category: '회사소식',
    title: '태장 현장의 짧은 소식',
    summary: '태장의 현장 소식과 간단한 안내를 X 원문에서 확인합니다.',
    thumbnail: 'images/coaching.jpg',