# Production 배포 운영 (2026-11-28)

이 문서는 기존 72시간 정책을 대체한다. 파일명은 기존 링크 호환을 위해 유지한다.
실제 적용 상태와 CI 증거는 이 변경의 PR을 기준으로 확인한다.

## 정기 배포

- 매주 **일요일·수요일 오후 9시(한국 시간)**가 정기 점검 기준이다. UTC에서 같은 요일 12:00에 해당한다.
- 기존 24시간 실행 허용 창과 지연 대비 cron을 유지한다. 각 슬롯 첫 실행만 확인하며, 실패·취소·무변경·재실행은 같은 슬롯을 다시 소비하지 않는다. 정기 점검 시작과 실제 게시 시각은 다를 수 있다.
- 마지막 수동·정기 게시 시각이 다음 주간 슬롯을 바꾸지 않는다. 수동 실행은 정기 이력에서 제외한다.
- 실제 공개된 성공 Production SHA와 최신 main의 웹 빌드 입력만 비교한다. 변경이 없거나 모바일·문서·테스트만 바뀌면 `NO_CHANGES`로 생략한다.
- `NETLIFY_PRODUCTION_RELEASE_ENABLED=true`인 기존 예약 활성화 조건을 유지한다.

## 즉시 배포 사용법

[GitHub 배포 워크플로](https://github.com/cetin072/taejang_homepage/actions/workflows/production-release.yml)에서 **Run workflow → main → action: deploy-now → Run workflow**를 누른다.
권한 있는 사용자의 명시적 요청이며 별도 임시 승인 파일·우회 플래그·기간별 예외는 필요 없다.

- 기본 `dry-run`은 읽기 전용이다. 기존 외부 `workflow_dispatch` 호출에 입력이 없어도 자동 공개하지 않는다.
- `deploy-now`는 최신 main을 checkout하고 현재 공개 SHA와 비교한다. 실제 변경이 없으면 생략한다.
- 실행 상태는 Actions의 queued/in progress 및 Summary/결과 artifact로 확인한다. `PUBLISHED`는 실제 공개 SHA 관찰 완료, `NO_CHANGES`는 생략, `FAILED`는 실패다.
- 정기/즉시 실행은 같은 concurrency group으로 직렬화한다. 중복 클릭이 대기했다 실행돼도 이미 공개된 입력이면 재배포하지 않는다. 기존 run 재실행은 거부하며 실패 후 필요하면 새 즉시 실행을 요청한다.
- main/사이트/저장소/정확한 SHA, payload 신선도, 빌드 검사와 기존 DB preflight(태장)를 유지한다. 실행 중 main이나 공개본이 바뀌면 중단한다.
- 기존 GitHub 사용자 권한과 Build Hook Secret을 재사용한다. 새 권한·자격증명·보호 규칙 변경은 없다. Secret은 UI/로그에 노출하지 않는다.
- 일반 main Git 빌드는 기존 Netlify ignore에서 차단하며 build.command도 승인된 payload를 요구한다. 이번 일정 설정 PR 병합 자체로 즉시 공개하지 않는다.
- 기존 Hook 이름 `48-hour approved main`은 외부 식별자이므로 그대로 유지한다. 실제 주기는 정책 JSON이 정한다.
- Hook POST는 1회만 한다. 응답 유실 시 재전송하지 않고 공개 SHA를 관찰한다. 실패하면 이전 공개본이 유지된다.

이번 작업에서 Production 시험 배포를 하지 않는다. 로컬 fixture 검증은 실제 게시 성공 증거가 아니다.

과거 marker PR 방식인 `production-release*.mjs`는 활성 workflow/package 실행 경로가 아니다. 해당 회귀는 당시 48시간 정책 fixture를 유지하며, 현재 운영 정책은 `scheduled-netlify-release.mjs`와 전용 회귀로 검증한다. 만료된 2026-10-22 일회성 예외의 기한도 연장하지 않는다.
