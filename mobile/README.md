# 태장 직원앱 Android

Issue #227의 Android 직원앱 1차 통합 구현입니다.

## 현재 통합 범위

### 공통
- React Native + Expo Router
- 기존 태장 `staff-config` + Supabase Auth 재사용
- SecureStore 기반 세션 보존
- AppState 기반 token refresh
- Web/PWA fallback 유지
- Android ARM64 release APK CI

### 일반직원
- 오늘 출퇴근 상태
- Native foreground 위치를 이용한 출근/퇴근
- 기존 서버 geofence/중복/예외 계약 재사용
- 공지 목록/상세/확인
- 태장 공식 홈페이지/네이버 블로그/유튜브 바로가기

### 홍보직원
일반직원 기능 +
- 홍보글 신규 작성
- 임시저장
- 운영팀장 상신
- 실제 보완 의견 확인
- 기존 draft/보완본 수정
- 재상신
- 상신 상태 확인
- 기존 웹에서 첨부한 공개 미디어/메타데이터 보존

### Native Push foundation
- Android 중요공지 channel/permission
- Expo Push token 등록
- 설치기기 ↔ 인증 사용자 연결
- 로그아웃 기기 비활성화
- 공지 version outbox / delivery idempotency
- Expo ticket + receipt 추적
- DeviceNotRegistered 정리
- 알림 탭 → 정확한 `/notices/[id]` deep link

## 아직 실제 배포 전 확인이 필요한 것

- EAS Project ID / FCM 자격증명 연결
- Notification dispatcher Edge Function 실제 배포/스케줄
- 실제 Galaxy 기기 foreground/background/killed Push 수신
- cold-start deep link
- 다중기기/token rotation 실기기 QA
- 홍보직원 실제 계정 작성→상신→보완→재상신 Human QA
- Play 비공개 테스트(Closed testing)/공개배포

## 안전선

- 새 모바일 backend를 만들지 않습니다.
- 기존 Auth/RLS/attendance/promotion 서버 계약 의미를 바꾸지 않습니다.
- 회사 geofence 좌표/60m 판정을 앱에 복제하지 않습니다.
- background location을 사용하지 않습니다.
- 운영팀장/운영총괄 관리자 UI를 native로 재작성하지 않습니다.
- Push 실패가 공지 저장을 롤백시키지 않습니다.
- Production DB/Edge Function/FCM/Play 공개 배포는 별도 사용자 승인 전 금지입니다.

## Google Play 정책 페이지

- 직원앱 개인정보처리방침: `https://taejang.co.kr/employee-app-privacy.html`
- 계정 삭제 요청: `https://taejang.co.kr/account-deletion.html`
- 현재 배포 전략과 Play Console 입력 기준: `docs/operations/GOOGLE_PLAY_CLOSED_TESTING_RUNBOOK.md`
