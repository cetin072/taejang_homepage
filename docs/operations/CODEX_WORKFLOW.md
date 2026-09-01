# Codex 표준 작업 흐름

이 문서는 태장 프로젝트에서 Codex가 **기존 승인 구조 안에서는 최대한 자율적으로 진행하고, 사람 판단이 필요한 지점에서만 멈추는 반자동 개발 방식**을 정의한다.

## 1. Source of truth

작업 판단은 아래 순서를 따른다.

1. `PROJECT_CHARTER.md`
2. 확정 상태의 관련 `docs/planning/` 문서
3. 상위 Epic/Goal GitHub Issue
4. 현재 구현 GitHub Issue
5. 기존 Draft PR과 최신 review
6. `docs/operations/`의 현재 운영 상태 기록

충돌이 있으면 임의로 새 요구사항을 만들어 구현하지 않는다. 확정 기획·데이터 계약·권한 의미를 바꿔야 하면 사람 판단 Gate로 보낸다.

## 2. 시작

1. `git fetch origin` 후 현재 branch, working tree, 최신 `origin/main`을 확인한다.
2. `AGENTS.md`와 `PROJECT_CHARTER.md`를 확인한다.
3. [`MODEL_SELECTION_POLICY.md`](MODEL_SELECTION_POLICY.md)를 읽고 현재 작업 단위에 맞는 모델·추론 수준을 선택한다.
4. 현재 Epic/Goal, 현재 Issue, **그 Issue가 참조하는 관련 planning 문서만** 우선 확인한다.
5. 기존 Draft PR이 있으면 PR과 최신 review를 읽는다.
6. 기존 Issue/branch/PR이 있으면 그대로 이어가고 같은 작업의 새 branch나 새 PR을 만들지 않는다.
7. 기존 로컬 미커밋 변경은 출처와 목적을 확인하기 전 새 작업에 자동 포함하지 않는다.

매 실행마다 저장소 전체, 모든 기획문서, 모든 과거 PR을 처음부터 다시 읽지 않는다. 현재 작업을 판단하는 데 필요한 범위만 탐색한다.

## 3. Codex 지시 헤더

가능하면 아래 형식을 사용한다.

```text
권장 모델: GPT-5.6 Terra
권장 추론: Medium
선정 이유: 기존 구조 안의 일반 구현과 회귀 테스트 작업
```

Goal과 현재 Issue가 충분히 명확한 경우에는 이후 실행 지시를 `계속해` 수준으로 줄일 수 있다.

## 4. 자율 진행 범위

현재 Issue와 승인된 구조 안에서는 사용자에게 작은 중간 결과를 운반시키지 않고 다음을 스스로 계속 진행한다.

- 구현
- 관련 targeted test
- build·lint·문법 검사
- 작은 오류와 명확한 CI 실패 원인 수정
- 회귀 테스트 추가
- Draft PR 갱신
- review 지적사항 수정
- 운영·QA 문서 갱신
- CI와 Deploy Preview 검증
- 수정 후 재검증

작은 오류나 테스트 실패는 안전하게 수정 가능한 범위라면 self-heal 후 계속 진행한다.

## 5. 사람 판단 Gate

다음 상황에서는 자동 구현을 멈추고 무엇을 결정해야 하는지 정확히 보고한다.

- 핵심 아키텍처 변경
- 승인된 데이터 구조 또는 상태 계약 변경
- Auth/RLS/보안/역할/권한 의미 변경
- destructive 또는 중요한 DB migration
- 실제 사용자 계정·권한·민감정보 변경
- 새로운 외부 서비스 도입
- 새로운 비용·유료 API 발생
- 확정 기획 또는 승인선 변경
- 요구사항 충돌 또는 중요한 불명확성
- Ready for review 전환
- `main` 병합
- Production Supabase 변경
- Production 배포

우회 push, force push, 보안규칙 우회, 승인 회피를 하지 않는다.

## 6. 모델 재평가

- 기본은 `Terra / Medium`이다.
- 여러 모듈·큰 회귀위험·복합 통합·승인된 Auth/RLS 검증은 `Terra / High`를 사용한다.
- 작은 저위험·기계적 작업은 Luna를 사용한다.
- Sol은 `Terra / High`로 반복 검증해도 안전하게 해결하기 어렵다는 구체적 근거가 있을 때만 예외적으로 검토한다.
- 사람 판단 Gate는 모델을 높여 우회하지 않는다.

세부 기준은 `MODEL_SELECTION_POLICY.md`를 따른다.

## 7. 비용·권한 원칙

- 추가 OpenAI API 결제, 외부 유료 API, 유료 자동화 서비스는 사용자 승인 없이 사용하지 않는다.
- 기존 GitHub Actions와 Netlify Deploy Preview 구조를 우선 활용한다.
- `fetch`, `push`, PR 갱신 등 권한 오류가 발생하면 우회하지 않고 필요한 권한만 보고한다.
- 이미 통과했고 입력이나 코드가 바뀌지 않은 hosted mutation·고비용 검증은 이유 없이 반복하지 않는다.

## 8. 개발

- 현재 Issue 범위만 수정한다.
- 요청하지 않은 디자인·아키텍처 전면 개편을 하지 않는다.
- 기존 기능·링크·파일 구조를 먼저 확인한다.
- 새 라이브러리·서비스 도입 전 현재 구조로 해결 가능한지 검토한다.
- 파일은 기존 저장소 구조와 인접 파일 패턴을 따른다. 새로운 최상위 디렉터리·자산 체계가 필요하면 아키텍처 변경 Gate로 본다.
- 공개 콘텐츠와 자산은 `docs/reference/TAEJANG_PUBLIC_WEB_BRIEF.md` 및 기존 `assets/` 구조를 따른다.

## 9. 검사

변경 범위에 맞는 검사를 선택한다. 모든 작업에 불필요한 검사를 일괄 실행하지 않는다.

### 변경 직후

- `git status`
- `git diff`
- `git diff --check`
- 변경 파일에 직접 관련된 targeted test·문법·링크·경로 검사

### PR 완료 직전

- 관련 회귀 테스트
- 필요한 접근성·모바일 검수
- GitHub Actions
- 필요한 Deploy Preview

Production 검증이나 실제 사용자 데이터 mutation은 별도 승인 범위에서만 수행한다.

## 10. GitHub 게시

1. 변경사항을 의도적으로 커밋한다.
2. 기존 작업 branch가 있으면 그 branch에 push한다.
3. 기존 Draft PR이 있으면 그대로 갱신한다.
4. 새 Issue 작업에 기존 PR이 없을 때만 새 branch와 Draft PR을 만든다.
5. PR에는 변경 목적, 관련 Issue, 변경 파일, 검사 결과, Preview 상태와 남은 사람 판단 Gate를 기록한다.
6. 사용자 승인 전 Ready for review, `main` merge, Production 배포를 하지 않는다.

## 11. PC 이동과 작업 복구

- 다른 PC로 이동하기 전에는 가능한 한 최소 commit과 push를 남긴다.
- GitHub Issue, branch, Draft PR, 운영상태 문서를 공유 상태의 기준으로 사용한다.
- 새 PC에서는 과거 로컬 대화를 복원하려고 하기보다 최신 GitHub 상태를 읽고 기존 branch/PR에서 이어간다.
- 로컬에만 남은 미커밋 변경이 있으면 원격 작업과 충돌시키지 않고 먼저 식별한다.

## 12. Goal 운영 원칙

Codex Goal은 GitHub Issue를 대체하지 않는다.

- Epic/Goal Issue: 장기 제품 방향과 단계 순서
- Codex Goal: 현재 Phase의 지속 실행 목표와 자율 진행 원칙
- GitHub Issue: 현재 구현 단위와 acceptance criteria
- Draft PR: 실제 결과물

Goal에는 변하지 않는 목적·source-of-truth·자율범위·비용규칙·사람 판단 Gate·완료기준을 둔다. 화면 세부 필드, 이번 RLS 조건, TEST 데이터, mutation 범위 같은 작업별 세부사항은 현재 Issue에 둔다.

## 13. 완료 기준

현재 Issue의 acceptance criteria를 충족하고 다음을 확인하면 구현 완료 후보로 본다.

- 관련 테스트 통과
- 필요한 회귀검증 통과
- GitHub Actions 성공
- 필요한 Deploy Preview 성공
- 확정 기획 대비 구현상태 확인
- blocker 없음
- 운영 상태 문서 최신화
- Draft PR에 결과 기록

그 뒤 Ready, `main` merge, Production이 필요하면 사람 판단 Gate에서 멈춘다.

## 14. 완료 보고

사용자에게 긴 작업 로그를 운반시키지 않는다. 완료 보고는 다음 중심으로 짧게 남긴다.

- PR 번호와 최종 commit
- 핵심 변경
- 테스트·CI·Preview 결과
- 남은 blocker
- 다음 사람 판단 Gate

## 15. 오류 발생 시

push 또는 PR 갱신에 실패하면 다음을 보고한다.

- 실패 단계
- 오류 메시지
- HTTP 상태 코드가 있으면 해당 코드
- 현재 branch
- remote 정보
- 로컬 변경 파일 목록

비밀값은 출력하지 않는다.
