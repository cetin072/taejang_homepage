# 태장 Existing-First / Open-Source-First 개발 원칙 V1

## 1. 목적

태장 홈페이지·업무플랫폼은 범용 기술을 바닥부터 반복 구현하지 않는다.

개발 우선순위는 다음과 같다.

1. 현재 태장 Platform/Core에 이미 있는 기능
2. 업무수첩 등 내부 프로젝트에서 이미 검증된 구현·계약
3. OS·Supabase·Expo 등 현재 채택한 플랫폼의 공식 SDK/API
4. 유지보수되는 검증된 오픈소스
5. Adapter/Service를 통한 연결
6. 필요한 최소 자체 구현
7. 최후의 수단으로 Fork 및 자체 유지보수

핵심 원칙은 **범용 기술은 재사용하고, 태장 고유 업무규칙과 데이터 통제권에 개발 역량을 집중한다**는 것이다.

## 2. 재작성하지 않을 기존 Core

오픈소스 도입만을 이유로 다음 정상 기반을 전면 재작성하지 않는다.

- Supabase / PostgreSQL
- Auth
- Profile / Person / Employee
- 불변 직원 식별 의미
- capability 기반 권한
- RLS / RPC
- audit / revision / archive / restore
- 현재 검증된 홍보·홈페이지 승인 계약

새 기술이 더 세련돼 보여도 실제 문제와 전환 이익이 확인되지 않으면 현재 정상 Core를 유지한다.

## 3. 태장이 직접 소유해야 하는 업무지식

### 조직과 권한
- 일반직원
- 홍보직원
- 운영팀장
- 운영총괄
- 역할 간 상신·승인·보완·최종결정

### 직원 생애주기
- 등록
- 계정 연결
- 수정
- 재직/퇴사
- archive/restore
- audit

### 출퇴근과 급여 연결
급여 계산엔진 자체는 별도 프로젝트에서 관리할 수 있다.

업무플랫폼은 다음 연결 의미를 소유한다.
- attendance evidence
- confirmed attendance
- payroll draft handoff
- 운영팀장 검토
- 운영총괄 상신/최종승인

### 홍보와 홈페이지
- 작성
- 상신
- 검토/수정
- 보완
- 승인
- 공개

이 업무 의미는 외부 라이브러리나 공급자에 종속시키지 않는다.

## 4. 범용 기능 조사 우선 대상

다음 기능은 새로 직접 구현하기 전에 Existing / 공식 SDK / 오픈소스를 우선 조사한다.

- Native mobile shell
- Push / Notification
- offline/session persistence
- calendar/date/time components
- file upload/download
- spreadsheet parsing/export
- image compression
- camera/media
- form validation
- table/grid
- modal/dialog/toast
- admin CRUD shell
- search UI
- network retry
- deep link
- mobile build/release tooling
- accessibility helpers

## 5. 오픈소스 채택 기준

도입 전 최소 확인:
- 라이선스
- 최근 유지보수 상태
- 릴리스 빈도
- 보안 공지와 알려진 심각한 문제
- 실제 사용자·프로덕션 사례
- 현재 기술스택 호환성
- bundle/app size
- 성능과 배터리
- 접근성
- 한국어/모바일 UX 적합성
- 기존 Core와의 결합 난이도
- 업데이트/마이그레이션 비용
- 직접 구현 대비 총비용

우선 검토 라이선스:
- MIT
- Apache-2.0
- BSD 계열

별도 검토:
- GPL
- AGPL
- Source Available
- Dual License
- 상업적 사용 제한이 있는 라이선스

## 6. Adapter 원칙

모든 코드를 억지로 추상화하지 않는다.

실제 공급자·엔진·런타임 교체 가능성이 있는 외부 경계에서만 Adapter를 둔다.

예:
- NotificationAdapter
  - Expo Push
  - FCM Direct
  - Web Push
- Storage/File Adapter
- Document/Spreadsheet Parser Adapter
- AI/STT/OCR Adapter
- External Publishing Adapter

태장 고유 DB/domain logic은 의미 없는 wrapper로 감싸지 않는다.

## 7. 오픈소스 관리

도입 항목은 최소 다음을 기록한다.
- 프로젝트명
- 원본 저장소
- 사용 버전
- 라이선스
- 적용 기능
- 직접 수정 여부
- Fork 여부
- 보안/업데이트 책임

필요하면 THIRD_PARTY_NOTICES.md 또는 docs/operations/OPEN_SOURCE_INVENTORY.md를 둔다.

## 8. 첫 적용

### 직원 Android 앱 / 알림
Issue #227에서 업무수첩의 모바일·알림 경험과 공식 Expo/Android 기능을 Existing First로 재사용한다.

### 관리자 UI
운영팀장/운영총괄의 새 관리자 기능이 필요할 때는 기존 순수 JS 패턴만 반복하지 않고 유지보수되는 React/headless admin/grid/form 오픈소스를 후보 비교할 수 있다.

단, 현재 정상 화면을 일괄 재작성하지 않는다. 좁은 신규 화면에서 먼저 시험하고 개발속도·버그·접근성 개선이 실제로 확인될 때만 확대한다.

## 9. 업무수첩 프로젝트에서 가져오는 원칙

내부 참고:
- cetin072/worklog-voice-pwa
- docs/planning/WORK_NOTE_OPEN_SOURCE_MODULAR_ARCHITECTURE_V1.md

재사용할 원칙:
- Existing First
- 공식 SDK 우선
- 검증된 오픈소스
- 실제 공급자 경계에만 Adapter
- Deterministic First
- 무료 여부가 아니라 총비용으로 판단
- 안정적인 내부 Core를 추상화 목적만으로 재작성하지 않음

업무수첩 코드를 무조건 복사하지 않고 태장 도메인·권한·데이터 계약에 맞게 적용한다.

## 10. 신규 기능 개발 전 체크

1. 이 기능이 줄이는 실제 업무는 무엇인가?
2. 태장 Core에 이미 있는가?
3. 내부 다른 프로젝트에 검증된 구현이 있는가?
4. 공식 SDK/API로 해결 가능한가?
5. 검증된 오픈소스가 있는가?
6. 라이선스가 적합한가?
7. 최근에도 유지보수되는가?
8. 보안·성능·배터리·접근성 문제가 없는가?
9. 현재 런타임과 맞는가?
10. Adapter가 실제로 필요한 교체 경계인가?
11. 직접 구현보다 총비용을 줄이는가?
12. 유료 서비스라면 비용보다 이익이 큰가?

## 11. 금지

- 유행만 보고 오픈소스 도입
- 현재 정상 Core 전면교체
- dependency 수만 늘리는 도입
- license 검토 없는 상용 사용
- upstream을 크게 수정한 Fork를 기본 선택
- 사용자 승인 없는 신규 유료 인프라/서비스

## 12. 최종 원칙

태장 업무플랫폼은 모든 범용 기능을 직접 만든 시스템이 아니라,

**검증된 기술을 필요한 경계에서 조립하고, 그 위에 태장 고유의 직원·출퇴근·공지·홍보·승인·급여 연결 업무를 안정적으로 구현하는 운영 플랫폼**

으로 발전시킨다.
