# 태장 Web Architecture Standard 적용 기록

## 공통 원본

웹 제작 공통 기준의 source of truth는 다음 문서입니다.

- Repository: `cetin072/ai-development-system`
- Document: `docs/WEB_ARCHITECTURE_STANDARD_V1.md`
- Core principle: **Static by Default, Dynamic by Necessity**

이 저장소에는 공통 표준 전문을 복제하지 않습니다. 공통 원본이 개정되면 그 문서를 우선 확인하고, 이 문서에는 태장 프로젝트 고유 결정과 예외만 기록합니다.

## 태장 공개 홈페이지

- 공개 기본 정보, 핵심 navigation, 핵심 CTA, 전화·이메일·주소, 승인된 기본 이미지는 정적 HTML/CSS를 기본으로 합니다.
- JavaScript는 UI interaction과 최신 승인 콘텐츠 보강에 사용합니다.
- JS/API 실패 시 핵심 공개정보와 이동이 남아야 합니다.
- 방문자에게 콘텐츠 영역으로 제시되는 Fresh content는 빈 컨테이너를 기본 상태로 두지 않고, 배포 시점의 마지막 승인 콘텐츠 또는 의미 있는 정적 fallback을 유지합니다.

### runtime fetch 선택

태장 공개 홈페이지는 내부 관리시스템에서 승인된 일부 홈페이지 콘텐츠를 재배포 없이 빠르게 반영할 운영 필요가 있고, 매 승인마다 Netlify 빌드를 발생시키는 비용·운영 부담을 줄이기 위해 제한적으로 runtime fetch를 사용할 수 있습니다.

runtime fetch를 쓰는 경우:

- 정적/배포 시점 fallback 유지
- API 실패 시 기존 정적 화면 유지
- 핵심 콘텐츠 빈 컨테이너 금지
- build-time ↔ runtime 변경은 아키텍처 변경으로 취급

## 태장 내부 업무 플랫폼

- 사용자·역할·업무 상태에 따라 화면이 달라지는 동적 앱으로 운영합니다.
- 인증·권한·중요 데이터는 서버/API/DB/RLS가 최종 검증합니다.
- 인증과 역할 결정 후 핵심 App Shell과 역할별 핵심 메뉴는 최초 렌더링에서 함께 확정합니다.
- 핵심 메뉴가 별도 후처리 모듈의 실행 순서나 race에 의존하지 않게 합니다.
- loading / empty / error / forbidden 상태를 구분합니다.

## 기존 구현 재감사

GitHub Issue #117에서 공개 홈페이지와 내부 업무 플랫폼을 공통 표준 기준으로 재감사합니다.

기존 정상 동작 구조를 표준 준수만을 이유로 대규모 재작성하지 않습니다. 보안·권한·race·핵심 fallback·이미지 성능 순으로 위험도 높은 항목부터 작은 PR로 정비합니다.
