# AGENTS.md 전체 감사 · 2026-10-07

관련 Issue: #402. 이 파일은 감사 이력이며 매 작업마다 읽는 지침이 아니다.

## 범위와 기준

- 수정 승인: AGENTS.md 전체의 중복·충돌·오래된 설명을 정리하고 안전 경계를 보존하며 고정 사용자 QA 규칙을 반영한다.
- 기준 저장소/commit: `cetin072/taejang_homepage` / `c6f7f42ef5b5d4418f6fd259b5eeb355f1f2eb47`.
- 기준 AGENTS blob: `65ee8d04f095b9b9557867f6ac4f648364368e3f`, UTF-8 20,325 bytes.
- 전체 검토: AGENTS.md의 모든 절, CODEX_WORKFLOW.md, MODEL_SELECTION_POLICY.md, PROJECT_CHARTER.md. 연결된 기획·모바일·웹·콘텐츠·오픈소스 문서는 관련 기준과 참조 경로를 확인했다. 이 보고서는 연결 문서 전부의 모든 업무 정책을 재감사했다는 뜻은 아니다.
- 공통 기준은 ai-development-system의 DEVELOPMENT_CONSTITUTION.md, AI_DEVELOPMENT_STANDARD.md의 관련 절, docs/PREVIEW_QA_GATE.md를 읽기 검토했다. 공통 저장소·다른 앱·사용자의 전역 AI 설정은 변경하지 않는다.
- 문서 수정만 수행한다. 홍보 PR #401, qa-preview, main, 앱 코드, DB·RLS·계정, Netlify 설정·운영 배포는 이번 변경 대상이 아니다.

## 발견과 처리

1. **반복:** main 보호, 기존 PR 재사용, 조건부 문서 로딩, 승인 경계, 재사용·완료 보고가 여러 절에 반복됐다. AGENTS의 안전·시작·완료 절로 통합했다.
2. **읽기 조건 충돌:** AGENTS는 조건부 읽기를 요구하지만 WORKFLOW 시작 절차, MODEL 정책의 기본 탐색 순서, CHARTER 도입부는 일괄 읽기를 요구했다. 문서의 권위와 매번 전문을 읽는 행동을 구분하고 네 문서를 정합화했다. 헌장 사업 목적·역할·로드맵, 모델 조합·승급 판단은 변경하지 않았다.
3. **오래된 배포 설명:** 저장소 루트 게시라는 설명을 실제 `netlify.toml`의 `publish = "dist"` 및 `scripts/build-netlify-publish.mjs`와 맞췄다. 변경 가능한 명령·환경은 설정을 확인하도록 했다.
4. **고정 QA 누락:** 사용자 웹 QA의 고정 주소, 정확한 HEAD·실제 배포·Staging 대조를 상시 지침에 남겼다. 동시 검수 보호, 이전 SHA 기록, non-fast-forward 정지·승인, 실제 배포 확인은 기존 WORKFLOW에 두었다. 강제 push·운영 DB 변경 권한을 추가하지 않았다.
5. **작업 종류 혼합:** 웹 사용자 검수 Gate와 순수 문서 검토를 구분했다. 문서만 바꾸는 작업에는 QA 사이트 교체를 요청하지 않되 기존 필수 CI·승인 규칙은 유지했다.
6. **적용 범위 오해:** 공통 원칙은 중앙, 태장 주소·업무규칙은 이 저장소, 현재 상태는 Issue/PR로 구분했다. GitHub에 기록하면 모든 ChatGPT/다른 도구가 자동으로 읽는다는 가정을 금지했다.
7. **권고와 실행 혼동:** 로컬 상태, 모델 전환, 실제 브라우저 검증, 독립 검수, 사용자 승인, 병합, 운영 반영은 실제 수행/확인 범위만 보고하도록 했다.

## 원문 전체 절 대조표

단순히 문장을 지운 것이 아니라 각 원문의 역할을 아래처럼 처리했다. 문서에 위임된 기준은 적용 조건이 맞을 때 읽는다.

| 원문 절 | 처리 | 보존 위치 / 판단 |
| --- | --- | --- |
| 최상위 개발 원칙 | 보존·압축 | AGENTS 1: 네 원칙, 검증된 코드의 독립 복제·적응, 보안 예외 |
| 최상위 기준 | 압축·위임 | AGENTS 1·3·4 + CHARTER: 실제 사용자·사업 가치, 기능 채택, 모듈 단위 완성 |
| 플랫폼 확장 판단 | 압축·위임 | AGENTS 1·4 + PLATFORM_CONSTITUTION: 명확한 공통성·조직 경계, 과잉 공통화·전면 재작성 금지 |
| Existing-First / 오픈소스 | 통합·위임 | AGENTS 1·4 + OPEN_SOURCE_ADOPTION: 기존 코드 우선, 라이선스·보안·유지보수·비용 |
| 모바일 앱 장기 기준 | 압축·위임 | AGENTS 5·4 + MOBILE_APP_DEVELOPMENT_STANDARD: 서버 계약, 최소 권한, background location 승인, signing/AAB/Play 상세 |
| 문서 로딩 경량화 | 통합·충돌 수정 | AGENTS 3·4; WORKFLOW 1; MODEL 8; CHARTER 도입부 |
| 기획 기록 우선 | 통합·위임 | AGENTS 3·6 + WORKFLOW 2·7 + PLANNING_RECORD_SYSTEM: 확정/검토 구분, 기획 대조 |
| 현재 기술 구조 | 현행화 | AGENTS 5: 정적 웹, 실제 package/netlify 설정, dist. 자산 경로 목록은 현재 코드에서 확인 |
| 공통 웹 아키텍처 | 압축·위임 | AGENTS 5·4 + WEB_ARCHITECTURE_ADOPTION: 정적 fallback, 서버 권위, 단일 Shell 소유, 렌더링 방식 변경의 아키텍처 검토 |
| 브랜치와 검토 원칙 | 통합 | AGENTS 2·3 + WORKFLOW 1·6: main 보호, 기존 작업 재사용, 승인 |
| 공통 AI 개발 운영 | 통합 | AGENTS 3 + WORKFLOW 1·2·6: 원격 상태, Issue/PR, PC 복구, Human Relay 최소화 |
| 사용자 Preview QA Gate | 보존·보강 | AGENTS 6 + WORKFLOW 4·5 + 공통 Preview QA Gate: 필수 검증, 고정 URL, exact HEAD, 실환경, 안정성, 입력 보존 |
| Codex 모델·추론 선택 | 상세 위임 | AGENTS 4 + MODEL_SELECTION_POLICY: 기본값 유지, 조합·승급·승인 기준 그대로 |
| 수정·보안 원칙 | 보존·통합 | AGENTS 2: 원본·비밀·민감정보·서버 권한·비용·승인 |
| 상시 운영 기준 | 통합·위임 | AGENTS 1·3·4·5 + WORKFLOW 2: 범위 준수, 인접 자산, 무관한 탐색·의존성·변경 금지 |
| Codex Goal 반자동 운영 | 압축·위임 | AGENTS 3 + WORKFLOW 2·3·7: 자율 범위, 반복 중단, Goal/Issue 역할, 사람 판단 |
| 콘텐츠와 대외 표현 | 상세 위임 | AGENTS 4 + TAEJANG_PUBLIC_WEB_BRIEF + CHARTER: 사실·날짜·연락·인증·로고·공개 승인·성과 표현 |
| 업무 플랫폼 개발 원칙 | 상세 위임 | AGENTS 4 + CHARTER 9·11·13 + 홍보 확정 기획: 역할 범위, 보완 필요, 직원의 판단 부담 제한, 내부 개발·전문 서비스 활용. 기존 개발 순서 자체는 재결정하지 않음 |
| 완료 보고 | 통합 | AGENTS 6 + WORKFLOW 7: 변경 파일·목적·기획 대조·증거·남은 사항 |

## 검증 범위와 한계

- 기준 파일을 GitHub에서 읽고 원격 기준 SHA를 확인했다. 로컬 네트워크의 DNS 제한으로 전체 저장소 clone/fetch는 수행하지 못했으며, 원격 커넥터를 사용했다.
- 일부만 수정한 CHARTER와 MODEL의 로컬 원문은 Git blob SHA로 원격 원문과 일치함을 확인한 뒤 변경했다. CHARTER는 도입부 읽기 조건 1곳, MODEL은 읽기 조건 2곳만 바뀌는지 비교했다.
- 새 AGENTS의 내부 문서 링크는 원격으로 확인한 경로 또는 이번 변경 파일과 대조했다. 공통 헌법·QA Gate 링크도 연결 저장소에서 확인했다. 참조가 정상이라는 것은 각 문서의 전체 내용과 실행 정책이 모두 자동 검증됐다는 뜻이 아니다.
- 문서 검사: UTF-8, conflict marker/공백, 상대 경로 이탈, 내부 참조, 필수 안전 문구·고정 QA, 원문 19개 절의 보존/위임 매핑, 최소 변경 파일의 정확한 치환 범위, Markdown 구조·분량을 확인했다. 이는 AI가 미래 모든 지침을 완벽하게 지킨다는 증명이 아니다.
- 빌드 스크립트의 공개 파일/디렉터리 whitelist에는 이 변경 문서들이 포함되지 않음을 소스로 확인했다. 실제 앱 build·DB·실계정 브라우저 검수는 이 문서 전용 변경의 실행 증거로 주장하지 않는다.
- 별도 검수자/문맥의 독립 검수는 아직 수행하지 않았다. 실행한 문서 검사와 자체 diff 재검토만 보고한다. 원격 CI/PR 상태는 해당 HEAD의 GitHub 기록으로 따로 확인한다.
- Draft PR은 제안 변경이며, 사용자 승인·병합 전 모든 도구에 활성화된 규칙으로 간주하지 않는다. 다른 프로젝트에 자동 전파하지 않는다.

## 이번 문서 검사 결과

AGENTS는 20,325 → 10,742 bytes로 47.15% 줄었고, 새 본문은 70줄이다. 한글 UTF-8 바이트 수 기준이며 모델의 토큰 절감률·응답 속도 개선률을 뜻하지 않는다. 로컬 문서 정합성 assertion 47개가 통과했고, 내부 참조 대상 13곳을 원격 확인 경로/변경 파일과 대조했다. `git diff --no-index --check`에서 공백 오류 출력은 없었다. 이 수치는 앱 테스트나 독립 검수의 통과 수가 아니다.

## 재사용과 향후 유지

공통 원칙의 압축본 + 각 저장소의 안전·실행 기준 + 필요한 때만 읽는 상세 문서라는 구조를 다른 앱에도 적용할 수 있다. 태장 QA URL, 조직·직책, 서버·배포 환경은 복사 대상이 아니다. 새 규칙은 기존 규칙으로 흡수 가능한지 먼저 검토하며, 감사 이력·세부 사례를 AGENTS에 누적하지 않는다.
