# 태장 지원사업 찾기 — 저장 연결 검수

> 아래는 인계 ZIP의 이전 환경 기록이다. 현재 재검수와 연결 제한은 [CONNECTION_REVIEW.md](CONNECTION_REVIEW.md)를 참조한다.

2026-10-26. 운영 DB는 사용하지 않았다. 이전 9b9b2e8 인계본의 'DB/관심 미구현' 제한을 보완한 로컬 구현 결과다.

| 검사 | 결과 |
| --- | --- |
| platform-static | 603 PASS / 0 FAIL (collector/persist 단위검사 7개 포함) |
| staging-safety | 16 PASS / 0 FAIL |
| 실제 격리 PostgreSQL | 23 PASS / 0 FAIL |
| 브라우저 | 1440/768/390/320px PASS, 기존 Chromium 사용 |
| build:netlify | 성공. 네이버 외부 썸네일 43건 기존 fallback |
| diff / JS 문법 | 통과 |

## 실제 DB 검증 범위

새 Docker 컨테이너만 생성: network=none, 포트 없음, data tmpfs, 고유 이름/검수 라벨. 기존 DB 주소/컨테이너/운영 볼륨을 입력받지 않는다. 종료 시 해당 생성 컨테이너만 제거한다. 이미지 digest는 테스트 파일에 고정했다.

저장소의 지원사업 foundation/mutation/query/review/source/capability 및 새 migration을 실제 PostgreSQL에 적용했다. 기존 실제 current_profile_is_active/current_user_has_role/private_actor_capabilities/private_actor_can/private_append_audit 함수를 사용했다. auth.users와 auth.uid의 세션은 합성 fixture이며 GoTrue/PostgREST/JWT 검증이 아니다.

- 모의 공식 JSON → collector → persist RPC → 실제 공고/출처 저장 → finder 조회.
- ID/원문/한국시간 마감일, 상시 기간 원문.
- 재수집 신규 0, 동일 run 멱등성, 클라이언트 timezone 변경에도 동일 run 유지.
- 동시 collector 2개에도 source-ID 중복 없음.
- 원문 정정 시 source-owned title 갱신, 수동 대상 보정·준비 메모·검토 메모·판단·배정 보존.
- 관심 저장/해제, 신청/보류와 독립, revision 증가, 오래된 revision 거절, 동시 관심 변경 1개만 성공.
- 대표 조회 허용; 직원·중지 계정·대표 쓰기 거부; capability 철회 시 운영총괄도 거부.
- 배정 직원의 기존 상세 조회 보존; 관리 수집 상태 접근 거부.
- anon RPC 실행 및 authenticated 직접 새 테이블 쓰기/이력 조회 거부.
- 인증/통신/미연결/응답 오류 이력, 마지막 성공 시각과 공고 보존.
- 잘못된 batch 전체 rollback, unknown 필드 미저장, source 자동화 상태 불변.
- 기존 audit 및 append source snapshot 유지.

초기 반복 검사에서 initdb 임시 서버를 준비 완료로 본 시작 race를 발견했다. PID 1이 최종 postgres 프로세스로 바뀐 뒤 연결을 확인하도록 보완 후 전체 검사를 통과했다.

## 화면 검증

관심 보관/해제/관심 필터, 기존 판단·마감 필터/검색 복원, 관심 변경 및 검토 실패 중 메모 보존, source 신규 없음/인증 실패 구별, 새 migration 없음 fallback, 권한 오류에서 fallback 금지, 읽기 전용 버튼 차단, 요청 완료 전 로딩 안내, 키보드 이동, 180px 메뉴명 및 가로 넘침을 확인했다. 실제 시간/성능 개선율은 측정하지 않았다.

캡처는 합성 RPC 화면이다. 실제 운영 데이터나 개인정보가 없다. 목록 PC/모바일 캡처는 이 폴더, 전체 폭의 목록/상세는 인계 묶음에 포함한다.

## 미실행·제출 경계

실제 기업마당 인증, 전체 Supabase migrations/GoTrue/PostgREST/JWT/pgTAP/advisors, Hosted DB 적용, 원격 CI/Preview는 미실행이다. CLI migration-new는 read-only 홈 초기화 오류로 사용하지 못했고 실제 UTC timestamp의 migration 파일을 작성했다. 공식 changelog는 접근 실패였으며 공식 함수 문서를 확인했다.

첫 구현 788dc7b만 원격 push 성공이 확인됐다. 이후 GraphQL Forbidden/후속 push 인증 부재를 재시도하지 않았다. 추가 코드도 로컬 커밋과 Library 인계 새 버전으로 전달한다. DRAFT_PR.md는 제출 본문이며 실제 PR이 아니다. 운영 DB·인증·스케줄·Ready·merge·Production 변경은 없다.
