# 태장 업무플랫폼 현재 운영 상태

마지막 확인일: **2026-09-02 (KST)**

이 문서는 다음 Work/Codex가 현재 상태를 빠르게 복구하기 위한 **현재 상태 중심 기록**이다. 상세 과거 이력은 GitHub Issue/PR 기록을 기준으로 확인한다.

## 1. 현재 기준 코드와 작업

- 기준 `main` SHA: `51859fb5f4f8fa51320d92052f3fe489049ac257`
- `main` 반영 완료: Issue #90 / PR #92 — MVP v1 제한 시범운영 준비
- 현재 작업 Issue: #94 `platform: implement promotion + homepage publishing MVP`
- 승인 계약: Issue #95 `planning: approve Phase C promotion data, RLS, RPC, and publication contract` — 사용자 승인/closed
- 현재 작업 브랜치: `codex/issue-94-promotion-publishing-mvp`
- 현재 Draft PR: #96 `feat: Phase C promotion publishing MVP foundation`
- 상위 장기 목표: Issue #89
- 공개 홈페이지와 내부 업무플랫폼의 보안·장애 경계는 계속 유지한다.

## 2. Production 상태 — 변경 금지 유지

- Netlify Production 현재 배포는 기존 상태 그대로다.
- site id: `9caa5a1a-f86d-4a9f-aed4-f560e1c2101f`
- current deploy id: `6a96fc697413e300082b1760`
- state: `ready`
- Production `main` 기준: `51859fb5f4f8fa51320d92052f3fe489049ac257`
- Issue #94 작업으로 Production Supabase, Netlify Production, 실제 사용자 계정·권한은 변경하지 않는다.
- PR #96은 계속 Draft 상태를 유지한다. Ready for review, main merge, Production 배포는 사용자 승인 gate다.

## 3. Supabase staging

- project: `taejang-phase1-staging`
- project ref: `jgsxpdflgkqroecfjzxq`
- Production Supabase는 변경하지 않는다.
- Phase C Contract v1 범위의 migration/RLS/RPC는 staging TEST-only로 적용·검증한다.

### 적용 확인된 Phase C migration

1. `20260902024950_phase_c_promotion_publishing.sql`
2. `20260902100857_phase_c_export_scheduled_candidate.sql`
3. `20260902111344_phase_c_workspace_detail.sql`
4. `20260902112106_phase_c_public_media_allowlist.sql`
5. `20260902113822_phase_c_review_stage_action_guard.sql`
6. `20260902114231_phase_c_internal_review_read_boundary.sql`

### Phase C staging 현재 상태

- `[TEST-C]` 홍보직원·홍보팀장·운영총괄·대표이사 TEST identity 4개는 cleanup 후 `pending`, active role 0 상태다.
- promotion content / revision / review / publication queue TEST row는 0건으로 정리돼 있다.
- 실제 사용자 계정·역할은 변경하지 않았다.
- `promotion_review_requests`, `promotion_publication_queue`의 authenticated direct `SELECT`는 차단했다. 브라우저는 guarded workspace RPC를 사용한다.
- 내부 review-stage guard는 authenticated 직접 실행 불가다.

## 4. 실제 사용자 계정 상태

- 김형철 시스템 최고관리자: 기존 검증 기록상 `active`; 역할은 `super_admin`, `operations_manager`; 부서는 `operations`, 직책은 `operations_manager`다. 이 상태를 보존한다.
- 이영희 대표이사: 계정 미생성.
- `apply_bootstrap`, `bootstrap_super_admin` 재실행 금지.
- 실제 `profiles`, `profile_roles` 직접 수정 금지.
- 실제 사용자에게 TEST/QA 표기를 붙이거나 자동 생성하지 않는다.

## 5. Phase C 구현 완료 범위

### 홍보직원

- 새 콘텐츠 작성, 임시저장, 승인 요청
- 기존 draft 상세 열기·수정
- 보완 후 기존 제출본을 덮어쓰지 않는 새 revision 저장
- 직원용 미리보기
- 사람 사진 / 숫자·금액 `있음 / 없음 / 잘 모르겠음`
- 중요도·승인선은 직원이 직접 선택하지 않음
- PHOTO 01~11 + 최근 활동 대표사진의 게시용 선별 URL 연결

### 홍보팀장

- 홍보 검토 queue
- 승인 / 보완 요청 / 운영총괄 상신
- 시스템 최소 승인 단계 하향 금지
- 최종 승인 콘텐츠의 홈페이지 발행 대기 등록
- generic 관리자 권한과 promotion 승인권을 자동 혼합하지 않음

### 운영총괄

- 중요 홍보 승인 queue
- 승인 / 보완 요청 / 보류 / 대표이사 상신
- 대표이사 상신 시 핵심 요약·확인 이유·운영총괄 의견 입력

### 대표이사

- 실제 상신된 콘텐츠만 검토 queue에 노출
- 승인 / 보완 요청 / 보류 / 반려
- 일상 편집·팀장 역할·계정관리 권한을 자동 부여하지 않음

### 데이터·보안

- `promotion_contents`
- immutable `promotion_content_revisions`
- `promotion_review_requests`
- `promotion_publication_queue`
- 중요한 상태 전이는 security-definer RPC + 서버 검증 + audit
- lead는 `hold/reject` 불가, operations는 `reject` 불가하도록 DB guard 추가
- public media JSON은 `url`, `slot`, `kind`, `alt` 외 임의 내부 필드 삽입을 거부
- 내부 승인 이력·approver id/comment·publication queue metadata는 브라우저 direct table read 차단

### 공개 결과 경계

- 최종 승인된 특정 revision만 publication queue 진입 가능
- service-role 전용 allow-list export candidate
- 내부 source link / 승인정보 / 감사정보 / 위험체크는 export 제외
- checksum 검증과 staged/atomic replace 원칙 유지
- `/promotion-preview/` Deploy Preview 전용 공개 결과 검증 경로 추가
- Production hostname에서는 TEST preview 렌더링 금지

## 6. 독립 검증 결과

- 최신 PR #96 HEAD 기준 GitHub Actions `Phase 1A Supabase Integration` run `33626087697` 성공
- `Migration, pgTAP, Auth and RLS` 전체 job 성공
- clean DB migration 재적용 성공
- DB lint 성공
- pgTAP 성공
- 실제 Auth/Data API 통합 회귀 성공
- Netlify Deploy Preview status 성공
- Deploy Preview: `https://deploy-preview-96--taejang-homepage.netlify.app`
- PR #96 mergeable 유지
- PR review thread 현재 0건

### Supabase security advisor 점검

- Phase C의 browser-facing security-definer RPC 경고는 각 RPC 내부 role/active 검증을 전제로 한 의도된 노출이다.
- Phase C 내부 helper 중 browser가 직접 호출할 필요가 없는 함수는 EXECUTE를 축소했다.
- 기존 Phase 1 계열 advisor 경고는 #94 범위에서 대규모 수정하지 않는다.
- 기존 `private_enforce_published_work_guide_assignment()` 등의 Phase 1 경고는 별도 보안 정리 대상으로 남긴다.

## 7. 아직 사람 승인 없이 하면 안 되는 작업

- PR #96 Ready for review 전환
- main merge
- Netlify Production 배포
- Production Supabase migration/data 변경
- 실제 사용자 생성·승격·정지·퇴사·역할 변경
- 실제 민감정보 입력
- 새 외부 서비스 또는 유료 API 도입
- Phase D 자동 시작

## 8. 다음 작업 판단

현재 Phase C 최소 MVP는 Draft PR #96 안에서 구현·staging 검증·CI·Deploy Preview까지 진행된 상태다.

다음 단계는 기획방 독립 최종검수 후 **Ready for review 전환 여부**를 사용자에게 묻는 human gate다. Ready 전환 전 추가 blocker가 발견되면 같은 branch/PR에서 수정한다.

## 9. 다음 Work 필수 확인 순서

1. `AGENTS.md`
2. `PROJECT_CHARTER.md`
3. Issue #89
4. Issue #94
5. Issue #95
6. Draft PR #96
7. 이 문서
8. Issue/PR이 직접 참조하는 승인 planning 문서

비밀번호, Service Role Key, DB password, Management PAT 등 실제 secret은 문서·GitHub·채팅에 기록하지 않는다.
