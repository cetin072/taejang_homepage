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
                        ↓ 기존 익명 공개 상세 RPC
운영자 pilot POST → Cloudflare Worker → 현재 공개 첨부 여부 확인
                        ↓ 한 파일 복사·크기/타입/SHA256 검증
                      비공개 R2

Netlify 피드/SSR → 검수 manifest의 URL만 media.taejang.co.kr/v1/... 로 변환
브라우저 → Cloudflare Worker → 기존 공개 상세 RPC로 현재 공개 여부 확인
                             → 비공개 R2 사진 직접 응답
```

`media.taejang.co.kr`은 제안 주소이며 소유권/설정 확인이나 DNS 변경을 하지 않았다.
Supabase는 작은 공개 메타데이터만 응답하며 R2 사진 바이트를 중계하지 않는다.
첫 단계는 공개 버킷/CDN 캐시 대신 **비공개 R2 + Worker, no-store**를 선택했다.
공개 철회 시 옛 주소의 신규 요청도 막기 위해서다. R2 인터넷 전송료와 별개로 Worker 호출,
R2 저장/읽기/쓰기 비용 및 메타데이터 DB 요청은 남는다. 캐시 최적화는 철회 보장 검토 후 별도 작업.

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
기존 공개 RPC 계약을 재사용하며 Supabase SDK/스키마/권한 변경 없음.
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
