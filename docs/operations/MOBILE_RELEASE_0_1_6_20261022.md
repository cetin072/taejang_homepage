# 태장 직원앱 0.1.6 / Android code 7 — Closed Testing 출시 후보

기준일: 2026-10-22 KST. 현재 Google Play 게시 완료 증거가 아닌 **출시 후보 준비 기록**이다.

## 채택 근거
- 사용자: 설치된 `태장 QA` Galaxy 실기기 검수 완료, 본 앱 최신 반영 지시(2026-10-22).
- 기능 소스: 통합 QA PR [#518](https://github.com/cetin072/taejang_homepage/pull/518), HEAD `858d8468fdf002787c6a67810585ffc20cb1d630`, main 병합 `9968114051cb377533ae30a688879428b8da100f`.
- 출시 브랜치 기준 main: `2bb0f0397a4eb2148da701f56d9e9874a525eada`.
- 기존 Play: 0.1.5 / code 6, Closed Testing Alpha 설치 및 Galaxy 무삭제 업데이트 성공 기록([#484](https://github.com/cetin072/taejang_homepage/issues/484)). 현재 Play Console 전체 트랙·초안 최고 code는 업로드 직전 재확인 필요.

## 최소 출시 범위
- 정식 package `com.cetin072.taejang.staff`, scheme `taejangstaff`, 기존 Play upload key/Play App Signing 유지.
- 0.1.6/code7로 app, package, lock 및 기존 버전 회귀검사만 동기화. 직원앱 로직·디자인·QA/PUSH 계약을 별도로 복제/변경하지 않는다.
- QA 앱은 동일 소스를 쓰되 별도 package `com.cetin072.taejang.staff.qa`; 정식 Play에 QA APK 업로드 금지.
- 기존 기능: 공지 최대 3개 독립 카드, 게시일 숨김, 2줄 제목, 미확인 점, 전체 목록·상세·필수 확인. #518의 검수된 대상 제한 Push 서버 코드는 포함되지만 **일반 직원 전체 Push 발송을 활성화하지 않음**.
- 실제 근태·급여·계정·Auth·RLS·Supabase 데이터·Netlify Production·48시간 릴리스 설정 변경 금지.

## 출시 절차 / 실패 경계
1. PR exact-head 필수 CI 및 Android QA standalone(typecheck/test/manifest) 전부 성공, release diff scope와 기준 main 최신 여부 검증. 실패하면 병합 및 AAB 빌드 중단.
2. **Play Console 전체 트랙/초안/등록 번들 최고 versionCode** 확인. code7 미사용과 Closed Testing Alpha 상태가 확인되지 않으면 AAB 제출 중단(사용자와 번호 조정).
3. 안전검증 후 main 병합. `.github/workflows/mobile-app.yml`의 **Taejang Mobile App → Run workflow**에서 정확한 병합 SHA/main, `build_play_aab=true` 수동 실행. 기존 `ANDROID_UPLOAD_*` 네 secret을 그대로 재사용(내용 열람·새 키 생성 금지).
4. `taejang-employee-mobile-play-aab`의 `app-release.aab` 출력, package, Android versionName/code, JAR signature, upload **certificate SHA-256**, ARM64/SDK36+/권한/background location 부재 검증. Play Console Upload key 지문과 공개 지문 일치 필수. AAB APK/QA variant 혼동 방지.
5. Google Play Console의 **기존 Closed Testing Alpha**에 AAB 등록/릴리스노트 입력/심사 제출; Production 트랙 신규 공개 금지. 직접 Console 조작 도구가 없는 경우 사용자 수동 클릭 지점만 요청하고 **업로드 성공을 추정하지 않음**.
6. 테스터 계정·국가·기기에서 code7 **실제로 설치 가능** 확인 이후에만 서버 optional 업데이트 정책을 별도 점검·승인하여 latest=0.1.6/code7으로 갱신. 기존 `public.mobile_optional_release_policy`의 현재 enabled/updated_at/값을 먼저 readback하고 변경은 경쟁 조건 CAS로 1행만. force=false, minimum 기존 지원 범위 유지; 일반 Push OFF 유지. 구버전 앱에서 Play 이동·무삭제 업데이트·로그인/기존 근태 보존 검수.
7. 실제 검수 증거(최종 PR/SHA·CI run·AAB artifact/해시·Play 트랙 게시·정책 상태·Galaxy 설치)를 본 문서 또는 대응 Issue에 추가한다. 검증 불가 항목은 PARTIAL로 구분.

## 사용자에게 표시할 릴리스노트
- 공지사항을 최근 공지 3개의 간결한 카드로 보여줍니다.
- 공지 제목과 새 글 표시를 더 쉽게 확인할 수 있습니다.
- 공지 상세 확인과 앱 사용 안정성을 개선했습니다.

이번 릴리스에는 전체 직원 대상 자동 푸시 발송 확대를 포함하지 않습니다.
