# 태장 지원사업 찾기 — 인계 복원·연결 검수

2026-10-26. 운영 DB를 검수에 사용하거나 수정하지 않는다.

## 원본과 제출 계보

- ZIP `taejang-support-finder-9b9b2e8.zip`의 SHA-256: `3cc6e68d1cd588396d49c42bc098eed7c026e4d67ac2414b12b033b38f58c9d7` 일치.
- 내부 SHA256SUMS 및 Git bundle 검증 통과. 원본 최종 커밋 `95f15dc0b3d06d549f6f7f2c42ea3aa9c4b63938`을 별도 worktree에 복원했다.
- 원격 브랜치의 `788dc7beac362c41c4fd3b558ec64e1452ae7c6e`는 원본 최종 커밋의 조상이다. 원본의 네 커밋과 다른 작업 worktree를 보존한다.
- 정상 인증된 GitHub connector를 통해 원격 788dc7be의 자손으로 최종 트리를 제출한다. API 생성 커밋은 원본과 SHA가 달라질 수 있으며, 파일 트리를 대조한다. 강제 push/reset을 사용하지 않는다.
- 동일 브랜치 PR은 없었다. 이전 별도 Draft #175/#189는 다른 구조의 작업이므로 병합·닫기·덮어쓰기를 하지 않는다. #530/#531/#535도 변경하지 않는다.
- main `dec4ca7e77f32267ee37a99d3865cf7efd66117c`, 배포 정책은 `deployment/release-policy.json`의 72시간을 유지한다.

## 보완한 부분

공식 명세의 JSON `jsonArray.item`과 기존 배열 `jsonArray`를 모두 처리한다. 공식 GET 요청에 `pageIndex=1`, `pageUnit=100`, `searchCnt=100`을 명시한다. 최신 100건의 제한된 수집이며 전체 과거 공고를 수집했다고 표시하지 않는다.

기존 UI·식별자·수집 및 관심 RPC·revision·감사 정책을 재사용한다. 기존 목록·필터·검색·상세·신청 판단·담당자·진행·검토 메모를 보존한다. 관심은 회사 공통 보관이며 신청 판단과 독립적이다. API·DB 이름은 변경하지 않는다.

## 현재 재실행 결과

| 검사 | 현재 로컬 결과 | 실행 경로 |
| --- | --- | --- |
| 정적 검사 | 604 PASS, 0 FAIL | `npm run test:platform-static` (기업마당 8개 포함) |
| 안전 검사 | 16 PASS, 0 FAIL | `npm run test:staging-safety` |
| 빌드 | PASS | `npm run build:netlify` |
| 브라우저 합성 RPC | 1440/768/390/320px PASS | `tests/support-radar-minimal-browser.mjs` |
| 별도 PostgreSQL | 로컬 NOT_VERIFIED: Docker 미설치 | 기존 23개 검사를 Phase 1A CI에 연결 |
| 전체 Supabase/Auth/PostgREST/JWT/RLS | 로컬 NOT_VERIFIED: Docker 미설치 | 확장한 `tests/support-radar-auth-integration.mjs`를 기존 Phase 1A CI에서 실행 |
| 실제 기업마당 인증 응답 | NOT_CONNECTED: 확인한 환경에 키 없음 | 모의 공식 JSON과 분리 |
| exact-head Preview | 원격 CI 결과로 판정 | 별도 브라우저 job에서 배포 자산과 현재 소스 일치 후 합성 RPC 화면 검사 |

이전 환경의 PostgreSQL 23 PASS를 현재 실행 결과로 합산하지 않는다. 최종 CI 결과 및 Preview URL은 PR에 기록한다.

추가 실제 Auth 검사는 localhost와 고정 폐기 프로젝트의 Docker 컨테이너를 확인한 뒤 합성 계정을 만든다. 실제 GoTrue 로그인·JWT로 PostgREST를 호출하여 수집 저장→목록, 재수집·동시 수집 중복 방지, 관심 공유·해제·revision 경쟁, 정정/메모/판단/배정 보존, 실패 이력, 대표/직원/anon/중지/비활성 capability 쓰기 거절, 직접 테이블 접근 차단을 확인한다. 화면도 실제 로그인과 RPC로 4개 폭에서 관심·메모 저장 및 DB 재조회, 대표 조회 전용 버튼을 확인한다. 대시보드 주변 shell은 좁은 component harness이며 전체 앱 메뉴 진입 E2E와 구분한다.

현재 지원사업 도메인은 단일 회사 모델이며 회사별 tenant 식별자가 없다. 회사 공통 관심과 미배정 직원 접근 거부를 검증하지만, 서로 다른 회사 tenant 격리 검증은 NOT_APPLICABLE/NOT_VERIFIED이다. 별도 조직 모델이나 권한을 임의 추가하지 않는다.

## 공식 명세·키 연결

- [기업마당 공식 API 명세 및 사용신청](https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi) 확인: GET, `crtfcKey`, JSON, 페이지 옵션, 공고 ID·제목·원문·대상·기간 계약.
- [Supabase API 보안](https://supabase.com/docs/guides/api/securing-your-api), [공식 changelog](https://supabase.com/changelog) 확인. RPC 실행 grant와 함수 내부 역할/capability 검사, 테이블 권한/RLS를 함께 유지한다. SDK·TLS 설정은 변경하지 않는다.
- 로컬 및 Netlify 사이트/팀 설정에서 `BIZINFO_API_KEY`/`BIZINFO_CRTFC_KEY`의 설정 여부만 확인했으며 없음. 값·길이·일부 문자열을 출력하지 않았다. GitHub secret 메타데이터는 도구가 제공하지 않아 확인하지 못했다.
- 사용자는 기업마당 사용신청에 기관·담당자·연락처·시스템 명칭 및 서버 IP/URL을 등록하고 발급받아야 한다. 키를 채팅·저장소·스크린샷에 보내지 않는다.
- 발급 후 별도 승인된 신뢰 실행 환경에서 `BIZINFO_API_KEY`를 비밀 환경변수로 설정한다. `PUBLIC_*`, `VITE_*`, 브라우저 설정에는 넣지 않는다. 이 작업에서는 새 키 발급·영구 환경변수 설정을 하지 않는다.
- `node scripts/support-radar/collect-bizinfo.mjs`는 읽기 전용 정규화 출력이며 DB 저장 명령이 아니다. 실제 저장은 `collectAndPersist({key,rpc,runId})`에 기존 운영총괄의 인증된 RPC transport를 주입하는 수동 호출 계약이다. 새 hosted endpoint·service-role 우회·정기수집은 없다.
- 실제 키와 승인된 격리 연결이 준비되면 모의 fetch 없이 수동 1회 수집, 재수집, 목록/DB 대조를 다시 실행한다. 현재 상태를 실제 자동수집 완료로 판정하지 않는다.

## 적용·승인 경계

새 migration `20261026105301_support_finder_collection_and_interest.sql`은 additive이며 기존 데이터를 삭제하지 않는다. 코드 검토 및 폐기 DB 통과 후에도 공유 DB에는 별도 승인 전 적용하지 않는다. 기존 migration을 재적용하지 않는다.

승인 후 적용 계획: 대상 DB 식별/백업 확인 → 새 migration 한 번만 적용 → 역할별 읽기 및 합성 자료 없는 운영 읽기 검수 → 승인된 수동 수집. DB schema가 아직 없으면 UI는 missing-function 코드에만 기존 조회로 fallback하며 관심 저장을 제공하지 않는다. 권한 거부는 fallback하지 않는다.

문제 시 자동 down/drop/delete를 하지 않는다. 코드 rollback으로 기존 조회를 복구하고 수집 호출을 중단하며 신규 표·이력은 보존한다. 추가 DB 변경은 별도 검토한다.

Draft PR·개발 Preview까지만 제출한다. 고정 사람 QA 브랜치는 기존 작업 소유권/비 fast-forward 문제 때문에 덮어쓰지 않는다. 운영 DB 변경, migration 적용, 새 키/영구 권한, 정기수집, Ready, main 병합, Production 배포는 모두 별도 승인 사항이다.
