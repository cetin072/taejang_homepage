#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const script = read('assets/js/hero-video.js');
const styles = read('assets/css/engagement-polish.css');

assert.match(index, /data-hero-video-slider/, 'Hero 영상 영역은 전용 수동 슬라이더입니다');
assert.equal((index.match(/\bdata-hero-video-slide(?:\s|=|>)/g) || []).length, 3, 'Hero에는 기사 사진과 기존 영상 두 개가 있습니다');
assert.ok(index.indexOf('class="hero-video hero-article"') < index.indexOf('data-youtube-video="FbEOcteBSJ4"'), '첨부 기사 사진을 첫 번째로 표시합니다');
assert.ok(index.indexOf('data-youtube-video="FbEOcteBSJ4"') < index.indexOf('data-youtube-video="8x7yg5YBK9g"'), '기존 영상 순서를 유지합니다');
assert.match(index, /민·관이 함께 만든 장애인 동행 일자리 1호점 태장\(주\)/);
assert.match(index, /출처: 경남공감/);
assert.match(index, /class="hero-article-image"[^>]*src="assets\/images\/home\/gonggam-taejang-team\.webp"[^>]*width="2048" height="1035"/);
const articleLink = index.match(/<a class="hero-article-link"[\s\S]*?<\/a>/)?.[0];
assert.ok(articleLink, '사진과 캡션을 하나의 링크로 묶습니다');
assert.equal((articleLink.match(/<a\b/g) || []).length, 1);
assert.match(articleLink, /ggSeq=41900/);
assert.match(articleLink, /rel="noopener noreferrer"/);
assert.match(articleLink, /새 탭에서 열림/);
assert.match(styles, /\.hero-article-image\s*\{[^}]*height: auto/);
assert.match(styles, /\.hero-article-link:focus-visible/);
assert.match(index, /data-youtube-video="FbEOcteBSJ4"/, '첫 번째 기존 영상을 유지합니다');
assert.match(index, /data-youtube-video="8x7yg5YBK9g"/, '두 번째 공식 영상을 추가합니다');
assert.match(index, /경상남도지사 개소식 축하영상/, '두 번째 영상의 제목과 접근성 안내를 일치시킵니다');
assert.match(index, /aria-label="경상남도지사 개소식 축하영상 재생"/, '두 번째 영상의 재생 버튼을 명확히 안내합니다');
assert.match(index, /data-hero-video-previous[^>]*aria-label="이전 슬라이드 보기"/, '이전 버튼은 접근 가능한 이름을 가집니다');
assert.match(index, /data-hero-video-next[^>]*aria-label="다음 슬라이드 보기"/, '다음 버튼은 접근 가능한 이름을 가집니다');
assert.equal((index.match(/data-hero-video-indicator=/g) || []).length, 3, '페이지 인디케이터가 세 개입니다');
assert.match(script, /youtube-nocookie\.com\/embed/, 'YouTube nocookie iframe을 사용합니다');
assert.match(script, /function restorePoster/, '비활성 영상은 poster 상태로 초기화합니다');
assert.match(script, /if \(!isActive\) restorePoster\(slide\)/, '슬라이드 전환 시 숨겨진 iframe 재생을 중지합니다');
assert.match(script, /touchstart[\s\S]*?touchend/, '모바일 스와이프를 처리합니다');
assert.match(script, /ArrowLeft[\s\S]*?ArrowRight/, '키보드 방향키 조작을 지원합니다');
assert.doesNotMatch(script, /setInterval|setTimeout/, '자동 전환 타이머를 사용하지 않습니다');
assert.match(styles, /\.hero-video-slider\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/, '영상 컨테이너는 16:9 비율을 유지합니다');
assert.match(styles, /\.hero-video-slider\s*\{[\s\S]*?touch-action:\s*pan-y/, '세로 스크롤과 가로 스와이프를 구분합니다');
assert.match(styles, /prefers-reduced-motion/, '감소된 모션 환경을 고려합니다');
