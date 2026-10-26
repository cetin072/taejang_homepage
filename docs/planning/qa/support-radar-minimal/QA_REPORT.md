# 지원사업 부분 재구성 검수

기준: main dec4ca7e, 2026-10-26. 실제 회사 데이터 대신 명시적인 합성 JSON과 격리 임시 파일, 모의 RPC를 사용했다.

- `npm run test:platform-static`: 602 PASS / 0 FAIL (신규 collector 6개 포함).
- `npm run test:staging-safety`: 16 PASS / 0 FAIL. 운영 DB 검증을 뜻하지 않음.
- `node --test tests/support-radar-*.test.js tests/support-radar-bizinfo.test.mjs`: 51 PASS / 0 FAIL.
- `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node tests/support-radar-minimal-browser.mjs`: 1440/768/390/320px PASS. 목록/상세, 지역 검색, 보류·마감 필터와 복귀 보존, 키보드 필터 이동, 원문 URL, 배정 표시, 검토 저장 실패 메모 보존, 가로 넘침 없음, 읽기 전용 수정 버튼 차단, source 조회 실패에도 목록 이용을 확인.
- 브라우저 스크립트는 `supportRadarBrowser` manifest 그룹으로도 실행 가능. 기존 설치 Chromium 사용. Playwright 다운로드는 403 Domain forbidden으로 실패했고 별도 재시도하지 않음.
- `--fixture` CLI: 합성 공고 2개 정규화. 키 없는 실행: `not_connected`, 성공 0건, 요청 없음.
- 반복 수집의 ID 중복 방지, 기존 메모/판단/배정 보존, 변경 공고 갱신 및 이전 공고 보존을 임시 파일 저장/재읽기로 검증.
- 인증 실패·HTTP 오류·잘못된 응답·네트워크 오류·신규 없음은 모의 응답 검사. 실제 기업마당 성공 호출은 미실행.

화면 캡처는 `/tmp/taejang-support-radar-qa/{list,detail}-{1440,768,390,320}.png`에 생성된다. 실제 Production/Preview 인증 화면이 아닌 합성 검수 화면이다.

미실행: 실제 API 인증, DB ingestion/관심 저장, 실제 역할별 서버 권한/동시성/pgTAP, 기존 전체 앱의 실사용 브라우저 흐름, CI/원격 Preview HEAD 대조. 따라서 사용자 수용 검수 준비 완료로 판정하지 않는다.

초기 platform-static 검사에서 신규 테스트 manifest 누락 1건을 발견하여 등록 후 602개 전부 통과했다. 검토 중 발견한 기업정보 진입 오연결과 정보원 카드 상태 누락도 수정했다.

`npm run build:netlify`: 종료 코드 0, dist 생성 성공. 기존 네이버 이미지 43건은 외부 fetch 실패로 빌드의 기존 fallback을 사용했다. 이번 지원사업 변경과 무관하지만 전체 이미지 검증 PASS로 해석하지 않는다. 배포는 실행하지 않았다.
