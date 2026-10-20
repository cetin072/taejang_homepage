# Issue #484 — Google Play 선택 업데이트 출시

기준 main: abc079f2a0bc5101352120905669123e532337ce (#450/#482 병합·사용자 Galaxy 수용). 이번 범위는 버전·검증·운영 절차이며 기존 앱 기능/서버/RLS/직원·근태·공지 데이터를 변경하지 않는다.

## 확인과 승인

- 2026-10-19 Play Console 전체 App Bundle 화면: 총5개, code1~5, 최고0.1.4/code5. Alpha는 테스터에게 제공/전체 출시. Production 비활성. 따라서 기존main0.1.4/code5를 다시 업로드하지 않는다.
- 사용자가 **0.1.5/code6** 명시 승인. 같은정식package com.cetin072.taejang.staff, 기존 upload key/Play App Signing 유지. QA APK 업로드 금지.
- Play upload 인증서 SHA256: AA:A4:D1:5C:17:58:9A:A6:4A:26:F3:13:8C:F7:4F:B2:2A:2A:AB:D4:67:1F:4B:3E:4D:C0:4D:13:74:54:5B:CA (공개 지문). 빌드 AAB의 공개 서명 인증서와 대조한다. 비밀키/암호를 읽거나 출력하지 않는다.

## 재사용 출시 순서

1. 전체트랙/초안 포함 등록된 bundle최고code, 기존 Alpha 설치가능상태, 서명지문을 Console에서 읽는다. 새로운 번호 필요시 명시 승인.
2. 최신main 기능을 유지하고 승인된versionName/versionCode 및package/lock/identity 테스트만 동기화. Draft PR에 기준main/변경점을 남긴다. 버전 메타데이터만 달라져도 해당exactHEAD 테스트/CI를 확인한다.
3. 기존 mobile-app.yml workflow_dispatch를 승인된branch/ref에 build_play_aab=true로 실행. ANDROID_UPLOAD_*4개 이름만 확인하고 기존keystore를 재사용한다. workflow의JAR서명/패키지/ARM64/SDK36/foreground권한/백그라운드위치없음 검사를 확인한다. 다운로드 AAB의SHA256/크기와 keytool 공개지문을 기록한다.
4. Console 업로드직전code6 미사용 재확인, 기존 Closed Testing Alpha 새버전에 정식AAB 업로드. 기존테스터·국가·검토계정·권한/서명설정 변경 없음. 릴리스노트만 이번기능으로 입력하고 심사에 제출한다. 법적동의/보안인증/직접조작이 필요하면 그 지점에서 사용자에게 넘긴다.
5. 검토중·게시대기만으로 출시완료라고 하지 않는다. 대상계정/국가/기기에서 새code가 실제 설치가능함을 확인한 뒤에만 다음선택정책을 적용한다. 직원 계정 로그인이나 시험근태 쓰기는 하지 않는다.
6. **선택업데이트만**: MOBILE_LATEST_VERSION=0.1.5, MOBILE_LATEST_VERSION_CODE=6, MOBILE_FORCE_UPDATE=false, minimum는 현재지원범위(현재null) 유지. MOBILE_UPDATE_TITLE=새 버전이 있습니다, MOBILE_STORE_URL=https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff. 구버전도읽는기존 staff-config public field를 사용한다. Maintenance/최소버전/권한 의미는 바꾸지 않는다.
7. 정책값 변경은 production context의 MOBILE_*에만 한정하고 runtime public response를 다시 읽어 검증. 적용에 redeploy가 필요하면 기존Production published 코드와 기능만 유지하는경로를 사용한다. 미승인main 전체/민감DB migration을 이 작업으로 우회배포하지 않는다(#480/#481 게이트 유지).
8. 실제0.1.3/code4 앱을 삭제하지않고 종료→재실행, 새버전/업데이트/나중에, HTTPS/Play이동, 무삭제업데이트 후nativecode6/세션·읽음/기존근태 보존을 확인한다. 기록은 읽기/모의검수만 한다. 실제단말 미연결이면 물리검수PASS로 보고하지 않는다.
9. 문제시 기존optional정책으로 되돌리고 최소/force를 올리지 않는다. Play binary는 낮은code로 롤백하지않고 다음높은code를 준비한다. Issue #484에 정확HEAD/CI/AAB/지문/실제트랙·심사·설치상태/정책/단말검증을 기록한다.

## 0.1.3 호환성과 한계

0.1.3 source2115ada603ca17a2ac1aa84d24c75bb9c4953088의 UpdateLifecycle/config/release-policy를 확인했다. coldstart staff-config의 latest/minimum/force/title/store_url을 읽고 선택모달(새 버전이 있습니다/업데이트/나중에)과 기존Play package 링크가 존재한다. 백그라운드 복귀시 정책 재조회는 없으므로 이미 실행중인0.1.3은 완전종료후재실행이 필요하다. old store_url은직접열기만하므로 HTTPS store URL을 제공하고 최신앱의market→HTTPS fallback과 혼동하지 않는다. 코드/VM실행과실제Play설치본확인은구분한다.

## 릴리스노트 초안

- 공지 제목과 읽음 표시를 더 쉽게 확인할 수 있습니다.
- 출근하기·퇴근하기와 완료 상태를 구분하고, 출근 성공 시 부드러운 전환과 촉각 안내를 제공합니다.
- 출퇴근 기록을 작은 보조 칩으로 정리하고 글자 확대·동작 줄이기·화면 읽기 안내를 다듬었습니다.

검증결과/산출물/심사·출시 상태는 Issue #484를 source of truth로 갱신한다. 이 문서의 계획을 실행완료로 간주하지 않는다. main병합/Netlify전체Production/민감DB 변경은 이 출시준비 PR에 포함하지 않는다.
