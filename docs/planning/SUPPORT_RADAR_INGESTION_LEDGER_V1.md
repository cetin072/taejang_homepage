# Support Radar Ingestion Ledger V1

Status: Phase 2 staging design draft  
Parent: #161  
Source research: #163  
Phase 2: #174  
Current Draft PR: #189  
Legacy offline parser PR: #175

## 1. 목적

기업마당 등 공식 Source 자동수집을 현재 Support Radar Phase 1 업무흐름에 연결할 때, 수집 실행·재시도·cursor·수정공고 판정 근거를 잃지 않도록 authoritative ingestion ledger 경계를 정의한다.

이 ledger는 별도의 제2 지원사업 DB가 아니다.

- 사업 공고의 authoritative normalized record는 기존 `support_notices`
- Source별 occurrence는 기존 `support_notice_occurrences`
- 첨부는 기존 `support_documents`
- 회사 Profile / 평가 / 결정 / 담당 / 신청 결과는 기존 Phase 1 구조
- ingestion ledger는 **수집 과정의 실행 이력과 provenance만** 보존한다.

## 2. 현재 Phase 1과의 연결

현재 main에는 다음이 이미 존재한다.

- `support_sources`
- `support_notices`
- `support_notice_occurrences`
- `support_documents`
- Rule Engine / evaluation / human decision workflow

`support_notice_occurrences`에는 이미:

- `source_id`
- `source_notice_id`
- `source_url`
- `raw_payload`
- `content_hash`
- `discovered_at`
- `last_seen_at`

이 있으므로 이를 복제하지 않는다.

## 3. 새 ledger 최소 구조

### 3.1 `support_ingestion_runs`

한 번의 Source fetch/parse/delta/write 시도를 기록한다.

권장 필드:

- `id uuid primary key`
- `source_id uuid not null -> support_sources(id)`
- `stream_key text not null default 'default'`
- `status text`: `running | succeeded | failed`
- `started_at timestamptz not null`
- `finished_at timestamptz`
- `request_public jsonb not null default '{}'`
- `cursor_before jsonb`
- `cursor_after jsonb`
- `batch_contract_version text`
- `content_hash_basis_version text`
- `delta_contract_version text`
- `fetched_items integer`
- `rejected_items integer`
- `insert_count integer`
- `touch_seen_count integer`
- `update_material_count integer`
- `rebaseline_count integer`
- `requires_re_evaluation_count integer`
- `retryable boolean`
- `error_code text`
- `error_summary text`
- `created_at timestamptz not null default now()`

규칙:

- credential/service-key 값은 어떤 경우에도 저장하지 않는다.
- `request_public`에는 endpoint와 공개 filter만 저장한다.
- 실패 run은 cursor를 전진시키지 않는다.
- 성공/실패 모두 이력을 삭제하거나 덮어쓰지 않는다.

### 3.2 `support_ingestion_source_state`

Source별 다음 fetch 지점을 나타내는 작은 authoritative head pointer다.

권장 필드:

- `source_id uuid not null -> support_sources(id)`
- `stream_key text not null default 'default'`
- `cursor jsonb`
- `cursor_contract_version text`
- `last_successful_run_id uuid -> support_ingestion_runs(id)`
- `updated_at timestamptz not null default now()`
- primary key: `(source_id, stream_key)`

규칙:

- cursor는 성공 run 이후에만 변경한다.
- pagination 모순 상태에서는 자동 전진하지 않는다.
- filter가 다른 수집 스트림은 `stream_key`로 분리한다.

### 3.3 `support_ingestion_rejects`

파싱 실패 항목의 최소 진단 이력을 보존한다.

권장 필드:

- `id uuid primary key`
- `run_id uuid not null -> support_ingestion_runs(id)`
- `item_index integer`
- `source_notice_id text`
- `reason text not null`
- `details jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

규칙:

- 전체 credential-bearing request를 저장하지 않는다.
- 원본 공개 payload 전체 복제는 기본값으로 하지 않는다.
- 원본 공고 payload는 기존 occurrence `raw_payload`가 authoritative provenance다.

### 3.4 `support_ingestion_item_events`

한 run에서 각 source notice ID가 어떻게 판정되었는지 기록한다.

권장 필드:

- `id uuid primary key`
- `run_id uuid not null -> support_ingestion_runs(id)`
- `source_notice_id text not null`
- `occurrence_id uuid -> support_notice_occurrences(id)`
- `delta_status text`: `new | unchanged | changed | basis_changed`
- `write_action text`: `insert | touch_seen | update_material_facts | rebaseline`
- `previous_content_hash text`
- `current_content_hash text not null`
- `content_hash_basis_version text not null`
- `requires_re_evaluation boolean not null default false`
- `created_at timestamptz not null default now()`

이 테이블에는 notice 본문을 다시 저장하지 않는다.

## 4. 기존 occurrence에 필요한 최소 보강

`support_notice_occurrences`에는 `content_hash`는 있으나 hash 계약의 버전을 별도 column으로 보존하지 않는다.

Phase 2 staging에서는 다음 additive column을 권장한다.

- `content_hash_basis_version text`
- `last_ingestion_run_id uuid -> support_ingestion_runs(id)`

이 보강이 있어야 parser/hash 계약이 바뀐 경우 `source content changed`와 `hash basis changed`를 구분할 수 있다.

## 5. 날짜 precision 정책

기업마당 Source가 `YYYY-MM-DD`만 제공하는 경우 현재 Phase 1의 `application_start_at` / `deadline_at` `timestamptz`에 임의 시각을 만들어 넣지 않는다.

PR #189의 mapping contract 기준:

- date-only fact는 occurrence provenance에 원값 + precision을 보존
- Phase 1 timestamp field는 비워 둔다.
- live fetch 전에 Rule Engine이 date-only 값을 사용할 필요가 생기면 별도 additive date/precision column 또는 deterministic derived-date 정책을 명시적으로 승인한 뒤 연결한다.

첫 staging fetch에서는 **정확한 provenance 보존이 완전한 urgency 자동평가보다 우선**이다.

## 6. Idempotency / 수정공고

동일 `(source_id, source_notice_id)`에 대해:

- 처음 발견: `new -> insert`
- 같은 hash + 같은 basis: `unchanged -> touch_seen`
- 다른 hash + 같은 basis: `changed -> update_material_facts`
- basis 변경: `basis_changed -> rebaseline`

다른 source notice ID는 자동으로 revision 관계로 묶지 않는다.

cross-source dedupe는 기존 Phase 1 dedupe 구조를 사용한다.

## 7. Rule Engine 연결

Rule Engine 자동 실행 대상:

- `new`
- `changed`
- `basis_changed`

`unchanged`는 기본적으로 재평가하지 않는다.

단, 회사 Profile 버전이 바뀐 경우 Source 변화가 없어도 기존 Phase 1 재평가 정책에 따라 별도로 평가할 수 있다.

AI는 ingestion 단계에 들어오지 않는다.

## 8. 권한 / 보안 경계

- 브라우저가 ingestion ledger에 직접 쓰지 않는다.
- 향후 live fetch worker/server function이 authoritative write를 담당한다.
- 일반 authenticated 직원에게 ledger mutation 권한을 주지 않는다.
- 운영총괄/대표의 필요한 진단 조회만 기존 Support Radar management capability 경계에 맞춰 제공한다.
- UI 숨김은 보안 근거로 사용하지 않는다.

구체 RLS/RPC는 현재 main capability helper를 재확인한 뒤 migration에 작성한다.

## 9. 첫 staging live fetch 조건

아래가 모두 충족되기 전 live fetch를 하지 않는다.

1. PR #189 mapping contract CI green
2. ingestion ledger migration + DB tests green
3. 공개 request metadata allowlist 확정
4. credential 저장 차단 테스트
5. cursor success-only progression 테스트
6. `new/unchanged/changed/basis_changed` replay 테스트
7. Production이 아닌 staging 환경 확인

첫 live fetch 범위:

- 기업마당 1개 Source
- 1페이지
- 소량 공고
- staging
- no Production
- no AI
- no mass schedule

## 10. 다음 구현 단위

1. 이 설계에 맞는 forward-only migration 작성
2. pgTAP/static DB contract test 작성
3. 기존 `support_notice_occurrences` additive 보강
4. #175의 offline parser/delta/run 계약을 최신 main 기준으로 선별 이식
5. staging fixture replay
6. 사용자 승인 후에만 실제 credential 등록 및 live fetch 검토
