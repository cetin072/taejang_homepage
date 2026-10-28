# 개인별 메뉴 권한 — 2026-10-28 결정 및 Draft 구현

상태: **권한 모델 확정 / 구현 부분 완료 / 운영 적용 금지**.
사용자 결정: 운영총괄이 사람에게 메뉴를 허용하면 직책과 무관하게 해당 메뉴의 운영총괄 화면과 업무 권한을 갖고, 필요에 따라 회수한다. 이메일 필드만 예외로 공개하는 안은 대체되었다.

### 2026-10-28 직원 메뉴 통합 검증 완료

`587b1e9a9ba796a4bd36cbd96e3a20b7003bcb4c`의 [Phase 1A 격리 CI](https://github.com/cetin072/taejang_homepage/actions/runs/40634753479)에서 전체 migration clean reset, DB lint/security, pgTAP 및 실제 Auth/Data API 회귀가 통과했다. 합성 일반직원에게 직원 관리만 허용해 전사 조회·등록·수정, 실제 Storage 업로드/인증 GET, Vault 암호화·목적별 조회·감사, 보험 설정, Edge reserve→begin→Admin 비밀번호 변경→감사, 보관/복원을 실행했다. 회수 후 같은 JWT의 직접 RPC·Storage 업로드/GET·Edge 초기화 차단과 실제 역할 불변도 통과했다(`PERSONAL_MENU_EMPLOYEE_AUTH_STORAGE_VAULT_EDGE_PASS`, 전체 복구 runner 160 assertions). 이전 저장공간 부족은 현재 차단 사유가 아니다.

운영팀장 초기화 신고도 이 PR에 포함한다. 최근 비밀번호 인증이 만료되면 로그아웃 없이 직원 화면에서 현재 계정의 비밀번호를 확인하고 대상 초기화 확인으로 돌아간다. 10분 AMR·live session·보호 계정·rate limit·감사는 유지한다. 이 화면은 LOCAL/exact-head Preview 1440/390/320 검사 통과. 명시적 초기화 전 `LOGIN_REQUIRED`만 세션 갱신 후 한 번 재시도하며, 불확실한 결과는 재실행하지 않는다. 이 추가 갱신 동작과 실제 production transport→로컬 Auth→Edge 경로는 후속 HEAD에서 다시 검증한다.

검증된 직원 adapter도 후보 migration의 `adapter_ready=false`를 유지한다. 실제 계정·메뉴 승인 및 운영 적용은 별도이며, 독립 신규 등록과 나머지 메뉴 adapter는 아래 순서로 계속 구현한다.

## 기존 계약과 변경 계약

현재 `role_navigation_visibility`는 역할별 메뉴 숨김이다. 개인별 실제 권한 승인이 아니다. 기존 true/false를 신규 grant로 변환하지 않는다. 기존 `profile_roles`를 변경하거나 모든 API에서 운영총괄로 가장하지 않는다.

새 승인 단위는 `(profile_id, menu_key)`다. 서버가 관리하는 명시적 메뉴 동작 묶음만 위임한다. 동일 메뉴 내부의 전사 조회, 개인정보 필드와 수정·보관·복원 등 동작도 포함한다. 메뉴 권한을 다른 사람에게 나눠 주거나 운영 역할/기술 최고관리자를 부여하는 기능은 별도 권한 관리 영역으로 분리한다. 단순 사이드바 표시와 서버 권한은 같은 판정을 소비한다.

`employee.manage`에는 현재 내부의 `+ 직원 등록` 이동도 있어 신규 등록 capability가 포함된다. 독립 `employee.new`만 허용할 때 기존 직원 전체 조회까지 따라가지 않도록 전용 등록 context가 필요하다. 동일 capability를 공유하는 메뉴도 각각 API 진입 검사로 분리한다. 메뉴 키를 클라이언트가 바꿔 전달하거나 직접 RPC를 호출해도 서버 검사를 생략할 수 없어야 한다.

## 구현 구조

- `menu_authority_catalog`: 메뉴별 범위·민감정보·명시적 capability 목록. `adapter_ready=false`가 기본이며 **이 Draft의 모든 메뉴는 false**다. UI/API/Storage 연결 검증이 끝난 메뉴만 별도 코드 변경으로 활성화한다. UI나 위임받은 사용자가 카탈로그를 변경할 수 없다.
- `profile_menu_authority`: 개인별 allowed/denied 결정, revision, 변경자·시각·사유. 기존 표시 설정으로 seed하지 않는다.
- `private_menu_operations(menu)`: 특정 메뉴의 운영총괄 업무 분기만 판단한다. 전역 `current_user_has_role`, 실제 역할, JWT를 운영총괄로 바꾸지 않는다.
- 기존 `private_actor_capabilities`를 재사용하여 명시적 메뉴 capability만 합친다. 재위임·역할변경·기술 capability를 묶음에 넣지 않는다.
- 기존 역할 fallback은 개인별 결정이 없을 때 유지한다. 회수는 행 삭제가 아니라 denied를 남겨 fallback 재개를 막는다. 겹치는 capability가 있어도 각 메뉴 API에서 denied를 직접 검사한다.
- 운영총괄 본인 및 기술 최고관리자 계정을 개인 메뉴 위임 대상으로 사용하지 않는다. 실제 활성 운영총괄만 grant 관리 가능하며 하위 역할 시뮬레이션에는 개인 위임을 가져오지 않는다.
- 계정 잠금 및 revision 비교로 동시 허용/회수 충돌을 거절한다. 기존 감사 함수를 사용한다. 개인정보 원문은 grant 감사에 기록하지 않는다.

SQL은 CLI로 생성한 `20261028033019_personal_menu_authority_contract.sql` 및 `20261028033026_personal_employee_menu_adapter.sql`로 이동했다. 기존 prototype 복제본은 제거했다. `SUPABASE_HOME=/tmp/taejang-menu-supabase`라는 CLI 지원 경로를 사용해 읽기 전용 기본 홈 문제를 복구했다. 운영에 적용한 것은 아니며 두 migration 모두 실제 계정 grant나 adapter 활성화를 하지 않는다.

## 메뉴 범위 표

이 표는 구현할 묶음의 범위다. 모든 연결 API를 검증한 운영 승인 목록이 아니다. 카탈로그에도 동일한 범위 안내가 있다.

| 메뉴 | 업무 범위 | 노출될 정보 |
| --- | --- | --- |
| 직원 관리 | 전사 조회·등록·수정·보관·복원, 사진·주민번호·보험 설정, 계정 연결·상태·소속, 보호규칙을 유지한 계정 복구 | 이메일·연락처·신분증·주민번호·생년월일·보험정보 |
| 신규 직원 등록 | 등록용 조직/직책 조회·등록; 기존 직원 전사 목록 제외 | 신규 인사정보 |
| 가입 승인 | 신청 조회·승인·반려·직원 연결; 관리자 역할 배정 제외 | 신청자 연락처·인사정보 |
| 홍보 작성 / 보낸 글 / 승인 검토 / 발행 현황 / 공개글 관리 | 각각 운영총괄의 해당 화면 동작; 승인 검토는 운영총괄 단계만, 공개글 관리의 보관·복원·영구삭제 포함 | 미공개 원고·첨부·심사정보 |
| 홈페이지 내용 관리 / 직접 수정 | 각각 초안·검토·승인 반영 / safe-slot 직접 반영 | 공개 전 콘텐츠 |
| 공지 관리 | 전사 조회·작성·수정·게시·보관·복원·첨부 | 내부 공지·첨부 |
| 거래처 문서 관리 | 문서 조회·작성·수정·제출·첨부 | 거래처·계약/거래자료 |
| 출근부 / 근태 보정 | 전사 조회·예외 검토 / 이력을 보존한 보정 | 근태·위치·증빙 |
| 근태·급여관리 / 외부 급여초안 검토 | 각각 급여 조회·계산·수정·확정·내보내기 / 초안 검토·승인 | 개인별 급여·공제·첨부 |
| 기업 프로필 / 지원사업 레이더 / 내 지원사업 | 각 운영총괄 메뉴의 조회·수정·업무 처리 범위 | 기업·검토·제출 정보 |

다른 사람에 대한 메뉴 재위임, `set_profile_roles`, `set_profile_super_admin_status`, 운영 전체 관리자 부여, 기술 관리, 대표이사 고유 승인 단계는 위임 범위 밖이다. 직원 관리의 기존 계정 도구에 섞인 역할 변경 UI/RPC를 분리해야 하며, 이를 생략하고 직원 메뉴를 활성화하면 안 된다.

## 회수와 캐시

서버는 요청마다 현재 DB grant/denied를 판정한다. 위임 정보가 JWT에 남아 권한이 지속되는 구조를 만들지 않는다. 직접 URL은 메뉴 진입 시 서버 계약을 새로 확인하고, 실패하면 열지 않는다. 클라이언트는 focus/visibility 복귀와 활성 창 30초 주기로 갱신하며, 회수 이벤트에서 직원 context/선택값·진행 중 목록 응답을 무효화하고 열린 업무 화면을 지운다. 기존 capability 계약도 갱신한다.

회수 전에 이미 전달된 개인정보·다운로드나 진행 중 트랜잭션을 소급 취소할 수는 없다. 새 직원 사진 조회는 서명 URL 발급 대신 Authorization을 동반한 `/storage/v1/object/authenticated/` GET을 사용한다. 회수 시 blob URL을 폐기하고 늦게 도착한 사진 응답을 버린다. 이전 버전에서 이미 발급한 서명 URL은 최대 기존 수명(600초) 동안 남을 수 있다. [Supabase 공식 다운로드 계약](https://supabase.com/docs/guides/storage/serving/downloads)에 따라 인증 다운로드를 구현했지만 실제 Storage HTTP 업로드/인증 GET 및 회수 차단은 587b1e9 격리 CI에서 통과했다.

## 구현 대조

| 항목 | 상태 |
| --- | --- |
| 기존 표시 체크 자동 이전 방지 | 구현 완료, seed 없음 |
| 개인별 grant/회수·감사·revision·관리자 제한 | migration 구현, 격리 PostgreSQL 합성 테스트 통과 |
| 개인별 관리 UI·민감정보 범위·사유·충돌 처리 | 구현, 합성 Chromium 390/1440 검사 통과 |
| 공통 메뉴 진입·표시·회수 시 context 무효화 | 부분 구현, 계약 테스트 통과 |
| 일반 근로자에게 허용된 업무 Shell | 공통 Shell 직접 URL·회수 검사 통과(합성 서버 계약); 실제 Auth 연동 검증 필요 |
| 직원 조회·등록·수정·보관/복원·사진·계정 도구 | 서버/UI adapter 구현, 실제 저장소 RPC 본문을 독립 PostgreSQL에서 합성 자료로 실행 |
| 주민번호·보험 설정·계정복구·Storage | 587b1e9 실제 격리 Auth/Storage/Vault/Edge 통합 검증 통과; 운영 미적용 |
| 나머지 메뉴의 기존 role 분기/API/직접 페이지 연결 | 목록·범위 설계만 완료, adapter 미구현 |
| DB migration 파일 / 운영 적용·개인 grant·배포 | 파일 생성 완료 / 운영 실행 없음 |

## 검증과 제한

- `node tests/menu-authority-isolated.mjs`: 네트워크 없는 독립 PostgreSQL 17, 합성 계정. grant·회수·fallback·타 메뉴 capability·재위임·충돌·감사·ACL 검사와 함께 기존 migration의 실제 직원 RPC 본문을 로드한다. 운영총괄/위임자의 목록·이메일·신원정보 flag 동일성, 실제 등록·수정·사진 setter·계정 도구·이력 조회·보관/복원·비밀번호 복구 option·회수 후 직접 RPC/Storage helper 차단을 실행한다. `authenticated` 역할 조회/회수 차단과 private 함수 ACL도 확인한다. 테이블은 schema-only 합성 fixture이며 **실제 Supabase Auth/Data API/Storage/Vault 통합 통과를 뜻하지 않는다.**
- `node --test tests/menu-authority.test.js`: 실제 브라우저 계약 모듈의 권한 결정·회수·오류시 차단·구서버 호환·계정 변경 응답 경쟁 5개.
- `node tests/menu-authority-browser.mjs`: 실제 Chromium, 합성 관리 화면 390/1440, 허용/회수·사유·revision·미준비 메뉴 차단.
- `tests/issue-451-employee-profile-browser.mjs`: 320/390/768/1440, 기존 직원 흐름과 일반직원·홍보직원·운영팀장의 위임 카드·수정·회수·직접 열기 차단을 검사한다. 사진은 인증 GET 응답 fixture를 사용한다.
- `tests/platform-menu-addresses-browser.mjs`: 기존 URL/history/dirty-guard에 위임 역할 3종의 직접 URL·회수·역할 불변 검사를 추가했다.
- 이번 변경의 직원 정적 검사 20개 통과. 이전 단계 전체 정적 613/staging 16/build 통과를 새 변경의 전체 검증으로 혼동하지 않는다.
- 초기 로컬 환경에서는 전체 Supabase Docker 다운로드가 저장공간 부족으로 실패했다. 후속 587b1e9의 GitHub Actions 격리 Supabase에서 전체 Auth/RLS/Storage 검증을 완료했다. 독립 PostgreSQL 검사 자체는 실제 서비스 검증과 구분한다.

## 운영 반영 전 action-time 승인 자료

현재 **실제 대상 계정/메뉴 선택은 확정되지 않았다.** “모델을 바꾸라”는 결정으로 기존 메뉴 체크 전체나 운영팀장에게 자동 부여하지 않는다. 다음 양식을 실제 변경 직전에 비공개 경로로 채운다.

1. 대상 DB ref, 승인할 정확한 migration/코드 SHA 및 검증 결과.
2. 대상 `profile_id`와 본인 확인 표시명(공개 PR에는 합성/비식별만), 메뉴 키, 허용/회수, 현재 revision.
3. 해당 메뉴의 조회 대상 직원/자료 범위, 공개되는 개인정보, 조회·등록·수정·삭제/보관·복원·승인·다운로드·계정복구 동작 목록.
4. 연동 메뉴·재위임·역할변경 제외 항목, 기존 역할 fallback 처리, 회수 및 복구 방법.
5. 이전 grant 상태 백업과 정확한 회수 SQL/RPC. 역할 확대나 전체 grant 일괄 적용은 금지.

현재 모든 adapter_ready는 false이므로 신규 grant를 전부 거절한다. 직원 adapter의 전체 Supabase 통합 검증 후 직원 메뉴부터 위 승인표를 확정한다. 검증이 끝나기 전에 true로 변경하지 않는다. #546 사진 복구나 별도 Production 배포 작업과 합치지 않는다.


## 2026-10-28 후속 구현 및 다음 순서

직원 메뉴 adapter는 명시적으로 열거한 기존 함수만 수정하고, 예상 함수/권한 표현이 없으면 전체 transaction을 중단한다. 전역 `current_user_has_role`과 급여 전체 operator helper는 변경하지 않는다. 직원 카드의 두 보험 설정 RPC만 직원 메뉴 권한을 추가한다. `access_level=operations_manager`는 이 메뉴의 공통 화면 동작 수준이며 실제 역할·JWT는 그대로다.

직원 메뉴 안의 계정 도구는 `can_manage_roles=false`를 내려 역할 변경을 표시하지 않고 기존 역할 변경 RPC에도 capability를 부여하지 않는다. 위임된 다른 계정 및 운영총괄·최고관리자에 대한 계정 연결/상태·소속 변경과 비밀번호 복구를 보호한다. 개인별 메뉴를 받은 계정은 직원 삭제·복구 대상 보호에도 포함한다. 이 보호 범위는 권한 재위임·계정 탈취를 메뉴 권한으로 허용하지 않는 경계다.

나머지 메뉴는 카탈로그 범위만 구현했으며 새 grant를 받을 수 없다. 순서:

1. 직원 메뉴(587b1e9 격리 CI 완료): 전체 migration clean reset, Supabase Auth/Data API 직접 호출, RLS/Storage 실제 업로드·인증 GET, Vault 주민번호·보험 성공/실패 경로, Edge 비밀번호 복구의 reserve→begin→Admin 변경→감사, 계정 연결·연락처 검토·보관/복원 충돌 회귀를 완료한다.
2. 신규 직원 등록: 전사 기존 직원 목록을 보내지 않는 등록 전용 context와 단독 route를 구현한다. 직원 관리 안의 등록 동작은 이미 직원 메뉴에 포함된다.
3. 공지·거래처 문서·출근부/보정: 각 RPC/첨부 경계와 기존 역할 검사를 메뉴별로 대조한다.
4. 홍보·홈페이지: 작성/검토/발행/영구삭제 동작을 분리하고 기존 대표이사 승인선·공개 반영 조건을 유지한다.
5. 지원사업·급여: 담당 범위 및 급여·내보내기 API를 분리하고 실제 역할을 요구하던 민감 경계를 개별 검증한다. 직원 보험 설정을 이유로 급여 전체를 열지 않는다.

이번 작업에서 구현/검증한 직원 메뉴의 승인 후보 범위는 전사 직원 관리와 연결 계정이다. 진단 시점 관측치는 미보관 직원 32명, 연결 계정 27명이며 현황 고정값이 아니다. 실제 승인 대상 계정은 아직 지정되지 않았다. 최초 적용을 운영팀장 1계정으로 할지 등은 부모가 변경 직전 정확한 계정·메뉴·revision과 함께 확인해야 한다. 직원 이메일·주민번호 등 원문을 공개 PR에 기록하지 않는다.
