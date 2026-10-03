<!--
Source: cetin072/ai-development-system
Source ref: codex/skills-lessons-v1
Source commit containing this pilot skill: 1a4a06200421581f30017e5b71ef57055ae19051
Local purpose: Taejang Phase 2A pilot snapshot. Edit locally only when Taejang-specific behavior is required.
-->

---
name: learning-loop-v0
description: "실제 개발 작업에서 사용자 수정, 반복 실패, 기계적으로 잡을 수 있었던 버그, 반복 가능한 성공 패턴이 발생했을 때만 짧은 Observation을 만들고 Lesson 후보 여부를 판정한다. 사용자가 별도로 Lesson 등록을 요청하지 않아도 작업 종료 시 학습 신호가 있으면 사용한다."
metadata:
  origin: ai-development-system
  status: pilot
  version: "0.1"
---

# Learning Loop v0

## 목적

Hook, background observer, 별도 DB 없이 **실제 작업에서 가치 있는 학습 신호만 최소 기록**한다.

이 Skill은 모든 작업을 회고하는 도구가 아니다. 학습 신호가 없으면 아무 것도 만들지 않는다.

## 자동 적용 Trigger

다음 중 하나가 실제로 발생했을 때만 사용한다.

1. 사용자가 AI의 개발 방식이나 판단을 **교정**했다.
2. 같은 원인의 실패가 반복되거나, 기존 검증으로 잡을 수 있었던 오류가 뒤늦게 발견됐다.
3. 사용자가 Preview/실기에서 **기계적으로 사전 검출 가능했던 버그**를 발견했다.
4. 기존 방식보다 분명히 단순하거나 안전한 절차가 실제로 성공했고 다른 작업에도 재사용할 가능성이 있다.
5. 기존 Rule / Skill / Gate가 있었는데 작업자가 따르지 않아 문제가 생겼다.

다음은 기본적으로 기록하지 않는다.

- 단순 오탈자
- 일회성 UI 취향
- 특정 콘텐츠 문구 선택
- 이미 테스트가 충분히 막고 있는 단순 구현 버그
- 재사용 가능성이 없는 프로젝트 특수 사건

## Inputs

- 현재 사용자 요청 또는 GitHub Issue
- 현재 PR / diff / 테스트 결과
- 사용자의 수정 지시 또는 발견한 오류
- 관련 AGENTS / Skill / Gate
- 실제 재현 또는 검증 증거

## Procedure

### 1. Observation

사실만 한 문장으로 적는다.

나쁜 예:
- "AI가 더 조심해야 한다."

좋은 예:
- "UI 변경 PR을 Preview 브라우저 검증 없이 merge 준비 상태로 판단했고 사용자가 운영에서 메뉴 누락을 발견했다."

### 2. Evidence

무엇으로 확인됐는지 적는다.

- 사용자 피드백
- 실패한 테스트
- PR diff
- Preview
- 로그
- 재현 단계

증거가 없고 추측뿐이면 Lesson 후보로 올리지 않는다.

### 3. 가장 작은 재발 방지 위치 선택

아래 순서로 본다.

1. 기존 테스트/fixture 보강으로 끝낼 수 있는가?
2. 프로젝트 로컬 AGENTS/운영 규칙 수정이면 충분한가?
3. 기존 Skill 수정이면 충분한가?
4. 새 Skill이 필요한가?
5. 여러 프로젝트 공통 Gate/Standard가 필요한가?

가장 작은 위치를 선택한다.

### 4. 프로젝트 범위 기본값

모든 Observation은 **프로젝트 로컬**이 기본이다.

중앙 공통 후보는 다음 중 하나일 때만 표시한다.

- 둘 이상의 프로젝트에서 반복
- 보안/권한/데이터 무결성 같은 보편 위험
- 동일 실수를 여러 작업에서 반복해서 막는 효과가 명확

### 5. 기록 위치

현재 작업에 GitHub Issue나 PR이 있으면 **그 Issue/PR에 짧은 댓글**로 남긴다.

별도 중앙 파일, 새 Issue, 새 Skill은 자동 생성하지 않는다.

권장 형식:

```markdown
### Learning Loop v0
- Observation:
- Evidence:
- Smallest prevention:
- Scope: project | central-candidate
- Next: keep-local | add-test | update-skill | review-for-promotion
```

학습 신호가 없으면 댓글을 남기지 않는다.

## Output

- **NO_LEARNING_SIGNAL** — 기록 없음
- **PROJECT_LESSON_CANDIDATE** — 현재 프로젝트 Issue/PR에 기록
- **CENTRAL_PROMOTION_CANDIDATE** — 중앙 검토 후보로 표시하되 자동 승격하지 않음

## Done

다음 조건을 만족하면 완료다.

- 실제 학습 신호가 있는지 먼저 걸렀다.
- 사실과 해석을 분리했다.
- 가장 작은 재발 방지 위치를 골랐다.
- 프로젝트 로컬을 기본값으로 유지했다.
- 사용자가 직접 "Lesson 등록"을 말하지 않아도 필요한 경우 기록했다.

## Safety / Stop Conditions

- 사용자 대화 전체나 transcript를 저장하지 않는다.
- 비밀값, 개인정보, 민감정보를 Lesson에 복사하지 않는다.
- Observation 하나로 중앙 헌법/표준을 자동 변경하지 않는다.
- 자동 Skill 생성, 자동 Hook 설치, 자동 merge/Production을 하지 않는다.
- Lesson 기록 때문에 본 작업 완료를 지연시키지 않는다.
