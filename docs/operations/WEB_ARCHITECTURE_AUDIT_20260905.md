# Web Architecture Standard v1 감사 메모 — 2026-09-05

이 문서는 `cetin072/ai-development-system/docs/WEB_ARCHITECTURE_STANDARD_V1.md`를 기준으로 태장 공개 홈페이지와 내부 업무앱의 현재 구조를 점검한 보조 메모입니다.

감사의 장기 상태와 결정은 GitHub Issue #117을 source of truth로 사용합니다. 이 문서는 코드 근처에서 확인할 수 있는 결과 요약이며 Issue를 대체하지 않습니다.

## PASS

- 공개 사이트 핵심 navigation, 회사 기본정보, 연락처, 핵심 CTA는 HTML 원본에 존재합니다.
- `site.js`는 핵심 공개 navigation을 비우고 재생성하지 않습니다.
- 메인 주요 사진 다수는 정적 `<img>` fallback을 가집니다.
- `homepage-live-overrides.js`는 실제로 `photo-slots.js`에서 메인에 연결되며, fetch 실패 시 정적 홈페이지를 유지합니다.
- 내부 업무앱의 인증·권한·중요 mutation은 Supabase/Auth/RLS/DB 검증을 사용하며 Phase 1A 통합검사로 검증됩니다.
- `dashboard-shell.js`가 역할 결정 후 핵심 메뉴를 직접 생성하므로 직원관리·신규직원·공지·안내·가입승인 등의 존재 자체는 후처리 모듈에만 의존하지 않습니다.

## P1 FIX

1. 모바일 No-JS navigation
   - 기본 CSS에서 모바일 구간의 `.desktop-nav`는 숨겨지고 `.mobile-nav`도 닫힌 상태가 기본입니다.
   - JavaScript가 실패하면 모바일에서 주요 페이지 navigation을 열 수 없습니다.

2. 과거 개소식 announcement
   - 일부 정적 HTML에 `2026.08.12` 개소식 안내가 남아 있고 `site.js`가 날짜로 숨깁니다.
   - JS 실패 시 지난 안내가 다시 노출될 수 있습니다.

3. Fresh content 정적 fallback
   - 메인 활동 기록, archive 목록, activities 목록, workplace 이야기 목록 등이 빈/hidden 컨테이너에서 시작하고 JS가 전체 내용을 생성합니다.
   - 배포 시점 마지막 승인 콘텐츠를 정적 fallback으로 남겨야 합니다.

4. 공개 이미지 예산
   - 실제 메인에 사용되는 `assets/images/business/environment-cleanup-group.webp`가 502,610 bytes로 일반 공개 이미지 200KB 기준을 초과합니다.
   - 사용 중 공개 이미지 기준 자동 용량 검사를 추가해야 합니다.

5. 내부앱 실패 상태
   - `app-ui.js`의 일부 feature module 로드 실패가 사용자에게 명확한 오류로 집계되지 않을 수 있습니다.
   - `dashboard-shell.js`는 일정/공지 RPC 실패를 빈 배열로 바꿔 실제 empty 상태와 구분하지 못합니다.
   - 중요 메뉴 클릭이 의존 모듈 실패 시 조용히 무반응이 되지 않도록 error/retry 상태가 필요합니다.

## P2 / REVIEW

- `dashboard-shell.js`와 `official-channel-links.js`에 공식 채널 생성 책임이 중복되어 있습니다. 후자는 compatibility fallback이지만 장기적으로 source of truth를 하나로 줄이는 편이 안전합니다.
- `role-navigation-priority.js`가 메뉴 순서/섹션을 후처리합니다. 핵심 메뉴 존재는 shell에서 보장되지만 안정된 메뉴 순서·분류도 가능한 범위에서 shell 쪽으로 수렴하는 것이 좋습니다.
- 공개 페이지 footer의 `오시는 길` 등 항목이 페이지별로 완전히 일치하지 않으며 현재 CI는 navigation 존재 중심이고 footer 순서/일치 검사가 부족합니다.
- Public/Phase1A workflow가 PR 중심이며 저장소 branch protection/ruleset은 현재 없습니다. 프로세스 규칙은 main 직접 수정을 금지하지만 GitHub가 기술적으로 강제하지는 않습니다.
- 오래된 Draft PR #30/#57은 현재 source of truth와의 관계를 확인 후 정리할 필요가 있습니다. #112는 별도 급여 Accuracy MVP 흐름이므로 임의 종료하지 않습니다.

## 현재 Draft PR #116 감사

- 최신 main의 표준 문서 적용 커밋보다 뒤에 있어 병합 전 동기화가 필요합니다.
- 관리자 `작업 매뉴얼`을 원본 메뉴에서 제외하지 않고 `role-navigation-priority.js` 후처리로 제거하는 현재 방식은 B2/C6 방향과 맞지 않습니다. 원본 `dashboard-shell.js`에서 생성하지 않는 방식으로 바꿔야 합니다.
- 새 회귀 테스트 `tests/mobile-app-shell-cleanup.test.js`는 현재 Phase 1A workflow의 실행 목록에 포함되어 있지 않습니다. CI에 명시적으로 연결한 뒤 재검증해야 합니다.

## 원칙

정상 동작하는 구조를 표준 준수만을 이유로 전면 재작성하지 않습니다. P0/P1부터 작은 Issue/PR 단위로 고치고, P2는 실제 유지보수 비용과 위험을 보고 순차 정리합니다.
