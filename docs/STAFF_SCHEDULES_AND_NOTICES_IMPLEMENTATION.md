# 일반 근로자 일정·중요공지 구현

상태: **개발 검증용 — Draft PR 승인 전 운영 Supabase에 적용하지 않는다.**

## 1. 적용 기준

- `PROJECT_CHARTER.md`
- `docs/planning/MVP_FUNCTIONAL_SPECIFICATION_V1.md`
- `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md`
- `docs/planning/ROLE_SCREEN_MAP_AND_NAVIGATION_V1.md`
- `docs/planning/ROLE_PERMISSION_MATRIX_V1.md`
- `docs/planning/PHASE1A_ACCESS_RLS_V1.md`
- `docs/planning/GOOGLE_WORKSPACE_INTEGRATION_V1.md`
- `docs/GENERAL_WORKER_TODAY_BOARD_IMPLEMENTATION.md`
- `docs/GENERAL_WORKER_WORK_GUIDES_IMPLEMENTATION.md`
- `docs/PHASE1A_SECURITY_FOUNDATION_IMPLEMENTATION.md`

일정·공지는 일반 근로자의 읽기와 안내 확인을 돕는다. 근태·출퇴근·업무실적·평가·일정 변경 요청 기능으로 사용하지 않는다.

## 2. 데이터 구조

migration:

`supabase/migrations/20260723000400_staff_schedules_and_notices.sql`

적용 순서:

1. `20260723000100_phase1a_security_foundation.sql`
2. `20260723000200_general_worker_today_board.sql`
3. `20260723000300_accessible_work_guides.sql`
4. `20260723000400_staff_schedules_and_notices.sql`

### `schedule_items`

- 안정적인 내부 UUID
- 일정 종류
- 시작·종료 일시와 하루 종일 여부
- 장소·담당자·준비물·이동방법·차량 출발시각
- 쉬운 설명
- 전체·부서·작업반·개인 대상 범위
- 작성 중·게시·취소·사용 중지 상태
- 변경 여부를 판단하는 일정 수정 번호
- 변경 사유와 작성·수정 이력
- 선택적 외부 제공자·이벤트 ID·마지막 동기화 시각·동기화 방향

취소 일정은 삭제하지 않는다. 일반 근로자에게 취소 문구를 글자로 표시한다.

### `notices`

- 공지 종류와 `normal | important | urgent` 중요도
- 제목과 쉬운 안내문
- 게시 시작·종료시각
- 적용 시작·종료일
- 장소·준비물
- 관련 일정·작업방법
- 관련 HTTPS 링크와 표시명
- 확인 필요 여부
- 공지 버전
- 대상 범위
- 상태·변경 사유·작성·수정 이력

게시 중이고 현재 게시기간 안이며 본인 대상 범위와 일치하는 공지만 일반 근로자에게 반환한다.

### `notice_acknowledgements`

- 공지 ID
- 공지 버전
- 본인 프로필 ID
- 확인시각

`공지 ID + 버전 + 사용자 ID`를 복합 기본키로 사용한다. 같은 공지 버전의 반복 확인은 하나의 행에서 최신 확인시각만 유지한다.

## 3. 기존 Today 요약과 관계

`today_information_items`는 삭제하거나 구조를 바꾸지 않는다.

- 기존 근무시간·당일 요약은 계속 읽는다.
- 새 일정과 공지는 별도 정규 테이블이 기준 데이터다.
- `get_my_today_board(date)`가 기존 Today 항목과 새 정규 데이터를 한 응답으로 합친다.
- Today에는 당일 일정, 차량·이동, 근무장소 변경, 현재 중요공지, 확인하지 않은 확인 필요 공지만 요약한다.
- 전체 목록과 상세는 `내 일정`, `중요공지` RPC에서 다시 권한을 검증한다.

기존 혼합 Today 작성 데이터는 운영 확인 뒤 별도 정리 PR에서 점진적으로 이전한다. 이번 migration은 기존 행을 자동 삭제·변환하지 않는다.

## 4. 대상 범위

기존 `today_target_scope`를 재사용한다.

- `company`
- `department`
- `work_group`
- `profile`

일반 근로자는 현재 활성 계정이어야 하며 전체, 현재 부서, 현재 유효한 작업반, 본인 개인 대상만 읽는다. 다른 개인·작업반·부서 데이터는 안전한 RPC에서 반환하지 않는다.

## 5. 일반 근로자 화면

### 내 일정

- 월간 달력 대신 가까운 일정 목록
- 오늘·내일·이번 주·그 이후 예정 구간
- 날짜순 정렬
- 일정명·종류·시간·장소·상태
- 일정이 없으면 `예정된 일정이 없습니다.`
- 과거 일정은 기본 목록에서 제외

상세에는 제목, 날짜·시간, 장소, 담당자, 준비물, 이동방법, 차량 출발시간, 쉬운 설명, 취소상태, 등록일과 최종 수정일을 표시한다.

### 중요공지

- 긴급·중요 우선, 게시 시작시각이 최근인 순서
- 새 공지·변경 공지 글자 표시
- 게시기간 밖·초안·사용 중지 자료 제외
- 확인 필요 여부와 본인 확인상태

상세에는 공지 종류, 중요도, 적용기간, 장소, 준비물, 관련 일정·작업방법·외부 링크, 최종 수정일과 확인 필요 여부를 표시한다.

## 6. 공지 확인

`important | urgent` 중요도이면서 `requires_acknowledgement = true`인 현재 게시 공지만 `내용을 확인했어요` 버튼을 표시한다. 일반 중요도의 공지에는 DB 제약과 guarded RPC가 확인 필요 설정을 허용하지 않는다.

- 본인 명의만 기록
- 다른 직원의 기록 조회 불가
- 직접 insert/update/delete 불가
- 확인 취소 불가
- 공지 수정 시 버전 증가
- 이전 버전 확인은 보존하되 새 버전은 미확인으로 처리
- 관리자는 확인 필요·확인·미확인 인원 수만 조회

확인은 공지 이해 여부를 다시 확인하기 위한 최소 기록이다. 근태·완료·업무실적·평가 점수로 사용하지 않는다.

## 7. 관리자 권한

guarded RPC가 화면과 독립적으로 현재 계정상태, 역할, 기존 대상, 변경 대상을 재검증한다.

- `super_admin`, `operations_manager`: 전사
- `department_lead`: 본인 부서·소속 작업반·소속 직원
- `field_lead`: 본인이 현재 책임자인 작업반과 반원
- 일반 직원·일반 근로자: 작성 불가

일정은 생성·수정·취소·사용 중지를 지원한다. 공지는 생성·수정·게시·취소·사용 중지와 확인 필요 설정을 지원한다. 물리삭제는 제공하지 않는다.

## 8. 관련 링크 보안

DB와 브라우저에서 모두 검증한다.

- `https:`만 허용
- `http:`, `javascript:`, `data:`와 공백·제어문자·사용자정보가 든 URL 거부
- 링크 표시명과 주소를 함께 입력
- 화면에 실제 주소를 별도로 표시
- 새 창은 `noopener noreferrer`
- 사용자 입력을 `innerHTML`로 삽입하지 않음

관련 링크가 열리지 않아도 일정·공지 본문과 태장 업무플랫폼은 계속 동작한다.

## 9. 감사로그

기존 `audit_logs`와 `private_append_audit(...)`를 사용한다.

- 일정 생성·수정·취소·사용 중지
- 시간·장소·대상 범위 변경
- 공지 생성·수정·게시·취소·사용 중지
- 중요도·확인 필요·대상 범위 변경
- 관련 일정·작업방법·링크 변경
- 공지 버전 증가

metadata에는 상태, 변경 여부, 짧은 종류와 버전만 둔다. 일정·공지 장문 본문, 직원 이메일, 토큰, 비밀번호, 건강·상담정보를 넣지 않는다. 공지 확인은 감사로그가 아닌 확인 테이블에 보존한다.

## 10. 접근성

- 모바일 우선
- 44px 이상 터치영역
- 날짜를 연·월·일·요일 문장으로 표시
- 목록 구간별 제목
- 취소·중요·변경 상태를 글자로 표시
- 명확한 heading과 포커스 이동
- 로딩·빈 상태·권한 오류 상태 구분
- 기술 오류 전문 비노출
- 키보드로 모든 버튼과 외부 링크 사용

## 11. 코드 모듈

- `schedule-worker.js`: 일반 근로자 일정 목록·상세
- `notice-worker.js`: 일반 근로자 공지 목록·상세
- `notice-acknowledgement.js`: 버전별 본인 확인
- `schedule-admin.js`: 관리자 일정 작성·수정·미리보기
- `notice-admin.js`: 관리자 공지 작성·수정·미리보기·최소 확인 수
- `staff-information-ui.js`: 공통 날짜·시간·대상·안전 URL UI
- `staff-information-today.js`: Today 일정·공지 요약

인증·세션·공통 RPC는 기존 `app.js`를 유지하되 일정·공지 기능 구현은 새 모듈에 둔다.

## 12. Google Calendar 향후 연동 경계

이번 PR은 Google Calendar API, Google Workspace OAuth와 실제 동기화를 구현하지 않는다.

기본 원칙:

> 태장 업무플랫폼 DB가 직원 화면의 기준 데이터이고, Google Calendar는 관리자·사무직 협업을 위한 선택적 복제 또는 연동 대상이다.

준비 필드:

- 내부 안정 UUID
- `external_provider`
- `external_event_id`
- `last_synced_at`
- `sync_direction`
- 외부 제공자·이벤트 ID 중복 방지

후속 연동에서는 플랫폼 우선, 마지막 수정시각 비교, 취소 상태 보존, 충돌 시 자동 덮어쓰기보다 관리자 확인을 적용한다. Google 장애나 연결 해제가 일반 근로자의 일정 조회를 막아서는 안 된다. 일반 근로자에게 Google 계정을 요구하지 않는다.

## 13. 검증

GitHub Actions의 격리 Supabase에서 다음을 실행한다.

1. migration 전체 순차 재적용
2. DB lint
3. 기존·새 pgTAP
4. 기존 Phase 1A Auth/Data API
5. Today·작업방법 Auth/Data API
6. 일정·공지·확인 Auth/Data API
7. 정적 보안·라우팅·화면 회귀 테스트
8. 로컬 Supabase 정리

테스트 데이터는 `example.test` 가상 계정만 사용한다. 운영 Supabase, 실제 직원 데이터, service role 키를 사용하지 않는다.

## 14. 운영 적용 전 확인

- 운영과 분리된 비운영 Supabase에서 migration dry-run
- 전체 pgTAP·Auth/Data API 통과
- 360px 휴대전화와 태블릿 확인
- 스크린리더 제목·포커스·외부 링크 안내 확인
- 팀장·현장 책임자의 실제 대상 범위 검수
- 공지 수정 후 재확인 흐름 검수
- 기존 `today_information_items` 운영 데이터의 점진적 이전 계획 확정
- 외부 캘린더 필드는 실제 동기화 전까지 비워둠
- 운영 Supabase 적용과 실제 계정·데이터 입력은 별도 사용자 승인 후 수행

## 15. 의도적으로 제외

- Google Calendar 실제 API·OAuth
- Gmail·문자·카카오·푸시 알림
- 월간 복잡한 달력과 반복 일정 전체 기능
- 일정 변경 요청
- 댓글·평가·근태·출퇴근·업무실적
- 파일 업로드·Storage RLS
- PWA·서비스 워커·QR
- 운영 Supabase 적용
