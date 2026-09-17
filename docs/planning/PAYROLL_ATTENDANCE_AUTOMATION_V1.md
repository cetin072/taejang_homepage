# 태장 근태 대조·월간 출퇴근부 자동화 V1

상태: **확정**

적용 Goal: [#142](https://github.com/cetin072/taejang_homepage/issues/142)  
적용 Issues: [#210](https://github.com/cetin072/taejang_homepage/issues/210), [#211](https://github.com/cetin072/taejang_homepage/issues/211), [#212](https://github.com/cetin072/taejang_homepage/issues/212), [#182](https://github.com/cetin072/taejang_homepage/issues/182)

## 목적

운영팀장이 보안업체 지문근태 원본과 현장 수기근거를 대조해 최종 출퇴근부를 만드는 현재 흐름을 보존한다. 정상건을 다시 입력시키지 않고, 보안업체 원본 업로드 후 예외만 확인하게 한다. 확정 근태는 월간 출퇴근부와 **급여 가안**에만 연결하며, 실제 급여 확정·잠금·지급은 이 범위에 포함하지 않는다.

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
| UI의 예외 중심 요약·필터 | 부분 구현 | `payroll-attendance-operator-ux.js`; 영속 예외 queue는 미구현 |
| 재다운로드 diff와 확정값 보호 | 구현 완료 | `20260917225912_payroll_vendor_source_snapshots.sql`, protected hash-index RPC, existing prefill protection |
| correction audit persistence | 부분 구현 | 기존 attendance correction schema와 raw clock append-only persistence; 예외 queue의 correction 작성 흐름은 #211 후속 |
| 월간 출퇴근부 XLSX model/exporter | 부분 구현 | `payroll-ledger-xlsx.js`의 protected-HR join contract·익명 회귀 |
| 기존 Golden workbook 구조/집계 비교 | 미구현·후속 작업 | 실제 Golden 파일을 저장소에 넣지 않음; 안전한 비교 경로 필요 |
| confirmed attendance → payroll draft 연결 | 부분 구현 | 기존 payroll effective attendance 계산 흐름; vendor persistence 완료 후 재검증 필요 |

## 이번 Draft PR 범위

PR #213은 vendor `.xls` import/reconciliation, 예외 중심 UX, confirmed-value 보호 및 월간 출퇴근부 exporter 계약을 다룬다. 적용 planning 문서는 본 문서다.

다음은 이번 PR에서 수행하지 않는다.

- main 병합, Production 배포, 실제 급여 확정·월 잠금·지급·송금
- Sensitive HR 대량 migration 또는 권한 확대
- 실제 민감 HR 데이터를 GitHub 또는 browser fixture에 저장
- shared Employee/Auth/RLS 의미 변경

## 남은 승인 경계

2026-09-18의 Goal 지시로 vendor source snapshot·재다운로드 diff를 DB persistence로 완성하는 비파괴 migration과 최소권한 RPC를 승인 범위 안에서 적용한다. 이 변경은 hash index만 보관하며 shared Employee/Auth/RLS 의미를 바꾸지 않는다. 예외 queue의 별도 correction 작성 흐름과 민감 HR 대량 migration은 여전히 별도 판단이 필요하다.

## 결정 이력

- 2026-09-18: Goal #142 및 Issues #210–#212의 확정 요구사항을 기획 기록으로 정합화했다. 실제 HR 값은 포함하지 않았다.
- 2026-09-18: 사용자 지시에 따라 #210의 비파괴 vendor snapshot persistence를 구현 범위로 확정했다. snapshot에는 해시 인덱스만 저장하고, 원본 초 단위 시각은 저장된 append-only attendance payload에만 유지한다.
