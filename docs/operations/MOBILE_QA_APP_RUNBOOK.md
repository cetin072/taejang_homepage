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

- QA 앱의 출퇴근은 항상 QA 모드로 진입한다.
- QA 계정이 기존 `qa_validate_attendance_event` 비기록 경로를 사용할 수 있을 때만 GPS/서버 출퇴근 검수가 진행된다.
- QA 앱에서 실제 `record_attendance_event`를 호출하지 않는다.
- QA 검수 권한이 없는 계정은 출퇴근 버튼이 실제 근태를 쓰는 대신 비활성 안내를 표시한다.
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
5. 홈/공지/설정/업무 플랫폼과 수정 기능을 검수한다.
6. 출퇴근은 화면의 QA 표시와 “실제 근태 미반영” 문구를 반드시 확인한다.
7. 검수 완료 후 QA 앱만 삭제해도 Play 앱과 직원 데이터에는 영향이 없다.
8. 후속 QA APK는 같은 QA package에 설치한다. 임시 debug 서명이 달라 업데이트가 거부되면 QA 앱만 삭제한 뒤 재설치하고 QA에 다시 로그인한다. Production 태장은 삭제하지 않는다.

## 배포 흐름

`모바일 수정 → PR → 자동 테스트 + 태장 QA APK → Galaxy Human QA → PASS → main 병합 → 승인된 versionCode 증가 → signed Play AAB → Closed Testing`

Production 공개는 별도 사용자 승인 Gate다.
