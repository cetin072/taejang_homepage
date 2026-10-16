# 2026-10-16 실제 오류 재확인 / #448 업데이트

최신 main `53510bacf9da7db1e3bd6ec861e3c96c63bc121e`의 #462/#464를 통합했다. #458(7일 기본 종료)은 별도 Draft로 유지하며 중복 도입하지 않는다.

- Production과 고정 QA의 public staff-config GET에서 같은 DB `jgsxpdflgkqroecfjzxq` 연결을 재확인했다. Hosted catalog에서 save_lead_notice/필드·이력이 없는 것을 확인했으며, 읽기 전용 GET API에서도 HTTP404/PGRST202가 반환됐다. 실패 화면 당시 실제 POST network 기록은 없으므로 그 시점 payload 전체의 다른 문제까지 단정하지 않는다.
- 2026-10-19 09:00 KST 재현 조건의 무사진 초안/예약은 합성 준비된 서버에서 정상이다. 필수 사진 규칙을 추가하지 않았다. 실제 서버 누락을 UI·승인 우회로 해결하지 않는다.
- app.request는 서버 code/status를 보존한다. 공지에서 missing RPC를 명시하고 입력/예약/사진을 유지한다. 초안 저장 후 최종 RPC가 사라진 경우도 '초안 저장 / 게시 실패'로 구분한다. 네트워크 응답 불명은 기존 재조회·중복방지 계약을 유지한다.
- 기존 대상 선택기는 복원하지 않는다. 새 company 공지 전체 경로가 막혀 있음을 안내하고, 기존 scoped 초안만 저장된 대상을 유지해 관리한다. 정책 오류는 권한/승인/상태에 맞게 안내한다.
- 운영 DB 적용은 아직 금지된 범위다. 따라서 코드/격리/Preview PASS와 실제 운영 저장 해결은 구분한다. 실제 운영의 근본 해결에는 기존 #447 migration의 별도 승인·적용·readback이 필요하다.

아래 2026-10-13 배포/DB 관찰과 당시 CI는 역사 기록이다. 현재 Production SHA나 릴리스 PR 상태로 해석하지 않는다. 최신 정확 HEAD의 검증 결과는 #448 완료 코멘트를 따른다.

# 직원 공지 운영 전환 준비 / 2026-10-16 갱신

상태: 개발·격리 검증 PASS / 실제 운영 전환 BLOCKED. 사용자 별도 승인 전 Hosted 적용·배포·실직원 테스트 금지.

기준 main: `0c2a6265eb3768d5135bc2a12f4b891d80a74171` (#447 병합). 작업 브랜치: `codex/notice-operational-readiness`.
확정 기획: [일반 근로자 정보게시판](../planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md)의 #444/#446 항목, [Issue #446](https://github.com/cetin072/taejang_homepage/issues/446), 현재 사용자의 운영 전환 통합 검수 지시. Supabase Free 유지, 별도 프로젝트/유료 branch 미생성.

## 1. 정기 배포 위험 — 우선 해결할 운영 gate

읽기 전용 확인:

- Netlify 실제 Production ready deploy `6ac7497e9319d40008d05b60`, SHA `d99a370d5546620f420efe7d9b24f4f34acd4c18`, 게시 시각 `2026-10-08T07:43:05.821Z`. production.json의 기록 시각과 실제 게시 시각은 다르므로 실제 published_deploy를 함께 기준으로 사용한다.
- 현재 main에는 #445/#447 웹 작성기와 `save_lead_notice` 호출이 있다. 운영 DB에는 이 함수와 `lead_notice_mode`/`lead_direct_published_at`이 없다. 48시간은 migration 적용을 보장하지 않는다.
- production-release.yml은 매일 00:20 UTC에 계획을 평가하며 48시간/일일1회 제한을 적용한다. 배포 입력(app 포함)이 있으면 marker-only PR/정확 HEAD CI/자동 squash 순서다. DB 준비 검사는 없다.
- netlify-production-gate.mjs는 marker-only commit·parent 일치만 검사한다. 일반 main 병합은 Production을 직접 발행하지 않지만 다음 marker 릴리스는 #447을 포함할 수 있다.
- [2026-10-13 실행](https://github.com/cetin072/taejang_homepage/actions/runs/38358898218)은 현재 main을 READY로 계획한 뒤 기존 [릴리스 PR #437](https://github.com/cetin072/taejang_homepage/pull/437) 때문에 OPEN_RELEASE_PR로 종료했다. #437은 오래된 base/head이며 autoMergeRequest=null. 열린 릴리스 PR은 우연한 차단 상태이지 DB gate가 아니다. 닫히면 이후 정기 작업이 새 릴리스를 만들 수 있다.

**운영 전환 BLOCKED:** DB 적용/readback 또는 명시 승인된 릴리스 제어 없이 현재 main의 운영 준비 완료를 선언하지 않는다. 이 작업은 예약 중지·PR #437 정리·Production 설정·릴리스 marker를 변경하지 않는다. 필요 시 사용자가 DB 적용 전 정기 릴리스 보류를 별도 승인해야 한다. 현재 코드 변경은 Draft이며 활성 배포 보호로 보고하지 않는다.

## 2. 이번 최소 보강

기존 #447 서버 정책/SQL/역할은 수정하지 않는다. 작성기와 기존 Playwright fixture만 수정한다.

- 정확한 HTTP404 + public.save_lead_notice schema-cache missing 오류일 때 직접 경로가 준비되지 않았음을 표시한다. 입력·대상·사진을 보존하고 자동 legacy 재쓰기/대상 변경/게시 재시도를 하지 않는다.
- 해당 화면 세션에서 직접 게시 버튼을 숨긴다. 최신 #462의 전체 직원 자동 대상 UI를 유지한다. 이미 존재하는 부서/작업반/개인 초안은 저장된 대상을 그대로 사용해 원래 save_notice(draft)→사진→운영총괄 상신을 사용할 수 있다. 새 전사 공지를 다른 대상으로 몰래 바꾸지 않는다. company는 기존 RPC로 우회하지 않는다. 서버 준비 후 화면을 다시 열어 정상 경로를 사용한다.
- 기존 DB의 목록에는 can_lead_edit가 없다. 표시가 아예 없는 구 응답의 비상신 초안만 기존 편집 경로를 유지한다. 명시 false/상신/검토/게시 이력은 잠금을 유지하며 서버가 최종 판정한다.
- 네트워크/권한/일반404 오류는 missing RPC로 간주하지 않는다. 응답 불명 fail-closed 및 파일 삭제 중단 계약을 그대로 사용한다.
- 미지원 DB를 사전에 알아내는 새 서비스·RPC·OpenAPI 탐색을 추가하지 않았다. 첫 직접 요청은 실패할 수 있지만 성공/비공개 저장을 거짓 안내하지 않는다. 이는 준비 완료 표시나 DB gate를 대신하지 않는다.

재현: 원 코드에서 missing RPC 안내 검사 FAIL → 보강 후 PASS. 기존 draft/사진/게시/예약/상신/운영총괄/직원 렌더러 및 320/390/1280 fixture를 재사용한다.

## 3. 직원 앱 새 공지의 정확한 의미

서버 get_my_notice_list의 is_new는 `publish_start_at >= now() - interval '7 days'`다. 직원 대상·게시 상태·시작/종료 조건은 기존 guarded RPC/RLS가 판정한다. #447은 직원 read RPC/ack/outbox를 변경하지 않았다. Hosted 함수에서도 7일 계약을 읽기 확인했다.

| 항목 | 현재 구현 / 검수 범위 |
| --- | --- |
| 최근 게시 표시 | 홈 NoticeHomeAction은 is_new 또는 미확인 중요공지에 빨간 점과 건수를 표시. 목록은 is_new에 '새 공지'를 표시 |
| 실제 미열람 여부 | 일반 공지는 읽음 이력이 없으므로 미열람 표시가 아님. 홈 변수 unread는 실제로 최근 공지와 확인 필요의 합집합 |
| 열면 표시 제거 | 일반 공지를 열어도 7일 동안 새 공지 표시 유지. 새 읽음 이력/확인 의무를 추가하지 않음 |
| 앱 복귀 | 실제 사용 중인 홈/공지 목록은 mount와 AppState active에서 기존 조회 RPC를 호출. 캐시는 user별이며 완료된 짧은 조회가 오래된 넓은 목록을 퇴출 |
| 구 NoticeListCard | 새 공지 메타와 수동 새로고침이 있음. 실제 공지 목록 route는 별도 AppState 갱신을 사용 |
| 제목·본문·사진 | 상세 RPC 텍스트가 먼저 표시되고 signed image 요청은 독립. 사진 실패가 본문을 지우지 않음 |
| 푸시 | OS 권한/토큰/네트워크/백그라운드 전달에 의존. push 수신과 앱 active 재조회·새 공지 표시는 서로 다른 경로이며 수신 보장으로 보고하지 않음 |

소스/자동 회귀로 위 계약을 확인했으며 실제 Android 알림 수신·실직원 화면·실기 복귀 조작은 미실행이다. 일반 공지의 실제 미열람 배지를 원하면 별도 읽음 정책으로 후속 판단한다.

## 4. Hosted 읽기 전용 사전 점검

대상 `jgsxpdflgkqroecfjzxq`는 이름과 무관하게 운영·QA 공유 DB다. 실행한 쿼리는 pg_proc, information_schema, pg_class, schema_migrations, 공지 총수 SELECT뿐이며 DDL/DML/사용자 계정 조회·테스트 데이터 생성은 하지 않았다.

관찰값:

- notices 7행. notices/notice_media/information_publication_requests RLS=true.
- #446 history version 없음, 필드2개 없음, save_lead_notice 없음.
- history 총289행, #300 및 기존 read/승인/Storage 기초 함수 존재. 다른 앱 migration도 공존하므로 현재 main과 원격 전체 version의 단순 차이를 미적용으로 해석하지 않는다.
- [Issue #306](https://github.com/cetin072/taejang_homepage/issues/306)은 closed. 마지막 결정은 의도된 foreign migration 보존이며 재수리/일괄 repair/재실행을 승인한 것이 아니다.

적용 직전 다음 함수 정의 MD5와 signature를 다시 비교한다. 아래 값이 다르면 적용 중단 후 차이를 검토한다.

| 함수 | 적용 전 md5(pg_get_functiondef) |
| --- | --- |
| save_notice | ee218772140be9d3a4e9e18f4bbb23a1 |
| current_user_can_manage_notice | 7f74f1301349240aa61ef4d97ffcc0fb |
| list_manageable_notices | 862e8c85ca2269df06392e013afb5e44 |
| submit_notice_for_operations_review | 2a8d9679b42b0fb371aa59b9b47ea833 |
| private_save_notice_pre280 | 17d99454f5469317581056d71bb74a02 |
| get_my_notice_list (불변) | efc2770ae4fdeaf7e0973ff053265a3f |
| get_my_notice_detail (불변) | a7bce1506da44c24be230ea7775889de |

핵심 helper current_profile_is_active/current_user_has_role/private_actor_can/current_user_can_manage_today_target/private_notice_is_current/today_target_matches_current_user 존재 확인. private 함수 ACL은 postgres만, 직원 read RPC는 authenticated만 실행, search_path는 빈 값이다. 이 사전 상태는 백업 완료를 뜻하지 않는다.

## 5. 승인 후 적용할 정확한 SQL과 순서

**이 절은 실행 계획이며 적용 승인이 아니다.**

원본 SQL은 병합 SHA에 고정된 [20261013042347_issue_446_lead_routine_notices.sql](https://github.com/cetin072/taejang_homepage/blob/0c2a6265eb3768d5135bc2a12f4b891d80a74171/supabase/migrations/20261013042347_issue_446_lead_routine_notices.sql) 전체다. Git blob LF UTF-8 SHA256:
`bb2960dd86a51b1999ff01afa036341f170d4d34ce7f4a809bcdf23652882cfe`.
Windows checkout CRLF 파일 해시와 구분한다. 원본은 begin/commit을 포함하고 컬럼→helper/권한→기존 core 교체→기존 RPC rename/revoke→guarded RPC→submit/view/list 순서다. 함수 rename은 재실행 가능하지 않으므로 1회만 적용한다.

실제 실행용 검토 bundle은 원본의 마지막 `commit;` 앞에 아래 신규 이력 INSERT만 추가한다. 다른 본문/과거 이력은 바꾸지 않는다. #300 선례처럼 DDL과 신규 이력 한 행이 같은 트랜잭션에서 commit되도록 한다.

```sql
insert into supabase_migrations.schema_migrations(version,name)
values ('20261013042347','issue_446_lead_routine_notices');
commit;
```

검토 bundle LF UTF-8 SHA256: `e6c72a6f3e4815215263103965ea7776bbdf2a7b2715ba23ea43bc598dfc4587`. 이 검토 bundle은 로컬에 준비만 했으며 미실행이다. 적용 시 승인된 환경/파일/해시를 다시 확인하고 ON_ERROR_STOP이 활성화된 단일 DB 연결에서 실행한다. 일반 db push, migration up, 전체 pending 실행, 과거 history repair는 금지한다. 기존 version 충돌/필드 존재/rename 대상 변경이면 즉시 중단한다. 이력 기록을 별도 commit하거나 ON CONFLICT로 덮어쓰지 않는다.

승인 후 operator 절차:

1. 실제 Production SHA와 현재 DB inventory를 새로 읽고 대상 ref를 이중 확인한다. 환경 Free 유지. 쓰기/DDL 시간창·릴리스 순서는 운영자와 확정한다.
2. 안전한 접근 위치에 현재 관련 함수 정의/ACL/RLS/Storage policies 및 공지·사진 metadata·상신·승인/감사·버전 상태를 백업한다. Storage 원본은 삭제/교체하지 않는다. 백업은 민감 자료이므로 공개 GitHub에 올리지 않는다. Free 플랜의 자동 백업 기능이 있다고 가정하지 않는다.
3. 위 MD5/signature, version 부재, 필드 부재, 원본/bundle SHA를 검증한다. 잠금 대기 제한과 오류 시 트랜잭션 rollback을 설정한 검토 실행기로 정확히 1회 적용한다.
4. 함수/ACL/RLS/필드/신규 version readback. 기존 직원 read RPC MD5가 그대로인지 확인한다. 공지 행/본문/사진/상신·승인·버전/감사 snapshot의 실제 값 보존을 대조한다. 새 필드는 기존 행 모두 NULL이어야 한다. 서버 소유 출처를 과거 행에 backfill하지 않는다.
5. 공개 API schema-cache 갱신 여부와 정확한 새 RPC signature 노출을 읽기 확인한다. 지연 시 배포/쓰기 검사 중단; DBA의 공식 cache reload 조치도 필요한 운영 승인 범위에서 처리한다.
6. 운영팀장 연결 확인은 읽기부터 시작한다. 실제 저장·게시·상신 테스트 데이터 생성은 별도 승인된 계정/대상/정리 정책이 있을 때만 수행한다.
7. readback 통과 후 사용자 승인된 코드/호환성 PR을 병합하고 기존 48시간 릴리스 정책의 웹 반영을 진행한다. 이 작업은 force 배포나 marker 조작을 하지 않는다.
8. 고정 QA exact SHA/DB 연결을 확인한 뒤 실제 Android/직원 수용 검수. 게시/상신/예약/새 공지 표시와 정책상 최근7일 표시의 의미를 확인한다.

사후 읽기 검사 예시:

```sql
select version,name from supabase_migrations.schema_migrations where version='20261013042347';
select count(*) as legacy_rows,
 count(*) filter(where lead_notice_mode is not null or lead_direct_published_at is not null) as changed_legacy_metadata
from public.notices; -- 적용 직후/운영 쓰기 전 changed_legacy_metadata=0
select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='notices'
 and column_name in ('lead_notice_mode','lead_direct_published_at');
select p.proname,pg_get_function_identity_arguments(p.oid),p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('save_lead_notice','save_notice','private_save_notice_before446','private_notice_lead_actor',
  'private_notice_is_routine','private_notice_write_target','list_manageable_notices');
```

save_lead_notice는 authenticated만 실행 가능해야 한다. 내부 helper/old writer는 PUBLIC/anon/authenticated 실행 불가, 직접 테이블 UPDATE/DELETE 권한은 없어야 한다. 기존 Storage policies와 current_user_can_manage_notice OID 연결을 유지한다. 기대값은 [pgTAP](../../supabase/tests/database/lead_routine_notice.test.sql)과 [Auth integration](../../tests/notice-review-media-auth-integration.mjs)를 따른다.

실패 대응:

- commit 이전 오류: 단일 트랜잭션 rollback, 사전 snapshot 대조, 자동 재시도 금지. 함수를 반쯤 적용하거나 이력만 기록하지 않는다.
- commit 여부 불명: version/columns/functions readback으로 먼저 확정, 파일 재실행 금지.
- commit 후/사용 전 오류: 웹 릴리스 보류, 영향과 복구 SQL 검토·승인. 자동 drop column/rename rollback 금지.
- 사용 후 오류: 신규 공지/발행 출처/감사 기록을 보존하고 승인된 forward fix를 우선한다. 예전 함수 복원이 새 출처·승인 경계를 우회할 수 있으므로 백업을 무조건 덮어쓰지 않는다.

## 6. 검증/후속 대조

이미 구현 완료: #445 작성기, #447 직접/승인 서버 경계, 사진·감사 보존, 신규 진입 통일. 이번 추가: 구 DB 호환 오류 처리/구 초안 편집 유지 + 전용 브라우저 재현 + 이 실행 계획. 새 읽음 정책/새 UI/신규 라이브러리/DB 관리 체계는 의도적으로 제외.

기준선 [#447 격리 CI](https://github.com/cetin072/taejang_homepage/actions/runs/38347789492)의 pgTAP819·공지 Auth145는 변경하지 않은 서버 소스의 증거로 보존한다. 이번 UI 수정 때문에 필요한 필수 CI가 격리 회귀를 실행하는 것은 허용하며 수동으로 같은 전체 검사를 중복 dispatch하지 않는다. 최종 HEAD CI/Preview/브라우저 결과는 후속 Draft PR과 Issue #446 완료 코멘트에 기록한다.

Issue #428 위험: Hosted Payroll workflow는 active이며 현재 pull_request paths가 남아 있다. 이번 변경 경로(app/assets/notice-admin.js, tests/browser/notice-authoring-ux-gate.html, 이 문서)는 해당 경로와 일치하지 않음을 확인했다. payroll/workflow/급여 migration 파일 변경·수동 Hosted E2E dispatch는 하지 않는다. PR 직전 실제 diff와 workflow path를 다시 대조한다.

참조: [공식 Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Supabase changelog](https://supabase.com/changelog) (현재 TLS cipher 종료 예고는 이번 SQL 변경과 무관, SDK/프로젝트 설정 변경 없음).


### 이번 구현 커밋의 검증 완료

구현 커밋 `3884e9c9fadfe69d8d846ac18157251e131b9294`:
- [격리 DB CI](https://github.com/cetin072/taejang_homepage/actions/runs/38368669110): clean replay/lint PASS, security advisors No issues found, pgTAP819 PASS, 공지 Auth/RLS/Storage145 및 전체 연관 회귀 PASS.
- [Browser](https://github.com/cetin072/taejang_homepage/actions/runs/38368668912), [UAR](https://github.com/cetin072/taejang_homepage/actions/runs/38368668979), [Public](https://github.com/cetin072/taejang_homepage/actions/runs/38368668988) PASS.
- 로컬 static543, 모바일 공지/캐시/일정10, 푸시·알림·release29, build PASS.
- Netlify `6acde9f48e4d3e07b812efeb` ready/commit_ref 구현 커밋 일치. immutable Preview runtime 경로, 작성기/구 진입 JS와 Git blob byte 일치, 320/390/1280 전체 fixture PASS.
- [브라우저 캡처](https://github.com/cetin072/taejang_homepage/actions/runs/38368668912/artifacts/11798685335). 합성 역할 테스트이며 Hosted 실제 쓰기/Android 기기 수용 검수를 뜻하지 않는다.
- Hosted Payroll 새 실행 없음. 최신 main 대비 behind0/충돌 없음 확인. 문서 정리만 후속 commit하며 웹/SQL 소스는 이 구현 커밋과 동일하게 유지한다.
