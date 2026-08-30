#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pages = {
  'index.html': read('index.html'),
  'about.html': read('about.html'),
  'greeting.html': read('greeting.html'),
  'why-minhwa.html': read('why-minhwa.html'),
  'workplace.html': read('workplace.html'),
  'activities.html': read('activities.html'),
  'archive.html': read('archive.html'),
  'partnership.html': read('partnership.html')
};
const issue46Pages = {
  'business.html': read('business.html'),
  'location.html': read('location.html')
};
const resources = read('resources.html');
const privacy = read('privacy.html');
const terms = read('terms.html');
const thanks = read('thanks.html');
const notFound = read('404.html');
const staff = read('staff/index.html');
const contentData = read('assets/js/content.js');
const externalContent = read('assets/js/external-content.js');
const site = read('assets/js/site.js');
const previews = read('assets/js/home-previews.js');
const heroVideo = read('assets/js/hero-video.js');
const contentHub = read('assets/js/content-hub.js');
const photoSlots = read('assets/js/photo-slots.js');
const styles = read('assets/css/styles.css');
const polish = read('assets/css/site-polish.css');
const photoMode = read('assets/css/photo-mode.css');
const engagement = read('assets/css/engagement-polish.css');
const partnershipCompact = read('assets/css/partnership-compact.css');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const photoFolderGuide = read('images/homepage/README.md');

const canonicalUrls = {
  'index.html': 'https://taejang.co.kr/',
  'about.html': 'https://taejang.co.kr/about.html',
  'greeting.html': 'https://taejang.co.kr/greeting.html',
  'why-minhwa.html': 'https://taejang.co.kr/why-minhwa.html',
  'workplace.html': 'https://taejang.co.kr/workplace.html',
  'activities.html': 'https://taejang.co.kr/activities.html',
  'archive.html': 'https://taejang.co.kr/archive.html',
  'partnership.html': 'https://taejang.co.kr/partnership.html',
  'business.html': 'https://taejang.co.kr/business.html',
  'location.html': 'https://taejang.co.kr/location.html'
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function duplicateIds(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function assertSafeBlankTargets(filename, html) {
  for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || []) {
    assert.match(tag, /rel="[^"]*noopener[^"]*"/, `${filename} 새 탭 링크는 noopener를 사용합니다`);
  }
}

for (const [filename, html] of Object.entries(pages)) {
  assert.match(html, /<meta name="description" content="[^"]+">/, `${filename} 검색 설명을 제공합니다`);
  assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRegExp(canonicalUrls[filename])}">`), `${filename} canonical 주소를 제공합니다`);
  assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRegExp(canonicalUrls[filename])}">`), `${filename} Open Graph URL은 공식 canonical 주소를 사용합니다`);
  assert.doesNotMatch(html, /taejang-homepage\.netlify\.app/, `${filename} 공개 SEO 메타에 Netlify 기본 주소를 남기지 않습니다`);
  for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) {
    assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`), `${filename} ${property} 정보를 제공합니다`);
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    assert.match(html, new RegExp(`<meta name="${name}" content="[^"]+">`), `${filename} ${name} 정보를 제공합니다`);
  }
  assert.equal((html.match(/<main\b/g) || []).length, 1, `${filename} main 영역은 하나입니다`);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${filename} 최상위 제목은 하나입니다`);
  assert.deepEqual(duplicateIds(html), [], `${filename}에 중복 id가 없어야 합니다`);
  assert.match(html, /taejang2025@naver\.com/, `${filename} 공개 연락처는 새 이메일을 사용합니다`);
  assert.doesNotMatch(html, /info@taejang\.co\.kr/, `${filename} 공개 화면에 이전 이메일을 남기지 않습니다`);
  assert.doesNotMatch(html, /콘텐츠 소식|사업과 역량/, `${filename} 원본에 이전 메뉴명을 남기지 않습니다`);
  assert.doesNotMatch(html, /href="staff\//, `${filename} 원본에서 임직원 진입을 숨깁니다`);
  assert.doesNotMatch(html, /class="staff-nav"/, `${filename} 원본에서 임직원 메뉴 클래스를 숨깁니다`);
  assert.doesNotMatch(html, /href="resources\.html"/, `${filename} 공개 메뉴에서 자료실 링크를 숨깁니다`);
  assert.match(html, /태장 소개/, `${filename} 공개 메뉴는 태장 소개를 제공합니다`);
  assert.match(html, /하는 일/, `${filename} 공개 메뉴는 하는 일 명칭을 사용합니다`);
  assert.match(html, /소식·기록/, `${filename} 공개 메뉴는 소식·기록 명칭을 사용합니다`);
  assert.match(html, /협력·문의/, `${filename} 공개 메뉴는 협력·문의 단일 진입점을 사용합니다`);
  assertSafeBlankTargets(filename, html);
}

for (const [filename, html] of Object.entries(issue46Pages)) {
  assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRegExp(canonicalUrls[filename])}">`), `${filename} canonical 주소를 제공합니다`);
  assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRegExp(canonicalUrls[filename])}">`), `${filename} Open Graph URL은 공식 canonical 주소를 사용합니다`);
  for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) {
    assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`), `${filename} ${property} 정보를 제공합니다`);
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    assert.match(html, new RegExp(`<meta name="${name}" content="[^"]+">`), `${filename} ${name} 정보를 제공합니다`);
  }
}

const breadcrumbNames = {
  'about.html': '태장 소개',
  'business.html': '하는 일',
  'greeting.html': '대표 인사말',
  'why-minhwa.html': '왜 민화인가',
  'workplace.html': '우리의 일터',
  'activities.html': '활동 기록',
  'archive.html': '소식·기록',
  'partnership.html': '협력·문의',
  'location.html': '오시는 길'
};
for (const [filename, name] of Object.entries(breadcrumbNames)) {
  const breadcrumb = issue46Pages[filename] || pages[filename];
  assert.match(breadcrumb, /<script type="application\/ld\+json">/, `${filename}은 정적 Breadcrumb JSON-LD를 제공합니다`);
  assert.match(breadcrumb, new RegExp(`"@type":"BreadcrumbList"[\\s\\S]*?"name":"${escapeRegExp(name)}"[\\s\\S]*?"item":"${escapeRegExp(canonicalUrls[filename])}"`), `${filename} Breadcrumb은 실제 canonical URL을 사용합니다`);
}
assert.doesNotMatch(site, /breadcrumbNames|data-breadcrumb-jsonld/, 'Breadcrumb JSON-LD를 런타임으로 주입하지 않습니다');

assert.equal(robots.replace(/\r\n?/g, '\n').trim(), 'User-agent: *\nAllow: /\nSitemap: https://taejang.co.kr/sitemap.xml', 'robots.txt는 기존 크롤링 정책과 공식 sitemap 주소를 유지합니다');
assert.doesNotMatch(sitemap, /taejang-homepage\.netlify\.app/, '공개 sitemap에 Netlify 기본 주소를 남기지 않습니다');
for (const url of Object.values(canonicalUrls)) assert.match(sitemap, new RegExp(`<loc>${escapeRegExp(url)}</loc>`), `sitemap은 ${url}을 포함합니다`);

assert.match(photoSlots, /const PHOTO_REVIEW_MODE = false;/, '공개 모드에서는 PHOTO 검수 번호를 표시하지 않습니다');
assert.match(pages['greeting.html'], /<img src="images\/homepage\/photo-08\.webp" alt="농업회사법인 태장 주식회사 대표이사 이영희"/, '대표 인사말에는 승인된 대표 사진을 사용합니다');
assert.doesNotMatch(pages['greeting.html'], /대표이사 공식 사진이 들어갈 자리|대표 사진은 공식 상반신 또는 업무 공간 사진으로 교체합니다\./, '대표 인사말의 제작용 사진 안내를 공개하지 않습니다');
assert.match(contentData, /id: "new-workplace-opening"[\s\S]*?title: "태장의 새로운 사업장이 문을 열었습니다"[\s\S]*?신규 사업장을 열었습니다\./, '개소식 게시물은 완료된 사실을 과거형으로 안내합니다');
assert.match(contentData, /id: "new-workplace-opening"[\s\S]*?heading: "새로운 일터를 마련했습니다"/, '개소 준비 완료 시제를 일관되게 안내합니다');
assert.match(pages['partnership.html'], /<h3>기업 협력·고용 연계<\/h3><p>기업·기관과 실제 업무와 협력 방식을 함께 검토합니다\.<\/p>/, '협력 카드는 협력 분야 입구로 간결하게 안내합니다');
assert.doesNotMatch(pages['partnership.html'], /<h2>모회사·예비 모회사<\/h2>/, '협력 카드에서 신규 모회사 모집 표현을 사용하지 않습니다');

const index = pages['index.html'];
const about = pages['about.html'];
const greeting = pages['greeting.html'];
const minhwa = pages['why-minhwa.html'];
const workplace = pages['workplace.html'];
const archive = pages['archive.html'];
const partnership = pages['partnership.html'];
const business = issue46Pages['business.html'];
const location = issue46Pages['location.html'];

assert.equal((index.match(/<section\b/g) || []).length, 7, '메인은 기존 7개 흐름을 유지합니다');
assert.doesNotMatch(index, /태장 공식 채널|channel-strip|channel-links/, '메인 본문에는 공식 채널 별도 블록을 두지 않습니다');
for (const id of ['about', 'business', 'contact']) assert.match(index, new RegExp(`<section[^>]*id="${id}"`));
assert.match(index, /함께 일하며,<br>지속 가능한 가치를 만듭니다/);
assert.match(index, /태장은 장애인과 함께 실제 일을 만들고, 그 일을 지속 가능한 사업으로 이어가는 농업회사법인이자 자회사형 장애인 표준사업장입니다\./);
assert.match(index, /태장은 사람에게 맞는 직무를 만들고, 민화·문화 굿즈와 기업 업무, 지역사회 활동으로 이어지는 사업을 운영합니다\./);
assert.match(index, /class="about-principle-strip"[\s\S]*사람에게 맞는 직무[\s\S]*오래 이어지는 일[\s\S]*기업·지역사회와 협력/);
assert.match(index, /<a class="btn hero-primary" href="about\.html"/, 'Hero의 회사 소개 CTA는 상세 소개 페이지로 연결합니다');
assert.match(index, /<a class="btn hero-secondary" href="partnership\.html"/, 'Hero의 협력 CTA는 협력 상세 페이지로 연결합니다');
assert.match(index, /CURRENT OPERATIONS[\s\S]*현재 운영[\s\S]*민화·문화 굿즈[\s\S]*지역사회공헌·ESG 협력[\s\S]*기업 업무 협력/);
assert.match(index, /BUSINESS IN DEVELOPMENT[\s\S]*개발 중인 사업[\s\S]*제품 개발 진행 중[\s\S]*테라리움 제조사업[\s\S]*표준 DIY 키트를 개발/);
assert.match(index, /assets\/images\/terrarium\/terrarium-display\.webp/);
assert.match(business, /class="business-workflow"[\s\S]*협력은 이렇게 함께 정리합니다[\s\S]*필요 확인[\s\S]*범위 협의[\s\S]*방식 설계[\s\S]*운영 확인/);
assert.match(business, /기업·기관이 함께 만들 수 있는 현재 사업과 협력 가능 업무를 소개합니다\./);
assert.match(workplace, /직무를 나누고, 순서와 작업환경을 이해하기 쉽게 운영합니다\./);
assert.match(workplace, /직무를 이해하고<br>함께 익히는 방식/);
assert.match(business, /assets\/css\/visual-hierarchy\.css/);
assert.match(location, /class="location-visit-card"[\s\S]*태장 방문 안내[\s\S]*경남 창원시 의창구 평산로 33[\s\S]*신화 더 플렉스시티 422·423호[\s\S]*055-293-8626[\s\S]*taejang2025@naver\.com[\s\S]*네이버지도에서 위치 보기/);
assert.match(location, /location-pin-icon/);
assert.doesNotMatch(location, /<iframe|map\.kakao\.com|map\.naver\.com\/v5\/api/);
assert.match(partnership, /contact-action--location[\s\S]*경남 창원시 의창구 평산로 33[\s\S]*신화 더 플렉스시티 422·423호[\s\S]*오시는 길 보기 →/);
assert.doesNotMatch(partnership, /contact-location-map|<svg/);
assert.match(partnership, /class="inquiry-scope"[\s\S]*어떤 문의든 편하게 남겨주세요[\s\S]*기업 업무 협력[\s\S]*지역사회공헌·ESG[\s\S]*민화·문화 활동[\s\S]*방문·기타 문의/);
assert.doesNotMatch(partnership, /subsidiary-standard-|자회사형 장애인 표준사업장이란|고용률 산정 반영|고용부담금 산정에 영향을/, '상세 제도 설명은 공개 페이지에서 제외합니다');
assert.doesNotMatch(partnership, /무조건 절감|막대한 절감|즉시 효과|리스크를 태장이 모두 부담/, '제도 설명에 과장된 영업 문구를 사용하지 않습니다');
assert.doesNotMatch(partnership, /index\.html#business/, '협력 페이지의 정적 하는 일 링크는 business.html로 통일합니다');
assert.match(partnership, /aria-controls="partnership-faq-answer-1"/, 'FAQ 버튼은 답변 영역을 명시적으로 연결합니다');
assert.match(partnership, /id="partnership-required-guide"[^>]*>[^<]*<span[^>]*>\*<\/span> 표시는 필수 입력 항목입니다\./, '협력 문의 폼은 필수 입력 안내를 제공합니다');
assert.match(index, /href="activities\.html\?id=terrarium-business-start-2026-08">테라리움 사업 이야기/);
assert.doesNotMatch(index, /모회사 참여부터 기업 업무/);
assert.match(index, /태장과 협력할 수 있는 분야[\s\S]*?모회사·고용 연계[\s\S]*?기업 업무·건별 프로젝트[\s\S]*?지역사회공헌·ESG 협력[\s\S]*?지역·문화 활동[\s\S]*?협력 방식 자세히 보기/, '협력 영역은 compact 정보형으로 안내합니다');
assert.doesNotMatch(index, /partnership-overview[\s\S]*?href="#contact">협력·문의/, '협력 영역은 문의 CTA를 반복하지 않습니다');
assert.match(index, /<h2 class="title" id="contact-title">태장에 문의하기<\/h2>[\s\S]*?전화, 이메일, 오시는 길 확인 또는 문의 폼으로 편하게 연락해 주세요\./, '문의 영역은 실제 연락 수단과 폼에 집중합니다');
assert.equal((index.match(/지속 가능한/g) || []).length, 2, 'Hero 제목과 회사 정의 보조문구에서만 사용합니다');
assert.match(index, /2026\.08[\s\S]*신규 사업장 개소[\s\S]*2026\.07[\s\S]*자회사형 장애인 표준사업장 인증[\s\S]*2025\.06[\s\S]*법인 설립/);
assert.match(index, /id="inquiry-required-guide"[^>]*>[^<]*<span[^>]*>\*<\/span> 표시는 필수 입력 항목입니다\./, '홈 문의 폼은 필수 입력 안내를 제공합니다');
assert.match(index, /소식·기록 전체 보기/);
assert.match(index, /<h2 class="title" id="recent-activities-title">활동 기록<\/h2>/);
assert.match(index, /ACTIVITY RECORDS/);
assert.ok(index.indexOf('data-recent-activities') < index.indexOf('COLLABORATION'), '활동 기록을 협력 안내보다 먼저 보여줍니다');
assert.match(index, /지역사회공헌·ESG 협력/);
assert.match(index, /기업·기관과 함께 지역사회에 필요한 활동을 기획하고 운영합니다\. 현재는 지역 환경정비 활동을 중심으로 시작하고 있습니다\./);
assert.match(index, /href="partnership\.html#environment-service">사회공헌 협력 안내/);
assert.match(index, /data-home-preview="hub"[^>]*data-home-preview-count="8"/);
assert.match(index, /소식·기록 전체 보기[\s\S]*?data-home-preview="hub"[\s\S]*?<div class="recent-activities-archive-cta"><a class="btn line" href="archive\.html">태장 아카이브 전체 보기<\/a><\/div>/, '상단 링크를 유지하고 카드 목록 뒤에 아카이브 CTA를 둡니다');
assert.match(polish, /\.recent-activities-archive-cta\s*\{[\s\S]*?justify-content:\s*center[\s\S]*?margin-top:\s*36px/);
assert.match(index, /<strong>taejang2025@naver\.com<\/strong>/);
assert.doesNotMatch(index, /info@taejang\.co\.kr/);
assert.match(site, /\['location\.html', '오시는 길'\]/, '공통 footer 바로가기에 오시는 길을 유지합니다');
assert.match(site, /FOOTER_CHANNEL_LINKS[\s\S]*?youtube\.com\/@taejangofficial[\s\S]*?blog\.naver\.com\/taejang-official/, '공통 footer는 검증된 공식 채널만 제공합니다');
assert.match(index, /external-content\.js[\s\S]*content-hub\.js[\s\S]*home-previews\.js[\s\S]*photo-slots\.js[\s\S]*hero-video\.js[\s\S]*site\.js/);
assert.doesNotMatch(index, /data-photo-slot="01"/);
assert.match(index, /data-youtube-video="FbEOcteBSJ4"/);
assert.match(index, /i\.ytimg\.com\/vi\/FbEOcteBSJ4\/hqdefault\.jpg/);
assert.match(index, /data-youtube-play[^>]*aria-label="태장 공식 소개영상 재생"/);
assert.match(index, /data-youtube-video="8x7yg5YBK9g"/);
assert.match(index, /i\.ytimg\.com\/vi\/8x7yg5YBK9g\/hqdefault\.jpg/);

assert.match(index, /<form[^>]*name="taejang-inquiry"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
assert.match(index, /action="\/thanks\.html"/);
assert.match(index, /name="form-name" value="taejang-inquiry"/);
assert.match(index, /name="email"[^>]*required/);
assert.match(index, /name="message"[^>]*required/);
assert.match(index, /<option>채용·근무 문의<\/option>/);
assert.match(index, /채용 여부와 시기는 문의 시점에 따라 달라질 수 있습니다\./);
assert.match(index, /<option>지역사회공헌·ESG 협력<\/option>/);
assert.match(index, /name="privacy-consent"[^>]*required/);
assert.match(index, /주민등록번호, 장애·건강정보 등 민감한 개인정보는 입력하지 마세요/);
assert.match(index, /문의 처리 완료 후 6개월/);
assert.match(privacy, /mailto:taejang2025@naver\.com/);
assert.match(terms, /mailto:taejang2025@naver\.com/);
assert.doesNotMatch(privacy, /info@taejang\.co\.kr/);
assert.doesNotMatch(terms, /info@taejang\.co\.kr/);

for (const slot of ['02', '03', '04', '05', '06']) assert.match(index, new RegExp(`data-photo-slot="${slot}"`));
for (const slot of ['07', '08']) assert.match(about, new RegExp(`data-photo-slot="${slot}"`));
assert.match(about, /data-photo-slot="07"[\s\S]*?<img src="images\/homepage\/photo-07\.webp"[^>]*loading="eager"[^>]*fetchpriority="high"/);
assert.match(read('assets/css/photo-mode.css'), /html:not\(\.photo-review-mode\) \[data-photo-slot\] > :not\(img\)/);
assert.match(about, /태장 한눈에 보기/);
assert.equal((about.match(/class="glance-grid"/g) || []).length, 1);
assert.equal((about.match(/<div><strong>/g) || []).length, 4, '태장 한눈에 보기는 확정한 4칸만 표시합니다');
assert.match(about, /<strong>장애인 표준사업장<\/strong><span>자회사형 장애인 표준사업장 인증 제2026-049호<\/span>/);
assert.equal((about.match(/class="glance-grid"[\s\S]*?<\/div>\s*<\/div>/g) || []).length, 1);
assert.doesNotMatch(about, /사업 확장/);
assert.match(about, /<strong>4개 기업 참여<\/strong><span>네 개 기업이 주주로 참여해 태장과 협력하고 있습니다\.<\/span>/);
assert.match(about, /사업과 직무<\/strong><span>민화·문화 굿즈와 포장·검수, 지역사회공헌 활동을 운영하며 테라리움 제조상품을 개발하고 있습니다\./);
assert.match(about, /대표이사 <strong>이영희<\/strong>/);
assert.match(about, /class="value-grid value-grid--visual"[\s\S]*사람을 먼저 봅니다[\s\S]*일을 오래 이어갑니다[\s\S]*함께 방법을 찾습니다/);
assert.match(about, /images\/homepage\/photo-08-about-preview\.webp/);
assert.match(greeting, /class="story-side story-side--static"[\s\S]*images\/homepage\/photo-08\.webp/);
assert.match(read('assets/css/story-pages.css'), /\.story-side--static \{ position: static; \}/);

assert.match(greeting, /사람을 숫자로만 보지 않겠습니다/);
assert.doesNotMatch(greeting, /21명|18명|스물한 명|열여덟|창원 진전면의 과수원에서 시작했습니다/);
assert.equal((minhwa.match(/class="story-chapter(?:\s|" )/g) || []).length, 5);
for (const heading of ['사람에게 맞는 일에서 시작했습니다', '농업의 이야기가 그림이 됩니다', '그림은 제품이 됩니다', '하나의 제품 안에 여러 일이 있습니다', '이미 시작된 일입니다']) assert.match(minhwa, new RegExp(heading));
assert.match(minhwa, /민화 작업을 적용한 제품 제작과 전달 과정을 경험했습니다/);
assert.match(minhwa, /민화는 계획만이 아니라 실제 작업과 제품으로 이어지고 있습니다/);
assert.doesNotMatch(minhwa, /약 130개|packing-inspection\.webp/);
assert.match(minhwa, /assets\/images\/workplace\/minhwa-work-process\.webp/);
assert.match(minhwa, /민화의 소재가 될 수 있습니다[\s\S]*제품과 문화 콘텐츠로 이어가는 방향을 생각하고 있습니다/);
assert.match(minhwa, /class="minhwa-illustration"[\s\S]*assets\/images\/minhwa\/why-minhwa-story-flow\.webp[\s\S]*농업과 자연의 소재가 민화 작업을 거쳐 제품과 체험·문화로 이어지는 수채화 일러스트/);
assert.match(minhwa, /class="minhwa-illustration"[\s\S]*assets\/images\/minhwa\/why-minhwa-product-expansion\.webp[\s\S]*하나의 민화 도안이 보석함, 카드, 달력, 농산물 포장, 기업 굿즈로 확장되는 수채화 일러스트/);
assert.match(minhwa, /class="minhwa-flow minhwa-flow--work"[\s\S]*재료 준비[\s\S]*도안 전사·채색[\s\S]*조립·마감[\s\S]*검수·포장/);
assert.match(minhwa, /class="minhwa-result-graphic"[\s\S]*민화 도안[\s\S]*제품 제작[\s\S]*검수·포장[\s\S]*전달/);
assert.doesNotMatch(minhwa, /서정희|무상|유상|원가|매출 예상|전문 작업자 3~4명/);

assert.match(workplace, /태장은 근로자의 강점과 작업 특성에 맞춰 직무를 나누고, 순서와 작업환경을 이해하기 쉽게 운영합니다\./);
assert.match(workplace, /class="workplace-work-gallery"[\s\S]*민화·문화 굿즈[\s\S]*포장·검수[\s\S]*작업 공간과 현장 업무/);
for (const [imagePath, alt] of [
  ['assets/images/workplace/workplace-minhwa-watercolor.webp', '꽃무늬 나무 상자를 채색하는 민화 작업 수채화 일러스트'],
  ['assets/images/workplace/workplace-packing-watercolor.webp', '상자를 테이프로 포장하는 작업 수채화 일러스트'],
  ['assets/images/workplace/workplace-workspace-watercolor.webp', '작업 테이블과 의자가 있는 차분한 작업실 수채화 일러스트']
]) {
  const imageFile = path.join(root, imagePath);
  const imageBytes = fs.readFileSync(imageFile);
  assert.equal(imageBytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(imageBytes.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.match(workplace, new RegExp(`src="${imagePath}" alt="${alt}"`));
}
assert.equal((workplace.match(/class="workplace-principle-list"/g) || []).length, 1);
assert.equal((workplace.match(/<li><span>0[1-3]<\/span>/g) || []).length, 3);
assert.doesNotMatch(workplace, /data-workplace-roles|data-workplace-process|class="workplace-role-card"|class="workplace-process-step"/);
assert.ok(workplace.indexOf('data-workplace-overview') < workplace.indexOf('data-listing'), '작업사진과 원칙 다음에 일터 이야기를 배치합니다');
assert.match(workplace, /일터 이야기/);

assert.match(partnership, /범한메카텍[\s\S]*삼현[\s\S]*청우비제이[\s\S]*현대비앤지스틸/);
assert.equal((partnership.match(/class="partnership-visual-card"/g) || []).length, 4);
assert.match(partnership, /id="environment-service"/);
assert.match(partnership, /지역사회공헌·ESG 협력/);
assert.match(partnership, /SOCIAL CONTRIBUTION &amp; ESG/);
assert.match(partnership, /현재는 지역 환경정비 활동을 중심으로 시작했으며, 지역에 필요한 다음 협력 방향을 검토합니다\./);
assert.match(partnership, /현재 활동[\s\S]*지역 환경정비[\s\S]*확장 방향[\s\S]*복지시설[\s\S]*공공기관 캠페인[\s\S]*지역문화·체험[\s\S]*기업 ESG 프로그램/);
assert.match(partnership, /현재 환경정비 활동 운영 과정/);
assert.match(partnership, /사전 협의[\s\S]*현장 준비[\s\S]*수행·기록/);
assert.equal((partnership.match(/class="service-step"/g) || []).length, 3);
assert.match(partnership, /기업 협력·고용 연계/);
assert.doesNotMatch(partnership, /START WITH A CONVERSATION|간단한 문의부터 시작할 수 있습니다/);
assert.match(partnership, /href="#contact">협력·문의하기/);
assert.match(partnership, /<form[^>]*name="taejang-inquiry"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
assert.match(partnership, /action="\/thanks\.html"/);
assert.match(partnership, /name="form-name" value="taejang-inquiry"/);
assert.match(partnership, /name="privacy-consent"[^>]*required/);
assert.match(partnership, /채용·근무 문의/);
assert.match(partnership, /<option>지역사회공헌·ESG 협력<\/option>/);
assert.match(partnership, /mailto:taejang2025@naver\.com/);
assert.match(partnership, /기업 업무·건별 프로젝트/);
assert.equal((partnership.match(/class="faq-item"/g) || []).length, 6, '협력 FAQ는 6개 질문을 제공합니다');
assert.equal((partnership.match(/data-faq-button aria-expanded="false"/g) || []).length, 6, 'FAQ 질문은 처음에 모두 접힌 상태입니다');
assert.match(partnership, /환경정비 등 지역사회 활동을 기업·기관과 함께 검토합니다\.[\s\S]*href="#environment-service"/);
assert.ok(partnership.indexOf('id="environment-service"') < partnership.indexOf('faq-section'), 'FAQ는 ESG 상세 뒤에 배치합니다');
assert.ok(partnership.indexOf('faq-section') < partnership.indexOf('id="contact"'), 'FAQ는 문의 영역 앞에 배치합니다');
assert.match(site, /querySelectorAll\('\[data-faq-button\]'\)[\s\S]*setAttribute\('aria-expanded', 'false'\)[\s\S]*setAttribute\('aria-expanded', 'true'\)/, '기존 FAQ 아코디언 동작을 재사용합니다');
for (const image of [
  'partnership-parent-company-ai.webp',
  'partnership-project-ai.webp',
  'partnership-esg-ai.webp',
  'partnership-community-ai.webp'
]) {
  assert.match(partnership, new RegExp(`assets/images/partnership/${escapeRegExp(image)}`), `협력·참여 카드가 ${image} 디자인 이미지를 사용합니다`);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/partnership', image)), true, `${image} 파일이 존재해야 합니다`);
}
assert.doesNotMatch(partnership, /PARENT COMPANY|ESG FIELD|COMMUNITY/, '비어 있는 카드용 텍스트 장식을 노출하지 않습니다');
assert.match(partnershipCompact, /\.partnership-visual-media img\s*\{[\s\S]*?object-fit:\s*cover/, '협력·참여 카드 이미지는 비주얼 영역을 안정적으로 채웁니다');
assert.match(partnershipCompact, /@media \(max-width: 760px\)[\s\S]*?\.partnership-visual-media\s*\{[\s\S]*?height:\s*170px/, '모바일 카드 미디어를 압축합니다');

assert.match(archive, /<div class="eyebrow">TAEJANG ARCHIVE<\/div>/);
assert.match(archive, /<h1 class="title">태장의 소식과 기록<\/h1>/);
assert.match(archive, /최근 소식과 일터, 지역 활동의 기록을 날짜순으로 모았습니다/);
assert.match(archive, /검색과 필터를 이용해 태장의 기록을 살펴보세요/);
assert.match(archive, /<label for="archive-search-input">기록 검색<\/label>/);
assert.match(archive, /<input id="archive-search-input" type="search" placeholder="제목이나 내용, 출처를 검색해 보세요" autocomplete="off" data-archive-search-input>/);
assert.match(archive, /<button class="archive-search-clear" type="button" aria-label="검색어 지우기" data-archive-search-clear hidden>/);
assert.match(contentHub, /function searchableText\(item\)[\s\S]*?item\.title[\s\S]*?item\.summary[\s\S]*?item\.category[\s\S]*?item\.publisher[\s\S]*?sourceLabel\(item\)/);
assert.match(contentHub, /!searchQuery \|\| searchableText\(item\)\.includes\(searchQuery\)/);
assert.match(contentHub, /const sourceFilters = createFilters[\s\S]*?const categoryFilters = createFilters/);
assert.match(contentHub, /function resetConditions\(\)[\s\S]*?sourceFilters\.reset\(\)[\s\S]*?categoryFilters\.reset\(\)[\s\S]*?dateControls\.yearSelect\.value = 'all'[\s\S]*?dateControls\.monthSelect\.value = 'all'/);
assert.match(contentHub, /검색 결과 \$\{filtered\.length\}건/);
assert.match(contentHub, /조건에 맞는 기록이 없습니다\./);
assert.match(contentHub, /검색어 또는 필터를 변경해 보세요\./);
assert.match(contentHub, /조건 초기화/);
assert.match(contentHub, /clearSearch\.addEventListener\('click'/);
assert.match(contentHub, /sourceLabels\[item\?\.source\] \|\| item\?\.source \|\| '홈페이지'/);
assert.match(contentHub, /link\.target = '_blank';[\s\S]*?link\.rel = 'noopener noreferrer'/);
const archiveStyles = read('assets/css/content-hub-polish.css');
assert.match(archiveStyles, /\.archive-search input\s*\{[\s\S]*?font-size:\s*16px/);
assert.match(archiveStyles, /@media \(max-width: 620px\)[\s\S]*?\.content-filter-buttons\s*\{[\s\S]*?flex-wrap:\s*wrap[\s\S]*?overflow:\s*visible/);
assert.doesNotMatch(archiveStyles, /@media \(max-width: 620px\)[\s\S]*?\.content-filter-buttons\s*\{[\s\S]*?overflow-x:\s*auto/);

assert.match(resources, /name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(resources, /taejang2025@naver\.com|콘텐츠 소식|사업과 역량|기업 협력|href="staff\//);
for (const page of [privacy, terms]) {
  assert.equal((page.match(/<meta name="robots"/g) || []).length, 1);
  assert.match(page, /name="robots" content="noindex,follow"/);
  assert.match(page, /taejang2025@naver\.com/);
  assert.doesNotMatch(page, /info@taejang\.co\.kr/);
}
assert.match(privacy, /문의 처리 완료일부터 6개월/);
assert.match(privacy, /Netlify Forms/);
assert.match(privacy, /미국을 포함한 국외/);
assert.match(privacy, /민감한 개인정보를 입력하지 않도록 안내/);
assert.match(terms, /외부 링크/);
assert.match(thanks, /name="robots" content="noindex,nofollow"/);
assert.match(thanks, /문의가 접수되었습니다/);
assert.match(thanks, /href="index\.html"/);
assert.match(notFound, /name="robots" content="noindex,nofollow"/);
assert.match(notFound, /href="index\.html#contact"/);

for (const excluded of ['resources.html', 'privacy.html', 'terms.html', 'thanks.html', '404.html', 'staff/']) {
  assert.doesNotMatch(sitemap, new RegExp(escapeRegExp(excluded)));
}
for (const filename of Object.keys(pages).slice(1)) assert.match(sitemap, new RegExp(escapeRegExp(filename)));
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Sitemap: https:\/\/taejang\.co\.kr\/sitemap\.xml$/m);

for (const [filename, html] of Object.entries(pages).concat([['privacy.html', privacy], ['terms.html', terms], ['thanks.html', thanks], ['404.html', notFound]])) {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|tel:|#)/.test(href)) continue;
    const localPath = href.split(/[?#]/)[0];
    if (!localPath) continue;
    const resolved = localPath.endsWith('/') ? `${localPath}index.html` : localPath;
    assert.equal(fs.existsSync(path.join(root, resolved)), true, `${filename}의 내부 링크 ${href} 대상이 존재해야 합니다`);
  }
}

assert.match(staff, /<h1 id="login-title">임직원 로그인<\/h1>/);
assert.doesNotMatch(staff, /태장 업무앱|업무 플랫폼/);
assert.match(site, /const SHOW_EMPLOYEE_ENTRY = false/);
assert.match(site, /const PUBLIC_EMAIL = 'taejang2025@naver\.com'/);
assert.doesNotMatch(site, /info@taejang\.co\.kr|LEGACY_PUBLIC_EMAIL/);
assert.match(site, /emailLink\.href = `mailto:\$\{PUBLIC_EMAIL\}`/);
assert.match(site, /emailLink\.textContent = PUBLIC_EMAIL/);
assert.match(site, /const OPENING_HIDDEN_FROM = '2026-08-13'/);
assert.equal((site.match(/\['archive\.html', '소식·기록'\]/g) || []).length, 2);
assert.equal((site.match(/\['partnership\.html', '협력·문의'/g) || []).length, 2);
assert.match(styles, /:focus-visible\{outline:3px solid var\(--green-deep\);outline-offset:3px\}/);
assert.match(site, /\['about\.html', '태장 소개'\]/);
assert.match(site, /\['business\.html', '하는 일'\]/);
assert.match(site, /assets\/css\/site-polish\.css/, '공통 보정 stylesheet를 동적으로 로드합니다');
assert.match(site, /assets\/css\/engagement-polish\.css/);
assert.doesNotMatch(site, /data-hero-slider|hero-slide|photo-slots\.css/);
assert.match(styles, /@media \(max-width:760px\)\{[\s\S]*?\.hero--neutral\{display:block;min-height:auto\}[\s\S]*?\.hero-facts\{position:static;left:auto;width:calc\(100% - 36px\);margin:0 auto 22px;grid-template-columns:1fr;transform:none;bottom:auto;border-bottom:1px solid rgba\(255,255,255,\.28\)\}[\s\S]*?\.hero-facts div\{padding:14px 16px 17px\}[\s\S]*?\.hero-facts span\{margin-top:3px;font-size:11px;line-height:1\.6\}/, '모바일 Hero는 block 흐름으로 쌓고 정보 패널의 내부 여백을 유지합니다');
assert.doesNotMatch(styles, /\.hero-facts\{[^}]*bottom:20px/, '모바일 Hero 정보 패널은 bottom 위치 보정을 사용하지 않습니다');
assert.match(engagement, /@media \(max-width: 760px\) \{[\s\S]*?\.hero-layout \{[\s\S]*?padding-bottom: 28px;/, '모바일 Hero layout은 absolute 정보 패널용 하단 예약 공간을 제거합니다');

assert.match(polish, /\/\* Numbered public-homepage photo slots \*\/[\s\S]*?\.photo-slot,\s*\.content-photo-slot \{/);
assert.doesNotMatch(styles, /^\.photo-slot\s*\{/m);
assert.match(polish, /\.workplace-gallery\s*\{\s*grid-template-columns:\s*1fr;/s);
assert.match(polish, /\.partnership-types li\s*\{[\s\S]*column-gap:\s*18px;/);
assert.match(polish, /\.recent-activities-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(polish, /@media \(min-width: 761px\) and \(max-width: 1100px\)\s*\{[\s\S]*\.recent-activities-grid\s*\{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(polish, /@media \(max-width: 760px\)\s*\{[\s\S]*\.recent-activities-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
assert.match(engagement, /\.contact-form-card/);
assert.match(engagement, /\.environment-service-layout/);
assert.match(engagement, /\.workplace-work-gallery/);
assert.match(engagement, /\.workplace-principle-list/);
assert.match(read('assets/css/partnership-compact.css'), /\.partnership-environment \.service-steps[\s\S]*repeat\(3/);
assert.equal(fs.existsSync(path.join(root, 'assets/css/photo-slots.css')), false);

assert.match(photoSlots, /const PHOTO_REVIEW_MODE = false/);
assert.match(photoSlots, /const PHOTO_BASE_PATH = 'images\/homepage\/'/);
assert.equal((photoSlots.match(/file: 'photo-\d{2}\.webp'/g) || []).length, 8);
assert.doesNotMatch(photoSlots, /photo-0(?:9|10|11)\.webp/);
assert.match(photoSlots, /mobileObjectPosition/);
assert.match(photoSlots, /slot\.prepend\(image\)/);
assert.match(photoMode, /\.photo-review-mode \.photo-slot--has-image \.photo-slot-number/);
assert.match(photoMode, /\.photo-public-mode \.photo-slot--has-image > :not\(img\)/);
assert.match(photoFolderGuide, /photo-01\.webp[\s\S]*photo-08\.webp/);
assert.match(photoFolderGuide, /메인 최신 최대 8개 카드/);
assert.match(photoFolderGuide, /thumbnail/);
assert.match(photoFolderGuide, /원본 사진, 공개동의서, 동의 관리대장/);
assert.match(contentHub, /window\.TAEJANG_CONTENT_HUB/);
assert.match(contentHub, /youtube: 'YOUTUBE'/);
assert.match(contentHub, /press: '언론보도'/);
assert.match(contentHub, /function formatPublishedDate\(value\)/);
assert.match(contentHub, /dateValue\(right\.item\.publishedAt\) - dateValue\(left\.item\.publishedAt\)[\s\S]*left\.index - right\.index/);
assert.doesNotMatch(contentHub, /Number\(right\.featured\)/);
assert.match(previews, /contentHub\.orderedItems\(content\.hub\)/);
assert.match(previews, /contentHub\.createMedia\(item, 'card-media recent-activity-media'\)/);
assert.match(previews, /contentHub\.sourceLabel\(item\)/);
assert.match(previews, /source-badge source-badge--\$\{item\.source \|\| 'homepage'\}/);
assert.match(previews, /Math\.min\(Math\.max\(requestedCount, 1\), 8\)/);
assert.doesNotMatch(previews, /createPhotoSlot|data\.photoSlot|PHOTO 0(?:9|10|11)/);
assert.match(heroVideo, /youtube-nocookie\.com\/embed/);
assert.match(heroVideo, /autoplay=1/);
assert.match(heroVideo, /playsinline=1/);
assert.match(heroVideo, /iframe\.title = title/);
assert.match(heroVideo, /setAttribute\('allowfullscreen'/);
assert.doesNotMatch(heroVideo, /data-photo-slot|photo-0(?:1|9|10|11)/);

function createHubApi(content) {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.className = '';
      this.attributes = {};
      this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    closest() { return null; }
  }
  const document = {
    createElement: () => new Element(),
    querySelector: () => null
  };
  const runtimeWindow = { TAEJANG_CONTENT: content };
  vm.runInNewContext(contentHub, { window: runtimeWindow, document, console: { warn() {} } });
  return runtimeWindow.TAEJANG_CONTENT_HUB;
}

function createPreviewFixture(content, count = '8') {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.className = '';
      this.attributes = {};
      this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    closest() { return section; }
  }
  const section = new Element();
  const container = new Element();
  container.dataset.homePreviewCount = count;
  const document = {
    createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-home-preview="hub"]' ? [container] : selector === '[data-recent-activities]' ? [section] : []
  };
  const runtimeWindow = { TAEJANG_CONTENT: content };
  runtimeWindow.TAEJANG_CONTENT_HUB = createHubApi(content);
  vm.runInNewContext(previews, { window: runtimeWindow, document, console: { warn() {} } });
  return { section, container };
}

const previewContent = { hub: [
  { type: 'internal', source: 'homepage', status: 'published', title: '오래된 고정 글', category: '소식', publishedAt: '2026-07-01', featured: true, detailUrl: 'activities.html?id=old' },
  { type: 'external', source: 'youtube', status: 'published', title: '가장 최신 외부 글', category: '소식', publishedAt: '2026-08-03', thumbnail: 'latest.webp', thumbnailAlt: '최신 외부 글 대표사진', externalUrl: 'https://example.org/latest', externalLabel: '원문 보기' },
  { type: 'internal', source: 'homepage', status: 'published', title: '두 번째 글', category: '소식', publishedAt: '2026-08-02', thumbnail: 'second.webp', detailUrl: 'activities.html?id=second' },
  { type: 'internal', source: 'naver-blog', status: 'published', title: '같은 날 세 번째 글', category: '소식', publishedAt: '2026-08-02', detailUrl: 'activities.html?id=third' },
  { type: 'internal', source: 'homepage', status: 'draft', title: '비공개 글', category: '소식', publishedAt: '2026-08-04', detailUrl: 'activities.html?id=draft' }
] };
const api = createHubApi(previewContent);
assert.deepEqual(api.orderedItems(previewContent.hub).map(item => item.title), ['가장 최신 외부 글', '두 번째 글', '같은 날 세 번째 글', '오래된 고정 글']);
assert.equal(api.sourceLabel({ source: 'homepage' }), '홈페이지');
assert.equal(api.sourceLabel({ source: 'naver-blog' }), 'NAVER BLOG');
assert.equal(api.sourceLabel({ source: 'youtube' }), 'YOUTUBE');
assert.equal(api.sourceLabel({ source: 'press' }), '언론보도');
assert.equal(api.formatPublishedDate('2026-08'), '2026.08');
assert.equal(api.formatPublishedDate('2026-08-20'), '2026.08.20');

const actualWindow = {};
vm.runInNewContext(contentData, { window: actualWindow });
vm.runInNewContext(externalContent, { window: actualWindow });
const actualHubItems = createHubApi(actualWindow.TAEJANG_CONTENT).orderedItems(actualWindow.TAEJANG_CONTENT.hub);
assert.equal(actualHubItems.length, 11, '소식·기록은 테라리움 제조사업 기록을 포함한 공개 콘텐츠를 함께 표시합니다');
assert.deepEqual(Array.from(actualHubItems, item => item.id), [
  'internal-terrarium-business-start-2026-08',
  'youtube-qvqNyeyfQsA',
  'youtube-8x7yg5YBK9g',
  'youtube-FbEOcteBSJ4',
  'youtube-8x4Rf3knAb8',
  'internal-opening',
  'naver-blog-224367547159',
  'internal-staff-birthday-2026-08',
  'kbs-news-8636757',
  'internal-environment-cleanup',
  'internal-certification'
]);
assert.deepEqual(Array.from(actualHubItems, item => item.title), [
  '테라리움 제조사업을 시작합니다',
  '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장',
  '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사',
  '태장 소개영상',
  "[현장] '경남형 장애인 동행일자리' 1호점 가보니",
  '태장 개소식 안내',
  '한 줄 한 줄 정성으로 완성되는 태장의 하루',
  '8월 생일을 함께 축하했습니다',
  '‘경남형 장애인 동행일자리’ 1호점 창원 가동',
  '첫 환경정비 활동을 진행했습니다',
  '자회사형 장애인 표준사업장 인증'
]);
assert.equal(actualHubItems.some(item => /민화 작업을 시작했습니다|포장과 검수 작업을 준비합니다/.test(item.title)), false);
assert.equal(contentData.includes('id: "minhwa-class"'), false);
assert.equal(contentData.includes('id: "packing-start"'), false);
assert.equal(contentData.includes('id: "internal-minhwa"'), false);
assert.equal(contentData.includes('id: "internal-packing"'), false);

const actualRecentItems = actualHubItems.slice(0, 8);
assert.equal(actualRecentItems.length, 8, '메인 활동 기록은 최신 공개 콘텐츠 최대 8개를 표시합니다');
assert.deepEqual(Array.from(actualRecentItems, item => item.title), ['테라리움 제조사업을 시작합니다', '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장', '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사', '태장 소개영상', "[현장] '경남형 장애인 동행일자리' 1호점 가보니", '태장 개소식 안내', '한 줄 한 줄 정성으로 완성되는 태장의 하루', '8월 생일을 함께 축하했습니다']);
assert.equal(actualRecentItems[3].thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');
assert.equal(actualRecentItems[3].thumbnailAlt, '태장 공식 소개영상 썸네일');
assert.equal(actualRecentItems[3].externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');
assert.deepEqual(Array.from(actualHubItems.filter(item => item.source === 'youtube' && item.publisher === '태장 공식 유튜브'), item => item.id), ['youtube-qvqNyeyfQsA', 'youtube-8x7yg5YBK9g', 'youtube-FbEOcteBSJ4']);
assert.equal(actualRecentItems[1].externalUrl, 'https://www.youtube.com/watch?v=qvqNyeyfQsA');
assert.equal(actualRecentItems[2].externalUrl, 'https://www.youtube.com/watch?v=8x7yg5YBK9g');
assert.equal(actualRecentItems[4].externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');
assert.match(contentHub, /item\.publisher[\s\S]*?sourceLabel\(item\)/, '아카이브 검색은 매체명과 출처 라벨을 함께 대상으로 사용합니다');

const birthdayHubItem = actualHubItems.find(item => item.id === 'internal-staff-birthday-2026-08');
assert.equal(fs.existsSync(path.join(root, birthdayHubItem.thumbnail)), true);
const birthdayBytes = fs.readFileSync(path.join(root, birthdayHubItem.thumbnail));
assert.equal(birthdayBytes.subarray(0, 4).toString('ascii'), 'RIFF');
assert.equal(birthdayBytes.subarray(8, 12).toString('ascii'), 'WEBP');
assert.match(contentData, /id: "staff-birthday-2026-08"[\s\S]*date: "2026\.08"/);

const terrariumHubItem = actualHubItems.find(item => item.id === 'internal-terrarium-business-start-2026-08');
assert.equal(terrariumHubItem.source, 'homepage');
assert.equal(terrariumHubItem.category, '회사소식');
assert.equal(terrariumHubItem.publishedAt, '2026-08-22');
assert.equal(terrariumHubItem.thumbnail, 'assets/images/terrarium/terrarium-display.webp');
assert.equal(terrariumHubItem.thumbnailAlt, '다양한 유리용기와 형태로 구성된 테라리움 샘플 진열');
for (const image of ['terrarium-display.webp', 'terrarium-glass-jars.webp', 'terrarium-plant-composition.webp', 'terrarium-geometric.webp']) {
  const imagePath = path.join(root, 'assets/images/terrarium', image);
  const bytes = fs.readFileSync(imagePath);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
}
assert.match(contentData, /id: "terrarium-business-start-2026-08"[\s\S]*?테라리움 제조사업을 시작합니다[\s\S]*?terrarium-glass-jars\.webp[\s\S]*?terrarium-plant-composition\.webp[\s\S]*?terrarium-geometric\.webp/);
const terrariumActivity = contentData.slice(contentData.indexOf('id: "terrarium-business-start-2026-08"'), contentData.indexOf('\n    }\n  ],\n  hub'));
assert.doesNotMatch(terrariumActivity, /판매 중|체험 프로그램 운영 중|태장 직원 제작 완제품/);

const certificationHubItem = actualHubItems.find(item => item.id === 'internal-certification');
assert.equal(certificationHubItem.thumbnail, 'assets/images/archive/standard-workplace-certification.webp');
assert.equal(certificationHubItem.thumbnailAlt, '태장 사업장에 설치된 장애인 표준사업장 인증과 경남형 장애인 동행일자리 및 공동출자기업 현판');
assert.equal(fs.existsSync(path.join(root, certificationHubItem.thumbnail)), true);
assert.match(contentData, /id: "standard-workplace-certification"[\s\S]*thumb: "assets\/images\/archive\/standard-workplace-certification\.webp"[\s\S]*hero: "assets\/images\/archive\/standard-workplace-certification\.webp"/);
assert.doesNotMatch(contentData, /images\/homepage\/photo-(?:09|10|11)\.webp/);

const visiblePreview = createPreviewFixture(previewContent);
assert.equal(visiblePreview.section.hidden, false);
assert.equal(visiblePreview.container.children.length, 4);
assert.deepEqual(visiblePreview.container.children.map(card => card.children[0].children[1].children[2].textContent), ['가장 최신 외부 글', '두 번째 글', '같은 날 세 번째 글', '오래된 고정 글']);
assert.deepEqual(visiblePreview.container.children.slice(0, 3).map(card => card.children[0].children[1].children[0].children[0].textContent), ['YOUTUBE', '홈페이지', 'NAVER BLOG']);
assert.deepEqual(visiblePreview.container.children.slice(0, 3).map(card => card.children[0].children[1].children[0].children[1].textContent), ['소식', '소식', '소식']);
assert.equal(visiblePreview.container.children[0].children[0].href, 'https://example.org/latest');
assert.equal(visiblePreview.container.children[0].children[0].target, '_blank');
assert.equal(visiblePreview.container.children[0].children[0].rel, 'noopener noreferrer');
assert.equal(visiblePreview.container.children[0].children[0].children[0].children[0].src, 'latest.webp');
assert.equal(visiblePreview.container.children[0].children[0].children[0].children[0].alt, '최신 외부 글 대표사진');
assert.equal(visiblePreview.container.children[1].children[0].href, 'activities.html?id=second');
assert.equal(visiblePreview.container.children[1].children[0].children[0].children[0].alt, '두 번째 글 썸네일');
assert.equal(visiblePreview.container.children[2].children[0].children[0].children[0].children[0].textContent, 'CONTENT PHOTO');
const maximumPreviewContent = { hub: Array.from({ length: 10 }, (_, index) => ({
  type: 'internal', source: 'homepage', status: 'published', title: `최신 글 ${index + 1}`, category: '소식',
  publishedAt: `2026-08-${String(index + 1).padStart(2, '0')}`, detailUrl: `activities.html?id=${index + 1}`
})) };
const maximumPreview = createPreviewFixture(maximumPreviewContent, '12');
assert.equal(maximumPreview.container.children.length, 8, '메인 최근 활동은 요청 수가 더 커도 최신 최대 8개만 표시합니다');
assert.equal(maximumPreview.container.children[0].children[0].children[1].children[2].textContent, '최신 글 10');
assert.equal(createPreviewFixture(undefined).section.hidden, true);
assert.equal(createPreviewFixture({ hub: [] }).section.hidden, true);

console.log('public-homepage-main-simplification tests: all cases passed');
