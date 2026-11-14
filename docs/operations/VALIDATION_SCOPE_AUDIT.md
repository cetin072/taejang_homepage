# 검사 실행 범위 점검 — 2026-11-15

## 확인 범위

기준 main `86f296e6a93545310c285c319ec12b887de22de2`. GitHub Actions 26개 설정의 트리거·실행 명령, package.json의 명령, 공통 테스트 목록, 검사/배포 스크립트의 프로세스 실행·재시도·대기, app/staff/assets의 검사 명령 포함 여부를 확인했다. 전체 업무 로직의 기능별 재설계나 모든 브라우저 사용자 흐름 검증을 완료했다는 의미는 아니다.

## 수정

- Phase1A의 문서 외 전체 실행 조건을 공유 변경 분류기로 교체했다. PR은 merge-base, main push는 before..after를 비교한다. 삭제·이름변경·혼합 변경도 포함한다.
- 검토된 공개 HTML·CSS·이미지·전용 테스트 변경은 공개 회귀 및 PC/모바일·배포 프리뷰 검사를 실행한다. 문서 변경은 무거운 브라우저·DB 작업을 적용 제외한다.
- 알려지지 않은 경로, 공유 JS, 실행 가능한 문서(.gs 등), 빌드·의존성·CI·플랫폼 변경과 수동 실행은 전체 검사를 선택한다. 판정 실패도 전체 검사로 처리한다.
- 홍보 workflow에서 공개 홈페이지 변경 시 직원·근태·공지·편집기 검사를 실행하지 않는다. 공개 랜딩 검사는 유지한다.
- 동일 로컬 홍보 브라우저 명령의 소유자를 UAR로 통일했다. UAR의 동일 프리뷰 명령은 한 번 통과한 결과를 재사용한다. 로컬과 프리뷰는 별도로 검증한다.
- 만료된 2026-10-22 일회성 운영 배포 workflow의 자동 실행 진입점을 삭제했다. 당시 스크립트·승인 검증 테스트는 기록으로 보존한다.
- 공개 UAR는 배포 상태뿐 아니라 같은 HEAD의 공개 정적·공개 브라우저·실제 프리뷰 검사 3개가 모두 성공해야 통과한다. 실패·취소·생략·다른 커밋·다른 제공자·미완료 결과는 수용하지 않는다.
- 공개 블로그 카드 검사는 내부 홍보 검사에서 공개 랜딩 검사로 옮겨 공개 HTML 변경에서도 계속 실행한다.
- 급여 및 물류 workflow에 중복된 공개·플랫폼·staging 검사는 기존 담당 workflow에 맡기고 각 기능의 전용 검사와 빌드는 유지한다.
- 모바일 CI 3곳의 lockfile 삭제·재생성을 제거하고 커밋된 lockfile의 `npm ci`를 사용한다. 모든 직접 의존성의 잠금 버전 일치를 검사했다. CI가 매번 새로운 간접 버전을 선택하지 않는다.
- PR 양식의 “workflow를 수정하지 않음”이라는 일률적 체크를 변경 영향·검사 선택 확인으로 바꿨다.

## 유지한 동작과 한계

- 배포 상태 조회와 네트워크 복구의 유한 대기는 실제 외부 응답을 기다리는 용도다. 성공 판정이나 타임아웃 수치는 완화하지 않았다.
- 수동 운영·DB 작업, 예약 푸시/아카이브/배포 작업에는 각 업무 목적과 승인 경계가 있다. 자동으로 불필요하다고 분류하지 않았다.
- 공개 정적 검사는 공개 및 전체 변경에서 배포 산출물 경계를 함께 확인한다. 문서 변경에서는 적용 제외한다. 복잡한 파일별 테스트 자동 추론기는 추가하지 않았다.
- 공유 변경과 미분류 경로는 여전히 전체 검사다. 이 분류기 자체를 바꾸는 PR도 전체 검사가 필요하다.
- 기존 #687의 직원 캘린더 CI 실패 근본 원인은 이번 변경으로 해결됐다고 주장하지 않는다. 검사 설정 PR의 원격 통합검사 결과를 별도로 확인해야 한다.
- 제품 실행 영역 `app/`, `staff/`, `assets/`, `mobile/src/`, `netlify/`에서는 테스트 실행 명령이나 child_process 호출을 찾지 못했다. 화면 갱신용 observer·timer는 실제 기능과 연결되어 있으므로 존재만으로 불필요하다고 삭제하지 않았다. 이번 전수 점검은 실행 명령·검사 연결 구조이며 전체 업무 기능의 재설계를 뜻하지 않는다.

## 전체 workflow 목록

| 설정 | 실행 범주 |
| --- | --- |
| `chat-approved-production-release.yml` | 운영·예약 실행 |
| `community-esg-qa.yml` | 경로 제한 |
| `fingerprint-xls-browser-qa.yml` | 경로 제한 |
| `hero-article-qa.yml` | 공통 검사 |
| `homepage-about-photo08-qa.yml` | 경로 제한 |
| `logistics-workspace-checks.yml` | 경로 제한 |
| `minhwa-landing-qa.yml` | 경로 제한 |
| `mobile-app.yml` | 경로 제한 |
| `monthly-client-document-render.yml` | 경로 제한 |
| `notification-push-schedule.yml` | 운영·예약 실행 |
| `notification-push.yml` | 경로 제한 |
| `official-archive-sync.yml` | 운영·예약 실행 |
| `official-archive-thumbnails-qa.yml` | 경로 제한 |
| `payroll-attendance-accuracy.yml` | 경로 제한 |
| `payroll-hosted-staging-e2e.yml` | 수동 실행 |
| `phase1a-supabase-integration.yml` | 공통 검사 |
| `production-release.yml` | 운영·예약 실행 |
| `promotion-browser-qa.yml` | 공통 검사 |
| `public-homepage-checks.yml` | 공통 검사 |
| `qa-account-preview-staging-deploy.yml` | 경로 제한 |
| `scheduled-release-checks.yml` | 경로 제한 |
| `staging-first-super-admin.yml` | 수동 실행 |
| `staging-migration-history-reconcile.yml` | 수동 실행 |
| `staging-notice-300.yml` | 수동 실행 |
| `user-acceptance-ready.yml` | 공통 검사 |
| `taejang-emergency-one-off-20261022.yml` | 만료된 실행 진입점 삭제 |
