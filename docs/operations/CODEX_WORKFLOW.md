# Codex 표준 작업 흐름

## 시작

1. `AGENTS.md`와 `docs/operations/` 문서를 먼저 읽습니다.
2. [`MODEL_SELECTION_POLICY.md`](MODEL_SELECTION_POLICY.md)를 읽고 **현재 작업 단위**에 맞는 모델·추론 수준을 다시 선택합니다.
3. 모든 Codex 실행 지시는 가능하면 아래 헤더로 시작합니다.

```text
권장 모델: GPT-5.6 Terra
권장 추론: Medium
선정 이유: 기존 구조 안의 일반 구현과 회귀 테스트 작업
```

4. 모델은 이전 채팅 설정을 그대로 이어받지 않습니다. 같은 채팅이라도 작업이 바뀌면 재평가합니다.
5. 판단이 애매하면 `Terra / Medium`을 기본값으로 합니다.
6. 단순 작업에 Sol을 관성적으로 유지하지 않고, 보안·Auth·RLS·권한·중요 DB migration·Production 사고·복잡한 장기 브랜치 정합화에는 Luna를 사용하지 않습니다.
7. 항상 최신 원격 `main`을 확인합니다.
8. GitHub Issue가 있으면 Issue 번호와 본문을 단일 작업지시서(source of truth)로 사용합니다. 대화의 추가 요청은 Issue 범위와 충돌하지 않는 보완사항으로만 반영하고, 범위가 바뀌면 먼저 Issue를 갱신합니다.
9. 기존 로컬 미커밋 변경을 자동으로 재사용하거나 새 작업에 포함하지 않습니다.
10. 작업 목적이 드러나는 새 기능 브랜치를 최신 `origin/main`에서 만들고 `main`에는 직접 수정하지 않습니다. 단, 기존 Issue/브랜치/Draft PR을 이어가는 작업은 기존 작업 흐름을 유지합니다.

## 모델 재평가

작업 도중 범위나 위험도가 달라지면 모델·추론을 다시 판단합니다.

- Luna로 시작했는데 여러 모듈·권한·DB까지 확대되면 Terra 또는 Sol로 올립니다.
- Sol로 복잡한 분석을 마친 뒤 남은 일이 단순 문구 수정·테스트 재실행뿐이면 Terra 또는 Luna로 낮춥니다.
- 이전 작업에서 Sol을 썼다는 이유만으로 다음 간단한 작업도 Sol을 쓰지 않습니다.

## 비용·권한 원칙

- OpenAI API 별도 결제·키와 외부 유료 자동화 서비스를 사용하지 않습니다.
- 기존 GitHub Actions와 Netlify Deploy Preview 구조를 우선 활용합니다.
- `fetch`, `push`, PR 생성 등 권한 오류가 발생하면 우회하지 않고 사용자에게 필요한 권한 승인을 요청한 뒤 재시도합니다.

## 개발

- 사용자 요청 범위만 수정합니다.
- 요청하지 않은 디자인 전면 개편은 하지 않습니다.
- 기존 기능과 링크를 먼저 확인합니다.
- 새 라이브러리 도입 전 현재 HTML·CSS·JavaScript로 해결 가능한지 검토합니다.
- 자산은 `PROJECT_STRUCTURE.md`와 `ASSET_POLICY.md`에 지정된 위치에만 추가합니다.

## 검사

변경 범위에 맞는 검사를 선택합니다. 모든 작업에 불필요한 검사를 일괄 실행하지 않습니다.

- `git status`, `git diff`, `git diff --check`
- HTML 구조 검사, JavaScript 문법 검사
- 내부 링크·앵커, 이미지 경로 확인
- 모바일 360px, 768px·1024px·1440px 레이아웃 확인
- 접근성 기본 확인
- 기존 관련 페이지 회귀 확인

## GitHub 게시

1. 변경사항을 의도적으로 커밋합니다.
2. 원격 작업 브랜치에 push합니다.
3. `main` 대상 Draft PR을 생성합니다.
4. PR 설명에 변경 목적, 관련 Issue, 변경 파일, 검사 결과, Preview 상태, 사용자 확인사항을 기록합니다.
5. 사용자 승인 전에는 Ready for review로 전환하거나 merge하지 않습니다.
6. Production 배포와 Netlify 운영 설정 변경을 하지 않습니다.

## 공통 AI 운영 절차

- 시작 전에는 `PROJECT_CHARTER.md`, 관련 `docs/planning/` 문서도 확인하고 `git fetch origin`, 최신 `origin/main`, working tree 상태를 점검합니다. clean working tree에서만 최신 `origin/main` 기준 Issue 전용 브랜치를 만듭니다. 기존 진행 중인 Issue/PR은 새로 만들지 않고 이어갑니다.
- 필요한 테스트와 문서 링크·경로 검증을 수행합니다. 구현 문맥과 분리된 검수자가 PR을 검토하면, 지적사항을 같은 PR 브랜치에서 수정하고 필요한 검증을 다시 실행합니다.
- 사무실·집·노트북 등 다른 PC로 이동하기 전에는 최소 commit과 push를 남깁니다. 가능하면 Draft PR까지 만들어 Issue, 브랜치, 커밋, 검증 결과를 GitHub의 공유 상태로 남깁니다. 미커밋 변경은 해당 PC에만 존재하는 상태이므로 장기간 고립시키지 않습니다.

## 완료 보고 형식

- PR 번호와 주소
- 검사 결과
- 사용자 확인 필요사항(있는 경우)

## 오류 발생 시

push 또는 PR 생성에 실패하면 다음을 그대로 보고합니다.

- 실패 단계
- 전체 오류 메시지
- HTTP 상태 코드
- 현재 브랜치
- remote 정보
- 사용한 인증 방식
- 로컬 변경 파일 목록
