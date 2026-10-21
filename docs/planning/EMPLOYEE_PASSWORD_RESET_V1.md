# 직원관리 비밀번호 초기화 V1 — Issue #500

상태: 2026-10-21 사용자 UI 초간소화 요구로 변경 / 구현·격리 검증 중. 운영 적용 승인 전.
적용 기준: Issue #500 최신 추가 요구, PROJECT_CHARTER.md, PLATFORM_CONSTITUTION.md.
분류: 직원관리 화면·대상 정책은 태장 Domain, 기존 Auth/capability/audit Core 재사용. 새 공급자 없음.

## 확정 범위와 흐름
- 기존 직원관리 → 인사카드 → 앱 계정. 미연결은 계정 발급 필요; 기존 Employee/Person/Auth ID는 재생성하지 않는다.
- 전용 employee.password_reset: 명시 부여된 실제 회사 범위 promotion_lead / operations_manager와 활성 capability를 함께 요구한다.
- 운영팀장: 활성 일반근로자·홍보직원. 운영총괄: 이에 일반사무·근로지원 담당자·근로지원인·외부지도자까지. 일반 직원 position allowlist와 모든 미취소 역할 및 capability도 검사한다.
- 본인·모든 관리자/임원/기술 최고관리자·알 수 없는 역할/직책·정지/휴직/퇴직/보관·미연결·동명이인·불일치는 차단한다. 기존 onboarding의 일반 계정 역할 계약을 재사용하며 자동 직급 서열 추론은 하지 않는다.
- 변경: 직원번호·신원 체크박스·사유·발급 방식·관리자 비밀번호·수동 비밀번호 입력을 제거한다. 앱 계정의 버튼 → 직원명/기존 비밀번호 무효/직원 본인 요청 확인 안내가 있는 최종 팝업 → 자동 발급. 취소는 서버 요청을 보내지 않는다.
- 서버 getUser → DB가 Employee/Auth 고유 연결 조회·기존 예약/제한/감사 재사용 → 서명된 AMR의 password 인증이 최근 10분 이내이며 현재 actor의 유효 auth.sessions에 속하는지 검사 → Admin getUserById 이메일·활성 확인 → 같은 JWT로 최근 인증/대상 재검증/CAS → Admin updateUserById({password}) → 내구성 감사 완료 후 1회 응답.
- `iat`, token refresh, user_metadata, 확인 팝업은 재인증 근거가 아니다. password AMR 누락/오래됨/미래/잘못된 타입/OTP·magiclink 단독/세션 취소·만료는 안전 거부한다. 재로그인 안내 후 기존 로그인 절차를 사용한다. 고정 감사 사유는 `현장 로그인 지원`이다.
- 기본은 CSPRNG rejection sampling으로 직원별 숫자 16자리. 보안정책 거부를 우회하지 않는다. 비밀번호/키는 DB·audit·로그·브라우저 저장소에 저장하지 않는다. 화면 표시 60초/숨김/전달 완료 시 삭제한다.
- 변경: 두 직원용 수동 입력은 UI 및 Edge 인터페이스에서 제거한다. 기존 예외 테이블·이력·운영 데이터는 삭제하거나 변경하지 않는다. 일반 경로는 무작위 16자리만 발급한다.
- 성공 시 복사 버튼과 본인 변경 주소를 제공한다. 60초/숨김/전달 완료 시 화면 원문과 복사 경로를 지운다. 불확실 응답·네트워크 오류는 자동 재시도 없이 버튼을 잠그고 결과 확인을 안내한다.
- actor 5회/15분, target 3회/시간. DB advisory lock과 열린 target unique index. 불확실 실행은 열린 상태를 보존하고 자동 재시도·자동 해제하지 않는다. 일반 실패는 사유/대상/actor/시각/결과 감사. 잘못된 JWT/입력·origin은 인증 전 거절하므로 신뢰할 actor 감사로 기록하지 않는다.

## #501 의존과 변경 강제 검토
- Draft #501 HEAD 90cf9d6af8490b005d1a8ae0865cdd85c133460c는 이메일 수신 없이 기존 password grant→본인 JWT PUT /user(current_password 포함)→local logout을 제공한다. 이 PR을 수정·병합하지 않는다.
- 격리 테스트는 위 정확 커밋의 실제 모듈을 실행하고 임시 비밀번호→본인 변경→새 로그인·기존/임시 비밀번호 거부를 확인한다.
- 기존 앱·RPC/RLS에 임시 비밀번호 플래그를 신뢰하여 전 기능을 차단하는 계약은 없다. user_metadata 플래그는 사용자 수정 가능해 보안 강제에 사용할 수 없다.
- 이번에는 변경 안내/웹 경로를 제공한다. 강제 변경·만료는 미구현 후속: 설치된 Play 앱과 모든 보호된 API/RLS에 같은 서버 계약을 도입해야 하므로 임의로 권한 의미를 변경하지 않는다.

## 운영 게이트
- 기본 disabled: Edge EMPLOYEE_PASSWORD_RESET_ENABLED=true를 승인 후 설정하기 전 모든 reset 차단.
- 운영은 EMPLOYEE_SELF_CHANGE_VERIFIED=true도 필요. #501 검수/병합 승인과 기존 48시간 정기 Production 배포 후 실제 본인 변경·로그인 확인을 마친 운영자가 설정한다. Edge도 매 요청 Production change-password.html의 form marker를 확인한다. marker 검사는 실제 사용자 검수의 대체가 아니다.
- SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / SUPABASE_URL은 Supabase Edge 기본 서버 환경을 사용. 키를 Codex/브라우저/Netlify/GitHub Actions에 복사하지 않는다.
- 운영 Edge는 taejang.co.kr origin만 허용, Deploy Preview 거절. 로컬 Auth URL인 격리 CI에서만 localhost 허용. Origin은 권한의 대체가 아니며 JWT/DB 재검증이 항상 필요하다.
- 운영 migration/function 배포·예외 두 슬롯 등록·실계정 초기화는 별도 승인 후. Netlify 정책/설정 변경 없음. 운영 개인정보는 Issue/PR에 기재하지 않는다.
- DB와 Auth는 분산 서비스이므로 HTTP 요청 사이에 단일 트랜잭션 원자성을 주장하지 않는다. 실행 직전 역할/연결 재검증; 분산 장애는 열린 요청을 보존하여 운영자가 비공개 감사로 대조한다. 권한/연결 변경과 reset 작업의 동시 운영은 피한다.
- 불확실 요청은 재초기화하지 말고 Auth 감사 및 request_id로 결과를 비공개 확인한다. 임시 비밀번호 재조회 불가. 확인 후 service-only 완료 RPC로 상태 정리; 새 reset은 신원/사유를 다시 확인한다.

## 구현 대조
- 구현: 기존 카드 단일 버튼/최종 팝업/복사/60초 삭제, 서버 전용 Admin API, 기존 capability/대상 보호, 무작위 숫자만 발급, 서버 최근 인증/횟수/동시성/감사. 별도 메뉴·의존성·권한 확장 없음.
- 검증 중: 정확 HEAD CI, 실제 격리 Auth/Edge/#501 연동, 브라우저·빌드/Preview.
- 후속/사람 확인: 승인된 migration/Edge 배포·활성화, 기존 48시간 Production 배포 후 본인 변경 검수, 실제 초기화·직원 전달/변경은 별도 승인 후. 이번 작업에서는 실제 계정 초기화와 고정 QA 교체를 하지 않는다.
- 의도적 제외: 신규 직원/Auth 생성·ID/인사/근태/급여/역할 변경, #501 수정·병합, Production 조기 배포, 강제 변경 서버 계약 선행 도입.
