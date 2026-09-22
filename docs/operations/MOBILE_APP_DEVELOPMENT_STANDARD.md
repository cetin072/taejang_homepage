# 태장 모바일 앱 개발·배포 장기 기준

이 문서는 태장 직원용 모바일 앱을 지속 개발·운영할 때 사용하는 장기 기준입니다.

대화 기억, 개인 PC 설정, 일회성 작업 지시보다 이 문서와 현재 GitHub Issue/PR을 우선합니다.  
현재 일시적인 배포 상황은 아래 "현재 rollout 기준"에 별도로 기록하며, 장기 원칙과 섞지 않습니다.

---

## 1. Source of truth

### 개발 정책과 운영 결정
- GitHub 저장소의 `AGENTS.md`, 이 문서, 관련 planning/operations 문서, 현재 Issue/PR이 source of truth입니다.
- 대화에서 장기적으로 유지할 결정이 확정되면 저장소 문서 또는 Issue에 반영한 뒤 개발 기준으로 사용합니다.
- ChatGPT/Codex 대화 기억만으로 장기 운영 결정을 유지하지 않습니다.

### Supabase
- Supabase는 runtime data, Auth, RLS, 서버 함수, 업무 상태와 서버 계약의 source of truth입니다.
- "앞으로 이렇게 개발한다" 같은 개발 정책이나 기획 메모를 Supabase 테이블에 저장하지 않습니다.
- DB/RLS/함수는 앱보다 강한 최종 보안 경계여야 합니다.

---

## 2. 모바일 앱의 기본 역할

- 모바일 앱은 기존 태장 업무 플랫폼의 별도 시스템이 아니라 **직원이 자주 쓰는 업무를 휴대폰에서 쉽게 수행하는 클라이언트**입니다.
- 기존 Auth/RLS/attendance/promotion/notice 서버 계약을 우선 재사용합니다.
- 모바일만을 위한 별도 backend는 명확한 필요가 없으면 만들지 않습니다.
- 웹과 모바일에서 같은 업무의 의미가 달라지지 않게 합니다.
- 화면 편의 때문에 서버의 권한·업무규칙을 약화하지 않습니다.

---

## 3. 서버 권위 원칙

다음 판정은 앱이 아니라 서버/DB가 최종 권위를 가집니다.

- 로그인 사용자와 활성 직원 여부
- 역할과 capability
- 출퇴근 가능 여부
- geofence/회사 도착 판정
- 중복 출퇴근 방지
- 근태 예외와 확정 상태
- 공지 접근 범위
- 홍보 작성·상신·보완 상태
- 관리자 승인 상태
- 민감 데이터 접근 권한

앱은 필요한 입력과 위치를 서버에 전달하고 결과를 표시합니다.

### 금지
- geofence 좌표·허용 거리·예외 규칙을 앱에 별도로 복제해 독립 판정
- 화면에서 버튼을 숨기는 것만으로 권한 구현
- 서버 실패인데 출퇴근이 성공한 것처럼 낙관적으로 확정 표시
- 동일 업무규칙을 웹/모바일에 각각 다른 코드로 유지

---

## 4. 출퇴근과 위치정보

- 위치정보는 출근/퇴근 같은 명확한 사용자 행동 시 필요한 범위에서만 요청합니다.
- 현재 기준으로 background location은 사용하지 않습니다.
- background location, 지속 위치 추적, 위치 이력 보관을 새로 도입하려면 사용자 승인과 개인정보/배터리/정책 검토가 필요합니다.
- 앱에는 회사 geofence의 최종 판정 규칙을 하드코딩하지 않습니다.
- 위치 권한이 없거나 정확도가 부족하거나 네트워크가 끊겼을 때 실패 이유를 직원이 이해할 수 있게 표시합니다.
- 중복 탭, 네트워크 재시도, 화면 복귀로 출퇴근 요청이 중복 저장되지 않도록 idempotency/서버 검증을 유지합니다.

---

## 5. 인증·세션·민감정보

- 세션 보존에는 SecureStore 등 플랫폼 보안 저장소를 사용합니다.
- 비밀번호, 토큰, 서비스 키, 주민등록번호 등 민감값을 일반 AsyncStorage, 로그, 화면 디버그 정보에 남기지 않습니다.
- 로그아웃 시 해당 기기의 push/token 연결을 안전하게 비활성화합니다.
- 앱이 background/foreground로 이동해도 만료 세션이 정상 갱신되거나 명확히 재로그인을 요구해야 합니다.
- 개인정보는 기능 수행에 필요한 최소 범위만 앱으로 내려받고 로컬에 오래 보관하지 않습니다.
- 직원 개인기기를 전제로 하므로 민감한 업무정보가 알림 미리보기나 로그에 과도하게 노출되지 않도록 합니다.

---

## 6. 권한 최소화

앱 권한은 "있으면 편리"가 아니라 "현재 기능에 필수"인 경우에만 요청합니다.

현재 모바일 주요 권한:
- foreground location: 출퇴근 시 도착 여부 확인
- notification: 공지 등 승인된 알림
- 네트워크: 서버 통신

새 권한을 추가할 때는 아래를 확인합니다.
1. 기능상 정말 필요한가
2. 권한 없이 fallback이 가능한가
3. Play/App Store 정책과 개인정보처리방침에 반영되었는가
4. 사용자가 권한 요청 이유를 이해할 수 있는가
5. 거부 후에도 앱이 불필요하게 막히지 않는가

---

## 7. 접근성·직원 사용성

태장 직원앱은 업무 현장에서 반복 사용하는 도구이므로 접근성을 기본 품질 기준으로 봅니다.

- 자주 쓰는 핵심 행동은 짧은 단계로 끝나야 합니다.
- 터치 영역을 충분히 크게 둡니다.
- 중요한 버튼과 상태는 글자와 형태로 명확히 구분합니다.
- 작은 아이콘만으로 의미를 전달하지 않습니다.
- 오류 메시지는 기술 용어보다 직원이 다음에 무엇을 해야 하는지를 설명합니다.
- 로딩·저장·전송 중 상태를 명확히 표시해 중복 탭을 줄입니다.
- 글자 크기 확대에서도 핵심 버튼·텍스트가 잘리지 않게 합니다.
- 색상만으로 성공/실패/경고를 구분하지 않습니다.
- 실제 Android 기기에서 한 손 사용, 키보드, 작은 화면, 느린 네트워크를 확인합니다.

---

## 8. Android 패키지·버전·서명

현재 태장 직원앱 Android package:
- `com.cetin072.taejang.staff`

Play 최초 등록 이후 package name은 사실상 영구 식별자로 취급합니다. 변경하려면 새 앱이 될 수 있으므로 최초 등록 전 최종 확인합니다.

### 버전
- 사용자 표시 버전(`versionName`/Expo `version`)과 Android `versionCode`를 구분합니다.
- Play에 올리는 새 빌드마다 `versionCode`는 반드시 증가합니다.
- 자동 배포를 붙이더라도 versionCode 충돌이 생기지 않는 단일 정책을 사용합니다.
- 앱 버전은 릴리스 노트에서 어떤 기능/버그가 바뀌었는지 추적 가능해야 합니다.

### 서명
- Play App Signing/EAS/keystore 운영 방식을 한 번 정하면 일관되게 유지합니다.
- keystore, 서비스계정 JSON, 비밀키, API secret을 GitHub 저장소에 커밋하지 않습니다.
- 비밀값은 GitHub/EAS/승인된 secret store에 둡니다.
- 서명키 분실은 장기 업데이트에 치명적이므로 복구/소유권 절차를 문서화합니다.

---

## 9. 빌드·배포 산출물

Google Play 배포용 기본 산출물은 Android App Bundle(`.aab`)입니다.

반복 가능한 흐름을 목표로 합니다.

`코드 수정 → 테스트 → Draft PR → 검수 → 승인/병합 → release build → AAB → Play 테스트 트랙 → 실기기 확인`

- 개발용 APK와 Play 배포용 AAB를 구분합니다.
- 로컬 PC에서만 가능한 수동 절차에 의존하지 않도록 점진적으로 자동화합니다.
- 자동화하더라도 Production 공개는 사용자 승인 없는 자동 실행으로 만들지 않습니다.

---

## 10. Backend 호환성과 앱 업데이트

직원들의 앱 업데이트 시점은 서로 다를 수 있습니다.

따라서:
- 서버/DB 변경은 가능한 한 이전 모바일 버전과 일정 기간 호환되어야 합니다.
- 앱이 새 필드가 반드시 있어야만 실행되는 구조라면 rollout 순서를 설계합니다.
- DB migration과 앱 release가 동시에 필요한 경우 backward-compatible migration을 먼저 배포하는 것을 우선합니다.
- 오래된 앱 버전이 위험한 경우 최소 지원 버전/강제 업데이트 정책을 별도로 설계합니다.
- 자동 업데이트를 가정하되 모든 직원이 즉시 업데이트한다고 가정하지 않습니다.

---

## 11. 실기기 QA Gate

모바일 작업은 웹 Preview만으로 완료 처리하지 않습니다.

릴리스 후보에서는 가능한 범위에서 실제 Android/Galaxy 기기로 다음을 확인합니다.

- 설치/업데이트
- 최초 실행
- 로그인/로그아웃
- 세션 유지
- foreground → background → foreground
- 앱 강제종료 후 재실행
- cold start
- 네트워크 끊김/느린 네트워크
- 위치 권한 허용/거부
- 알림 권한 허용/거부
- 출근/퇴근 중복 탭
- 공지 deep link
- push foreground/background/killed
- 키보드와 작은 화면
- 실제 직원 역할별 핵심 흐름

자동으로 확인할 수 있는 것은 사용자에게 넘기기 전에 자동 테스트/CI로 제거합니다.

---

## 12. Google Play 출시 준비

정식 출시 여부와 별개로 아래 항목을 항상 최신 상태로 준비합니다.

- 앱 이름
- 아이콘
- feature graphic
- 휴대폰 screenshots
- 간단 설명/상세 설명
- support email
- 개인정보처리방침 URL
- 광고 여부
- target audience
- content rating
- Data Safety
- App Access
- 검토자가 로그인해야 하는 경우 유효한 review account와 접근 안내
- 위치/알림 등 권한 사용 이유
- release notes

앱의 실제 데이터 처리 방식과 Play Console의 Data Safety 답변이 다르면 안 됩니다.

---

## 13. Crash/Analytics/외부 SDK

- 새 crash reporting, analytics, attribution, 광고 SDK는 편의성만으로 넣지 않습니다.
- 개인정보, 장애 영향, 유지비, 무료 한도, vendor lock-in을 검토합니다.
- 외부 유료 서비스나 새 비용은 사용자 승인 없이 추가하지 않습니다.
- 단순 운영 로그는 가능한 한 기존 인프라를 우선 사용합니다.
- SDK를 추가하면 개인정보처리방침/Data Safety 영향까지 함께 반영합니다.

---

## 14. Production 배포 승인선

다음은 사용자 최종 승인 없이 실행하지 않습니다.

- Google Play Production 공개
- App Store 정식 공개
- 운영 DB의 중요한 migration
- Auth/RLS/권한 의미 변경
- background location 도입
- 민감정보 수집 범위 확대
- 새 외부 유료 서비스
- 서명/개발자 계정 소유권 변경

테스트 트랙 자동화와 Production 자동화는 분리합니다.

---

## 15. iOS와 PWA

Android 정식화가 현재 우선순위입니다.

iPhone 지원은 별도 선택지로 유지합니다.
- PWA 홈 화면 설치
- TestFlight
- 향후 Unlisted App Store 등

Android 출시 때문에 iOS 구현을 억지로 선행하지 않습니다.  
반대로 공통 서버 계약은 iOS/PWA에서도 재사용 가능하게 유지합니다.

---

# 현재 rollout 기준 — 2026-09-22

아래는 장기 불변 규칙이 아니라 현재 배포 단계의 운영 결정입니다. 상황이 바뀌면 업데이트합니다.

## Play 개발자 계정
- 현재 신규 개인 Google Play 개발자 계정을 생성 중입니다.
- 개인사업자 D-U-N-S는 향후 Organization 전환 가능성을 위해 병행 검토합니다.

## Android 배포 트랙
태장 직원 수가 충분하므로 **Closed testing을 1차 실사용 트랙으로 우선**합니다.

목표:
- Android 직원 Google Play 이메일을 수집
- 최소 12명 이상이 Closed testing에 14일 연속 opt-in 상태 유지
- 실무상 여유를 위해 15~20명 이상 등록 권장
- 14일 동안 매일 앱을 실행해야 하는 것은 아니지만, 실제 업무 테스트와 피드백을 수행
- 테스트 기간 중 버그 수정 및 새 버전 업데이트 가능
- Production access 승인 전에는 Production 공개 금지

Android 직원 수가 예상보다 부족한 경우에만 Internal testing을 임시 대안으로 사용합니다.

## 현재 앱
- 경로: `mobile/`
- React Native + Expo Router
- Android package: `com.cetin072.taejang.staff`
- 기존 Supabase Auth/RLS/attendance/promotion 계약 재사용
- background location 미사용

---

## 관련 문서

- `AGENTS.md`
- `PROJECT_CHARTER.md`
- `docs/PLATFORM_CONSTITUTION.md`
- `mobile/README.md`
- `docs/operations/CODEX_WORKFLOW.md`
- GitHub Issue #333 — Google Play 배포 준비
- GitHub Issue #334 — 이 장기 기준 문서화
