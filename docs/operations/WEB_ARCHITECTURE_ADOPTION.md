# 태장 Web Architecture Standard 적용 기록

## 공통 원본

웹 제작 공통 기준의 source of truth는 다음 문서입니다.

- Repository: `cetin072/ai-development-system`
- Document: `docs/WEB_ARCHITECTURE_STANDARD_V1.md`
- Core principle: **Static by Default, Dynamic by Necessity**

이 저장소에는 공통 표준 전문을 복제하지 않습니다. 공통 원본이 개정되면 그 문서를 우선 확인하고, 이 문서에는 태장 프로젝트 고유 결정과 예외만 기록합니다.

## 태장 공개 홈페이지

- 공개 기본 정보, 핵심 navigation, 핵심 CTA, 전화·이메일·주소, 승인된 기본 이미지는 정적 HTML/CSS를 기본으로 합니다.
- JavaScript는 UI interaction과 최신 승인 콘텐츠 보강에 사용합니다.
- JS/API 실패 시 핵심 공개정보와 이동이 남아야 합니다.
- 방문자에게 콘텐츠 영역으로 제시되는 Fresh content는 빈 컨테이너를 기본 상태로 두지 않고, 배포 시점의 마지막 승인 콘텐츠 또는 의미 있는 정적 fallback을 유지합니다.

### runtime fetch 선택

태장 공개 홈페이지는 내부 관리시스템에서 승인된 일부 홈페이지 콘텐츠를 재배포 없이 빠르게 반영할 운영 필요가 있고, 매 승인마다 Netlify 빌드를 발생시키는 비용·운영 부담을 줄이기 위해 제한적으로 runtime fetch를 사용할 수 있습니다.

runtime fetch를 쓰는 경우:

- 정적/배포 시점 fallback 유지
- API 실패 시 기존 정적 화면 유지
- 핵심 콘텐츠 빈 컨테이너 금지
- build-time ↔ runtime 변경은 아키텍처 변경으로 취급

## 태장 내부 업무 플랫폼

- 사용자·역할·업무 상태에 따라 화면이 달라지는 동적 앱으로 운영합니다.
- 인증·권한·중요 데이터는 서버/API/DB/RLS가 최종 검증합니다.
- 인증과 역할 결정 후 핵심 App Shell과 역할별 핵심 메뉴는 최초 렌더링에서 함께 확정합니다.
- 핵심 메뉴가 별도 후처리 모듈의 실행 순서나 race에 의존하지 않게 합니다.
- loading / empty / error / forbidden 상태를 구분합니다.

## 기존 구현 재감사

GitHub Issue #117에서 공개 홈페이지와 내부 업무 플랫폼을 공통 표준 기준으로 재감사합니다.

기존 정상 동작 구조를 표준 준수만을 이유로 대규모 재작성하지 않습니다. 보안·권한·race·핵심 fallback·이미지 성능 순으로 위험도 높은 항목부터 작은 PR로 정비합니다.

### 소식·기록 초기 목록 (PR #560)

- 기존 승인 데이터(content / naver-blog-archive / external-content / official-channel-updates)와 같은 content-hub 정렬·공개 판정을 빌드에서 재사용한다. 새 수집기나 CMS를 만들지 않는다.
- build-netlify-publish는 썸네일 로컬화 후 generate-archive-snapshot으로 archive.html의 최신 승인 카드 12개·필터·날짜 영역·JSON baseline을 매번 생성한다. 기존 익명 public-promotion-feed의 JSON을 최대 8초간 읽어 배포 시점 공개 발행글도 보강한다. 인증정보·DB 쓰기는 사용하지 않는다.
- 공개 피드를 못 읽으면 빌드 경고를 남기고 저장소 승인 데이터로 생성한다. 이전 HTML의 snapshot을 재사용하지 않는다. 자동 수집 승인 PR의 정적 데이터 변경은 다음 정기 배포 빌드에 반영되며, 직원 공개 발행글도 다음 빌드에서 확인한다.
- 방문 시 비동기 JSON 피드는 loading / ready / error를 구분한다. 늦은 응답은 목록을 강제 재정렬하지 않고 ‘최신 소식 반영’으로 알린다. 반영 시 검색·출처·주제·연월·더보기 범위와 보이는 카드 위치를 유지한다. 홈페이지의 기존 피드 경로는 보존한다.
- JS/API 실패 시 최신 기본 카드·원문 링크가 남고 실패는 안내한다. JS off의 검색·필터는 비활성화된 안내형 기본 상태이며 정적 12개 링크를 사용할 수 있다. source archive.html의 저장소 baseline은 generateArchiveSnapshot({outputRoot:process.cwd(),live:false})로 갱신 가능하고 실제 배포본은 빌드가 자동 갱신한다.
