# 일반 근로자 ‘오늘’ 정보게시판 구현

상태: **개발 검증용 — 운영 Supabase 적용 전 비운영 검증 필요**

## 1. 적용 기준

- `PROJECT_CHARTER.md`
- `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md`
- `docs/planning/MOBILE_TASK_DASHBOARD_V1.md`
- `docs/planning/FIELD_LEAD_OPERATION_RECORDS_V1.md`
- `docs/planning/MVP_FUNCTIONAL_SPECIFICATION_V1.md`
- `docs/planning/ROLE_SCREEN_MAP_AND_NAVIGATION_V1.md`
- `docs/planning/ROLE_PERMISSION_MATRIX_V1.md`
- `docs/planning/ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md`
- `docs/planning/PHASE1A_DATA_MODEL_V1.md`
- `docs/planning/PHASE1A_ACCESS_RLS_V1.md`
- `docs/planning/STAFF_PWA_ENTRY_AND_INSTALLATION_V1.md`
- `docs/PHASE1A_SECURITY_FOUNDATION_IMPLEMENTATION.md`

PR #20에서 병합된 인증·계정상태·역할 자동 라우팅을 그대로 사용한다. 이 구현은 일반 근로자에게 업무 시작·진행·완료·생산량·실적·출퇴근·자유보고를 요구하지 않는다.

## 2. 이번 구현 범위

### 구현 완료

- 일반 근로자 `/app/` 첫 화면을 읽기 전용 ‘오늘’ 정보게시판으로 변경
- 오늘 날짜와 사용자 이름
- 오늘 근무시간
- 시간순 오늘 업무
- 업무 상세의 장소·담당 반장·준비물·쉬운 주의사항
- 중요 일정·공지 요약
- 최소 작업방법 참조와 준비 중 상세영역
- 작업반과 반원·반장 배정 이력
- 전체·부서·작업반·개인 대상 범위
- 일반 근로자 조회 RLS와 안전한 집계 RPC
- 관리자 최소 작성·수정·취소 화면
- 중요 변경 감사로그
- pgTAP과 실제 Auth/Data API 통합 테스트

### 부분 구현

- 작업방법: 제목·간단 설명·준비물·주의사항·게시상태만 구현
- 일정·공지: 오늘 화면에 필요한 요약만 하나의 최소 테이블로 구현
- 작업반 관리: 안전한 RPC와 데이터 구조를 구현했지만 별도 조직관리 화면은 후속

### 의도적으로 제외

- 작업 시작·완료·진행률·생산수량·실적
- 출퇴근·근태
- 작업 결과·문제·조치·인계
- 반복업무 템플릿
- 작업방법 대표사진과 3~7단계
- 전체 일정관리와 월간 달력
- 공지 확인 통계
- 파일 업로드와 Storage RLS
- PWA·서비스 워커·QR
- 운영 Supabase 연결과 실제 직원 데이터

## 3. migration

파일:

`supabase/migrations/20260723000200_general_worker_today_board.sql`

기존 `20260723000100_phase1a_security_foundation.sql` 다음에 적용한다. migration 전체는 하나의 트랜잭션으로 실행한다.

### 3.1 `work_groups`

- 작업반 이름
- 소속 부서
- 활성·비활성
- 표시 순서
- 작성자·수정자와 시각

물리삭제보다 비활성화를 사용한다.

### 3.2 `work_group_members`

- 작업반
- 프로필
- `worker | lead | assistant`
- 시작일·종료일
- 배정자

현재 소속만 덮어쓰지 않고 시작일·종료일로 과거 배정을 보존한다. 일반 근로자의 현재 작업반 판정에는 오늘 날짜에 유효한 행만 사용한다.

### 3.3 `work_guides`

- 부서
- 작업방법 제목
- 간단 설명
- 준비물
- 주의사항
- `draft | published | inactive`
- 버전
- 변경 사유
- 작성자·수정자·게시시각

이번 단계에는 사진과 단계 테이블이 없다. 일반 근로자에게는 오늘 업무에 연결된 `published` 자료의 최소정보만 반환한다.

### 3.4 `daily_work_assignments`

- 날짜와 시작·종료시간
- 업무명
- 장소
- 담당 반장
- 준비물
- 쉬운 주의사항
- 작업방법 참조
- 대상 범위
- `draft | published | cancelled | inactive`
- 변경 사유
- 작성자·수정자와 시각

일반 근로자 입력을 의미하는 상태·실적·근태 필드는 없다.

### 3.5 `today_information_items`

오늘 화면에 필요한 근무시간·일정·공지 요약을 저장한다.

종류:

- `work_hours`
- `training`
- `external_activity`
- `holiday`
- `location_change`
- `event`
- `transport`
- `notice`
- `safety`

필드:

- 날짜와 선택적 시간
- 제목과 쉬운 안내문
- 장소와 준비물
- 중요 여부
- 대상 범위
- 상태와 변경 사유
- 작성자·수정자와 시각

전체 일정·공지 기능을 미리 만들지 않고 오늘 화면에 필요한 최소 공통필드만 사용한다.

## 4. 대상 범위

`today_target_scope`:

- `company`: 전체 활성 직원
- `department`: 지정 부서
- `work_group`: 지정 작업반의 현재 구성원
- `profile`: 지정 개인

대상은 한 행에 하나만 지정한다. 개인별로 같은 내용을 여러 행 복제할 필요가 없다.

일반 근로자 조회 조건:

1. 현재 DB의 계정상태가 `active`
2. 상태가 `published` 또는 `cancelled`
3. 오늘 날짜
4. 다음 중 하나
   - 전체 대상
   - 본인 부서 대상
   - 본인이 오늘 유효한 구성원인 작업반 대상
   - 본인 개인 대상

`cancelled`는 삭제하지 않고 일반 화면에 취소 상태로 보여준다. `draft`와 `inactive`는 보이지 않는다.

## 5. 일반 근로자 RLS

일반 근로자에게 허용:

- 본인이 속한 활성 작업반 최소정보
- 본인의 작업반 배정 이력
- 본인 대상범위의 게시·취소된 업무
- 본인 대상범위의 게시·취소된 오늘 일정·공지
- 오늘 업무에 연결된 게시 상태 작업방법 최소정보

일반 근로자에게 차단:

- 다른 개인·다른 작업반 업무
- 초안·사용 중지 자료
- 다른 근로자의 작업반 배정
- 변경 사유
- 작성자·수정자 내부 식별정보
- 직접 insert·update·delete
- 관리자 옵션과 작성 RPC
- 감사로그

브라우저 필터가 아니라 RLS와 `get_my_today_board(date)`가 같은 대상 판정을 사용한다.

## 6. 관리자 작성 범위

허용 역할:

- `super_admin`: 전사
- `operations_manager`: 전사
- `department_lead`: 본인 부서·그 부서 작업반·그 부서 개인
- `field_lead`: 본인이 현재 반장인 작업반과 그 반원 개인

UI에서 역할에 맞는 선택지만 보여주지만 최종 허용판정은 다음 RPC가 DB에서 다시 수행한다.

- `save_daily_work_assignment(...)`
- `save_today_information_item(...)`
- `save_work_guide_stub(...)`
- `save_work_group(...)`
- `set_work_group_member(...)`

기존 대상과 새 대상 양쪽을 검사하므로 URL이나 요청 본문을 바꿔 권한 밖 자료를 가져오거나 수정할 수 없다.

## 7. 오늘 화면 데이터 흐름

```text
/app/ 진입
→ 저장된 Auth 세션 확인
→ get_my_access_context()
→ active + general_worker 확인
→ get_my_today_board(한국 날짜)
→ RLS와 동일한 대상 범위 판정
→ 근무시간·업무·일정/공지 JSON 반환
→ 모바일 우선 카드 렌더링
```

업무는 시작시간 오름차순이고 시간 미정 업무는 뒤에 표시한다. 현재 시각에 따른 진행·지연·실적 판단은 하지 않는다.

## 8. 화면 상태

### 로딩

`오늘 정보를 불러오고 있습니다.`

### 전체 빈 상태

`오늘 등록된 업무가 없습니다. 담당 반장에게 확인하세요.`

### 근무시간 없음

`오늘 근무시간이 등록되지 않았습니다. 담당 반장에게 확인하세요.`

### 작업방법 미연결

`등록된 작업방법이 없습니다. 담당 반장에게 확인하세요.`

### 취소

취소된 업무·일정은 삭제하지 않고 취소 카드와 담당 반장 확인 안내를 표시한다.

### 오류

DB 또는 네트워크의 기술 오류 전문은 화면에 표시하지 않는다. 로그인 만료, 권한 없음, 다시 시도 안내로 구분한다.

## 9. 감사로그

기존 `audit_logs`와 `private_append_audit(...)`를 사용한다.

기록:

- 작업반 생성·수정
- 작업반 구성원 변경
- 작업방법 최소자료 생성·수정·게시·사용중지
- 오늘 업무 생성·수정·대상변경·반장변경·시간/장소변경·취소·작업방법 연결변경
- 근무시간·일정·공지 생성·수정·대상변경·취소

감사 metadata에는 대상·상태·시간·장소 요약·참조 ID만 저장한다. 비밀번호·토큰·건강·장애·상담정보와 장문의 업무·공지 본문은 저장하지 않는다.

일반 근로자는 감사로그를 조회할 수 없다.

## 10. 테스트 데이터

GitHub Actions의 격리 로컬 Supabase에 다음 가상계정만 만든다.

- 테스트 최고관리자
- 테스트 부서 팀장
- 테스트 현장 반장
- 테스트 일반 근로자 A
- 테스트 일반 근로자 B
- 테스트 다른 부서·상태변경 근로자
- 테스트 승인 대기 근로자

이메일은 모두 `example.test`를 사용한다. 실제 직원 이름·이메일·UUID·개인정보는 사용하지 않는다. 작업 종료 시 `supabase stop --no-backup`으로 로컬 스택을 정리한다.

## 11. 자동검증

GitHub Actions:

1. 정적 보안·화면 테스트
2. 격리 로컬 Supabase 시작
3. 깨끗한 DB에 migration 전체 재적용
4. DB lint
5. pgTAP 전체 실행
6. 기존 Phase 1A Auth/Data API 회귀
7. 오늘 게시판 Auth/Data API 통합 테스트
8. 로컬 Supabase 종료

오늘 게시판 통합 테스트:

- 비로그인·pending·suspended·departed·deleted 차단
- 일반 근로자의 본인·부서·작업반·전체 대상 조회
- 다른 개인·다른 작업반·초안 차단
- 일반 근로자 생성·수정 차단
- 최고관리자·부서 팀장·현장 반장 범위
- 시간순 정렬
- 취소 상태
- 작업방법 최소정보
- 감사로그

운영 프로젝트, `supabase link`, GitHub Secrets와 service role 키를 사용하지 않는다.

## 12. 운영 적용 전 확인

- 운영과 분리된 비운영 Supabase 프로젝트에서 migration dry-run
- migration 전체 적용과 DB lint
- pgTAP·Auth/Data API 전체 통과
- 실제 사용할 부서·작업반·반장·반원 배정 검수
- 팀장과 반장의 대상 범위 검수
- 일반 근로자 휴대전화 360px와 공용 태블릿 확인
- 스크린리더 제목구조·키보드 조작 확인
- 취소·빈 상태·오류 문구 현장 확인
- service role·실제 개인정보가 저장소와 브라우저에 없는지 확인
- 운영 Supabase 적용과 실제 직원 생성은 별도 사용자 승인 후 수행

## 13. 후속 확장 지점

### 작업방법

- 대표사진
- `work_guide_steps` 3~7단계
- 단계별 사진·대체텍스트
- 올바른 완성모습
- 자주 하는 실수

### 일정

- 오늘 요약에서 가까운 일정 목록으로 확장
- 반복일정은 실제 필요가 확인된 뒤 별도 설계
- 월간 달력은 초기 제외 유지

### 공지

- 표시기간
- 관련 링크와 이미지
- 필요한 중요공지만 확인기록
- 확인기록을 실적·평가와 분리

### 작업반 관리

- 최고관리자 조직관리 UI
- 승인 시 작업반 배정
- 반 변경·종료 이력 조회
- 공용 태블릿 작업반 화면

## 14. 필요한 환경변수

변경 없음:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저와 Netlify 공개 응답에 넣지 않는다.
