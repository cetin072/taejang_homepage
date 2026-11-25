# 유급 연차일 출퇴근 누락 오탐 수정

## 범위와 원인
2026-11-01~2026-11-09 운영 기록을 읽기 전용으로 점검했다. 4개 날짜·6개 직원일에서 유급 연차 상태인데도 출근/퇴근 누락이 각각 표시되는 총 12건을 확인했다. 개인별 이름·UUID·인사 사유는 공개 저장소에 기록하지 않는다.

기존 재개방 안정화의 blocker wrapper는 과거 Excel 근거만 누락 예외로 제외하고, 현재 canonical `private_attendance_effective_status`의 `paid_leave` 상태를 누락 판정에서 제외하지 않는다. 직원앱 연차 요청이 없는 관리자 직접 연차 등록도 현재 계약상 유효하다.

## 변경
최종 private blocker 함수에서 canonical 상태가 `paid_leave`인 직원의 `missing_clock_in`/`missing_clock_out`만 제외한다. 자동 확정·출퇴근 시간 생성·예외 해소 원장 쓰기는 하지 않는다. 다른 사람·다른 날짜·GPS/급여 검토·미래 예외와 기존 Excel 요구 폐기는 유지한다. 연차에서 근무로 변경되면 다시 출퇴근 누락을 검사한다.

## 검증
- 플랫폼 정적 검사 656건 PASS.
- 운영 데이터에 새 판정 조건을 SELECT로만 대입: 연차 오탐 12건만 제외되고 다른 blocker는 그대로 남는다. 이 결과는 배포/DB 적용 완료를 뜻하지 않는다.
- 합성 pgTAP: 관리자 직접 연차 2명, 실제 근무 누락 대조군, 시간 미생성, 일일 자동 확정 없음, 근무 복귀 시 누락 복원, 다른 gate·순서·익명/일반 사용자 ACL 보존. 전부 transaction rollback이며 격리 CI DB에서 실행한다.

## 서버 반영 안전 경계
- 대상: 태장 기존 프로젝트 `jgsxpdflgkqroecfjzxq`.
- 단일 파일: `supabase/migrations/20261109042312_paid_leave_confirmation_missing_time.sql`.
- SHA256: `b52112fd760a8383a86e9f9fd28a9dbb5bbbb894cb0c0cd9cb21ce68b06f3e13`.
- 변경 대상: 기존 private 함수 `private_attendance_confirmation_blockers(date)` 정의만 교체. 표/데이터/정책 변경 없음.
- 실제 DB 적용은 별도 명시 승인 후 단일 migration만 적용한다. 모든 과거 migration 재실행 금지.
- 적용 전 현재 함수 정의와 ACL을 읽어 baseline(Excel 누락만 제거하는 wrapper)인지 확인·보관한다. 달라졌으면 중단하고 차이를 검토한다.
- 적용 후 11/1~11/9 재조회로 paid_leave 누락 0건, 다른 blocker 동일, 데이터 변경 0건을 대조한다. 하루 전체 확정은 자동으로 실행하지 않는다.
- 복구: 보관한 기존 함수 정의로 되돌린다. 데이터 역변환은 필요 없다. 기존 ACL을 유지하며 권한 확대 금지.
- 현재 실행은 구현·격리 검증 단계다. main/운영 배포/실제 DB 변경은 수행하지 않았다.
