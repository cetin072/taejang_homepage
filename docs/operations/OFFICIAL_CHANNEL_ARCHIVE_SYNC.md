# 공식 블로그·유튜브 아카이브 자동 확인

상태: Draft 구현 후보. Production 배포 또는 자동 병합이 아님.

## 목적

공개 홈페이지 `/archive`에 태장 공식 네이버 블로그와 공식 유튜브의 새 게시물을 기존 카드 형식으로 보강한다. 기존 승인된 수동 아카이브는 보존한다.

## 기준 데이터 및 책임

- 기존 수동 자료: `assets/js/naver-blog-archive.js`, `assets/js/external-content.js`
- 새 자료 원장: `assets/js/official-channel-updates.js`의 지정된 JSON 배열
- 표시: 기존 `assets/js/content-hub.js`를 그대로 사용 (새 런타임 서비스 없음)
- 수집: `scripts/sync-official-archive.mjs`
- 스케줄: `.github/workflows/official-archive-sync.yml`
- 배포: 기존 `docs/operations/NETLIFY_48H_PRODUCTION.md` 그대로 적용

네이버 RSS의 공개 item에서 공식 `taejang-official`의 logNo·원제목·원본 발행일만 받는다. 유튜브는 공식 채널 HTML의 채널 ID를 확인하고 공개 Atom 피드의 동일 채널 videoId·제목·발행일을 사용한다. 네이버는 RSS에 담기는 최근 글까지만, 유튜브는 Atom 최근 항목까지만 발견할 수 있으므로 **전체 과거 글 전수 확인을 보장하지 않는다**. RSS 제공 또는 네트워크 접근 자체가 막히면 그 출처의 누락 개수는 미확정이다.

2026-10-19 GitHub Actions **실제 공개 피드 조회**: RSS·Atom 모두 접근 성공, 수집 55개 중 기존 항목 제외한 **39개(네이버 38, 공식 유튜브 1)를 Draft PR #488에 실제 등록**. 추가된 네이버 글의 대표이미지는 각 공개 원문 페이지에서 확인한 공식 OG 이미지를 사용한다. 검증된 `blogthumb.pstatic.net` 호스트만 허용하고, 이미지 연결이 실패하면 태장 공식 로고로 대체한다.

기존 등록 자료는 제목/일자/썸네일을 변경하지 않는다. 새 블로그 글은 공식 원문 페이지에 공개된 OG 이미지만 검증하여 카드에 사용한다. OG 이미지 획득·외부 이미지 표시가 실패할 때는 **태장 공식 로고로 대체**한다. 사진은 자동 복제하지 않고 원문으로 연결한다. 원문 제목·발행일·URL은 그대로 보존한다. 유튜브는 공식 동영상 썸네일을 사용한다. 블로그 사진의 자동 로컬 복제·변환은 의도적으로 제외하였다. 공식 블로그에서 이미 공개한 사진을 다른 공식 채널에 연결하는 것으로, 홈페이지 최종 공개 전 기존 사진 사용 승인 기준을 함께 점검한다.

## 주기와 안전 경계

- GitHub가 매일 `00:10 UTC`(09:10 KST)에 깨어나지만, 실제 수집은 **2026-10-22 09:10 KST부터 72시간마다** 슬롯 조건을 통과한 날에만 진행한다.
- 변경 없음: commit/PR/Production 요청 전부 없음.
- 신규 글: 원본 ID 중복 제거 후 **Draft PR만 생성**한다. 보호된 main의 자동 승인·병합이나 직접 수정은 하지 않는다.
- 진행 중인 자동화 Draft PR이 있으면 같은 목적의 PR을 다시 만들지 않는다. 해당 PR이 병합되어야 다음 자동 수집 결과를 제안한다.
- 수동 `workflow_dispatch`: **항상 읽기 전용**. 추출 차이만 보고한다.
- 한 출처만 실패하면 다른 출처만 보강할 수 있으나 실패 내용을 Actions Summary에 남긴다. 둘 다 실패하면 작업 실패로 보고하고 파일을 변경하지 않는다.
- 모든 자료는 UTF-8 데이터로 보존하며 실제 발행일은 한국시간 `YYYY-MM-DD`로 표시한다. 과거 한 번만 사용한 활동일 보정 규칙을 새 글에 적용하지 않는다.
- GitHub 기본 `GITHUB_TOKEN`의 PR 생성 권한이 저장소 설정상 제한되면 새 브랜치 push 후 PR 생성이 거부될 수 있다. 비공개 토큰을 추가하거나 권한을 우회하지 않으며 필요한 설정은 별도 사용자 승인 대상으로 보고한다.
- Actions가 만든 PR은 `GITHUB_TOKEN` 보호 동작으로 통상 PR CI가 자동 트리거되지 않는다. 수집 작업 내 `npm run test:public`, 자체 테스트, `npm run build:netlify`를 실행하되 **PR Preview / GitHub 필수 검사는 최종 HEAD에서 별도로 확인**해야 병합 가능하다.
- 기존 Production 배포 48시간 슬롯은 이 자동화와 완전히 독립적이다.

## 외부 이미지 표시 안정화 (2026-10-20)

- Naver `blogthumb.pstatic.net` 직접 브라우저 호출은 ORB/핫링크 정책에 따라 카드에서 실패할 수 있다.
- 원본 `assets/js/official-channel-updates.js`의 제목/원본URL/게시일/검증된 썸네일 URL은 변경하지 않는다.
- Netlify `npm run build:netlify`의 기존 정적 출력 생성 단계에서 `scripts/localize-official-thumbnails.mjs`가 **공식 블로그의 확인된 HTTPS 이미지 URL만 서버 측에서 읽고** 실이미지 바이트/크기/콘텐츠 유형을 검사한다.
- 허용한 이미지 형식(jpeg/png/webp)은 `dist/assets/images/archive/naver-blog-<logNo>.<ext>`로 생성하고, **dist의 아카이브 JS만** 같은 출처 경로로 치환한다. 원본 저장소/DB 변경 없음.
- 서버 측 다운로드 실패 또는 비정상 파일은 기존 태장 로고로 대체한다. 외부 URL 직접 재시도나 웹 브라우저 프록시·유료 API를 도입하지 않는다.
- Snapshot 변환은 자동 수집으로 들어오는 미래 신규 블로그 게시물에도 똑같이 적용된다. GitHub Actions는 기존처럼 Draft PR만 작성하고, 배포는 기존 고정 48시간 Production 게이트를 따른다.
- Netlify 빌드 출력의 `Official Naver thumbnail snapshot` 집계에서 local/fallback 수를 확인하고, 실제 Preview의 카드 사진을 PC·모바일에서 확인한다. 로컬 회귀 테스트만으로 이미지 실제 다운로드 성공을 주장하지 않는다.

## 검증

`node --test tests/official-archive-sync.test.mjs`

`npm run test:public`

`npm run build:netlify`

`node scripts/sync-official-archive.mjs --check` — 읽기 전용 실피드 조회

`node scripts/sync-official-archive.mjs --due` — 현재 UTC 날짜 슬롯 확인

실제로 수집된 새 글의 제목, 게시일, URL, 대표 이미지를 Draft PR과 Preview에서 검수한 뒤 병합한다. 기존 페이지 29개 수동 네이버 항목과 5개 유튜브 항목(타사 보도 포함)을 삭제하거나 변경하지 않는다.
