# 물류 관리 V1 검수 기록

기준일: 2026-11-14. Issue #681. 운영 적용 전 개발 검수이다.

## 구현 및 재현

- 기준 main: `e6b83aa1d0d6bd9a86d23eb3d7e75c69745e98ee`
- 구현 커밋: `6e0ee159273f32dd872e027aa488fd5deb9672b2`
- 서버 테스트/빌드 실행: https://github.com/cetin072/taejang_homepage/actions/runs/43592802725
- 기능 브랜치에서만 소스를 통합한 임시 전송 파일과 bootstrap workflow는 검수 후 제거한다. 후속 PR은 읽기 권한의 `logistics-workspace-checks.yml`로 계속 검증한다.

## 통과한 자동 검수

| 검사 | 결과 |
| --- | --- |
| 순수 계산/권한/입력 불변성 | 11개 통과 |
| 격리 PostgreSQL 검수 | 통과 |
| JavaScript / SQL 금액 비교 | 48가지 일치 |
| 실제 직급별 허용/차단, 익명/직접 테이블 접근 차단 | 통과 |
| 확정과 차감 분리, 잔액 부족/중복 요청/중복 차감 차단 | 통과 |
| 원장 정정, 고객명 변경 후 과거 견적 보존 | 통과 |
| 같은 고객에 대한 동시 차감 | 통과 |
| `npm run test:platform-static` | 통과 |
| `npm run test:staging-safety` | 통과 |
| `npm run build:netlify` | 통과 |

DB 검수는 기존 격리 helper의 network-none PostgreSQL 컨테이너와 가상 데이터만 사용했다. 운영 DB에 검수용 고객/충전금/견적을 작성하지 않았다. CLI는 migration 파일 생성에만 사용했으며 hosted migration을 적용하지 않았다.

## 로컬 화면 검수

Chromium + 가상 RPC 응답으로 고객 등록/변경, 견적 확정, 과거 견적 열기, 고객용 A4 PDF, 충전금 차감, 기타 비용, 미확인 요청 동일 UUID 재시도, 모바일, 권한 회수 후 화면 정리를 확인했다. 기본 견적 PDF 1페이지를 렌더링해 확인했다. 이는 hosted ERP 로그인/실제 공용 DB를 연결한 종단 검수와 구분한다.

## 아직 하지 않은 작업 / 운영 게이트

- main 병합, 운영/공용 DB migration, Production 배포, 고정 QA alias 변경: 미실행.
- 실제 직원 계정으로 hosted ERP에서 역할별 종단 검수: 미실행.
- 기존 HTML의 실제 고객/충전금 이관: 미실행. 브라우저 JSON 백업과 잔액 대조가 선행되어야 한다.
- 기존 영업/회계 장부 자동 전기: 범위 밖.

운영 적용은 대상 프로젝트와 백업/복구 계획을 확인하고 별도 승인을 받은 뒤 수행한다. 현재 PR을 통과/병합 가능 또는 직원 사용 가능 상태로 오인하지 않는다.
