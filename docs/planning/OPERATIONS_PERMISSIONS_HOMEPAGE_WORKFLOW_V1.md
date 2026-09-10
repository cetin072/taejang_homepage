# 운영 권한 및 홈페이지 승인 워크플로 v1

- 상태: `확정 · Issue #146 구현 기준`
- 상위 기획: GitHub Issue #145, #146 (2026-09-08 최종 정정)
- 적용 범위: 홍보 콘텐츠, 홈페이지 안전 콘텐츠, Employee 등록, 운영총괄 권한

## 확정 계약

1. `operations_manager`는 일반 플랫폼 운영 기능의 상위 집합이다. `super_admin`은 시스템·비상 안전 역할로 남을 수 있으나 일반 운영 기능의 추가 자격요건이 아니다.
2. `promotion_lead`(표시명 운영팀장)는 전 부서·팀·미배정 신규 Employee를 직접 등록할 수 있다. 서버가 불변 `employee_id`를 발급하며 운영팀장에게 Employee 삭제 권한은 없다.
3. 미발행 홍보 콘텐츠는 운영팀장이 사유와 감사기록을 남기는 recoverable archive로 정리할 수 있다. 공개 이력이 있는 콘텐츠는 숨김/재공개와 운영총괄 삭제 요청 흐름을 사용한다. 발행 후 24시간이 지난 콘텐츠의 삭제는 반드시 요청으로 시작한다.
4. 운영팀장과 운영총괄은 안전하게 식별한 기존 공개 홈페이지 텍스트·이미지 영역만 초안으로 만들 수 있다. 현재 공개본, 변경안, PC·모바일 미리보기, 승인선과 audit를 유지한다. 구조·HTML·CSS·JS·Auth/RLS·배포 설정은 이 워크플로의 대상이 아니다.
5. 운영총괄은 요청을 승인·보완·반려하고 recoverable archive, 숨김/재공개 및 기존 직접수정 기능을 수행할 수 있다. 승인 전 정적 공개본은 변경하지 않는다.

## 이번 구현 대조

| 확정 항목 | 상태 | 구현 위치 |
| --- | --- | --- |
| 운영팀장 전사 신규 Employee 직접 등록 | 구현 완료 | forward migration, `employee-management.js` |
| Employee 삭제 금지 및 ID 불변 | 구현 완료 | 기존 recoverable delete/identity 계약 유지, 회귀 테스트 |
| 운영총괄 단독 최종 홍보 archive | 구현 완료 | forward migration |
| 미발행 글 archive 및 공개 글 24h 삭제 요청 | 구현 완료 | forward migration |
| 홈페이지 allowlist 확대, 비교·PC/mobile preview | 구현 완료 | forward migration, `phase-c-workspace-v2.js` |
| 운영총괄 전체 플랫폼 기능의 RPC/RLS superset 감사 | 검증 진행 | #146 영향 모듈의 UI·RPC·RLS role matrix와 실제 integration 검증을 완료 조건으로 한다. |
| 승인된 홈페이지 변경의 운영 공개 반영 | 구현·검증 진행 | 운영총괄 승인은 canonical live content source에 반영되어 해당 공개 페이지의 safe slot에 적용된다. 이 앱 내부 반영은 저장소 merge·Production 배포 승인과 별개이며, override 장애 시 정적 fallback을 유지한다. |

## 검수 기준

- 일반 직원은 Employee 생성·archive 및 홈페이지 변경 요청을 할 수 없다.
- 운영팀장은 Employee 삭제와 공개 콘텐츠 hard delete를 할 수 없다.
- 운영총괄은 `super_admin`을 추가로 보유하지 않아도 최종 recoverable archive를 할 수 있다.
- 공개 홈페이지의 정적 fallback과 승인 전 공개본은 변경하지 않는다.

## 결정 이력

- 2026-09-08: #145/#146에서 운영팀장 전사 등록, 운영총괄 superset, 공개 콘텐츠 삭제 안전선, 홈페이지 전반 안전 콘텐츠 편집을 확정했다.
- 2026-09-08: 홈페이지 승인 후 canonical live source 반영은 #146의 앱 내부 워크플로로 확정했다. 이는 main 병합이나 Production 배포 승인 게이트를 대체하지 않는다.
