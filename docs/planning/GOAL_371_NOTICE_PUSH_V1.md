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


## 2026-10-22 확정 — Galaxy 1대 신규 공지 자동 발송
- 사용자 승인: 등록 Galaxy 한 대, 그 소유 활성 계정 한 명만 대상으로 한 신규 테스트 공지 한 건. 수동 Expo/발송 SQL 없이 게시→예약 실행→기존 Edge→Expo/FCM→단말 수신을 검증한다.
- 기존 태장 공지 Domain과 공통 outbox/device/receipt Core를 유지한다. 새 알림 시스템·일반 직원 확대·계정/근태/급여/RLS 변경·main 병합·Play 배포는 제외한다.
- 전체 queue 점유 후 검사 대신 service-role-only scoped RPC로 notice/device/version/cutoff/current target를 점유 전에 검증한다. 다른 queue 행과 과거 취소 이벤트를 변경하지 않는다.
- 단일 시도 후 timeout/5xx/429/명시적 거절도 이 시험에서는 자동 재발송하지 않는다. 불명 결과 또는 sending 저장 실패도 재점유하지 않는다. 기존 일반 dispatcher retry RPC 계약은 유지한다.
- Edge 최초 OFF, 올바른 key·잘못된 key·OFF·범위/동시성 검사 후에만 최대1시간의 제한 창을 연다. 공지 버전도 고정한다. receipt는 기존15분 대기/10분 조회 간격과 별도 상태 처리를 유지한다.
- 기본 브랜치 미병합이므로 GitHub cron을 활성화하지 않는다. 기존 Supabase pg_cron+pg_net/Vault의 공식 경로로 Edge만 호출한다. 모든 일반 직원 자동 발송은 계속 OFF.
- 완료 조건: 자동 event/단일 delivery/ticket/receipt 증거와 사용자의 실제 Galaxy 도착·정확 상세·명시적 확인 검수. 코드·CI만으로 수신 완료 처리하지 않는다.
- 구현 대조와 실제 server/단말 결과는 PR #514 및 통합 #518에 별도 기록한다. 기존 문서의 과거 '별도 승인 전' 상태는 이번 단일기기 범위에 한해 이 승인으로 갱신한다.
