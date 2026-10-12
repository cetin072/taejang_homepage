# 태장 QA 앱 운영 기준

기준일: 2026-10-08
관련 Issue: #410

## 목적

모바일 기능 수정과 버그 수정 때 Google Play에서 설치한 직원용 **태장** 앱을 삭제하지 않고도 같은 Galaxy에서 새 빌드를 검수할 수 있게 한다.

## 앱 구분

| 구분 | 직원용 | QA용 |
| --- | --- | --- |
| 앱 이름 | 태장 | 태장 QA |
| Android package | `com.cetin072.taejang.staff` | `com.cetin072.taejang.staff.qa` |
| scheme | `taejangstaff` | `taejangstaffqa` |
| 설치 | Google Play | GitHub Actions QA APK |
| 데이터 디렉터리/세션 | 별도 | 별도 |
| Play 업데이트 정책 | 적용 | 적용하지 않음 |

QA 앱은 같은 소스 트리를 사용한다. 별도 앱 코드를 복제하지 않는다.

## 안전 경계

- QA 앱 기본은 **운영팀장 시점 + 직원 화면 체험**이다. 실제 로그인 계정이 운영총괄/근태 제외 대상이더라도, 일반 직원과 동일한 출퇴근 카드 렌더러로 모의 출근·퇴근을 체험한다.
- QA 화면 시점: 기본 **운영팀장**(업무 플랫폼 단추 포함), 선택 **일반 직원**(업무 플랫폼 단추 없음). 전환은 화면만 변경하며 실제 로그인 계정의 capability, 서버 권한, 공지 노출 범위는 변경하지 않는다. 업무 플랫폼 버튼을 눌러 실제 접속하는 것은 로그인 계정의 서버 capability가 있을 때만 가능하다.
- QA 출퇴근 화면 체험은 **메모리 안에서만** 출근·퇴근·완료 상태를 바꾸며 실제 위치 요청, `record_attendance_event`, 출퇴근 예외 요청, 근태 저장을 실행하지 않는다. 기기 재실행 시 체험 상태는 초기화될 수 있다.
- QA의 **오늘 · 서버 달력**은 읽기 전용 `get_attendance_workday_status`와 `get_my_attendance_today`를 사용해 KST 날짜, 근무일·휴무일, 오전 6시 출근 가능 여부를 확인한다. 운영총괄 개인의 `attendance_required=false`로 일반 직원 화면을 막지 않는다. 서버 응답 오류 또는 날짜 불일치 시 출근을 비활성화한다.
- QA 고정 예시 **평일(2026-10-08)**, **한글날(2026-10-09, 공휴일)**은 회귀검사용 fixture다. 일반 직원/운영팀장 모두 한글날에는 `오늘은 출근일이 아닙니다`, `한글날`이 표시되고 출근을 누를 수 없어야 한다. 고정 예시는 실서버의 해당 날짜를 다시 판정하는 기능이 아니다.
- 별도 **GPS·서버 검수**로 전환하면 기존 `qa_validate_attendance_event` 비기록 경로를 사용한다. 검수 권한이 없는 계정은 버튼이 비활성화된다.
- QA 앱에서 실제 `record_attendance_event`를 호출하지 않는다. 출퇴근 예외 요청·급여·확정 데이터는 QA 체험으로 수정하지 않는다.
- 서버 capability/RLS/RPC가 최종 권위다.
- QA 앱은 production용 강제/선택 업데이트 팝업, 최소 버전 차단, Play 이동을 적용하지 않는다. 현재 같은 `mobileRelease` 객체의 점검 팝업도 생략하여 검수 접근을 유지한다. 서버의 실제 접근 제한이나 장애는 우회하지 않으며 API 오류로 확인한다. 별도 QA 서버 release 정책은 도입하지 않는다.
- Push 기기 등록은 QA 앱에서 자동 수행하지 않는다. 설정의 알림 버튼을 사용한 명시적 수동 검수는 가능하다.
- Production DB/RLS를 QA 앱 때문에 별도로 완화하지 않는다.

## CI 산출물

모바일 PR의 `Taejang Mobile App` workflow가 다음 QA APK를 자동 생성한다.

- artifact: `taejang-employee-mobile-qa-app-apk`
- APK: `app-release.apk`
- variant: `TAEJANG_APP_VARIANT=qa`
- package: `com.cetin072.taejang.staff.qa`
- release-mode JS bundle 포함
- QA/debug signing key 사용
- Google Play 제출물 아님

Play AAB job은 `TAEJANG_APP_VARIANT=production`을 명시하고 기존 `com.cetin072.taejang.staff` package 검증을 유지한다.

## Galaxy 검수 흐름

1. Google Play의 **태장** 앱은 그대로 둔다.
2. PR의 Checks → `Taejang Mobile App` → 성공한 최신 HEAD의 workflow run → Artifacts → `taejang-employee-mobile-qa-app-apk` ZIP을 받아 압축을 풀고 `app-release.apk`를 설치한다. GitHub 로그인이 필요하며 보존 기간은 7일이다. Android 설치 허용을 요청하면 APK를 연 앱에만 허용한다.
3. Galaxy 앱 목록에서 **태장 QA**를 연다.
4. QA 앱은 별도 패키지이므로 로그인은 별도로 한 번 수행한다.
5. 첫 실행 기본이 **운영팀장 시점**인지 확인한다. QA 표시 아래 검수 설정을 열어 **일반 직원 시점**으로 전환하고 업무 플랫폼 버튼이 없어지는지 확인한다.
6. 직원 화면 체험에서 **오늘 · 서버 달력** 확인 → 한글날 예시에서 공휴일 이름과 출근 비활성화 확인 → 평일 예시에서 출근·퇴근·완료·다시 체험을 확인한다. 체험 중 실제 근태는 기록하지 않는다.
7. **GPS·서버 검수**로 변경하면 검수 권한 계정에서만 기존 위치·서버 검수를 수행한다. 서버 저장·백엔드 출근부 반영 검사는 비운영 전용 테스트 계정의 별도 검증이며 화면 체험 PASS만으로 서버 연동 PASS라 판단하지 않는다.
8. 실제 로그인 계정의 권한에 따라 공지 내용과 업무 플랫폼 열기 권한이 다를 수 있다. QA의 시점 전환은 직원 사칭이나 권한 변경이 아니다.
9. 검수 완료 후 QA 앱만 삭제해도 Play 앱과 직원 데이터에는 영향이 없다.
10. 후속 QA APK는 같은 QA package에 설치한다. 임시 debug 서명이 달라 업데이트가 거부되면 QA 앱만 삭제한 뒤 재설치하고 QA에 다시 로그인한다. Production 태장은 삭제하지 않는다.

## 배포 흐름

`모바일 수정 → PR → 자동 테스트 + 태장 QA APK → Galaxy Human QA → PASS → main 병합 → 승인된 versionCode 증가 → signed Play AAB → Closed Testing`

Production 공개는 별도 사용자 승인 Gate다.
