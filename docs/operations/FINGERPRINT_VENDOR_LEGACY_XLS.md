# 지문인식기 구형 Excel(.xls) 가져오기 — 2026-10-21

## 실제 장애

- 운영팀장이 `지문 Excel 가져오기`에서 실제 지문인식기 원본 `.xls`를 선택하면 `attendance_xlsx_required`가 발생함.
- 소스: `app/assets/payroll-attendance-xlsx.js`는 `.xlsx`만 허용했으며 `attendance-admin.js`의 파일 선택기도 `.xlsx`로 제한했음.
- 제공 원본은 **진짜 OLE/CFB BIFF8 `.xls`**, ZIP 기반 `.xlsx`가 아님. 개인 데이터는 GitHub에 업로드하지 않음.
- 원본 구조 확인(개인정보 제외): 2개 시트 중 1개 데이터 시트, 13열, 제목 1행 + 2026-10-19 근태기록 **21건**. 컬럼 `일 자 / 요 일 / 사 번 / 이 름 / 회 사 / 부 서 / 직 책 / 직 위 / 출 근 / 출근위치 / 퇴 근 / 퇴근위치 / 총 근무시간`; 출퇴근 시각은 Excel 분수 숫자.
- 분석 단계 기준으로 신원·시간 완전 누락 0건, 같은 직원·같은 날짜 중복 0건. 실제 사번의 직원 매핑 상태는 DB 권한을 이용한 실운영 확인 전까지 미검증.

## 최소 수정

- Draft PR #213의 기존 검증된 `app/assets/payroll-attendance-xls.js` **순수 읽기 코드만 대상 브랜치로 복사**. 해당 Draft PR의 미완료 급여 기능이나 DB 마이그레이션에 런타임 의존 없음.
- 기존 공용 XLSX 분석기에서 `.xls`를 고른 경우에만 독립 `.xls` 파서를 **지연 로딩**한다. 일반 직원·관리자 첫 화면 로딩에는 추가 JS를 요구하지 않는다.
- 기존 `TaejangPayrollAttendanceXlsx.parseXlsxFile(file)`은 `.xls`일 때 기존 BIFF/HTML 파서에 위임, `.xlsx`는 기존 ZIP/XML 경로 유지.
- 출근부 가져오기 버튼에서 `accept=.xls,.xlsx`로 수정. 서버 `import_attendance_external_evidence` RPC, 사번 매칭, SHA-256 원본 해시, 중복 방지, 직원 권한 검증, 출근 확정 정책 모두 그대로 유지.
- 신뢰할 수 없는 파일을 읽을 때 브라우저 내부 처리 및 8 MiB 안전 한도; 외부 변환 API 또는 사용자 개인정보 전송 서비스 없음.
- 코드에서 변환 성공을 이유로 출근부가 자동 확정되지 않음. 기존 데이터 오류/중복은 그대로 차단됨.

## 검증·운영

- `tests/payroll-attendance-xls.test.js`: 익명 BIFF8/CFB 테스트 파일로 실제 `.xls` 읽기, 한국어 13열 헤더/Excel 시간/날짜 분석, 기존 XLSX 경로 유지
- `tests/issue-250-attendance-fingerprint-evidence.test.js`: 파일 선택기·권한·RPC 연결 계약
- `npm run test:platform-static`, `npm run test:payroll`, `npm run build:netlify`, 필수 CI, Preview QA
- 실제 전달받은 원본에서만 추출한 구조적 통계를 비공개로 비교. 실명/사번/출퇴근시간을 Issue/PR/테스트/스크린샷 로그에 넣지 않음.
- User Acceptance: Preview에서 `2026-10-19` 날짜, 실제 파일 `.xls` 선택, 파싱 결과, 중복/미매칭 여부 확인. **운영 DB에 실제 등록은 담당자 명시 승인 없이 수행하지 않음.**
- 이미 생성된 호환본 `.xlsx`와 원본 `.xls`를 **둘 다 연달아 업로드하면 파일 해시가 달라 중복 원장 이력이 생길 수 있음**. 한 쪽만 사용해야 함.
- 고정 48시간 Production 배포 정책과 별도로 강제 배포/DB 변경 불가.
