# Support Radar Date Precision Decision

Status: design only / approval required before schema implementation  
Parent: #174  
Current Draft PR: #189

## 문제

현재 Phase 1의 신청기간 필드는 `application_start_at timestamptz`, `deadline_at timestamptz`다.

기업마당은 `reqstBeginEndDe`에서 `YYYY-MM-DD` 수준의 날짜만 제공하는 공고가 많다. Phase 2 ingestion은 이 값을 임의 시각으로 바꾸지 않고 occurrence provenance에 `precision='date'`로 보존한다.

이 선택은 원문 정확성에는 맞지만, 자동수집 공고는 현재 다음 기능에서 불리해진다.

- 마감일 정렬
- D-7 등 urgency 계산
- 마감 임박 중요알림
- Rule Engine의 deadline 기반 실행가능성 판단

따라서 live pilot 이후 Rule Engine을 자동수집 자료에 연결하기 전에 날짜 precision을 공식 스키마로 승격할지 결정해야 한다.

## 선택지

### A. 날짜를 임의 timestamptz로 변환

예: `2026-09-30`을 `2026-09-30 23:59:59+09` 등으로 저장.

장점:
- 기존 쿼리 변경이 적다.

문제:
- Source가 제공하지 않은 시각을 발명한다.
- 시간대 정책이 사실처럼 DB에 굳어진다.
- 다른 Source가 실제 시각을 제공할 때 precision 차이를 잃는다.

판단: 권장하지 않음.

### B. date-only 필드를 additive로 추가

권장안.

예시 구조:

- `application_start_date date`
- `deadline_date date`
- 필요 시 `application_start_precision text`, `deadline_precision text`

정책:

- Source가 날짜만 제공하면 `*_date`만 채운다.
- Source가 실제 timestamp를 제공하면 기존 `*_at`를 사용한다.
- 표시·정렬·D-day 계산은 사용할 수 있는 가장 정확한 필드를 선택한다.
- date-only를 timestamp로 변환해 저장하지 않는다.
- 원문과 precision은 occurrence provenance에도 계속 보존한다.

Rule Engine 초안:

1. 실제 `deadline_at`이 있으면 기존 timestamp 기준을 우선한다.
2. `deadline_at`이 없고 `deadline_date`가 있으면 `deadline_date - current_date`로 D-day를 계산한다.
3. 둘 다 없으면 현재처럼 `verify` 성격을 유지한다.
4. date-only 공고는 시각 단위 마감 판단을 하지 않는다.

알림 초안:

- `deadline_date`가 오늘부터 7일 이내면 D-7 중요조건에 포함할 수 있다.
- 당일 공고는 `오늘 마감`으로만 표현하고 임의 시간을 표시하지 않는다.
- Source가 별도 접수시각/마감시각을 제공한 경우에만 시간까지 표시한다.

### C. provenance에만 계속 보존

장점:
- 스키마 변경 없음.

문제:
- 자동수집 공고의 마감 임박 판단이 장기간 불완전해진다.
- Support Radar의 핵심 목적인 "놓치지 않기"와 충돌한다.

판단: live pilot 전까지는 안전한 임시상태지만 장기안으로는 권장하지 않음.

## 권장 결정

**B. additive date-only 필드 추가**를 권장한다.

이 방식은 기존 Phase 1 timestamp 계약을 깨지 않고, 기업마당처럼 날짜 precision만 제공하는 Source를 사실 그대로 다룰 수 있다.

## 구현 시 필요한 회귀검사

승인 후 구현한다면 최소한 다음을 자동화한다.

1. 기존 timestamp 공고의 정렬·Rule Engine 결과가 변하지 않는다.
2. date-only 공고는 임의 timestamp를 만들지 않는다.
3. `deadline_date` 기준 D-7 / 오늘 / 지난 공고 판정이 deterministic하다.
4. `deadline_at`과 `deadline_date`가 함께 있을 때 timestamp가 우선한다.
5. 지역·자격·경제성 등 기존 점수요소는 날짜 변경과 무관하게 유지된다.
6. 직원/운영총괄 UI는 date-only와 datetime을 혼동하지 않는다.
7. Production 적용 전 local clean migration + pgTAP + Auth/Data API + Preview 회귀를 통과한다.

## 승인 게이트

이 문서는 설계만 준비한다. 아래는 별도 승인 전 수행하지 않는다.

- 실제 schema migration 작성·Staging 적용
- Rule Engine deadline 계산 변경
- 중요알림 deadline 조건 변경
- Production migration

live BizInfo 1페이지 pilot에서 실제 `reqstBeginEndDe` 형태를 확인한 뒤 최종 승인하는 순서가 가장 안전하다.
