# 태장 직원앱 Android Foundation

Issue #227의 Android 직원앱 첫 조각입니다.

## 첫 단계 범위

- React Native + Expo Router
- 기존 태장 `staff-config` + Supabase Auth 재사용
- SecureStore 기반 세션 보존
- AppState 기반 token refresh
- Native notification permission / Android 중요공지 channel
- Android ARM64 release APK CI

## 다음 단계

1. 일반직원 공지 read-only
2. 기존 출퇴근 RPC 연결
3. Remote Push device token 등록
4. 사용자/Employee/device token lifecycle
5. 새 공지 remote push + exact notice deep link
6. 홍보직원 작성/상신

## 안전선

- 새 모바일 backend를 만들지 않습니다.
- 기존 Auth/RLS/attendance 계약 의미를 바꾸지 않습니다.
- PWA/Web은 fallback으로 유지합니다.
- 운영팀장/운영총괄 관리자 UI를 native로 재작성하지 않습니다.
- Remote Push는 아직 실제 서버 발송을 구현하지 않았습니다.
- Production/Play 공개 배포는 별도 사용자 승인 전 금지입니다.
