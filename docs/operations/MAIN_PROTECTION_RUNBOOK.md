# main 브랜치 보호 적용 절차

상태: Issue #131 준비 문서

## 목적

`main` 직접 push를 기술적으로 막고, 태장 저장소의 기본 흐름을 `Draft PR → CI → 사용자 승인 → merge`로 강제한다.

## 현재 필수 체크 이름

GitHub Ruleset/Branch protection에서 추측하지 말고 아래 실제 job check 이름을 사용한다.

- `Public source and launch regression`
- `Migration, pgTAP, Auth and RLS`

두 workflow는 모든 `main` 대상 PR에서 check 결과를 만들도록 구성한다.

- 공개 홈페이지 검사는 가벼워서 모든 PR에서 실행한다.
- Phase 1A 검사는 모든 PR에서 check 자체는 생성하되, 플랫폼 민감 파일이 바뀐 경우에만 Supabase clean reset / DB lint / pgTAP / 실제 Auth·Data API 통합검사를 실행한다.
- docs-only 등 무관 변경에서는 Phase 1A가 lightweight pass로 종료되어 required check가 영원히 pending 되는 문제를 막는다.

## GitHub Ruleset 권장값

대상: `main`

1. Require a pull request before merging: ON
   - required approvals: 0
   - 현재 저장소는 사용자 단독 운영이므로 GitHub 자체의 타인 승인 1건을 강제하지 않는다.
   - 실제 merge 승인선은 프로젝트 운영 규칙의 사용자 명시 승인으로 유지한다.
2. Require status checks to pass: ON
   - `Public source and launch regression`
   - `Migration, pgTAP, Auth and RLS`
3. Require conversation resolution before merging: ON
4. Block force pushes: ON
5. Restrict deletions / prevent branch deletion: ON
6. Broad bypass actor는 두지 않는다. 긴급 해제가 필요하면 저장소 소유자가 설정 화면에서 명시적으로 처리하고 사유를 기록한다.

## 의도적으로 required로 두지 않는 상태

- Netlify Deploy Preview는 검수에 사용하지만 외부 서비스 상태이므로 branch protection의 핵심 required check에는 우선 포함하지 않는다.
- Production 배포는 merge 승인과 별도 운영 단계이며 Ruleset이 자동 Production 승인을 의미하지 않는다.

## 활성화 전 검증

- workflow 변경 PR에서 두 check가 모두 생성되는지 확인한다.
- 플랫폼 관련 변경에서는 Phase 1A full integration이 실제로 실행되는지 확인한다.
- docs-only 테스트 PR 또는 후속 실제 docs 변경에서 Phase 1A가 lightweight pass로 정상 종료되는지 확인한다.
- 현재 GitHub App/Codex/ChatGPT 작업은 기능 브랜치에 push하고 PR을 만드는 흐름을 유지한다.

## 권한 경계

현재 연결된 ChatGPT GitHub App은 contents/workflows/pull requests write 권한은 있지만 repository administration/ruleset write 권한은 없다. 따라서 Ruleset 활성화 자체는 저장소 소유자의 GitHub 설정 권한으로 수행해야 한다.

Ruleset이 활성화된 뒤 Issue #131에서 `main` protected 상태와 required check 이름을 다시 읽어 최종 확인한다.
