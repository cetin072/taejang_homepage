# 월별 거래처 문서 관리 V1

상태: 사용자 범위 확정 · Claude 원본 확인 · 구현 완료 · 자동 검증 완료 · Preview/DB/Word 검수 대기
확정일: 2026-10-01
적용 기준: `PROJECT_CHARTER.md`, `PLATFORM_CONSTITUTION.md`, `PLANNING_RECORD_SYSTEM.md`, `UNIFIED_CAPABILITY_SIDEBAR_V1.md`

## 목적과 승인 범위

운영총괄이 매월 4개 거래처에 제출하는 공문·견적서·결과보고서를 태장 업무 플랫폼에서 저장·확정하고, 기존 승인 양식과 계산을 사용해 DOCX로 생성한다. 실제 업무 흐름은 DOCX 생성 → 인쇄 → 직인 날인 → 스캔 → 거래처 이메일 발송이다. 메일은 초안·복사만 지원하고 SMTP/Gmail 발송, 자동 PDF 생성, AI API, 소급전용 로직은 추가하지 않는다.

이번 승인 범위는 기존 Draft PR #388 `feat/monthly-client-documents`의 구현, migration 작성, 회귀 검증, Draft PR 업데이트, Deploy Preview와 가능한 PC/mobile 자체 QA다. 새 PR, `main` 직접 변경·병합, Ready for review, staging/production DB 적용 및 production 배포는 제외한다.

## Source of Truth

2026-10-01 제공된 `taejang-docgen-codex-handoff.zip`의 `core.js`, `ui.html`, `taejang-docgen.html`, `tpl.json`, `pkg.zip`은 검증한 원본이다. ZIP과 추출 원본 텍스트는 공개 저장소에 복사하지 않는다. 실행에 필요한 토큰 WordprocessingML, 빈 DOCX package skeleton, 계산·문서 생성 코드는 `app/assets/`의 정식 자산으로만 반영한다.

- `core.js`: 계산식, 날짜·문구·토큰 치환 규칙
- `ui.html`: 실제 입력 필드와 네 회사의 Artifact 운영 기본값
- `tpl.json`: 공문(C), 견적서(Q), 결과보고서(R/Rlast) WordprocessingML 조각 및 section properties
- `pkg.zip`: DOCX package skeleton
- `taejang-docgen.html`: 통합 결과의 토큰·표현·양식 대조 자료
- `mk_tpl.py`, `assemble.py`, `test.js`, `uitest.js`: 원본 생성·검증 참고자료

원본 A4 양식과 디자인을 유지하며 HTML/CSS 인쇄나 PDF 변환으로 다시 만들지 않는다. ZIP 작업 사본은 임시 디렉터리에서만 읽었다. 로컬 브라우저 DOCX 생성은 CDN 대신 JSZip 3.10.1을 사용하며 MIT 라이선스 고지를 함께 둔다.

## 확정 업무 및 데이터 계약

- capability는 `monthly_client_documents.manage`이며 기존 capability resolver의 operations manager 자동 부여만 사용한다. CEO나 `super_admin` 단독, 운영팀장, 홍보직원·팀장, 일반 직원에는 권한을 추가하지 않는다. lower-role simulation에서는 effective capability가 제거되어야 한다.
- sidebar는 기존 단일 소유자인 `dashboard-shell` master item을 사용하고 `업무 운영` section에 `거래처 문서 관리`를 둔다. 직접 진입, 읽기, 저장, 확정·해제, 회사 기본값 수정과 출력 데이터 취득은 모두 서버 권한을 확인한다.
- 두 테이블만 사용한다: 변경 가능한 4개 회사 기본 설정과 월별 aggregate snapshot. 월 snapshot은 공통 입력, 회사별 설정, 추가 프로그램, 작성/확정 상태, revision 및 calculation/template version을 보존한다. 현재 기본값 변경은 과거 월에 반영되지 않는다.
- 회사 기본값: 범한메카텍 19%·상한 7·override 6·7일, 삼현 19%·상한 7·자동·10일, 청우비제이 13%·상한 5·자동·10일, 현대비앤지스틸 17.5%·상한 7·자동·10일. 삼현·청우 10일은 계약 확인값이 아니라 현재 Artifact의 편집 가능한 기본값이다.
- 계산 입력: 장애 중증/경증 여성/경증 남성, 부담기초액, 지원비율, 회사 지분율·상한·override. 자동 적용은 `min(계산상 최대, 계약 상한)`이다. 총 산입, 지분별 최대, 단가, 공급가액, VAT와 합계를 원본 `calcCompany`와 동일하게 결정적으로 계산한다.
- 필수 누락, 잘못된 날짜·수치, 회사 ID 불일치, 중복 문서 순번, 계산 오류 또는 적용 인원이 계산 최대/계약 상한을 넘으면 텍스트 경고를 보여주고 확정 및 DOCX 출력을 막는다. 입력 오류와 경고가 있는 draft는 저장 가능하나 확정은 서버에서 다시 검사한다.
- `outdoor`와 `indoor`만 canonical safety value다. 실내 출력은 `실내 안전교육(영상 교육)`이다. 기존 `indoor_video`는 메일 모듈의 짧은 호환 alias로만 처리하며 새 상태로 저장하지 않는다.
- 문서번호는 월별 회사 순번 01~04로 `YYYY-MM-SS`, 공문 `태장 제YYYY-MM-SS호`, 견적 `TYYYY-MM-SS호`, 결과보고서 `태장 제YYYY-MM-SS호 붙임 2`를 사용한다.
- 월 복사는 직전 월의 반복 입력·회사 snapshot을 복사하고 대상 월을 작성중으로 시작한다. 연/월을 바꾸고 날짜·월별 문구·일회성 프로그램은 초기화한다. 확정 후 일반 수정은 막고 명시적인 확정 해제 뒤 수정한다.

## DOCX와 메일

- 회사별 DOCX는 공문 1쪽 → 견적서 1쪽 → 결과보고서 1쪽의 기존 Word 양식, 4사 합본은 회사별 순서대로 12쪽을 목표로 한다. 각 활성 회사의 번호·이름·인원·금액·날짜·장소·수행 문구가 섞이지 않고 모든 `{{TOKEN}}`이 치환되어야 한다.
- 파일명: `26년 9월_범한메카텍_공문+견적서+결과보고서.docx`, 전체 회사는 `26년 9월_모회사 4사 전체_공문+견적서+결과보고서.docx`, 일부 회사는 display key를 `·`로 결합한다.
- 표준 이메일은 한 종류만 생성한다. 제목과 본문은 편집 가능하고 별도 복사 버튼을 둔다. 메일 계산은 하지 않고 월·회사에 일치하는 공유 calculation 결과만 표시한다. 생성 DOCX 파일명과 실제 인쇄·직인·스캔 후 메일에 표시할 첨부 문구는 별도 값이다.
- 현장 사진 ON은 사진 안내와 ZIP 첨부 표시를 함께 넣고 OFF는 둘 다 뺀다. 메일에서 사용자가 편집한 제목/본문은 월 데이터 변경 시 덮어쓰지 않고 stale 안내와 새 자동초안 적용을 표시한다.

## Golden 기준

2026-09 공통 입력은 중증 20, 경증 여성 0, 경증 남성 3, 총 산입 41, 부담기초액 1,295,000원, 지원비율 70%, 단가 906,500원이다. 네 회사 결과는 범한 7/상한7/적용6/공급 5,439,000/VAT 543,900/합계 5,982,900원, 삼현 7/7/7/6,345,500/634,550/6,980,050원, 청우 5/5/5/4,532,500/453,250/4,985,750원, 현대 7/7/7/6,345,500/634,550/6,980,050원이다.

2026-10 시나리오는 문서일 10-30, 수행일 10-20, 추가 프로그램 없음이다. 범한 번호는 `2026-10-01`, 견적 번호 `T2026-10-01호`, 수행일 표기는 `2026년 10월 20일(화)`, 버스킹 문구는 없으며 공문 3항은 야외 현장 안전교육과 지역사회 환경정비만 포함한다. 날짜 계산은 UTC/strict ISO calendar 기준이다.

## 구현 대조 및 검수 상태

| 항목 | 완료 기준 | 현재 상태 |
| --- | --- | --- |
| 원본 양식·계산·기본값 확인 | 원본 C/Q/R, 계산식, 4사 값 대조 | 확인 완료 |
| 순수 계산·날짜 유효성 | 단일 계산 모듈과 strict ISO 날짜 | 구현 및 golden test 완료 |
| DOCX template/생성 | 원본 package/WordprocessingML 보존, 단일·합본 토큰 검사 | 구현 및 ZIP/XML 구조 테스트 완료; Word 페이지 렌더 검수 대기 |
| 메일 모듈 | indoor canonical, DOCX 파일명 결합 제거, 사진 ON/OFF | 화면 연결·편집·복사·stale 보호 구현 및 단위 테스트 완료 |
| 월 화면·메일 편집 UX | 운영총괄 메뉴, DB CRUD, month copy, 확정, DOCX, 편집/복사 | 구현 및 static contract 테스트 완료; 실제 Preview 흐름 검수 대기 |
| Capability/RLS/RPC | 조회·수정·확정·해제 전부 server guard, revision lock | migration 및 pgTAP 작성; clean replay/pgTAP CI 대기 |
| 2026-09/10 golden | 네 회사 계산·문서, 날짜·안전·추가 프로그램 | 계산·XML 내용·파일명 테스트 완료; 실제 Word 페이지 수 확인 대기 |
| Preview/PC/mobile | exact commit 대표 사용자 흐름과 반응형 QA | 새 커밋 Preview 배포 후 확인 대기 |
| Word/LibreOffice 직접 확인 | 각 출력 문서의 페이지 렌더 확인 | 미수행; 설치/실행 가능한 환경 확인 후 Human Check로 처리 |
| production DB/deploy/merge/Ready | 금지 | 의도적으로 제외 |

실행 결과와 구현 항목별 최종 상태는 Draft PR #388의 변경·검증 기록과 이 문서에 함께 갱신한다. 자동화하지 않은 브라우저/Word 환경 확인은 PASS로 보고하지 않는다.

## 결정 이력

- 2026-10-01: 사용자가 기존 Draft PR #388 흐름의 전체 DOCX 기능 이식을 지시했다. 첨부 원본 확보로 기존 blocker를 해소했고, PDF 가정·PDF 파일명·PDF 페이지 수를 모두 DOCX 기준으로 정정했다. migration/기능/검증은 같은 branch/PR에서 이어간다.
