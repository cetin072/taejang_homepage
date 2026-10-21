# 공지 Push 실사용 연결 — 승인 전 준비

기준: Goal #371 기존 RPC/outbox/Expo/deep link 계약 재사용. 이번 변경은 운영 활성화가 아니다.
운영 DB, Edge Function, 비밀값, 예약 실행, 직원 대상 발송은 아직 변경하지 않는다.
기존 0.1.5/code6 메타데이터는 유지하며 이 QA APK를 Play 업로드 후보로 사용하지 않는다.

## 1. 사람 작업: 기존 프로젝트·자격증명 연결

신규 프로젝트/자격증명 생성·등록은 별도 승인 후에만 한다. 먼저 기존 프로젝트를 재사용한다.

1. Expo 로그인 → 해당 조직 → 기존 프로젝트 → **Project settings → General → Project ID**.
   정식/QA 연결 대상을 각각 확인한다. QA가 정식 값을 암묵적으로 상속하지 않는다.
2. Firebase Console → 기존 프로젝트 → **프로젝트 설정 → 일반 → 내 앱**.
   Android 앱 `com.cetin072.taejang.staff`, `com.cetin072.taejang.staff.qa`를 각각 선택해
   해당 `google-services.json` 다운로드. 앱이 없으면 생성 승인부터 받는다.
3. Google Cloud Console → 해당 Firebase 프로젝트 → **API 및 서비스 → 사용 설정된 API 및 서비스**에서
   Firebase Cloud Messaging API(v1) 확인. 서비스 계정 생성/키 발급은 승인된 관리자만 수행한다.
4. 로컬에서 `eas login` 후 `eas credentials --platform android` → 정확한 프로젝트/Android application identifier →
   **Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1)**.
   Firebase 프로젝트와 일치하는 기존 키를 연결한다. 이 비밀 JSON은 Git/GitHub variables/앱에 넣지 않는다.
   EAS 설정을 위해 새로운 keystore를 만들거나 기존 Play upload/signing key를 교체하지 않는다.
5. GitHub → 저장소 **Settings → Secrets and variables → Actions → Variables**:
   - `EXPO_PUBLIC_EAS_PROJECT_ID`, `EXPO_PUBLIC_EAS_PROJECT_ID_QA`
   - `ANDROID_GOOGLE_SERVICES_JSON_BASE64`, `ANDROID_GOOGLE_SERVICES_JSON_BASE64_QA`
     (각 패키지의 공개 google-services.json을 base64 인코딩한 값; FCM 서비스 계정 키 아님)
   이 설정 등록도 승인 후 수행한다. 앱에 포함되는 공개 설정은 비밀키 대용으로 쓰지 않는다.
6. **Actions → Taejang Mobile App → Run workflow**에서 승인된 PR 브랜치를 선택,
   `build_play_aab=false`. 먼저 QA 설정을 모두 연결하고 다시 빌드한다.
   APK 산출물 `taejang-employee-mobile-qa-app-apk`를 지정 Galaxy **1대**에 설치한다.
   QA 패키지는 정식 앱을 덮어쓰지 않으며 QA 자동 등록은 계속 금지한다.

설정이 없으면 QA 빌드는 가능하지만 요약에 **Push NOT configured**가 표시된다.
이 바이너리로 Token/실수신 검수를 요청하지 않는다. 정식 AAB 빌드는 완전한 Push 설정을 요구한다.
Play 새 versionCode는 Console **테스트 및 출시 → 앱 번들 탐색기**의 현재 최고값 확인 후 별도 결정한다.

## 2. 기기 등록 (발송 아님)

지정 휴대폰에서 승인된 활성 테스트 계정으로 로그인 → **설정 → 공지 알림 설정** → OS 알림 허용.
EAS/native 설정, 권한, Token 발급, 서버 권한/저장 오류를 구분해 표시한다.
설치 ID는 SecureStore에 유지하고 RPC의 기존 upsert/unique 경계를 재사용한다.
세션 갱신/동시 호출은 단일 등록으로 합치며 계정 변경과 token 변경은 다시 검증한다.
등록 완료 문구는 실제 수신 성공을 뜻하지 않는다. 활성 기기 ID만 기록하고 token은 로그에 남기지 않는다.

## 3. 운영 승인 패키지 (이 문서는 실행 명령이 아님)

운영 변경 전 대상 Supabase project ref, 복구 담당자, 지정 테스트 계정/기기/공지와 점검 시각을 확정한다.
운영팀장 게시 권한과 공지 대상에 테스트 계정만 포함되는지 먼저 확인한다. 직원 전체 대상 공지는 금지한다.

- 승인 후 `notification-dispatch`만 배포한다. 기존 dispatch header로 인증하므로 이 함수에 한해서
  `--no-verify-jwt`를 사용하고 내부 `x-taejang-notification-key` 검증은 유지한다.
- Supabase 프로젝트 **Edge Functions → Secrets** 또는 CLI로 별도 승인된 키를 등록:
  `NOTIFICATION_DISPATCH_KEY`, (Expo 보안 설정 사용 시) `EXPO_PUSH_ACCESS_TOKEN`.
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Edge 런타임 기존 값을 재사용한다.
- 최초 배포는 `NOTIFICATION_DISPATCH_ENABLED=false`. 발송하지 않고 인증/disabled 응답만 확인한다.
- 공유 DB 기존 10개 이벤트 등 과거 backlog를 승인자에게 ID/상태/시각으로 제시한다.
  백업/복구 계획과 정확한 ID allowlist를 확정한 후 **별도 승인된 트랜잭션**으로 오래된
  queued/expanded 이벤트를 cancelled로, 연결된 미발송 queued/retry delivery를 cancelled로 격리한다.
  accepted/receipt_checking/delivered 기록은 변경하거나 삭제하지 않는다.
  이 PR에는 운영 SQL 자동 실행이나 backlog 자동 취소 기능이 없다.
- 신규 테스트 공지를 **초안**으로 만들고 그 ID를 확인한다. 승인된 cutoff 시각
  `NOTIFICATION_DISPATCH_START_AT`(ISO8601), `NOTIFICATION_CANARY_DEVICE_ID`,
  `NOTIFICATION_CANARY_NOTICE_ID`를 등록한다. 단일 ID만 받는다.
  과거 이벤트가 남아 있으면 `BACKLOG_REVIEW_REQUIRED`로 claim 전에 차단한다.
  claim 후에도 ID와 시각을 재검증하여 다른 기기/공지/동시 변경이면 전송 없이 차단한다.
- 발송 승인 후에만 enabled=true → 지정 초안 게시 → 수동 dispatch 1회 → receipts 조회.
  기존 DB의 active 계정/기기·공지 대상·버전·중복 unique/claim 계약을 유지한다.
  DeviceNotRegistered 비활성화, 명시적 429/MessageRateExceeded 재시도는 기존 RPC를 재사용한다.
  네트워크 timeout/5xx 등 결과 불명은 자동 재발송하지 않고 failed로 남겨 운영자가 조사한다.
  DB 완료 저장 실패로 sending에 남은 건도 무조건 retry로 되돌리지 않는다.
  Expo ticket/receipt 성공 역시 실제 단말 수신 증거와 구분한다.

## 4. 예약 실행 준비 (기본 OFF)

`.github/workflows/notification-push-schedule.yml`은 5분 cron을 준비하되 저장소 변수
`NOTIFICATION_PUSH_CANARY_ENABLED=true`가 없으면 job을 실행하지 않는다.
기본 브랜치에 승인·병합되기 전에는 cron도 시작되지 않는다.

승인 후 GitHub **Settings → Environments → notification-push-production**에서 required reviewers와
허용 배포 브랜치를 먼저 설정하고, 이 Environment의 Secrets에 `NOTIFICATION_DISPATCH_URL`,
`NOTIFICATION_DISPATCH_KEY`를 등록한다. 보호 설정 확인 전에 opt-in 변수를 켜지 않는다.
이 버전은 예약 실행도 한 기기·한 공지 제한이다. 전체 직원 자동 발송은 후속 승인·검수가 필요하다.
dispatch/receipts는 동일 직렬 job이며 curl 자동 재전송은 없다. blocked 응답은 job 실패로 나타난다.
중지: 먼저 workflow opt-in=false, Edge enabled=false. 기존 accepted receipt 정리는 수동 receipts로 계속 가능하다.
등록 토큰·로그·기존 데이터를 삭제하는 방식으로 중지하지 않는다.

## 5. 지정 Galaxy 수용 검수 — 아직 미실행

앱 실행 중 / 백그라운드 / 일반 종료(최근 앱 제거; Android 설정의 강제 중지는 별도 OS 제한) 상태를 나눠
각각 **새로운 테스트 공지 ID를 1개씩 승인·설정**하고 단 한 번 게시한다.
같은 delivery/event를 초기화하거나 재발송해 테스트하지 않는다.

각 상태에서 휴대폰 실제 도착 시각 → 잠금화면의 일반 문구 → 알림 터치 → 정확한 공지 상세 →
직원 확인 버튼의 명시적 처리까지 기록한다. push 수신/상세 열기만으로 확인 완료가 되면 실패다.
동일 알림 탭 cold/warm 중복은 하나로 처리하며 로그인 전 알림은 로그인 후 라우팅한다.
권한 거부, 로그아웃, 정지/퇴사 계정, 대상 제외, 구버전 공지, 중복 dispatch도 확인한다.
정지/퇴사/대상 테스트는 실제 직원 정보를 변경하지 않고 승인된 테스트 계정/격리 환경을 사용한다.

## 근거

- [Expo Push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo Android FCM v1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)

현재 단계: 연결 코드·검증·QA 빌드 준비. 자격증명 연결, 운영 적용, 기기 Token, 실제 Galaxy 수신은 미확인.
