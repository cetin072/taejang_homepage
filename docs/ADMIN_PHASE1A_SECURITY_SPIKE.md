# 관리자 시스템 Phase 1A 보안 기술 검증

> 상태: **비운영 보안 프로토타입**
>
> 이 문서는 Phase 1 전체 구현이나 Supabase 채택 결정이 아닙니다. 실제 Supabase 프로젝트, 직원 계정, 운영 데이터, Netlify 설정, GitHub Actions, Build Hook, 비밀키, 운영 배포는 만들거나 변경하지 않습니다.

## 1. 목적과 범위

Phase 0의 보안 설계가 구현 가능한지 작은 코드·SQL 초안·테스트로 확인합니다. 우선 검증 대상은 다음 여덟 가지입니다.

1. `active` 계정만 민감 작업 가능
2. `suspended`·`departed` 전환 즉시 작업 차단
3. 요청별 `active` 검사와 세션 폐기의 독립 방어
4. 마지막 `active super_admin` 보호
5. 퇴사자 담당 콘텐츠 재배정
6. 과거 작성·검토·승인·감사 관계 보존
7. 승인 revision만 정적 발행
8. 발행 실패 시 기존 공개본 유지

이번 PR에서 실제로 추가한 비운영 파일은 다음과 같습니다.

| 파일 | 역할 |
| --- | --- |
| `prototypes/admin-phase1a/schema.sql` | Supabase/PostgreSQL에 적용 전 검토할 데이터·RLS·트리거 SQL 초안 |
| `scripts/admin-phase1a-publish.js` | 공개 홈페이지와 분리된 fixture 정적 발행·검증·롤백 프로토타입 |
| `tests/admin-phase1a-publish.test.js` | 정적 발행 안전성 자동 테스트 |
| 이 문서 | 구현·미검증·수동 검증·승인 항목 기록 |

## 2. 환경 제약과 검증 수준

현재 작업 환경에는 Supabase CLI, Docker, PostgreSQL 클라이언트가 없습니다. 따라서 다음은 **실행하지 않았습니다.**

- `supabase start`, `supabase db reset` 또는 실제 local migration
- PostgreSQL SQL 파서·RLS·트리거·동시성 실행
- Auth 세션 전역 폐기와 Storage 정책의 실제 동작
- 실제 GitHub·Netlify·Supabase 발행 연결

억지 설치하거나 외부 프로젝트를 만들지 않았습니다. SQL은 실행 가능한 초안이며, Phase 1B의 로컬 Supabase 환경에서만 적용·테스트합니다.

Node.js가 있는 환경에서는 정적 발행 프로토타입을 다음 명령으로 실행할 수 있습니다.

```bash
node --test tests/admin-phase1a-publish.test.js
```

이번 PR에서 위 명령과 같은 테스트를 실행했으며, 정적 발행 안전성 테스트 **5개가 모두 통과**했습니다. 이 결과는 fixture publisher에 한정되며, DB·RLS·Auth·Storage·동시성 테스트가 통과했다는 뜻은 아닙니다.

## 3. DB 모델 초안

`schema.sql`은 인증 사용자(`auth.users`)와 업무 프로필(`profiles`)을 분리합니다.

| 개념 | 초안 테이블 | 핵심 원칙 |
| --- | --- | --- |
| 업무 프로필·상태 | `profiles` | `active/suspended/departed/deleted`; Auth 사용자와 분리 |
| 역할 이력 | `user_roles` | `staff/reviewer/admin/super_admin`; 현재 역할 표시와 보존 |
| 콘텐츠 | `contents` | 담당자·상태·공개 revision 참조 |
| 콘텐츠 revision | `content_revisions` | 본문 변경은 revision 단위, 작성자 참조 보존 |
| 검토·승인 | `review_decisions` | 승인 대상 revision을 고정 |
| 담당자 이력 | `content_assignments` | 재배정 후에도 이전 관계 보존 |
| 파일 메타데이터 | `media_assets` | 원본·공개본 키, checksum, 공개 상태 분리 |
| 발행 작업 | `publication_jobs` | 대상 revision, checksum, 성공·실패·롤백 기록 |
| 감사 로그 | `audit_logs` | append-only 방향, 최소 정보만 기록 |

모든 업무 관계의 외래키는 `on delete restrict`입니다. 계정을 `deleted` 또는 익명화해도 작성자·검토자·승인자·감사 이력이 자동 삭제되지 않습니다. 실제 개인정보 삭제가 필요하면 표시명 등 개인정보만 익명화하고 tombstone 또는 동등한 보존 레코드로 업무 관계를 유지합니다. 감사 로그는 계정 삭제와 함께 삭제하지 않습니다.

## 4. 요청별 active 상태 차단

### 독립된 두 방어

1. **상태 차단(필수 방어):** 모든 민감 작업은 서버/신뢰 가능한 함수, DB RLS, Storage 정책에서 현재 `profiles.status = active`를 다시 검사합니다. `suspended` 또는 `departed`가 저장되는 순간부터 기존 access token, 오래 열린 브라우저, 진행 중인 다음 요청도 거부해야 합니다.
2. **세션 전역 폐기(추가 방어):** 기존 access session, refresh token 및 관련 세션을 전역 폐기합니다. 폐기 실패·지연이 상태 차단을 약화하거나 지연시켜서는 안 됩니다.

`schema.sql`의 `current_profile_is_active()`와 RLS 정책은 이 원칙의 DB 초안입니다. 실제 서비스에서는 아래 모든 동작에 같은 조건을 적용합니다.

- 콘텐츠 생성·수정·soft delete
- 검토 요청·수정 요청·승인·승인 취소
- 발행·롤백 요청
- 파일 업로드·교체·삭제
- 담당자 재배정
- 계정·역할 관리

UI에서 버튼을 숨기는 것은 보조 수단일 뿐 보안 통제가 아닙니다.

## 5. 마지막 active super_admin 보호

### 권장 방식

단순 `COUNT` 후 업데이트는 두 요청이 동시에 실행될 때 0명의 최고관리자를 만들 수 있습니다. SQL 초안은 아래를 결합합니다.

- `profiles.status` 및 `user_roles` 변경 전 trigger
- `pg_advisory_xact_lock`으로 상태·역할 변경 직렬화
- 변경 뒤 마지막 active `super_admin`이 0명이 되는지 DB에서 계산
- 위험 변경이면 변경을 막고 `last_super_admin_change_denied` 감사 이벤트 기록

트리거는 감사 이벤트가 같은 트랜잭션에서 보존되도록 위험한 직접 변경을 **denied no-op**으로 처리합니다. 신뢰 가능한 서버 함수/API는 “0행 변경”을 명시적인 권한 거부 응답으로 바꿔야 합니다.

이 초안은 본인 강등, 다른 관리자의 마지막 최고관리자 정지, 상태·역할 동시 변경, 동시 두 요청을 다룹니다. DB superuser가 트리거를 제거하는 행위는 애플리케이션 권한 통제 범위를 넘어서는 운영자 권한이므로, 운영 환경에서는 서버·DB 관리자 접근을 별도로 최소화·감사해야 합니다.

## 6. 퇴사 처리와 담당 재배정

퇴사 처리는 재배정보다 차단이 먼저입니다.

1. 퇴사 또는 업무 종료 확인
2. `departed` 전환 또는 동등한 긴급 차단 적용
3. 요청별 `active` 검사로 서버·DB·Storage 민감 동작 즉시 차단
4. 세션·refresh token 폐기 시도와 결과 기록
5. 담당 업무·콘텐츠 목록 생성
6. `active`이고 역할이 맞는 직원에게 재배정
7. 미배정 항목 수·후속 책임자·기한 경고
8. 차단·세션 폐기·재배정 결과의 감사 기록

재배정 실패나 지연은 접근 차단을 취소하거나 늦추지 않습니다. 처리 함수/트랜잭션에는 최소 업무상 사유, 처리자, 처리 시각, 미배정 콘텐츠 수, 세션 폐기 결과, 감사 correlation ID가 포함되어야 합니다. 건강·징계·인사 상세 사유는 저장하지 않습니다.

## 7. 감사 로그 보호

`audit_logs`에는 일반 직원·일반 관리자의 UPDATE/DELETE RLS 정책을 만들지 않습니다. 최종 구현에서는 trusted server function 또는 최소 권한 서비스 경로만 INSERT할 수 있게 하고, 읽기는 기본적으로 `super_admin`으로 제한합니다.

필수 이벤트는 다음과 같습니다.

- 로그인 실패, 권한 거부
- 계정 상태·역할 변경 성공/실패
- 세션 폐기 성공/실패, 퇴사 후 차단 확인
- 마지막 active `super_admin` 변경 거부
- 재배정 성공/실패 및 미배정 업무 발생
- 콘텐츠 생성·수정·검토·승인
- 발행 요청·성공·실패·검증 실패
- 롤백 승인·실행·실패
- 파일 업로드·교체·삭제
- 중요 설정 변경 시도

비밀번호, access token·refresh token 원문, 비밀키, 민감한 인사 사유, 필요 이상의 콘텐츠 본문 전문은 기록하지 않습니다.

## 8. 정적 발행 안전성 프로토타입

`scripts/admin-phase1a-publish.js`는 실제 홈페이지·GitHub·Netlify를 건드리지 않는 fixture 도구입니다.

- 공개 필드 allowlist만으로 결과를 구성합니다.
- `approved`가 아닌 revision은 자동 결과에서 제외됩니다.
- 특정 revision 발행을 요청하면 승인되지 않은 revision은 오류로 거부합니다.
- 내부 메모·승인자 정보 등은 결과에 복사하지 않습니다.
- 결과에는 revision ID와 SHA-256 checksum을 포함합니다.
- checksum·필수 식별자·공개 필드 allowlist를 검증한 뒤에만 staged 파일을 rename으로 교체합니다.
- 검증 실패는 기존 공개 fixture의 교체 전에 발생합니다.
- 이전 승인 snapshot이 유효하면 staged rollback으로 복원할 수 있습니다.

이는 정적 발행의 안전 속성만 검증합니다. 보호된 `main` 직접 쓰기, 자동 병합, GitHub Actions, Netlify 운영 배포는 구현하지 않았습니다. 최종 발행 방식도 사용자 승인 전 미확정입니다.

## 9. 테스트 매트릭스

| 번호 | 시나리오 | 이번 PR 상태 |
| --- | --- | --- |
| 1 | active staff draft 생성 성공 | SQL/RLS 수동 검증 명세 |
| 2 | suspended staff 생성·수정·업로드 실패 | SQL/RLS·Storage 수동 검증 명세 |
| 3 | departed staff 기존 토큰 요청 실패 | SQL/RLS 수동 검증 명세 |
| 4 | 세션 폐기 실패에도 departed 요청 실패 | SQL/RLS·Auth 수동 검증 명세 |
| 5 | staff 승인 시도 실패 | SQL/RLS 수동 검증 명세 |
| 6 | reviewer/승인 권한자 승인 성공 | SQL/RLS 수동 검증 명세 |
| 7 | 마지막 active super_admin 정지 실패 | SQL trigger·동시성 수동 검증 명세 |
| 8 | 마지막 active super_admin 강등 실패 | SQL trigger·동시성 수동 검증 명세 |
| 9 | 최고관리자 2명 중 1명 강등 성공 | SQL trigger 수동 검증 명세 |
| 10 | 동시 강등에도 active super_admin 0명 방지 | advisory lock 동시성 수동 검증 명세 |
| 11 | 퇴사자의 과거 작성 콘텐츠·감사 로그 보존 | SQL FK·익명화 수동 검증 명세 |
| 12 | 퇴사 처리 뒤 미배정 콘텐츠 경고 | trusted function 수동 검증 명세 |
| 13 | 미승인 revision 발행 실패 | 자동 테스트 |
| 14 | 승인 revision 발행 성공 | 자동 테스트 |
| 15 | 발행 검증 실패 시 기존 fixture 유지 | 자동 테스트 |
| 16 | 롤백 시 이전 승인 revision 복원 | 자동 테스트 |
| 17 | 일반 관리자의 감사 로그 수정·삭제 실패 | SQL/RLS 수동 검증 명세 |

### 로컬 Supabase 수동 검증 절차

Phase 1B에서만, 비운영 환경에 다음 순서로 실행합니다.

1. `supabase start`로 로컬 스택을 시작하고, 테스트용 `auth.users`·`profiles`·역할을 생성합니다.
2. `supabase db reset` 또는 임시 DB에 `schema.sql`을 적용합니다.
3. 각 역할의 JWT로 RLS 정책과 Storage 정책을 호출합니다.
4. `departed` 전환 뒤 기존 JWT로 insert/update/delete/upload를 재시도해 거부를 확인합니다.
5. 세션 폐기 API를 의도적으로 실패시키거나 생략한 뒤에도 4번이 거부되는지 확인합니다.
6. 두 SQL 세션에서 최고관리자 강등을 동시에 실행해 advisory lock·trigger 결과와 감사 로그를 확인합니다.
7. 승인 revision·draft·검증 실패 fixture를 이용해 Node 테스트와 publication checksum·rollback을 확인합니다.
8. 테스트 데이터와 임시 Storage 객체를 제거하고 결과만 비밀값 없이 기록합니다.

## 10. Supabase에서 공식 확인이 필요한 기능

Supabase는 우선 검증 후보일 뿐 최종 채택이 아닙니다. Phase 1B 전에는 공식 문서로 다음을 확인해야 합니다.

- 관리자 API에서 특정 사용자의 access/refresh session을 전역 폐기하는 정확한 방법과 권한
- Auth 차단과 `profiles.status`/RLS 상태 검사의 적용 순서
- Storage RLS가 기존 access token을 가진 요청에서 현재 프로필 상태를 다시 읽는 방식
- service role을 사용하지 않는 일반 관리자 경로와 서버 전용 경로의 분리
- local Supabase에서 Auth·Storage·RLS·DB trigger 통합 테스트 방법
- 백업·감사 로그·Storage 보존과 요금제 영향

Firebase, Git 기반 CMS, 헤드리스 CMS 또는 다른 서비스로 바뀌어도 다음 요구는 유지해야 합니다: 요청별 active 차단, 세션 폐기와의 독립성, 마지막 최고관리자 DB 수준 보호, 이력 보존, 승인 revision 고정, staged 정적 발행·검증·롤백.

## 11. Phase 1B 착수 조건과 사용자 승인

### Phase 1B 착수 조건

- [ ] 백엔드·인증 후보의 승인 또는 제한된 기술 검증 승인
- [ ] 비운영 Supabase local 환경 또는 동등한 PostgreSQL 테스트 환경 확보
- [ ] 세션 폐기·RLS·Storage·동시성 테스트 통과
- [ ] 실제 콘텐츠 유형·승인자 분리·역할 겸임 규칙 확정
- [ ] 발행 브랜치 또는 별도 콘텐츠 저장소와 main 보호 규칙 승인
- [ ] 개인정보·익명화·감사 보존·백업 책임자 확정
- [ ] Preview·운영 환경과 비밀값 관리 기준 승인

### 사용자 승인이 필요한 항목

- Supabase 최종 채택 여부 및 무료·유료 요금제
- 관리자 앱 위치와 실제 인증 방식
- 세션 폐기 방식과 MFA 범위
- 파일 저장소·원본 보관·백업·복구 서비스
- 감사 로그와 익명화 기록의 보존 기간
- 승인자 분리 수준·긴급 정정 권한
- 전용 발행 브랜치/별도 콘텐츠 저장소, main 반영·자동 병합·Netlify 운영 배포의 보호 절차

## 관련 파일

- [Phase 0 기술 설계](ADMIN_PHASE0_TECHNICAL_ARCHITECTURE.md)
- [관리자 보안 계획](ADMIN_SECURITY_PLAN.md)
- [관리자 데이터 모델](ADMIN_DATA_MODEL.md)
- [관리자 도입 의사결정](ADMIN_DECISION_LOG.md)
- [Phase 1A DB 보안 초안](../prototypes/admin-phase1a/schema.sql)


## 12. 보안 보완 검토: 감사·승인·직접 변경 경계

### 감사 함수 직접 호출 차단

`append_audit`는 `SECURITY DEFINER`만으로 충분하지 않습니다. SQL 초안은 다음을 추가합니다.

- `PUBLIC`의 실행 권한을 명시적으로 회수합니다.
- Supabase local에 존재할 수 있는 `anon`, `authenticated` 역할도 조건부 SQL로 실행 권한을 회수합니다.
- 아직 확정하지 않은 전용 서버 역할에는 권한을 부여하지 않습니다. Phase 1B에서 실제 역할명·서버 경계를 승인한 뒤 필요한 내부 경로에만 최소 권한을 부여합니다.
- `search_path`를 `pg_catalog, public`으로 고정합니다.
- `outcome`은 `success`, `denied`, `failed`만 허용합니다.
- metadata는 JSON object·4 KiB 이내로 제한하고 password/token/secret/key/refresh 계열 키를 거부합니다. 이것은 민감정보 방지의 보조 장치이며, 일반 사용자가 함수를 호출할 수 없게 하는 권한 분리가 주된 통제입니다.
- 일반 로그인 역할의 `append_audit(...)` 직접 호출은 권한 거부가 되어야 합니다. 이는 Phase 1B SQL 검증 시나리오에 추가합니다.

### 현재 유효 승인과 승인 취소

과거 `approved` 이력이 하나라도 있다는 사실은 발행 권한이 아닙니다. `review_decisions`의 append-only 이력과 별개로, `revision_approval_states`를 revision별 단일 현재 상태로 둡니다.

- `decision_sequence` identity 순번을 기록해 단순 `created_at` 동시 시각 비교를 피합니다.
- 신뢰 함수가 검토·승인·승인 취소를 기록할 때 같은 흐름에서 현재 상태를 갱신합니다.
- 발행 요청 정책은 과거 이력이 아니라 `revision_approval_states.status = 'approved'`만 확인합니다.
- `approved → approval_revoked → 발행 요청`은 `APPROVAL_NOT_CURRENT` 또는 동등한 명시 거부 결과가 되어야 합니다.

현재 초안은 상태 테이블, 정책, 그리고 `request_publication` trusted function을 포함합니다. 권한 경계와 SQL 실행 결과는 Phase 1B에서 local DB로 검증해야 하며 아직 실행하지 않았습니다.

### 콘텐츠별 단일 공개 revision

공개 결과에는 한 `contentId`당 정확히 하나의 revision만 존재해야 합니다. fixture publisher는 다음을 검증합니다.

- `contentId`, `slug`, `revisionId` 중복 거부
- 특정 발행 요청의 revision ID 중복 거부
- `contentId`, `revisionId`, `slug`, `title` 빈 값 거부
- 본문 타입, 선택 필드 타입, `generatedAt`·`publishedAt` UTC ISO 시각 검증
- slug → contentId → revisionId의 결정적 순서
- checksum과 공개 allowlist 유지
- 검증 실패는 staged 교체 전에 발생하여 기존 fixture를 유지

### 마지막 최고관리자 거부 결과와 감사 트랜잭션

트리거에서 감사 로그를 INSERT한 뒤 `RAISE EXCEPTION`하면 같은 PostgreSQL 트랜잭션의 감사 기록도 롤백될 수 있습니다. 따라서 이 프로토타입의 권장 경계는 다음과 같습니다.

1. 일반 클라이언트는 `profiles`, `user_roles`, `review_decisions`, `revision_approval_states`, `publication_jobs`, `audit_logs`를 직접 INSERT/UPDATE/DELETE하지 못합니다. RLS와 별개로 직접 테이블 권한을 명시적으로 회수합니다.
2. 상태·역할 변경은 trusted server function/API만 수행합니다. 함수는 advisory lock과 행 잠금을 적용합니다.
3. 마지막 active `super_admin`을 없애려는 요청은 데이터를 변경하지 않고 감사 이벤트를 기록한 뒤 `{ ok: false, code: 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED' }` 같은 구조화된 결과를 반환합니다.
4. 서버 API는 이 `ok: false`를 성공 응답으로 취급하지 않고 호출자에게 명시적 거부(예: HTTP 409)로 변환해야 합니다. affected row count 확인에 의존하지 않는 API 계약입니다.
5. 기존 trigger는 함수 밖의 우회·결함에 대한 DB 방어선으로 남기되, 일반 클라이언트 경로의 결과 전달을 맡기지 않습니다.

이 방식은 거부 감사 기록을 같은 성공 트랜잭션에 보존할 수 있는 현실적인 초안입니다. 실제 Supabase RPC·서버 역할·RLS 조합에서의 동작은 Phase 1B 검증 대상입니다.

### Phase 1B 추가 SQL 검증 시나리오

- [ ] `authenticated` 역할이 `append_audit`를 직접 호출하면 권한 거부
- [ ] trusted 경로의 허용된 audit event만 기록되고 허용 밖 outcome·과대/민감 metadata는 거부
- [ ] `approved → approval_revoked → publication request`가 현재 승인 부재로 거부
- [ ] 일반 클라이언트의 profiles.status·user_roles.role/is_current·review_decisions·publication_jobs·audit_logs 직접 변경이 권한 거부
- [ ] trusted 상태 변경 함수가 마지막 최고관리자 변경에 구조화된 거부 결과를 반환하고 감사 기록을 보존
- [ ] 두 동시 상태/역할 변경 요청에서도 active `super_admin` 수가 0이 되지 않음
- [ ] 발행 요청·승인 취소·감사 기록이 같은 revision/decision sequence를 정확히 참조

Supabase는 계속 우선 검증 후보일 뿐 최종 채택된 서비스가 아닙니다.
