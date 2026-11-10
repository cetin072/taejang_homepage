# 직원 기본정보 · 장애 분류

2026-11-10 사용자 요청에 따른 구현. Draft, 운영 미반영.

## 확정 범위
- 직원 인사카드 최상단 기본 인사정보에 연결 계정 이메일을 표시한다. Auth 이메일을 여기서 수정하거나 별도 복제하지 않는다. 계정 미연결은 미등록으로 표시한다.
- 장애 여부(확인 전/장애인 직원/비해당), 주장애 유형, 복지 기준 장애정도, 고용 기준 중증·경증을 선택한다. 미입력과 비해당을 구분한다. 기존 직원은 추론·일괄변환하지 않는다.
- 운영총괄(`operations_manager`)·운영팀장(`promotion_lead`)은 보호 직원 포함 전체 비보관 직원의 해당 정보를 기본정보 안에서 바로 열람한다. 기존 편집권한은 유지한다. 운영팀장의 이번 추가 권한은 열람이다.
- 중앙 `employee.disability_view` capability와 기존 `role_capability_grants`를 재사용한다. 향후 직책 추가는 서버 grant 추가와 회귀 검증으로 처리한다. 화면 곳곳의 역할 목록 수정이나 새 권한 관리 UI가 필요하지 않다.

## 공식 분류와 입력 의미
현재는 16유형이다. 기존 15유형에 2026-07-01 시행 췌장장애가 추가되었다.
지체·뇌병변·시각·청각·언어·지적·자폐성·정신·신장·심장·호흡기·간·안면·장루/요루·뇌전증·췌장장애.

- 보건복지부: https://mohw.go.kr/menu.es?mid=a10710010900
- 공식 개정 안내: https://www.nyj.go.kr/www/selectBbsNttView.do?bbsNo=62&key=2481&nttNo=546953&pageIndex=8&pageUnit=10&searchCnd=all
- 장애인고용법 시행규칙 제2조/제3조: https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20261002&lsiSeq=290901
- 중증장애인 확인 고시: https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000281718

복지 기준 `장애의 정도가 심한/심하지 않은`과 고용 기준 `중증/경증(중증 해당 없음)`은 별도로 보관한다. 증빙을 보고 담당자가 확인하며 앱이 유형·옛 등급·복지 정도에서 고용 중증 여부를 자동 판정하지 않는다. 복수장애의 모든 부장애·진단서·등록번호·건강 메모·지원사업 제출은 이번 범위에서 제외한다.

## 저장·권한·실패 경계
일반 직원 테이블/명부가 아닌 private 테이블에 최소 분류값만 저장한다. RLS 활성화, anon/authenticated 직접 SELECT/INSERT/UPDATE/DELETE 불허, 서버 RPC만 허용한다. 읽기도 실제 역할 및 유효 역할 grant와 활성 계정, 직원 메뉴 revoke를 검사한다. 메뉴 위임만으로 건강정보를 새로 공개하지 않는다.

단일 직원 카드를 열 때 자동 조회해 기본정보에 표시한다. 전체 명부/검색/로그/다운로드/브라우저 저장소로 분류값을 확산하지 않는다. 일반 감사기록은 조회·수정 사실만 남긴다. 내용은 넣지 않는다. 쓰기는 기존 employee.update와 employee.manage 운영 권한을 함께 요구한다. 직원 parent row lock과 별도 revision으로 첫 저장 경합 및 오래된 화면의 덮어쓰기를 차단한다. 저장 실패 시 폼 입력 보존, 취소 시 서버 최신값 재조회. 비해당/확인 전 저장은 분류값을 명시적으로 비운다.

## 마이그레이션 및 복구 게이트
추가 테이블·capability grant·함수만 만드는 단일 transaction이다. 기존 직원/계정/주민번호/급여 데이터 변경 및 백필 없음. 운영 DB에는 적용하지 않았다.

적용 전: 대상 프로젝트·현재 schema 및 migration 순서, 두 역할의 현재 grant, 기존 편집범위, employee.manage revoke/역할체험을 staging 실제 인증으로 검증한다. SQL schema 검사만으로 실제 계정 권한 검증 완료를 주장하지 않는다. 건강정보 수집의 내부 동의·보존 근거는 회사 절차로 확인한다.

복구: 운영 승인 후 적용에 실패하면 transaction rollback. 적용 후 기능 회수는 새 capability 비활성화와 RPC execute 회수/이전 프론트 배포로 닫고 저장한 분류 데이터는 보존한다. 운영 저장 뒤 테이블 drop은 복구 방법이 아니며 별도 백업·승인 없이 하지 않는다. 권한 변경은 배포 전 사용자 승인 게이트와 저장소 정책을 따른다.

## 검증 상태
- 신규 계약 검사 + 기존 직원 목록/프로필 단위검사 10/10 PASS. JS 문법 및 diff whitespace PASS.
- 기존 합성 브라우저 QA에 16유형·저장 실패 입력보존·취소·법적 구분 자동환산 금지·팀장 조회/편집분리 추가.
- pgTAP에 schema/ACL/역할 grant/비로그인 RPC 거절 검사 추가.
- 이 cloud shell의 Chromium은 socket Operation not permitted로 실행 실패(승격 시도 후에도 동일). 실제 브라우저 PASS 아님.
- GitHub CI·DB 실행·실제 인증 staging·고정 QA 배포는 별도 확인해야 한다. User Acceptance Ready 미확인 상태로 사용자 검수를 요청하지 않는다.
- main 병합/Ready 전환/운영 배포/운영 migration/실제 직원 입력은 하지 않는다.
