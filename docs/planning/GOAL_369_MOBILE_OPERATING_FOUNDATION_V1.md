# Goal #369 — Android 0.1.2 운영 기반

상태: **구현 기준 확정**
상위 기준: GitHub Goal #368, 장기 결정 #367
적용 기획: 이 문서와 [#369](https://github.com/cetin072/taejang_homepage/issues/369)

## 범위와 경계

- 범위: 직원 Android 앱의 업데이트 안내, 점검 안내, 세션 freshness, 쉬운 오류 안내, splash, Push 권한 진입점, 안전한 지원 진단이다.
- 공통 후보: 버전/점검 정책, 업데이트 UX, Push 권한 UX는 향후 재사용 가능성이 있지만 현재는 태장 앱 한 사용처이므로 `현재는 태장에 두고 공통화 보류`로 둔다.
- 제외: Production DB/RLS/권한 의미, 근태 또는 급여 판단, FCM/EAS 비밀값, Play Closed/Production 게시, 관리자 ERP 화면이다.

## 확정 사용자 흐름

1. 앱은 공개 `staff-config` 응답의 비밀 없는 release policy를 읽는다.
2. 설치 버전이 최신이면 방해하지 않는다.
3. 선택 업데이트면 `나중에` 또는 `업데이트`를 제공한다. 필수 업데이트/최소 버전 미달이면 업데이트만 제공한다.
4. 운영자는 배포 설정의 `MOBILE_*` 공개 변수로 버전, 메시지, Play 링크, 릴리스 노트, 점검 안내를 바꿀 수 있다. 실제 Production 값 변경은 운영 승인 후에만 한다.
5. 동일 설치 버전의 release notes는 SecureStore에 확인 상태를 남겨 한 번만 보인다.
6. 점검 모드에서는 쉬운 안내와 문의 동선만 보여 업무 화면을 막는다.
7. 앱이 foreground로 돌아오면 SecureStore session을 서버와 다시 확인·갱신한다.
8. 설정에서 사용자가 명시적으로 Push 권한을 허용할 수 있고, 거부된 경우 OS 설정으로 이동한다.
9. 진단 화면은 앱 버전/빌드/기기 종류/연결 확인 결과만 표시한다. 토큰, 비밀번호, 위치, 개인정보, 민감 로그는 절대 표시하지 않는다.

## 운영 변수

`staff-config`가 읽는 변수는 모두 공개 UI 정책용이며 비밀값을 포함하지 않는다.

- `MOBILE_LATEST_VERSION`, `MOBILE_LATEST_VERSION_CODE`
- `MOBILE_MINIMUM_VERSION`, `MOBILE_MINIMUM_VERSION_CODE`, `MOBILE_FORCE_UPDATE`
- `MOBILE_UPDATE_TITLE`, `MOBILE_UPDATE_MESSAGE`, `MOBILE_STORE_URL`
- `MOBILE_RELEASE_NOTES_VERSION`, `MOBILE_RELEASE_NOTES`
- `MOBILE_MAINTENANCE_MODE`, `MOBILE_MAINTENANCE_MESSAGE`

변수가 비어 있으면 업데이트/점검 prompt를 만들지 않아, 아직 Play에 없는 binary를 강제로 요구하지 않는다.

## 완료 대조

| #369 항목 | 결과 |
| --- | --- |
| 선택/필수 업데이트와 중앙 정책 | 구현 완료 — semantic version과 Android versionCode를 함께 비교 |
| 업데이트 후 변경사항 1회 | 구현 완료 |
| 태장 splash/loading | 구현 완료 — 승인된 launcher 자산, fake delay 없음 |
| offline/server/session/location/notice 오류 UX | 부분 구현 — 앱 공통 연결·세션은 쉬운 안내, 기존 근태·공지의 한국어 실패 안내 유지; 실제 기기 GPS/Push는 Human QA 필요 |
| foreground freshness | 구현 완료 — active 전환 시 session refresh |
| Push permission/OS 설정 | 구현 완료 |
| maintenance/support diagnostics | 구현 완료 |
| Android build/Closed Testing candidate | 구현 준비 완료; 실제 signed AAB 및 Closed Testing은 비밀값/Play 승인 게이트 |

## 검수 기준

- `npm --prefix mobile run typecheck`
- `node --test tests/mobile-*.test.mjs`
- Android prebuild 및 ARM64 debug APK build
- 실제 Galaxy에서 update link, denied notification setting, offline, resume session, splash, TalkBack/글자 크기 Human QA
