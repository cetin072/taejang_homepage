# Phase 1 비운영 샘플 데이터 가이드

## 원칙

- 운영 Supabase, 실제 직원 이름·이메일·전화번호·장애·건강·상담·인사 정보는 사용하지 않는다.
- migration에는 샘플 데이터를 넣지 않는다.
- 계정은 `example.test` 가상 정보만 사용하고 고정 비밀번호를 문서·저장소에 남기지 않는다.
- browser에는 publishable key만 사용한다. Auth 사용자를 **자동** 생성·삭제하는 로컬 관리자 도구만 일시적으로 service role 키를 사용하며, 브라우저·Netlify·GitHub·문서에는 넣지 않는다.

### 기본 최소 시드

| 예시 표시명 | 역할 | 부서·작업반 |
| --- | --- | --- |
| `[TEST] 시험 관리자` | `super_admin` | `[STAGING-QA] [TEST] 시험부서` |
| `[TEST] 시험 근로자` | `general_worker` | `[STAGING-QA] [TEST] 시험부서 / 시험 작업반` |

기본 실행은 위 2계정과 작업반 1개만 생성한다. 샘플 콘텐츠는 오늘의 업무, 일정, 중요공지, 작업방법, 자주 보는 안내 각각 1개로 제한한다. 실제 대표이사·직원 계정은 자동 생성하지 않으며, 실제 사용자는 추후 `/staff/` 회원가입 화면에서 직접 가입한다.

### 전체 QA 시드 — 필요할 때만

| 예시 표시명 | 역할 | 부서·작업반 |
| --- | --- | --- |
| 검수 최고관리자 1·2 | `super_admin` | `[STAGING-QA] 검수운영부` |
| 검수 대표 | `ceo` | `[STAGING-QA] 검수운영부` |
| 검수 운영총괄 | `operations_manager` | `[STAGING-QA] 검수운영부` |
| 검수 팀장 | `department_lead` | `[STAGING-QA] 검수현장부` |
| 검수 현장책임자 | `field_lead` | `[STAGING-QA] 검수현장부 / 현장 A반` |
| 검수 사무직 | `office_staff` | `[STAGING-QA] 검수운영부` |
| 검수 근로자 1·2 | `general_worker` | 검수현장부 / 현장 A반, 검수운영부 / 운영 B반 |

전체 QA 시드는 `STAGING_CONFIRM=STAGING STAGING_FULL_QA_CONFIRM=FULL_QA node scripts/staging/seed-phase1.mjs --full`에서만 실행된다. `[STAGING-QA] 검수운영부`·`[STAGING-QA] 검수현장부` 2개 부서와 현장 A반·운영 B반 2개 작업반을 만든다. 시작일, 종료된 멤버십, 오늘 시작 멤버십을 하나씩 두어 KST 경계를 확인한다.

콘텐츠는 오늘 업무, 3단계 이상 작업방법, 회사·부서·작업반·개인 대상 일정·공지·안내, 취소 일정, 수정 공지, 적용 전·종료 안내, 타 범위·초안·사용 중지 자료와 빈 상태를 각각 준비한다. 실제 연락처·개인 사례·건강 정보는 넣지 않는다.

모든 자동 생성 데이터는 `[STAGING-QA]` 제목 prefix, `qa-...@staging.invalid`, Auth metadata `staging_qa: true`, 전용 manifest로 식별한다. 운영 스키마에 QA 컬럼은 추가하지 않는다.

## 실제 사용자 시범운영 초기 입력 금지

실제 사용자가 `/staff/`에서 가입한 뒤에도 초기 시범운영에서는 아래 정보를 입력·업로드·복사하지 않는다.

- 장애 상세정보, 건강정보, 상담기록
- 보호자 연락처, 주민등록번호
- 급여·계약 원문
- 민감한 인사·징계·사고 기록

실제 사용자 계정의 승인·역할 배정은 별도 운영 절차로만 처리하며, TEST·QA 계정과 혼용하지 않는다.

1. 운영과 구분된 테스트 프로젝트 또는 로컬 Supabase에 clean migration을 적용한다.
2. `scripts/staging/`의 검사·시드·검증 명령으로 가상 계정을 생성하고, 반복 실행 시 manifest로 중복 생성을 막는다. 전체 9계정 시드는 별도 확인값이 있는 `--full`에서만 사용한다.
3. 수동 체크리스트와 Auth/Data API 검증을 수행한다.
4. cleanup은 공지 확인 → 콘텐츠 → 작업반 멤버십·작업반 순으로 처리한다. 감사·상태 이력의 삭제 제한은 우회하지 않으며 남은 Auth 계정은 보고한다. 운영 DB에서 샘플 삭제를 시험하지 않는다.
