# #387 — 0.1.2 Closed Testing 서버 hardening

상태: 구현·격리 CI 검증 후보. 운영 적용/병합/Play 제출은 수행하지 않음.
기준: #387, #368 독립감사, docs/planning/GOAL_375_MOBILE_SELF_PROFILE_V1.md.
시작 기준 main: b17e72aa115448ffe440d287f4f2f1934d8c6bf7. 작업 중 #401이 반영되어 최종 검증은 최신 origin/main 02302f47을 병합한 head에서 수행한다. CI 실행 위치 충돌만 해결했고 #401 모바일 diff는 없다.

## 읽기 전용 운영 점검 — 2026-10-07

운영 대상은 CURRENT_PLATFORM_STATUS의 jgsxpdflgkqroecfjzxq(표시 이름 taejang-phase1-staging)다. migration history는 다른 프로젝트 소유 항목도 포함한다.

- notification_push_foundation(20260918133000)은 적용되어 있고 실제 private_claim_notification_push_batch는 body = notice.title인 이전 정의다.
- goal_371_notice_push_lock_screen_privacy와 goal_375_self_profile_contact_requests는 history에 없고 private_active_employee_for_profile도 없다.
- profiles/people/employees/account_person_links의 컬럼과 private_employee_scope_allowed / private_team_lead_department 정의를 읽었다. 본 작업은 직원 레코드나 비밀값을 읽지 않았다.
- 월별 문서·홍보 관련 이후 migration은 별도 운영 타임스탬프로 적용되어 있다. remote version과 repo filename이 일치한다고 가정하지 않는다. shared project의 foreign migrations를 repair/delete/reset하지 않는다. 일괄 db push --include-all은 사용하지 않는다.

## 운영 적용 후보 — 정확한 파일 순서

독립검수·명시적 DB apply 승인 이후에만 다음 source를 순서대로 적용한다.

1. supabase/migrations/20260925072012_goal_371_notice_push_lock_screen_privacy.sql
2. supabase/migrations/20260925135506_goal_375_self_profile_contact_requests.sql
3. supabase/migrations/20261007073309_issue_387_self_profile_scope_hardening.sql

#371은 기존 claim 함수의 display body만 바꾸며 service-role privilege와 urgent ordering, exact opaque notice id/version, active guards와 lifecycle은 그대로다. 추가 push corrective migration은 필요하지 않다.
#375 원문은 변경하지 않았다. #387 corrective는 CREATE OR REPLACE 기반이며 데이터 backfill, role grants, 신규 contact field가 없다. #375가 이미 적용된 환경에서는 #387만 추가할 수 있다. #387 재실행은 동일 정의로 수렴하지만 #375의 CREATE TABLE/함수 rename은 재실행하지 않는다.
새 #387 타임스탬프는 CLI 생성값이며 기존 20261007123000 홍보 보관 migration보다 앞에 정렬된다. 두 migration은 서로의 함수/테이블에 의존하거나 덮어쓰지 않는다.

**#375만 적용하고 멈추면 안 된다.** 아직 미적용인 운영 환경에서는 #375 및 corrective의 SQL 본문을 한 DB transaction에서 검토·적용해 취약한 중간 RPC가 외부에 commit되지 않게 한다. 각 파일의 바깥 begin/commit을 제외하고 하나의 transaction으로 묶는 적용 산출물과 source-to-history 기록 방식은 DB Human Gate에서 검토한다. 과거 repo migration이나 기존 remote history를 고쳐 맞추지 않는다. 실행 직전 migration history/현재 함수 drift를 다시 읽고, 예상 밖 기존 객체가 있으면 중단한다.

적용 후 isolated TEST 계정으로 archived/revoked/scoped/self approval/privacy를 재확인한다. 이 문서는 운영 apply 명령을 실행하지 않는다. 문제가 생기면 self-profile/contact endpoints를 차단하는 forward correction을 검토하고 취약한 #375 정의로 rollback하지 않는다.

## AAB 및 Human Gate

- mobile/ diff 없음. versionName 0.1.2 / versionCode 3 유지. **versionCode 3 AAB 재사용 가능**(이번 변경의 binary 영향 기준).
- 새 AAB 생성, 업로드, Play 다음/저장/검토 제출/게시 없음.
- profile foreground freshness는 #378 carry-forward. 급여명세 #374/#384는 완전 제외.
- 다음 순서: Draft PR 독립검수 → 사용자 merge 승인 → 별도 운영 DB apply 승인 → 운영 read/RPC·push 실기 검수 → Play Console Alpha의 기존 versionCode 3 draft를 사람이 검토·제출.
- 실제 Galaxy foreground/background/killed/잠금화면·tap, dispatcher 운영 secret/config/deploy 상태, Play track 및 제출은 Human Gate다. DB-only CI로 실기기 수신 성공을 주장하지 않는다.

## 검증

로컬: git diff --check, mobile typecheck, mobile contract 58, platformStatic 515, stagingSafety, employee/notification static 계약 통과.
Docker/Podman이 없어 로컬 clean reset·lint·pgTAP·Auth는 실행 불가. PR exact-head GitHub CI에서 격리 clean migration/reset/schema lint/전체 pgTAP/Goal375 Auth scope·archived/notification lifecycle/Phase1A를 검증한다. CI 결과는 최종 PR 기록을 기준으로 한다.
