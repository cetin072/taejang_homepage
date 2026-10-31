# 공개 홍보 사진 R2 pilot

상태: 코드 준비, 실제 계정·버킷·DNS·환경변수·파일 복사·운영 적용 미실행.
2026-10-31 사용자가 공개 사진 분리 구현을 승인했다. 신규 유료 가입, 자격증명 생성/등록,
DNS, 실제 업로드와 운영 설정은 별도 승인 대상이다. main 병합·Production 배포 제외.

## 결정과 기존 작업

- Supabase Auth/DB/RLS/RPC 및 직원/출퇴근/급여, 작성/압축/상신/승인 화면 유지.
- #561(ea43dcc) 요청 감소, #562(82375e0) 업로드 압축 재사용.
- #560은 ccacb0b로 병합됨. 아카이브 수집/초기 렌더링 코드 변경 없음.
- #555 경남공감 카드와 #546 누락 사진 보완 Draft는 별도이며 수정/재구현하지 않는다.
- 신규 npm 의존성 없음. Cloudflare Workers의 공식 R2 binding/Web Crypto 사용.
- 승인된 공개 홍보 사진 중 검수한 소수만 명시 manifest로 선택한다. 사내 직원관리 사진,
  근태/급여/계약 첨부, 미승인·숨김·보관 게시물, 외부 핫링크와 signed URL 제외.
  공개 행사에 직원이 나온 승인 사진과 직원관리용 비공개 사진을 혼동하지 않는다.

## 데이터 흐름

```text
기존 작성/압축/승인 → Supabase 게시물/원본 (변경 없음)
                        ↓ 현재 공개 상태 (신규 읽기 전용 RPC)
운영자 pilot POST → Cloudflare Worker → 현재 공개 첨부 여부 확인
                        ↓ 한 파일 복사·크기/타입/SHA256 검증
                      비공개 R2

Netlify 피드/SSR → 검수 manifest의 URL만 media.taejang.co.kr/v1/... 로 변환
브라우저 → Cloudflare Worker → 읽기 전용 공개 첨부 RPC로 현재 공개 여부 확인
                             → 비공개 R2 사진 직접 응답
```

`media.taejang.co.kr`은 제안 주소이며 소유권/설정 확인이나 DNS 변경을 하지 않았다.
Worker 검사에 Supabase는 boolean(true/false)만 응답하며 R2 사진 바이트를 중계하지 않는다.
첫 단계는 공개 버킷/CDN 캐시 대신 **비공개 R2 + Worker, no-store**를 선택했다.
공개 철회 시 옛 주소의 신규 요청도 막기 위해서다. R2 인터넷 전송료와 별개로 Worker 호출,
R2 저장/읽기/쓰기 비용 및 공개 여부 판정 DB 요청은 남는다. 캐시 최적화는 철회 보장 검토 후 별도 작업.

## 코드와 활성화 계약

- `shared/public-media-manifest.mjs`: 기본 빈 배열. contentId/sourceUrl/sha256/size/contentType만 수록.
  개인정보나 signed URL, secret 금지. 동일 contentId+hash 키 중복/상충 항목은 검수에서 거부한다.
- `PUBLIC_MEDIA_R2_ENABLED=true`가 Netlify Functions와 Edge에 제공되어야 참조가 전환된다.
  미설정/false/빈 manifest에서는 원래 Supabase URL 그대로다.
- Worker `PUBLIC_MEDIA_ENABLED=true`, `PUBLIC_MEDIA_BUCKET`, `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY` 필요. 프로젝트 service-role 키 불필요/사용 금지.
- 복사 POST만 `COPY_TOKEN` 서버 비밀 필요. 브라우저와 앱에 배포하지 않는다.
  자동 업로드/스케줄 없음. 정규화한 `v1/contentId/hash` 경로 1건에 대한 수동 POST만 가능하다.
- R2 r2.dev 및 버킷 public custom domain은 OFF. 도메인은 Worker에만 연결한다.
- manifest와 origin은 서버 번들에서 가져온다. 피드/SSR가 반환한 공개 URL만 화면에서 사용한다.
  목록, 상세 갤러리, SSR, OG에 동일 전환 적용. 이미지 실패 시 기존 기본 사진 fallback 재사용.
- Worker 배포/연결 전 Netlify 스위치 활성화 금지. Worker와 Netlify manifest 동일 버전 확인.

## pilot 승인 전 준비할 대상 목록

실제 공개 피드 조회·다운로드는 이번 검증에서 하지 않았다. 따라서 대상 건수는 아직 0이며
실제 이전 대상이 확정됐다고 해석하지 않는다. 다음 표는 승인 단계에서 1~3개 사진으로 채운다.

| 항목 | 검수할 내용 |
| --- | --- |
| 게시물 ID/공개 상태 | 현재 공개 RPC가 반환하는 글, 예정/미승인/숨김 제외 |
| 원본 URL/용도 | 해당 글 public_media에 포함된 promotion-media 사진 |
| 사용권/개인정보 | 공개 승인 근거, 내부 직원/급여/계약 파일 제외 |
| 파일 크기·SHA256·MIME | 승인된 로컬 원본으로 산출 우선. 다운로드 필요시 전송량과 함께 승인 |
| R2 key/백업 | contentId+SHA256, Supabase 원본 유지, 삭제 계획 없음 |
| 전환/복구 검수 | 목록·상세·SSR·OG·숨김·재공개·원본 복구 확인 |

## 실패, 중복, 철회, 복구

1. 승인 RPC 장애/비공개/첨부 변경: Worker는 503/404, 사진 미응답. public_media URL 일치 확인.
2. 복사 중 실패/크기·MIME·hash 불일치: 참조 전환 금지. R2 checksum 검증 쓰기, 오류 응답은 비밀 미포함.
3. 동일 키 재시도: 저장 크기/hash 메타데이터가 일치하면 원본 재다운로드 없이 성공.
   복사 중 철회는 쓰기 전 재조회로 차단하며, 쓰기 직후 철회돼도 GET의 현재 승인 확인이 차단한다.
4. DB 기록 실패: 이 pilot은 DB URL/행을 변경하지 않으므로 분산 DB 쓰기 문제가 없다.
   복사 성공 후 설정/배포 실패시 비공개 복사본만 남고 기존 참조 유지. 자동 cleanup/delete 없음.
5. 철회: 기존 숨김/보관 절차 유지. Worker는 매 요청마다 공개 상세 RPC 확인, 모든 응답 no-store.
   CDN Cache Everything/브라우저 TTL override 금지. 실제 환경에서 direct URL/HEAD/OG를 재검사.
   이미 다운로드됐거나 진행 중인 응답, 외부 SNS가 자체 보관한 사본까지 회수할 수는 없다.
6. 롤백: Netlify R2 스위치를 false로 하고 승인된 이전 배포 복구. 기존 원본 참조가 즉시 다시 사용된다.
   기존 정적 archive snapshot에 R2 URL이 남을 수 있어 이전 산출물 복구 또는 재빌드 필요.
   snapshot 복구를 확인한 뒤 Worker disable. 버킷 원본/복사본 삭제하지 않는다.
7. 기존 Supabase 공개 URL 자체의 과거 접근 정책은 변경하지 않는다. R2 철회와 기존 공개 버킷
   철회는 다른 문제이며 운영 검수에서 함께 확인한다. 무료 Supabase 업무 중단 위험은 여전히 존재.

## 운영 적용 체크리스트 (아직 미실행)

- [ ] Cloudflare 계정/태장 도메인 권한 확인, R2/Workers 실제 요금·무료 한도 및 결제 조건 확인.
- [ ] 사용자에게 계정, 비공개 pilot 버킷, Worker, 제안 도메인, 예상 저장/요청량 제시 후 설정 승인.
- [ ] 승인 후 전용 비공개 버킷 + Worker binding. 최소 권한, 비밀 등록은 제공자 보안 UI/CLI로만.
- [ ] staging 합성 사진으로 copy/GET/HEAD/철회/실패/재시도 검사. 실제 사진으로 먼저 시험하지 않음.
- [ ] 대상표 1~3건, 원본/비공개 제외/복구 검수 후 실제 복사 승인.
- [ ] manifest 배포 → 승인된 POST 복사 → SHA256/직접 URL 검증 → Netlify 스위치 활성화 순서.
- [ ] main 병합 및 Production 설정/배포는 별도 승인. 고정 QA를 다른 진행 작업과 충돌시키지 않음.
- [ ] 실제 브라우저 목록·상세·갤러리·SSR·OG, 깨진 사진 fallback, 숨김 direct URL 차단 확인.
- [ ] 며칠간 Supabase egress와 Worker/R2 요청/오류/비용 비교. 효과 확인 후 소규모 확대.

Android 사용자는 지금 PC가 필요 없다. 외부 설정 승인 시 Cloudflare 로그인/계정 확인·결제 동의가
필요할 수 있다. 키/비밀번호는 채팅으로 요청하지 않는다. 연결 도구가 없으면 관리자 화면에서
위의 구체적 계정/버킷/도메인 설정만 안내한다.

## 검증 근거와 제한

로컬 fixture만 사용. 실제 사진 바이트/운영 DB 쓰기/Cloudflare API 호출 없음.
공식 API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
Supabase changelog.md 조회는 도구 content-type 오류 및 셸 HTTP403으로 미확인.
기존 공개 피드 계약은 유지한다. Worker에는 아래의 새로운 읽기 전용 boolean RPC가 필요하며 운영 적용은 하지 않았다.
Cloudflare 연결 도구와 환경변수 이름에서 자격증명 존재를 확인하지 못함. 계정 자체가 없다는 뜻 아님.

### 이번 로컬 검사 결과

- `node --test tests/public-media-r2.test.mjs tests/public-promotion-media.test.mjs`: 13/13 PASS.
- 모든 실제 fetch를 HTTP503 fixture로 치환한 `npm run test:public`: 164/164 PASS.
- 동일 오프라인 모드 `npm run build:netlify`: PASS. 28 navigation, 12 articles, 100 archive records.
  네이버 사진 49개는 의도적으로 로컬 fallback 사용; 실제 사진 수집 성공으로 보고하지 않는다.
- `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node tests/public-media-r2-browser.mjs`:
  390/1440px 실제 Chromium, 합성 PNG의 Worker 직접 GET/decode 및 공개 취소 시 fallback PASS.
- `git diff --check`, Worker 문법 검사 PASS.
- 일반 public test가 내부 빌드를 호출함을 확인하고 중단 후 전체 fetch 차단 방식으로 재실행했다.
  운영 egress 측정/실사진 이전 검증을 수행한 것은 아니다.
- Playwright bundled Chromium 다운로드는 HTTP403(Domain forbidden); 시스템 Chromium으로 검사 완료.
- Cloudflare 실제 런타임, provider 연결, 실계정 승인/철회, hosted CI, 고정 QA는 미검증.


## 2026-10-31 독립 검수 보완 (로컬만, 추가 push/PR 없음)

### 읽기 요청과 부수 효과

저장소의 `get_public_promotion_content` 최신 정의는
`20260912112000_issue_181_promotion_source_and_schedule.sql:413`이다. 이 함수는
`private_publish_due_promotions()`를 호출하며 예약 발행 시 contents/queue/audit를 쓴다.
이전 Worker 설계는 그 함수를 사진 요청마다 호출했으므로 무변경 읽기라는 설명은 잘못이었다.
Worker에서는 이 경로를 완전히 제거했다. 기존 홈페이지 피드/SSR의 원래 동작은 변경하지 않았다.

- `mediaPolicy.resolve`는 R2 사진 URL을 선택할 때 HEAD를 보내지 않는다.
  피드·SSR의 중복 확인은 0회이고 실제 브라우저 GET만 Worker에서 검사한다.
- Worker는 GET `is_public_promotion_media(p_content_id,p_source_url)`를 호출한다.
  SQL STABLE, boolean만 반환하며 PostgREST GET의 read-only transaction을 사용한다.
  공개 content/current revision/정확한 첨부 URL만 SELECT한다. 제목/본문/첨부 목록 반환 없음.
- 권한 TTL/응답 간 공유 캐시 없음. 매 GET마다 새 판정 1회. 정상 GET은 R2 get 1회;
  철회·판정 실패는 R2 get 이전 차단. 직접 HEAD 요청도 지원하되 화면은 생성하지 않는다.
- 복사는 처음 2회(다운로드 전/쓰기 전), 완료 키 재시도는 1회 판정한다. 승인 체크를 줄여
  복사 중 철회 안전성을 약화하지 않는다.

### SQL 적용 준비와 복구

`supabase/migrations/20261031141001_public_media_readonly_access.sql`을 CLI로 생성했고,
`supabase/proposals/public_media_readonly_access.rollback.sql`을 복구 SQL로 유지한다.
초기 CLI는 읽기 전용 `/home/agent/.supabase` 생성에 EROFS로 실패했으나,
공식 `SUPABASE_HOME` 옵션으로 `/tmp/taejang-r2-cli`의 빈 디렉터리를 지정해 해결했다.
기존 HOME/설정/자격증명을 변경·복사하지 않았다. 환경을 비운 상태에서 PATH 및 임시 설정,
업데이트 알림·추적 OFF만 주입해 `migration new --help` → `migration new`를 실행했다.
기존 제안 SQL은 중복 원본이 되지 않게 migration으로 옮겼다. 운영 적용은 하지 않았다.

공식 근거: https://github.com/supabase/cli/blob/develop/apps/cli/docs/supabase-home.md
생성 명령은 로컬 파일 생성만 수행하며 login/link/원격 SQL을 실행하지 않았다.
전체 로컬 Supabase 스택은 실행 중이지 않아 전체 migration/RLS/advisor/PostgREST HTTP
통합 검증은 여전히 미실행이다. 이를 CLI 파일 생성 성공으로 대체하지 않는다.

공개 wrapper는 SECURITY INVOKER이고, 별도 비노출 `public_media_private` schema의
STABLE SECURITY DEFINER가 현재 공개 첨부 존재 여부만 판단한다. 익명 사진 요청이므로
로그인 요구 대신 정확한 공개 조건을 적용한다. 기존 `private` schema 권한 및 원본 테이블
SELECT/RLS 권한은 열지 않는다. 새 schema를 Data API exposed schemas에 추가하지 않는다.
공개 함수는 PUBLIC 기본 실행권을 회수하고 anon/authenticated만 명시 허용한다.

미적용 RPC(404), 접근 불가, 잘못된 응답, DB 장애는 Worker 503으로 차단한다.
기존의 부수 효과 있는 상세 RPC로 fallback하지 않는다. Netlify 스위치 OFF/빈 manifest는
이전 경로 유지. 적용 전 스위치를 켜면 기존 일반 이미지 fallback으로 끝나며
R2 원본이나 미승인 사진을 공개하지 않는다. 적용 순서는 SQL 검증/승인 → RPC → Worker
→ 합성 fixture → 실제 사진 pilot 별도 승인 → Netlify 스위치다.
복구는 Netlify 이전 참조/정적 snapshot 복원 → Worker OFF → public wrapper/helper/schema
순서로 drop. rollback은 CASCADE 없이 예상하지 못한 의존성이 있으면 중단한다.

### 원본 URL 불변성 조건

R2 키는 검수 시점의 바이트 해시다. 같은 Supabase URL의 원본을 덮어쓰면 공개 URL
membership 검사만으로 바이트 변경을 알 수 없어 과거 R2 사본이 남을 수 있다.
따라서 pilot 활성화 조건은 **선택한 원본 경로는 덮어쓰지 않는 것**이다.
교체할 때는 새 고유 원본 URL로 업로드 → 기존 공개 승인 절차 → 새 크기/해시 manifest
→ 검증 복사 → 참조 전환한다. 기존 키 재사용 금지. overwrite가 있었거나 의심되면
해당 manifest 전환을 끄고 기존 경로로 복구한 뒤, 승인된 원본으로 manifest/hash/key를
다시 만들고 복사·검수한다. 이 검증을 매 이미지 GET마다 원본 다운로드로 대체하지 않는다.
Storage 전역 불변성 정책을 이번 변경으로 강제했다고 주장하지 않는다.

공개 철회는 **새 R2 요청**에 적용된다. 이미 보존된 기존 Supabase 공개 URL의 접근 권한이나
다운로드된 사본·외부 SNS 캐시까지 회수하는 것은 아니다. 이 한계는 그대로 유지된다.

### 활성화 전 소규모 실측 계획 (이번에는 트래픽 생성 안 함)

승인 후 합성 사진 1개 및 별도 검수된 실제 사진 1~3개만 사용한다.
기존 경로와 R2 경로를 같은 페이지·사진·화면 폭·조건으로 각 1회 비교하고 HAR/서비스 계수를
기록한다. 캐시 cold/warm과 목록/상세·SSR를 구분하며 새로고침 반복 부하를 만들지 않는다.

| 측정 | 기록/판정 |
| --- | --- |
| 페이지당 네트워크 요청 | 피드/SSR 메타데이터와 이미지 GET/HEAD 별도; R2 사전 HEAD 0 |
| API bytes | 기존 전체 공개 상세 응답과 새 boolean 응답의 body/HTTP total을 구분 |
| Worker 호출 | 실제 R2 URL 요청 수와 일치하는지; 실패/철회도 별도 기록 |
| R2 읽기 | 정상 GET 1당 get 1; 철회/판정 실패에는 0 |
| 지연 | Worker의 boolean 조회 시간, R2 조회, 이미지 TTFB/decode, 페이지 체감 |
| 비용 효과 | 절감한 Supabase 이미지 bytes 대 증가한 boolean RPC/Worker/R2 요청 비교 |

fixture에서 예상하는 정상 대표 사진 1장의 추가 경로는
`사전 HEAD 0 + Worker GET 1 + boolean RPC 1 + R2 get 1`이다.
권한 캐시로 요청 수를 더 줄이거나, 응답 JSON의 4/5바이트를 전체 HTTP 전송량이라고
보고하지 않는다. 실제 지연·페이지별 총요청·과금 효과는 아직 측정하지 않았다.

### 보완 후 검증 결과

- 관련 Node tests 15/15 PASS, 전체 오프라인 공개 웹 tests 166/166 PASS.
- Chromium 390/1440px 각각 대표 이미지 GET 1 / boolean RPC 1 / R2 get 1을 명시 단언.
  숨김 후 새 요청은 RPC를 다시 호출하고 R2 get 없이 기본 사진으로 전환.
- PostgreSQL 17 (`postgres:17-alpine`, digest
  `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`),
  네트워크/공개 포트 없는 임시 Docker fixture에서 SQL 적용·READ ONLY 실행·rollback PASS.
  `tests/fixtures/public-media-r2/`의 최소 테이블 fixture 사용. published/current attachment,
  hidden/scheduled/null published_at/archived/draft/missing/old revision/정확하지 않은 URL/null,
  익명 원본테이블 접근 불가, 기존 private schema 권한 보존, STABLE/invoker/definer,
  scheduler 미호출, 숨김 직후 재검사와 rollback을 확인했다.
- 위 PostgreSQL 검사는 **전체 저장소 migration/RLS 통합이나 PostgREST HTTP 실행 검사가 아니다.**
  전체 로컬 migration/advisor/RPC HTTP gate는 별도로 남는다.
- 로컬 fixture DB만 생성/삭제. 운영 DB/계정/사진/캐시/도메인 설정 변경 없음.
- 실제 Supabase/Cloudflare 성능·과금 효과 및 production 철회는 미측정/미검증.

### 정식 migration 생성 후 재검증

- CLI 생성 파일 `20261031141001_public_media_readonly_access.sql`로 새 격리 PostgreSQL 17
  fixture에 적용 → 읽기 전용/권한/철회 assertions → rollback 모두 PASS.
- 임시 fixture 컨테이너 제거. 기존 credential 복사, login/link, 운영 SQL 실행 없음.
- 변경은 SQL 파일 이동·생성 및 기록 갱신이며 Worker/프런트 런타임은 직전 검증본과 동일하다.
- `git diff --check` PASS. 전체 Supabase/PostgREST 스택은 존재하지 않아 통합검증 미실행 유지.
