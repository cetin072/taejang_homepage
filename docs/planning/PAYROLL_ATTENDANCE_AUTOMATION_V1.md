# 태장 근태 대조·월간 출퇴근부 자동화 V1

상태: **확정**

적용 Goal: [#142](https://github.com/cetin072/taejang_homepage/issues/142)  
적용 Issues: [#210](https://github.com/cetin072/taejang_homepage/issues/210), [#211](https://github.com/cetin072/taejang_homepage/issues/211), [#212](https://github.com/cetin072/taejang_homepage/issues/212), [#182](https://github.com/cetin072/taejang_homepage/issues/182)

## 목적

운영팀장이 보안업체 지문근태 원본과 현장 수기근거를 대조해 최종 출퇴근부를 만드는 현재 흐름을 보존한다. 정상건을 다시 입력시키지 않고, 보안업체 원본 업로드 후 예외만 확인하게 한다. 장기적으로는 Employee App 출퇴근 event를 Primary source로 사용하고, vendor 원본은 fallback·과거 검증 source로 유지한다. 확정 근태는 월간 출퇴근부와 **급여 가안**에만 연결하며, 실제 급여 확정·잠금·지급은 이 범위에 포함하지 않는다.

## 확정된 업무 흐름

```text
보안업체 .xls 원본 업로드
  → 정상 근태 자동대조
  → 예외만 운영팀장 확인·보정
  → confirmed attendance 누적
  → 기존 태장 월간 출퇴근부 구조의 XLSX 생성
  → 급여 가안 계산
```

### 원본·확정값 경계

- 보안업체 employee number는 reference일 뿐 canonical employee identity가 아니다.
- 직원 이름이 정확히 일치하고 해당 일자 재직 후보가 정확히 한 명일 때만 자동매칭한다. 그 외에는 fail-closed `review_required`다.
- raw fingerprint evidence, 수기 근거, operator confirmed attendance, payroll effective attendance를 구분한다.
- 지문 원본 시간이 운영팀장 최종 인정시간과 다르다는 이유만으로 오류 또는 급여시간으로 자동판정하지 않는다.
- 원본의 초 단위 시간 evidence는 보존하고 UI·출력용 분 단위 값은 파생한다.
- 재다운로드로 행이 추가·변경·소실되어도 기존 accepted/confirmed attendance를 조용히 삭제하거나 덮어쓰지 않는다.

### Attendance source 추상화와 Primary 전환

급여계산기는 source 종류나 raw clock span을 직접 해석하지 않고, source-neutral `confirmed attendance`와 `payroll effective attendance`만 사용한다.

```text
employee_app | vendor_fingerprint | manual_evidence
  → raw attendance evidence (append-only)
  → confirmed attendance (operator correction/audit)
  → payroll effective attendance
  → payroll draft
```

- `employee_app`: 최종 Primary source다. 앱 event는 server-authoritative timestamp, server-side workplace/geofence validation, Employee identity, duplicate in/out protection을 유지하며 원본을 수정·삭제하지 않는다.
- `vendor_fingerprint`: 현행 transitional source와 Employee App 장애·과거 기간·재해복구용 fallback이다. importer를 삭제하지 않는다.
- `manual_evidence`: 종이 수기 출근부 등 비상·확인 evidence다. 정상 근태를 매일 다시 입력하는 source가 아니라 예외 보정의 supporting source다.
- 예: App raw clock-in `08:07`을 수기근거로 `08:00`으로 인정할 때 raw event, confirmed value, reason, actor, timestamp, supporting source를 모두 남긴다.
- 위치는 출퇴근 event 순간에만 검증한다. 실시간 위치추적은 하지 않는다.

### Employee App 전환 로드맵

| Phase | 운영 source | 완료 판단 |
| --- | --- | --- |
| 1 | vendor fingerprint + paper ledger | 현행 급여 자동화·Golden regression 완성 |
| 2 | Employee App + vendor fingerprint + paper ledger | event capture, missing/duplicate, geofence failure, manual correction rate를 기존 확정근태와 비교 |
| 3 | Employee App Primary + paper backup + vendor secondary | 정상 App 근태 자동처리, 예외만 수기근거 확인 |
| 4 | Employee App + paper backup | 충분한 안정성 검증 뒤 vendor regular operation 종료; importer는 recovery/historical fallback으로 보존 |

### 예외 상태

내부 enum은 아래 의미를 보존한다.

- `clock_in_missing`, `clock_out_missing`, `no_fingerprint_record`, `duplicate_source`
- `employee_unmatched`, `source_changed`, `confirmed_conflict`
- `paid_leave`, `unpaid_absence`, `paid_holiday`, `termination`, `out_of_scope`
- `manual_evidence_required`

정상 근태는 예외 목록에서 제외한다. 보정은 before/after, reason, actor, timestamp, source reference를 남기며 raw evidence를 수정하지 않는다.

## 월간 출퇴근부 계약

- 기존 월간 가로형 구조를 유지한다: 오전/오후, 순번, 성명, 성별, 생년월일, 장애유형, 날짜별 출근·퇴근·근무시간, 월 근무시간, 월차, 입사일, 근로지도원.
- `confirmed attendance`만 월 근무시간의 source가 된다. `work` 상태의 confirmed hours만 합산하고, 유급휴가·결근·유급공휴일은 별도 상태로 출력한다.
- 성별·생년월일·장애유형·월차·근로지도원은 raw attendance에 복제하지 않는다. protected HR source가 직원별로 정확히 하나 제공될 때만 결합한다.
- protected HR source가 없거나 불완전하면 export는 fail-closed다. 실제 민감값은 fixture, log, Issue, PR에 넣지 않는다.

## 구현 대조

| 확정 항목 | 상태 | 증거 |
| --- | --- | --- |
| 구형 13-column BIFF `.xls` 직접 읽기 및 실제 기간 판별 | 구현 완료 | `payroll-attendance-xls.js`, vendor import 회귀 |
| 보안업체 Excel 원본 우선 입력, 수기 입력은 예외 보정 | 구현 완료 | `app/payroll/live.html`, `payroll-attendance-editor.js` |
| 초 단위 evidence와 분 단위 파생 | 구현 완료 | `payroll-attendance-vendor-import.js`, append-only editor payload |
| 이름 + 재직기간 fail-closed 매칭 | 구현 완료 | `payroll-attendance-normalizer.js` 회귀 |
| UI의 예외 중심 요약·필터 | 구현 완료 | `payroll-attendance-operator-ux.js`, 예외만 보기와 append-only 보정 사유 재표시 |
| 월 전체 예외 요약·다음 예외 이동 | 구현 완료 | `payroll-attendance-month-summary.js`, `payroll-attendance-editor.js`; 빈 cell은 자동 결근으로 해석하지 않음 |
| 재다운로드 diff와 확정값 보호 | 구현 완료 | `20260917225912_payroll_vendor_source_snapshots.sql`, protected hash-index RPC, existing prefill protection |
| correction audit persistence | 구현 완료 | append-only status/time/reason, source reference, actor/timestamp; `20260918090000_payroll_attendance_exception_reason_context.sql` |
| 확정 예외상태 저장·재표시 | 구현 완료 | `termination`/`out_of_scope`/`manual_evidence_required` 편집·append-only 저장·reload·예외큐 resolved 처리; `20260918093000_payroll_attendance_exception_statuses.sql` |
| 월간 출퇴근부 XLSX model/exporter | 부분 구현 | `payroll-ledger-xlsx.js`의 protected-HR join contract·익명 회귀·휴가/결근/공휴일/퇴사/범위제외/수기근거 상태 표현 |
| 근태 검토내역 XLSX 다운로드 | 구현 완료 | authenticated live page에서 원본 참조·상태·보정사유·미해결 상태를 내보냄. protected HR 열은 의도적으로 제외 |
| 기존 Golden workbook 구조/집계 비교 | 비교 harness 구현 완료·실자료 실행 대기 | 개인정보 없는 employee/day/hour/status aggregate summary + expected diff helper. 실제 Golden 원문은 저장소에 넣지 않음 |
| confirmed attendance → payroll draft 연결 | 부분 구현 | 기존 manual-overlay → canonical payroll calculation input → payroll draft 경로는 회귀검증됨. 새 `manual_evidence_required`는 fail-closed review로 유지; 종료/범위제외의 급여 의미 확정은 #182에서 별도 검증 필요 |
| Employee App event → confirmed/effective attendance → payroll draft | 미구현 | App의 안전한 raw `attendance_events`와 append-only correction은 존재하지만, payroll input builder가 App event를 source-neutral confirmed attendance로 투영하지 않음 |

## 이번 Draft PR 범위

PR #213은 vendor `.xls` import/reconciliation, 예외 중심 UX, confirmed-value 보호 및 월간 출퇴근부 exporter 계약을 다룬다. 적용 planning 문서는 본 문서다.

다음은 이번 PR에서 수행하지 않는다.

- main 병합, Production 배포, 실제 급여 확정·월 잠금·지급·송금
- Sensitive HR 대량 migration 또는 권한 확대
- 실제 민감 HR 데이터를 GitHub 또는 browser fixture에 저장
- shared Employee/Auth/RLS 의미 변경

## 남은 승인 경계

2026-09-18의 Goal 지시로 vendor source snapshot·재다운로드 diff를 DB persistence로 완성하는 비파괴 migration과 최소권한 RPC를 승인 범위 안에서 적용한다. 이 변경은 hash index만 보관하며 shared Employee/Auth/RLS 의미를 바꾸지 않는다. 예외 queue의 확정 상태/사유는 기존 append-only attendance history를 재사용해 구현했다. 민감 HR 대량 migration·권한 확대는 여전히 별도 판단이 필요하며, 해당 승인 없이 월간 출퇴근부의 실제 HR 결합 경로를 새로 만들지 않는다.

## Product Definition of Done — 1차 완료 기준

2026-09-18에 확정한 제품 완료 기준이다. parser·계산엔진·CI만으로는 완료가 아니며, 운영총괄이 태장 업무플랫폼의 `근태·급여관리` 안에서 월 급여 가안 업무를 끝낼 수 있어야 한다.

### 정상 월의 입력과 흐름

- Phase 1 transitional 운영의 외부 입력은 보안업체 지문근태 `.xls` 1개다. 과거 확정 출퇴근부와 실제 급여명세서는 Golden validation 전용이며 운영자가 매월 입력하지 않는다. Employee App Primary 전환 뒤에는 월을 선택하면 App attendance를 DB에서 직접 조회하므로 외부 파일을 매월 입력하지 않는다.
- 급여월 선택 → 파일 내부 근태기간 인식 → 재직기간·이름 기반 자동매칭 → 정상 근태 자동처리 → 월간 예외 요약 → `예외만 보기` → 수기근거에 따른 예외 보정 → 근태 저장/확정 → 월간 집계 → 월~일 7일 주휴 계산 → 급여 가안 검토 → Excel 다운로드 순서가 화면 안에서 가능해야 한다.
- 직원, 재직기간, 입·퇴사일, effective-dated 소정근로시간·시급·월급제, 기존 correction/audit 및 protected HR source는 기존 플랫폼의 권한 있는 데이터에서 자동 참조한다. 월마다 같은 정보를 재입력하지 않는다.
- 미해결 예외가 있으면 급여 최종확정은 fail-closed다. 이 PR은 급여 가안까지만 제공하며 실제 급여 확정·월 잠금·지급은 계속 제외한다.

### 운영 화면과 결과물

- 첫 화면은 전체 재입력표가 아니라 자동처리·한쪽 지문누락·지문기록없음·미매칭·source changed·확인 필요의 요약을 우선 표시하고, 정상근태는 예외 검토에서 숨길 수 있어야 한다.
- 화면에는 파일 업로드부터 예외 처리, 가안 계산, 다운로드까지의 짧은 사용방법을 제공한다.
- `확정 출퇴근부 XLSX`는 confirmed attendance와 월차·결근·유급공휴일·수기처리·퇴사/대상제외 상태를 보존한다. 기존 월간 출퇴근부의 protected HR 열은 권한 있는 정확한 source가 하나일 때만 결합하고, 그렇지 않으면 fail-closed한다.
- `급여대장 XLSX`는 근무·유급·주휴시간, 근태기반 지급액, 월급제 lane, 총지급 가안과 계산/검토 상태를 포함한다. 공식 검증 전인 세무·보험 공제는 임의 추정하지 않는다.
- 업로드 source, 예외, 보정 전후, 사유, actor, timestamp 및 미해결 항목은 플랫폼에서 확인 또는 다운로드할 수 있어야 한다.

### Employee App 최종 Product DoD

- 직원은 App에서 출근·퇴근, 오늘 상태, 공지만 사용해 raw attendance evidence를 생성할 수 있다.
- 급여관리는 선택한 월의 Employee App attendance를 DB에서 직접 조회하고 정상건은 자동 후보 처리한다.
- 담당자에게는 누락·이상·위치/네트워크 실패 등 예외만 노출되며, 종이 수기 출근부로 예외만 보정할 수 있다.
- raw App event는 보정·급여 계산 때문에 변경·삭제되지 않으며, confirmed/effective 값과 audit chain이 분리된다.
- 확정근태는 자동으로 급여 가안과 출퇴근부·급여대장 다운로드에 연결된다.
- vendor fingerprint를 비활성화해도 payroll engine의 source-neutral confirmed/effective attendance 계약은 변경하지 않는다.

### Production 전 검증·UAT gate

- Historical regression은 실제 2026년 6·7·8월의 연속 근태로 월경계 주휴를 검증한다. 8월 Historical Replay는 hourly 23/23, gross difference KRW 0, `unknown_difference` 0을 유지한다.
- Current Rule Shadow는 Monday–Sunday 7일 주를 사용하고 `cross_month_evidence_pending` 및 `unknown_difference`가 0이어야 한다. Historical Replay와의 차이는 `weekly_holiday_rule_change` 등으로 설명한다.
- 실제 2026년 9월 자료로 actual, completed-week, current-week pending, month-end forecast를 구분한 shadow 결과를 낸다. 가짜 근태를 만들지 않는다.
- 실제 운영자 UAT는 로그인 → `근태·급여관리` → 2026년 9월 → 실제 보안업체 `.xls` → 예외만 보정 → 근태 저장 → 급여 가안 → 출퇴근부/급여대장 다운로드를 별도 개발도구 없이 재현한다. 실제 민감 원본은 GitHub에 넣지 않는다.
- main merge, Production, 실제 월 잠금·확정·지급은 이 UAT 결과를 보고한 뒤 별도 사용자 승인을 받아야 한다.

## 결정 이력

- 2026-09-18: Goal #142 및 Issues #210–#212의 확정 요구사항을 기획 기록으로 정합화했다. 실제 HR 값은 포함하지 않았다.
- 2026-09-18: 사용자 지시에 따라 #210의 비파괴 vendor snapshot persistence를 구현 범위로 확정했다. snapshot에는 해시 인덱스만 저장하고, 원본 초 단위 시각은 저장된 append-only attendance payload에만 유지한다.

- 2026-09-18: #211 확정 예외상태 3종을 편집기·보호 RPC·reload·예외큐까지 연결하고 exact-head CI/Preview GREEN을 확인했다.
- 2026-09-18: #212 실자료 Golden 원문을 저장소에 넣지 않고도 월간 인원/근무 person-day/상태/시간 집계를 비교할 수 있는 privacy-safe harness를 추가했다. 실제 protected HR 결합은 기존 승인된 source가 확인되기 전까지 fail-closed로 유지한다.
- 2026-09-18: 사용자 지시에 따라 본 문서에 Product DoD를 추가했다. 정상 운영 입력은 보안업체 `.xls` 1개로 제한하고, Golden 자료는 private validation 전용으로 분리한다. 실사용 UAT와 6·7·8월 Historical regression, 9월 real shadow는 main/Production 승인 전 gate다.
- 2026-09-18: 사용자 지시에 따라 Employee App을 최종 Primary attendance source로 확정했다. vendor fingerprint importer는 삭제하지 않고 transitional/fallback/historical source로 보존한다. App raw event → source-neutral confirmed/effective attendance → payroll 경로는 별도 구현·회귀·pilot metric gate가 남아 있으며, 현재 vendor/manual payroll input을 App event로 바꾸는 것으로 원본 무결성 계약을 약화시키지 않는다.
