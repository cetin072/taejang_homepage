# Goal #371 — 공지와 Native Push 완료 기록

상태: 구현 완료 / 실제 기기·외부 push 운영은 별도 Human Gate

## 적용 기준

- GitHub Goal #371
- `docs/operations/MOBILE_APP_DEVELOPMENT_STANDARD.md`
- `docs/planning/ATTENDANCE_INTEGRITY_POLICY_V1.md`의 서버 권위 원칙

## 구현 범위

- 기존 공지의 normal/important/urgent, unread/new, acknowledgement와 정확한 notice deep link 계약을 재사용한다.
- existing native push outbox의 provider-facing body를 generic 문구로 좁힌다. 공지 제목·본문은 잠금화면에 보내지 않고, 인증된 앱의 정확한 공지 상세에서만 읽는다.
- 기존 token rotation, multi-device, logout/inactive account 처리, stale delivery cancellation, receipt/retry/idempotency를 유지한다.
- foreground/background/killed tap은 opaque notice ID를 통해 기존 `/notices/:id` 경로로 연결한다.

## 보안 경계

- migration은 `private_claim_notification_push_batch`의 표시 문구만 변경하며 RLS, 사용자 권한, 대상 선별, notification delivery 상태 의미를 변경하지 않는다.
- Supabase 공식 권고에 맞춰 security-definer 함수의 빈 `search_path`와 schema-qualified 참조를 유지한다.
- Push provider secret·Production dispatcher 배포·실제 기기 token은 이 Goal에서 만들거나 변경하지 않는다.

## 완료 조건 대조

| #371 완료 조건 | 결과 |
| --- | --- |
| 일반/중요/긴급·unread·acknowledgement | 기존 guarded notice RPC/UI 계약 유지 |
| foreground/background/killed deep link | 기존 Expo response bridge가 exact `/notices/:id`로 연결 |
| token lifecycle·multi-device·중복 방지 | 기존 private registry/outbox/device-idempotency 유지 |
| 이미지 성능 | 텍스트 RPC 우선, signed media URL은 별도 실패 허용 경로 유지 |
| lock-screen 개인정보 최소화 | provider body를 generic 문구로 변경, 제목/본문 미전송 |

## Deferred Human Gate

- 실제 Galaxy의 foreground/background/killed 수신·탭, 알림 권한 거부/재허용, multi-device delivery 및 Expo receipt 운영을 검수한다.
- Production DB migration 적용, dispatcher secret 설정/배포, Google Play 업로드는 실행하지 않는다.
