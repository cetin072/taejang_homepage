# 태장 공개 전 체크리스트

## 현재 공개 전 유지 상태

- Draft PR 유지, `main` 미병합
- `assets/js/photo-slots.js`의 `PHOTO_REVIEW_MODE = true` 유지
- 실제 사진이 들어간 슬롯은 작은 PHOTO 번호 배지로 구분
- 임직원 진입 숨김
- 공개 자료실 메뉴 숨김
- 공개 문의 이메일은 `info@taejang.co.kr`
- 상단·모바일·푸터 메뉴의 기록 메뉴명은 `소식·기록`
- 개소식 안내는 2026년 8월 13일부터 한국시간 기준 자동 숨김
- 최근 활동 자료가 없으면 해당 섹션 자동 숨김

## 임직원 진입

현재 공개 홈페이지의 `임직원` 진입은 숨김 상태입니다.

다음 두 시점에 반드시 다시 확인합니다.

1. 내부 업무 플랫폼의 로그인·가입 신청·관리자 승인·퇴사자 차단 테스트가 완료된 시점
2. `taejang.co.kr` 공식 도메인 공개 직전 최종 점검 시점

재노출할 때는 `assets/js/site.js`의 `SHOW_EMPLOYEE_ENTRY`를 `true`로 변경하고, 모바일·PC에서 로그인 화면 연결을 확인합니다.

## 공개 문의 이메일과 연락처

- 이메일: `info@taejang.co.kr`
- 전화: `055-293-8626`
- 주소: 경남 창원시 의창구 평산로 33, 신화 더 플렉스시티 422·423호
- 대표이사: 이영희
- 사업자등록번호: 157-86-03535

기존 `taejang2025@naver.com` 주소는 일정 기간 병행 운영하며, 신규 메일 전달과 회신 서명을 통해 새 주소로 자연스럽게 전환합니다.

## 공식 도메인 운영 원칙

- 대표 주소는 `https://taejang.co.kr`
- `https://www.taejang.co.kr` 접속은 대표 주소로 영구 이동
- 공식 연결 전까지 Netlify 주소를 미리보기·검수용으로 유지
- 실제 DNS와 Netlify 사용자 지정 도메인은 별도 공개 작업에서 연결

공식 도메인 공개 시 다음 주소를 한 번에 바꿉니다.

- canonical
- Open Graph URL과 이미지 URL
- Twitter 공유 이미지 URL
- `sitemap.xml`
- `robots.txt`와 검색 노출 정책
- Netlify 기본 도메인·리디렉션 설정

## 개인정보·이용 안내와 검색 노출

- `privacy.html`은 현재 홈페이지의 실제 처리 방식에 맞게 회원가입·문의 폼 미운영, 전화·이메일 문의, 기술 접속정보, 보유·파기·권리 요청 내용을 안내
- `terms.html`은 정보성 홈페이지의 이용 범위, 콘텐츠 권리, 외부 링크와 금지 행위를 안내
- 개인정보처리방침과 이용약관은 푸터에서 접근할 수 있지만 검색 결과에는 노출하지 않도록 `noindex,follow` 유지
- `404.html`은 `noindex,nofollow`로 유지하고 홈·문의 경로 제공
- `sitemap.xml`에는 공개 핵심 페이지 8개만 포함하며 자료실·법적 안내·404·임직원 페이지는 제외
- 공식 도메인 연결 전까지 `robots.txt`와 사이트맵 주소는 Netlify 미리보기 기준으로 유지

## 사진과 로고

촬영 현장에서는 [`PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md`](PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md)를 사용합니다.

공개동의, 직원 안내, 촬영 당일 점검과 철회 처리는 [`PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md`](PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md)를 사용합니다.

고정 파일 경로, 슬롯 연결과 공개 모드 전환은 [`PUBLIC_HOMEPAGE_PHOTO_SLOTS.md`](PUBLIC_HOMEPAGE_PHOTO_SLOTS.md)를 사용합니다.

- 사진은 처음에 넉넉하게 수집하고 시험 배치 후 줄이기
- 공개 승인된 WebP 변환본만 `images/homepage/`에 저장
- PHOTO 01~11은 `photo-01.webp`부터 `photo-11.webp`까지 고정 파일명 사용
- 사진을 넣은 슬롯만 `assets/js/photo-slots.js`에서 `enabled: true`로 변경
- PHOTO 번호는 검수 단계의 편집 식별자로 유지
- 모바일·PC의 `objectPosition`을 각각 확인
- 공식 공개 직전에 모든 슬롯의 사진·대체 텍스트·크롭을 확인
- 최종 확인 후 `PHOTO_REVIEW_MODE = false`로 변경해 번호와 제작 안내 숨김
- 촬영 동의와 홈페이지 공개 동의를 별도로 확인
- 대표·근로자·외부인 사진 공개 동의 확인
- 홈페이지·SNS·보도자료 사용 범위를 채널별로 확인
- 공개 거부 또는 얼굴 제외 요청에 불이익이 없음을 안내
- 미확인 사진은 Deploy Preview에도 업로드하지 않기
- 공개동의서와 사진 파일을 분리 보관하고 접근 권한 최소화
- 동의 철회 요청을 받을 연락처와 처리 기록 준비
- 원본은 공유 드라이브에 보관하고 공개 승인된 변환본만 GitHub 저장소에 반영
- 기업 로고는 네 기업의 공식 원본과 사용 범위가 모두 확인된 뒤 일괄 적용

## 최종 기능 점검

- 전화 연결과 `info@taejang.co.kr` 수신 테스트
- 개인정보처리방침·이용약관 링크 확인
- 회사소개·기업협력·일터·활동·소식·기록 링크 확인
- `archive.html` 제목이 `태장의 소식과 기록`, 영문 소제목이 `TAEJANG ARCHIVE`인지 확인
- 숨겨진 임직원·자료실 링크가 공개 메뉴에 나타나지 않는지 확인
- 개소식 안내 자동 종료 확인
- 최근 활동 빈 상태 자동 숨김 확인
- 모바일 메뉴 열기·닫기와 키보드 접근 확인
- 모바일에서 사진 중심부가 잘리지 않고 PHOTO 배지가 콘텐츠를 가리지 않는지 확인
- PC에서 히어로 사진 위 제목의 명암 대비와 버튼 가독성 확인