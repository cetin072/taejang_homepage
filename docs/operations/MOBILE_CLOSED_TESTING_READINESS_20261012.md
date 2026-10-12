# 태장 직원앱 다음 Closed Testing 출시 준비 — 2026-10-12

관련 Goal: [#368](https://github.com/cetin072/taejang_homepage/issues/368), [#369](https://github.com/cetin072/taejang_homepage/issues/369).
기준 main: `c25973849dbb5f31a5bde4f80a255c49cf4eb661`.
적용 기획: [GOAL_369_MOBILE_OPERATING_FOUNDATION_V1.md](../planning/GOAL_369_MOBILE_OPERATING_FOUNDATION_V1.md).
운영 기준: [MOBILE_APP_DEVELOPMENT_STANDARD.md](MOBILE_APP_DEVELOPMENT_STANDARD.md), [GOOGLE_PLAY_CLOSED_TESTING_RUNBOOK.md](GOOGLE_PLAY_CLOSED_TESTING_RUNBOOK.md), [MOBILE_QA_APP_RUNBOOK.md](MOBILE_QA_APP_RUNBOOK.md).

## 버전 결정 Gate

| 항목 | 현재 근거 / 결정 |
| --- | --- |
| 다음 출시 versionName / versionCode | **`0.1.4` / `5` — 2026-10-12 사용자 Console 확인 및 지시로 확정** |
| 정식 package / scheme | `com.cetin072.taejang.staff` / `taejangstaff` |
| QA package / scheme | `com.cetin072.taejang.staff.qa` / `taejangstaffqa` |
| 현재 Play 트랙 | 비공개 테스트 - Alpha — 사용자 Console 확인 |
| Play 전체 업로드 최고 versionCode | **`4` / `0.1.3` — 사용자 Console 확인(2026-10-12), 이미 사용됨** |
| 버전 결정 | code 4 재사용 금지. 다음 후보 `0.1.4` / `5`로 app/package/lock/identity 테스트 동기화 |
| 업로드 직전 재확인 | 다른 업로드로 code 5가 사용됐다면 중단하고 새 번호를 사용자와 확정 |

Play Console의 App bundle explorer와 모든 트랙(Internal/Closed/Open/Production), 초안/비활성 산출물을 대조해 최고 업로드 code와 확인 시각을 기록한다. 현재 설치한 휴대폰의 버전이나 GitHub AAB 빌드 이력만으로 미사용 번호를 판단하지 않는다. 미확인 번호를 바꾸거나 서명 AAB를 만들어 제출 후보로 확정하지 않는다. 번호가 바뀌면 관련 identity/release 회귀 테스트도 함께 수정하고 exact-head CI/APK를 다시 만든다.

## 통합 범위 및 대조

| 요청 항목 | 구현/검증 상태 |
| --- | --- |
| #425 설정 개인정보/삭제 안내 하단 분리 | 기존 구현 유지; 순서/URL/접근성 계약 테스트 |
| #430 운영팀장 기본 QA·일반직원 전환·휴일 검수 | 기존 구현 유지; 렌더링/한글날/서버 달력/모의 출퇴근 실행 테스트 |
| #436 Play 업데이트 안내 | 기존 구현 유지; 최신/선택/필수/복귀/Play→HTTPS/오프라인/QA 제외 실행 테스트 |
| 일반 직원 출근→퇴근→완료, 06:00 이후 개방 | 실제 AttendanceCard + mocked 기존 서버 RPC 응답으로 실행 회귀 보강; 운영 근태 쓰기 없음 |
| 위치 거부 및 반복 GPS 실패 | 기존 실패 회귀 + 위치 거부 시 실제 근태/예외 미생성 실행 회귀 |
| 로그인·로그아웃·세션 재실행 | 기존 Auth/로그아웃 계약 유지; SecureStore chunk 재실행 보존·갱신·전체 삭제 실행 회귀 보강. 실제 로그인/Android Keystore는 Galaxy 검수 |
| 공지·Push·handoff·업무 플랫폼 권한 | 기존 테스트 및 CI 재사용; QA 시점은 표시만 바꾸며 실제 capability/RPC 권한은 유지 |
| 실제 Play 업데이트/서명 연속성 | Human Gate. QA APK는 별도 package이므로 정식 앱 업데이트 설치를 증명할 수 없음 |
| #440 YouTube 개선 | 병합된 main 그대로 포함; 모바일에서 재개발하지 않음 |
| 급여명세/Hosted Staging | 의도적으로 제외. #384 및 별도 릴리스 #437 수정 없음 |

자동 검사 결과, CI URL, 최종 HEAD와 artifact ID/만료일은 이 준비 PR의 최종 검수 기록에 남긴다. CI PASS와 실기기 PASS를 구분한다.

## 사용자용 업데이트 내용 초안

출시 후보: **0.1.4 / versionCode 5**.

- 설정 화면에서 개인정보 및 계정 삭제 안내를 더 쉽게 구분할 수 있습니다.
- 새 버전이 설치 가능한 경우 Google Play 업데이트 안내를 받을 수 있습니다.
- 출퇴근, 공지 및 로그인 상태 유지 흐름을 통합 검증했습니다.

QA 운영팀장/일반직원 시점 전환은 검수용 앱 기능이므로 정식 직원앱의 신규 기능으로 홍보하지 않는다. Push 실제 수신이나 Android 자동 업데이트 설치를 검증 완료 기능으로 단정하지 않는다.

## QA APK 전달 및 Galaxy 검수

1. 준비 PR Checks → Taejang Mobile App → **최종 HEAD와 같은 성공한 run**의 `taejang-employee-mobile-qa-app-apk`를 선택한다.
2. 개발자가 `gh run download <run-id> --name taejang-employee-mobile-qa-app-apk --dir <검수용 임시 폴더>`로 받아 단일 `app-release.apk`를 전달하는 방식을 우선한다. GitHub Actions의 웹 artifact 다운로드 자체는 ZIP이다. APK 공개 호스팅/새 서비스를 만들지 않는다.
3. 직접 APK 전달을 지원하지 않는 클라이언트에서는 정확한 run URL/artifact ID를 공유해 ChatGPT 또는 사용자가 ZIP을 해제하도록 한다. 버전은 동일해도 최종 SHA를 기준으로 고른다.
4. 기존 Play 태장을 유지하고 **태장 QA**를 별도 설치·로그인한다. QA APK는 Metro가 필요 없는 ARM64 release-mode이며 debug 키로 서명한 검수용이다. Play에 제출하지 않는다.
5. QA 기본 운영팀장 시점 → 일반직원 시점 → 평일 모의 출근/퇴근/완료/다시 체험 → 한글날 비활성 → 서버 오늘 상태를 확인한다. 체험 권한과 로그인 권한을 혼동하지 않는다. 권한 없는 실제 업무 플랫폼 열기는 차단돼야 한다.
6. GPS/server 검수는 승인된 검수 계정으로 명시적으로 전환한다. 기존 QA RPC만 사용하며 실제 record/correction/exception을 만들지 않는다. 위치 거부/실패 시 실제 예외 요청 버튼이 없어야 한다.
7. 공지 목록/상세, 개인정보/계정 삭제 요청 링크, 로그아웃/별도 로그인, 강제종료 후 세션, background 복귀, TalkBack/글자 확대/작은 화면을 확인한다. 삭제 요청 페이지 열기까지만 검수하고 실제 계정 삭제를 제출하지 않는다.
8. QA는 자동 Push 등록을 하지 않는다. 수동 알림 설정/권한 안내를 확인한다. 기존 EAS project ID/FCM 미구성 조건에서 실제 수신은 미검증이며 설정/실기기 후속 확인이 필요하다.
9. QA를 삭제해도 기존 정식 앱 세션/데이터가 유지되는지 확인한다.

QA 앱에는 정식 Play 업데이트 팝업을 넣지 않는다. 선택/필수 정책은 가상 정책으로 자동검사하고, 실제 Play 페이지·설치 업데이트는 아래 정식 앱 흐름에서 검수한다.

## 정식 AAB와 기존 키의 연속성

- 기존 `.github/workflows/mobile-app.yml`의 `android-play-aab`를 그대로 재사용한다. `TAEJANG_APP_VARIANT=production`, 기존 4개 `ANDROID_UPLOAD_*` secrets 이름을 유지한다. 이번 준비에서는 비밀값을 읽거나 새로 만들지 않는다.
- 서명 AAB는 **최고 code 확인 → 버전 확정 → Galaxy QA → 사용자 서명 빌드 승인** 뒤, 검수한 정확한 branch/SHA에 `build_play_aab=true`를 명시해 만든다. 버전 Gate는 사용자 확인으로 해소됐다. 사용자가 서명 AAB 빌드를 아직 금지했으므로 이번 실행에서 dispatch하지 않는다.
- 기존 workflow는 release에 debug 키가 암묵 적용되지 않도록 하고, JAR 서명/Android Debug 인증서 금지/package/ARM64/target SDK 36+/권한/백그라운드 위치 부재를 검사한다. QA APK에도 Manifest 검사를 적용한다.
- 네 secret 이름의 존재는 실제 keystore 동일성을 증명하지 않는다. 빌드된 AAB의 **공개 upload 인증서 SHA-256 fingerprint**를 Play Console App integrity의 Upload key certificate와 대조한다. Play가 설치 APK를 서명하는 app-signing certificate는 upload certificate와 구분한다. 불일치 시 업로드하지 말고 키 소유자에게 확인한다. 비밀키/비밀번호를 로그·PR에 남기지 않는다.
- 기존 앱→새 앱 무삭제 업데이트는 **동일 정식 package + Play app-signing key + 더 높은 사용 가능 code**를 실제 Play 설치로 확인한다. QA debug APK를 정식 앱 위에 덮어씌우지 않는다.

## Closed Testing 제출·설치·정책 순서

1. Play 최고 code 및 트랙을 확인하고 버전을 확정한다. 검수 결과/출시 후보 SHA를 사용자에게 제시한다.
2. 사용자 승인 후 signed AAB를 만들고 위 인증서/package/SDK 검사와 artifact SHA를 확인한다.
3. 사용자: 기존 Closed Testing 트랙에서 AAB 업로드, 릴리스 노트, App Access 전용 검토 계정, Data Safety/개인정보 URL/계정 삭제 경로/위치 권한 설명을 대조한다. 실제 업로드/저장/검토 제출/게시 버튼은 이번 준비에서 누르지 않는다.
4. 테스트 참여자 목록/Google 계정·국가·기기 호환성·opt-in 링크와 실제 사용 계정이 일치하는지 확인한다. 신규 개인 개발자 계정의 Production 접근 조건은 최소 12명이 14일 연속 opt-in이며, 실제 Console 조건을 다시 확인한다.
5. Play 검토 완료 후 대상 직원이 **실제로 새 버전을 설치할 수 있을 때** 기존 앱에서 Play 업데이트를 수행한다. 앱 삭제 없이 로그인/공지/설정/근태 상태가 유지되고 native versionCode가 바뀌는지 확인한다. 실제 직원 근태는 별도 승인 없는 시험 기록을 생성하지 않는다.
6. 위 설치 가능 확인 전에는 `MOBILE_LATEST_*`, `MOBILE_MINIMUM_*`, `MOBILE_FORCE_UPDATE`를 활성화하지 않는다. 이 PR은 운영 환경변수를 변경하지 않는다.
7. 운영 정책 변경 별도 승인 후 `MOBILE_LATEST_VERSION(_CODE)`를 실제 배포 완료 버전으로 설정한다. 먼저 optional 안내, minimum은 기존 지원 범위 유지, force=false. release notes도 확정된 실제 설치 버전에 맞춘다.
8. 모든 대상 계정/국가/기기/배포 범위의 업데이트 가능과 호환성을 확인한 뒤에만 별도 승인으로 minimum/force를 올린다. minimum ≤ latest 유지. 일부 rollout/검토 중 빌드를 강제하지 않는다.
9. 정식 앱 cold start/복귀에서 최신은 무팝업, 구버전은 optional, 승인된 minimum 미달은 forced, market 실패 시 HTTPS, 정책 fetch 실패 시 오래된 차단 해제를 확인한다. 기존 0.1.2/0.1.3 설치본에 새 안내 로직이 없으면 정책만 바꿔 최신 클라이언트 동작이 생기지 않는다. 최초 업데이트는 참여 링크/Play 직접 업데이트 안내가 필요하다.
10. 문제 시 사용자 승인으로 latest/minimum/force를 마지막 정상 정책으로 되돌린다. Play는 낮은 code로 되돌리는 업데이트가 아니라 수정한 더 높은 code의 빌드를 준비한다. 서버는 이전 앱과 하위호환을 유지한다.

## 남은 사람 Gate

- 최고 Play upload code 4 / Alpha 확인은 완료. 업로드 직전 code 5 미사용 재확인, 새 버전 설치 가능 상태 및 upload certificate 일치는 후속 검수.
- Galaxy 동시 설치/읽기·모의 출퇴근/가독성/세션/기기 권한과 실제 정식 업데이트 설치.
- 실제 Push 수신은 기존 EAS/FCM/dispatcher 구성이 갖춰진 뒤 검수.
- Draft PR 수용/병합, 서명 AAB 빌드, Play 제출/게시, 운영 MOBILE_* 변경은 각각 사용자 승인. Production 공개는 별도 승인.

## 공식 정책 참고 — 2026-10-12 확인

- [Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk): 새 일반 Android 앱/업데이트는 API 36 이상. 생성 Manifest로 확인한다.
- [신규 개인 개발자 계정 테스트 조건](https://support.google.com/googleplay/android-developer/answer/14151465): 최소 12명, 14일 연속 opt-in. Production 공개 승인을 대신하지 않는다.
