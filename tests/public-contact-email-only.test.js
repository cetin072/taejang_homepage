#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => readFileSync(path.join(root, name), 'utf8');

// Do not publish a telephone contact link or phone number in a public page.
// This deliberately does not remove disclosure about employee phone data processed by the app.
const publicTelephone = /tel:|["']telephone["']\s*:|0(?:1[016789]|2|[3-6]\d|70)[\s.-]?\d{3,4}[\s.-]?\d{4}/i;
const pages = readdirSync(root).filter(name => name.endsWith('.html'));

test('all root public HTML pages are free of published phone numbers and telephone actions', () => {
  assert.ok(pages.length >= 20, 'every public root HTML file should be checked');
  for (const name of pages) {
    const html = read(name);
    assert.doesNotMatch(html, publicTelephone, name + ': no published phone number, tel: link or telephone schema');
  }
});

test('homepage and partnership direct contact choices are email-only', () => {
  const home = read('index.html');
  const partner = read('partnership.html');
  for (const [name, html] of [['index.html', home], ['partnership.html', partner]]) {
    assert.match(html, /<a class="contact-action" href="mailto:taejang2025@naver\.com\?subject=/,
      name + ': official email action stays clickable');
    assert.doesNotMatch(html, /type="tel"|name="phone"|전화 문의/,
      name + ': inquiry form and action cards should not collect or promote phone numbers');
    assert.match(html, /name="email"[^>]*required/,
      name + ': inquiry form still requires email for a reply');
    for (const field of ['inquiry-type', 'name', 'message', 'privacy-consent']) {
      assert.match(html, new RegExp('name="' + field + '"'),
        name + ': existing form field is retained: ' + field);
    }
    assert.match(html, /href="location\.html"/, name + ': visit/directions link remains');
  }
  assert.match(home, /"@type":"Organization"[\s\S]*"email":"taejang2025@naver\.com"/,
    'structured organization details preserve email');
  assert.doesNotMatch(home, /"telephone":/, 'phone is no longer disclosed to search engines');
});

test('public privacy, account deletion, and visitor guidance remain reachable by email', () => {
  for (const page of [
    'privacy.html', 'employee-app-privacy.html', 'account-deletion.html',
    'terms.html', 'thanks.html', 'location.html'
  ]) {
    assert.match(read(page), /href="mailto:taejang2025@naver\.com/,
      page + ': email contact remains available');
  }
  const location = read('location.html');
  assert.match(location, /경남 창원시 의창구 평산로 33/);
  assert.match(location, /네이버지도에서 위치 보기/);
  assert.doesNotMatch(location, /<dt>전화<\/dt>/);

  const privacy = read('privacy.html');
  assert.match(privacy, /시행일: 2026년 10월 20일/);
  assert.match(privacy, /회사·기관명은 선택 항목입니다/);
  assert.match(privacy, /홈페이지 문의폼과 이메일을 통해 수집합니다/);
  assert.doesNotMatch(privacy, /전화 또는 이메일|전화, 이메일|회사·기관명과 연락처는 선택 항목/);

  const appPrivacy = read('employee-app-privacy.html');
  assert.match(appPrivacy, /전화번호, 입사일/, 'description of actual employee data processing must not be erased');
  assert.match(read('thanks.html'), /입력하신 이메일로 회신드리겠습니다/);
});
