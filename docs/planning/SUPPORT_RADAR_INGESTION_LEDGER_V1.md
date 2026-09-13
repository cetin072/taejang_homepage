# Support Radar Ingestion Ledger V1

Status: Phase 2 staging implementation draft  
Parent: #161  
Source research: #163  
Phase 2: #174  
Current Draft PR: #189  
Legacy offline parser PR: #175

## 1. 목적

기업마당 등 공식 Source 자동수집을 현재 Support Radar Phase 1 업무흐름에 연결할 때 수집 실행·재시도·cursor·수정공고 판정 근거를 잃지 않도록 authoritative ingestion ledger 경계를 정의한다.

이 ledger는 별도의 제2 지원사업 DB가 아니다.

- 사업 공고의 authoritative normalized record: 기존 `support_notices`
- Source별 occurrence: 기존 `support_notice_occurrences`
- 첨부: 기존 `support_documents`
- 회사 Profile / 평가 / 결정 / 담당 / 신청 결과: 기존 Phase 1 구조
- ingestion ledger: 수집 과정의 실행 이력·cursor·reject·delta provenance

## 2. Phase 1과의 연결

현재 main의 다음 구조를 그대로 사용한다.

- `support_sources`
- `support_notices`
- `support_notice_occurrences`
- `support_documents`
- 기존 Rule Engine / evaluation / human decision workflow

`support_notice_occurrences`의 기존 `source_id`, `source_notice_id`, `source_url`, `raw_payload`, `content_hash`, `discovered_at`, `last_seen_at`를 복제하지 않는다.

## 3. Ledger 구조

### 3.1 `support_ingestion_runs`

한 번의 Source fetch/parse/delta/write 시도를 기록한다.

핵심 필드:

- `source_id`, `stream_key`
- `status`: `running | succeeded | failed`
- `started_at`, `finished_at`
- `request_public`
- `cursor_before`, `cursor_after`
- batch/hash/delta contract version
- fetched/rejected/write-action count
- `requires_re_evaluation_count`
- `retryable`, `error_code`, `error_summary`

규칙:

- credential/service-key는 저장하지 않는다.
- `request_public`에는 공개 endpoint/filter만 저장한다.
- cursor, reject details, prepared candidate, error summary도 credential-shaped key/value와 과대 payload를 거부한다.
- 성공 run만 cursor를 전진시킨다.
- `state='inconsistent'` cursor는 성공 run 또는 source state로 저장할 수 없다.
- 성공/실패 이력은 덮어쓰거나 삭제하지 않는다.

### 3.2 `support_ingestion_source_state`

Source/stream별 마지막 성공 cursor를 보존한다.

- primary key: `(source_id, stream_key)`
- `cursor`
- `cursor_contract_version`
- `last_successful_run_id`
- `updated_at`

이 테이블이 **성공한 수집 진행 위치의 authority**다.

### 3.3 `support_ingestion_rejects`

파싱 실패 항목의 최소 진단 이력을 보존한다.

- 전체 credential-bearing request를 저장하지 않는다.
- 공개 원본 payload 전체를 중복 저장하지 않는다.
- reject details는 크기와 credential-shaped metadata를 검사한다.

### 3.4 `support_ingestion_item_events`

한 run에서 source notice가 어떻게 판정됐는지 기록한다.

- `delta_status`: `new | unchanged | changed | basis_changed`
- `write_action`: `insert | touch_seen | update_material_facts | rebaseline`
- previous/current hash
- hash basis version
- `requires_re_evaluation`

notice 본문 자체를 복제하지 않는다.

## 4. Occurrence 보강 의미

Phase 2에서 다음 additive column을 사용한다.

- `content_hash_basis_version`
- `last_ingestion_run_id`

중요한 의미:

`last_ingestion_run_id`는 **성공한 마지막 run이 아니라, 해당 occurrence를 실제로 write/touch한 최신 ingestion 시도**다.

성공 여부의 authority는 `support_ingestion_source_state.last_successful_run_id`다.

이 구분을 통해 실패 후 재시도에서도 provenance를 잃지 않는다.

## 5. 날짜 precision 정책

기업마당 Source가 `YYYY-MM-DD`만 제공하면 현재 Phase 1의 `application_start_at` / `deadline_at` `timestamptz`에 임의 시각을 만들지 않는다.

- date-only fact는 occurrence provenance에 원값 + precision으로 보존한다.
- Phase 1 timestamp field는 비워 둔다.
- 달력상 불가능한 날짜는 mapper에서 거부한다.
- urgency가 date-only를 사용해야 할 경우 별도 deterministic 정책 또는 additive date/precision column을 명시적으로 설계한다.

첫 live fetch에서는 정확한 provenance가 임의 timestamp보다 우선한다.

## 6. Idempotency / 수정공고 / Fingerprint

동일 `(source_id, source_notice_id)`에 대해:

- 처음 발견: `new -> insert`
- 같은 hash + 같은 basis: `unchanged -> touch_seen`
- 다른 hash + 같은 basis: `changed -> update_material_facts`
- basis 변경: `basis_changed -> rebaseline`

fingerprint는:

- raw payload의 volatile metadata를 제외한다.
- target region/category/hashtag처럼 set 의미인 배열의 순서·중복 노이즈를 제거한다.
- document 목록 순서 변화만으로 material change를 만들지 않는다.
- locale에 의존하지 않는 고정 정렬을 사용한다.
- batch Source와 item Source가 다르면 거부한다.

다른 source notice ID는 자동 revision 관계로 묶지 않는다.

## 7. 실패 run과 재평가 신호

at-least-once 구조에서는 item write 후 upstream 오류로 run이 실패할 수 있다.

따라서 다음을 명시적 불변조건으로 둔다.

1. 실패 run의 item event는 직접 Rule Engine 후보가 아니다.
2. 실패 run은 cursor를 전진시키지 않는다.
3. 실패한 run이 `new/changed/basis_changed`를 write한 뒤 동일 공고가 재시도되면 content delta는 `unchanged`가 될 수 있다.
4. 이 경우 이전 실패 run의 미해결 `requires_re_evaluation` 신호를 성공 재시도의 `unchanged` event가 승계한다.
5. run summary의 `requires_re_evaluation_count`에도 이 승계가 반영된다.
6. deterministic evaluation candidate boundary는 **성공 run + ledger-level requires_re_evaluation=true**인 event만 노출한다.

이 규칙으로 실패 후 동일 재시도에서 평가 필요 신호가 사라지는 것을 막는다.

## 8. Rule Engine 연결 경계

현재 기존 `support_evaluate_notice_v1`은 운영총괄 권한을 전제로 하는 인간용 RPC다.

Phase 2 ingestion writer가 service role을 이용해 이 권한을 우회하지 않는다.

현재 PR #189는 다음까지만 제공한다.

- private service-only re-evaluation candidate boundary
- 성공 run의 평가 대상 판정
- 실패 run 차단
- unchanged retry의 평가 debt 승계

실제 자동 deterministic evaluator 연결은 별도 안전 단위에서 기존 인간 승인/결정 경계를 유지한 채 설계한다.

AI는 ingestion 단계에 들어오지 않는다.

## 9. 권한 / 보안 경계

- 브라우저가 ingestion ledger에 직접 쓰지 않는다.
- 일반 authenticated 직원은 ingestion mutation 권한이 없다.
- raw writer는 `private` schema에 둔다.
- service mutation 함수는 `SECURITY INVOKER`를 사용한다.
- service role에 필요한 table/function 권한만 명시적으로 grant한다.
- authenticated ledger 조회는 기존 Support Radar management capability 경계를 사용한다.
- UI 숨김을 보안 근거로 사용하지 않는다.
- public/private function의 PUBLIC/anon/authenticated EXECUTE를 명시적으로 revoke한다.

입력 방어:

- request/cursor/candidate/raw payload/reject/error 크기 제한
- recursive credential-shaped metadata 차단
- stale cursor 차단
- Source mismatch 차단
- 한 Source/stream의 동시 running run 차단
- browser-reachable URL은 HTTP(S)만 허용
- host 없는 URL, credential-bearing URL authority, `javascript:` / `data:` / `file:` 등을 거부

## 10. 첫 staging live fetch 조건

아래가 모두 충족되기 전 live fetch를 하지 않는다.

1. 최신 main 동기화 및 conflict 없음
2. parser/mapping/delta 전용 테스트 GREEN
3. clean migration reset GREEN
4. DB lint GREEN
5. pgTAP security/replay tests GREEN
6. 실제 Auth/Data API integration GREEN
7. secret leak / URL boundary tests GREEN
8. failed-run/cursor/retry re-evaluation tests GREEN
9. Deploy Preview가 실제 대상 HEAD로 READY
10. Production이 아닌 staging 환경 확인
11. 기업마당 credential 등록에 대한 사용자 승인

첫 live fetch 범위:

- 기업마당 1개 Source
- JSON
- 1페이지
- 소량 `pageUnit`
- Staging only
- Production OFF
- AI OFF
- schedule OFF

## 11. 첫 live fetch 이후 확인할 실제 계약

실제 응답에서 다음을 검증한다.

- HTTP status / encoding
- 실제 field name과 공식 문서 차이
- `totCnt`
- pagination
- source notice ID 안정성
- 날짜 형식/precision
- 첨부 URL과 filename
- 한글/HTML 정규화
- malformed item
- rate limit/error contract
- credential이 로그·DB·에러에 남지 않는지

실제 응답이 문서와 다르면 adapter만 안전하게 보정하고 기존 Phase 1 authority를 복제하지 않는다.

## 12. 현재 승인 게이트

PR #189는 Draft 상태를 유지한다.

사용자 명시 승인 전 하지 않는다.

- 실제 기업마당 credential 등록
- 실제 Staging live fetch
- Ready for review
- main merge
- Production Supabase migration
- Production deploy/ingestion
- 대량 schedule
- 유료 API/외부 AI 연결
