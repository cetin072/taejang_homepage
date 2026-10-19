# 모바일 선택 업데이트 안내 정책 분리 — Draft (Issue #484)

## 상위 목표
Google Play 업데이트를 승인된 테스터에게 제공한 뒤 직원 앱 시작 시 "업데이트 / 나중에" 안내가 나오게 한다. 더 이상 홈페이지 전체 Production 배포와 버전 변경을 결합하지 않는다.

## 구현 범위
- 기존 Netlify staff-config 공개 API 및 기존 모바일 UpdateLifecycle을 재사용한다. 앱 AAB 업데이트, 로그인, 출퇴근, 공지, 네비게이션 변경 없음.
- 공유 Supabase에 공개 비민감 버전 정보 단일 행 `public.mobile_optional_release_policy`를 새로 두고 **초기 비활성** 상태로 등록한다.
- Netlify staff-config는 서버 시작 시 기존 환경설정을 사용하면서, 요청 시 Supabase REST의 공개 read-only 정책을 짧게 조회한다. 검증된 `enabled=true`이면 latest/title/message/Play URL만 교체하고 minimum=null, force=false를 강제한다.
- 데이터베이스가 느리거나 보안/네트워크 오류가 나거나 표가 없으면 기존 환경설정으로 안전하게 돌아간다. 로그인/공지/근태 API를 막지 않는다. 강제 업데이트 경로는 이 V1 정책으로 활성화할 수 없다.
- DB에서 익명 읽기만 허용, anon/authenticated 쓰기는 전부 거절한다. 새로운 운영 UI·클라이언트 DB 쓰기·추가 외부 서비스·새 비밀 키 없음. 권한 있는 관리자만 서버측에서 정책을 갱신한다.

## 아직 미실행 (운영 경계)
**이 PR 자체는 Production 변경이나 출시 안내 활성화가 아니다.**

1. Draft 기능·RLS/REST/브라우저 CI를 검증하고 권한 변경 및 Supabase migration의 배포/롤백을 별도로 수용한다.
2. 운영 배포를 승인받은 정상 48시간 예약 릴리스에서 해당 Netlify 함수를 **최초 1회** 배포한다. 그 시점의 다른 웹 변경도 별도 QA/승인이 필요하다. 보호된 main-only·Git-only 제한 해제 금지.
3. 먼저 위 표가 존재하고 익명 GET read-back 및 쓰기 거절을 확인한다. Disabled인 동안 앱 알림은 뜨지 않는다.
4. 실제 0.1.5/code6이 대상 테스터에게 설치 가능한 상태임을 확인하고 그때만 권한 있는 관리 경로로 `enabled=true` 반영한다. 별도 Netlify deploy 없이 새 공개 정책이 조회돼야 한다. 새 버전은 항상 사용 가능한 Play code 및 공식 Play URL로 설정한다.
5. 기존 0.1.3/0.1.4 앱을 삭제하지 않고 **완전종료→재실행→선택 안내→Google Play 이동**을 실기기에서 확인한다. 강제/최소 버전은 그대로 비활성. 운영 직원 근태 기록에 시험 쓰기 금지.
6. 잘못된 정보가 나오면 관리 경로에서 `enabled=false`로 돌린다. 동기화 문제/느린 Supabase 조회는 비활성으로 실패한다.

## 현재 남은 차단
현 Production 8489a19의 Netlify 함수는 DB 조회를 하지 않는다. 다른 미검수 main의 웹 변경까지 내보내지 않기 위한 안전한 **최초 코드 배포 승인**은 여전히 필요하다. 이 PR을 병합하거나 표를 생성하는 것만으로 현재 구버전 앱의 안내창은 켜지지 않는다.
