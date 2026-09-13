# Support Radar Ingestion Ledger V1

Status: Phase 2 offline/staging-boundary draft  
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

주요 필드:

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
- cursor, reject details, safe error summary, prepared candidate provenance도 credential-shaped key/value와 과대 payload를 거부한다.
- 실패 run은 cursor를 전진시키지 않는다.
- 성공/실패 모두 이력을 삭제하거나 덮어쓰지 않는다.

### 3.2 `support_ingestion_source_state`

Source별 다음 fetch 지점을 나타내는 작은 authoritative head pointer다.

주요 필드:

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

주요 필드:

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

주요 필드:

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

## 4. 기존 occurrence 최소 보강

Phase 2 Draft migration은 다음 additive column을 사용한다.

- `content_hash_basis_version text`
- `last_ingestion_run_id uuid -> support_ingestion_runs(id)`

`last_ingestion_run_id`의 정확한 의미는 **해당 occurrence를 실제 write/touch한 최신 ingestion 시도**다. 성공 여부와 무관하다.

성공 cursor의 authoritative pointer는 `support_ingestion_source_state.last_successful_run_id`다.

## 5. 날짜 precision 정책

기업마당 Source가 `YYYY-MM-DD`만 제공하는 경우 현재 Phase 1의 `application_start_at` / `deadline_at` `timestamptz`에 임의 시각을 만들어 넣지 않는다.

현재 mapping contract 기준:

- date-only fact는 occurrence provenance에 원값 + precision을 보존한다.
- Phase 1 timestamp field는 비워 둔다.
- 달력상 불가능한 날짜는 거부한다.
- 장기 해결안은 `docs/planning/SUPPORT_RADAR_DATE_PRECISION_DECISION.md`에서 별도 설계한다.

첫 live fetch 전까지는 **정확한 provenance 보존이 완전한 urgency 자동평가보다 우선**이다.

## 6. Idempotency / 수정공고 / 실패 재시도

동일 `(source_id, source_notice_id)`에 대해:

- 처음 발견: `new -> insert`
- 같은 hash + 같은 basis: `unchanged -> touch_seen`
- 다른 hash + 같은 basis: `changed -> update_material_facts`
- basis 변경: `basis_changed -> rebaseline`

다른 source notice ID는 자동으로 revision 관계로 묶지 않는다.

cross-source dedupe는 기존 Phase 1 dedupe 구조를 사용한다.

at-least-once replay에서 item write 후 run 자체가 실패할 수 있다. 이 경우 실패 run의 재평가 필요 신호가 사라지지 않아야 한다.

현재 계약:

1. failed run item event는 직접 평가 후보로 노출하지 않는다.
2. failed run은 cursor를 전진시키지 않는다.
3. 이전 failed run이 `new/changed/basis_changed`를 기록한 뒤 동일 facts가 성공 재시도되어 `unchanged`가 되면, 미해결 `requires_re_evaluation`을 성공 재시도 event가 승계한다.
4. run summary의 `requires_re_evaluation_count`에도 승계를 반영한다.
5. service-only 평가 후보 경계는 succeeded run의 ledger-level `requires_re_evaluation=true` event만 노출한다.

## 7. Rule Engine 연결

향후 deterministic evaluation 대상은 ledger-level `requires_re_evaluation=true`인 succeeded-run event다.

기존 `support_evaluate_notice_v1`은 운영총괄 권한을 전제로 하는 인간용 RPC이므로 service role이 권한을 우회해 호출하지 않는다.

이번 Phase 2 안전 단위는 **평가 후보를 안전하게 식별하는 경계까지만** 준비하고 Rule Engine 자동 실행은 하지 않는다.

AI는 ingestion 단계에 들어오지 않는다.

## 8. 권한 / 보안 경계

- 브라우저가 ingestion ledger에 직접 쓰지 않는다.
- raw item writer는 `private` schema에 둔다.
- service mutation API는 `SECURITY INVOKER` + explicit `service_role` grant를 사용한다.
- public / anon / authenticated에는 writer EXECUTE를 주지 않는다.
- 운영총괄/대표의 필요한 진단 조회만 기존 Support Radar management capability 경계에 맞춘다.
- UI 숨김은 보안 근거로 사용하지 않는다.
- object shape, size limit, Source 일치, one-running-run, stale cursor, credential-shaped metadata, HTTP(S)+host URL을 server boundary에서 다시 검증한다.

## 9. 첫 Staging live fetch 직전 offline pilot 계약

서비스키 없이 다음 경로를 자동검증한다.

`synthetic BizInfo JSON -> normalize -> fingerprint/delta -> pagination -> Phase 1 candidate -> prepared runner -> local service-role RPC -> local PostgreSQL`

첫 live pilot의 fail-closed 기준:

- JSON only
- page 1 only
- `pageUnit <= 20`
- `searchCnt <= 20`
- request filter는 allowlist만 허용
- raw Source page item count와 accepted item count를 분리
- credential-shaped request/cursor/raw provenance를 JS preflight에서도 차단
- malformed/rejected source item이 1건이라도 있으면 pilot 성공 확정 금지
- rejected item은 reject ledger에 기록
- partial valid write가 있더라도 run은 failed로 종료하고 cursor를 전진시키지 않음
- network fetch / credential handling / Rule Engine / AI / Production은 prepared runner 밖에 둔다.

`support-radar-prepared-ingestion-runner.mjs`는 이미 검증된 pilot plan과 service-side RPC transport만 받는다. 외부 fetch와 secret 자체를 받지 않는다.

## 10. 현재 자동검증 자산

- BizInfo normalizer fixture/static tests
- material fingerprint / delta / pagination tests
- Phase 1 mapping/date precision tests
- ingestion ledger/writer/security/input/URL/retry pgTAP
- prepared ingestion runner unit tests
- local Supabase cross-runtime E2E:
  - 정상 insert
  - 동일자료 replay/idempotency
  - document 중복 방지
  - date-only timestamp 미발명
  - reject 1건 포함 partial write 후 failed finalization
  - failed pilot cursor 미전진
- 기존 Phase 1 Auth/Data API regression
- 기존 platform static/staging safety regression

## 11. 다음 외부 승인 게이트

아래는 현재 수행하지 않는다.

- 실제 기업마당 credential 등록
- 실제 기업마당 network fetch
- persistent Staging 외부공고 수집 시작
- Rule Engine 자동 실행
- date-only schema 변경
- Production migration / deploy
- main merge

서비스키 발급 후 첫 실제 검증 범위는:

- `taejang-phase1-staging` only
- 기업마당 1 Source
- JSON
- page 1
- max 20 items
- schedule OFF
- AI OFF
- Rule Engine auto OFF
- Production OFF

실응답 형태를 확인한 뒤 날짜 precision schema 및 다음 페이지 자동수집을 별도 승인한다.
