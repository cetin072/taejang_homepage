# 태장 지원사업 레이더 — 기업마당 API Mapping v1

Status: **검토 중**  
Parent: #161 / #163  
조사일: 2026-09-09

공식 문서:
- 정책정보 개방: https://www.bizinfo.go.kr/apiList.do
- 지원사업정보 API 상세: https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi

---

## 1. 확인된 API 계약

기업마당은 공식 `지원사업정보 API`를 제공한다.

- Method: `GET`
- Endpoint: `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do`
- Response: JSON 또는 XML/RSS
- 서비스 인증키 필요
- API 사용신청 후 인증키 발급

지원사업 레이더에서는 **JSON을 기본값**으로 사용한다.

---

## 2. 요청 파라미터

| 기업마당 | 의미 | 필수 | 레이더 사용안 |
| --- | --- | --- | --- |
| `crtfcKey` | 서비스키 | Y | 서버 환경변수에서만 사용 |
| `dataType` | `rss` / `json` | N | `json` 고정 권장 |
| `searchCnt` | 조회건수 | N | 무제한 조회 회피 |
| `searchLclasId` | 분야 코드 | N | 필요 시 분야별 수집 |
| `hashtags` | 분야/지역 해시태그 | N | `경남` 등 보조 필터 |
| `pageUnit` | 페이지 데이터 수 | N | bounded pagination |
| `pageIndex` | 페이지 번호 | N | bounded pagination |

공식 문서에 따르면 `searchCnt`가 0이거나 없으면 전체 데이터를 제공할 수 있다.

### 결정

정기 수집에서 `전체 한번에 받기`를 기본값으로 하지 않는다.

`pageUnit + pageIndex` 기반의 제한된 pagination을 사용하고, 실제 rate/응답크기를 기술검증한 뒤 batch 크기를 고정한다.

---

## 3. 분야 코드

기업마당 지원사업 API의 대분류:

| code | 분야 |
| --- | --- |
| `01` | 금융 |
| `02` | 기술 |
| `03` | 인력 |
| `04` | 수출 |
| `05` | 내수 |
| `06` | 창업 |
| `07` | 경영 |
| `09` | 기타 |

태장 내부 분야 분류는 이 값만 사용하지 않는다.

예를 들어:

- 인건비·고용 → 기업마당 `인력` + 본문 AI/규칙 분류
- AI·디지털 → `기술/경영/기타` 등 복수 원천 가능
- 원예·농업 → 기업마당 대분류보다 해시태그/본문 분석 필요
- 문화 → 기업마당 외 Source가 더 중요할 수 있음

따라서 기업마당 분야코드는 **Source taxonomy**로 보존하고, 태장 내부 `categories`는 별도 정규화한다.

---

## 4. 지역 필터

공식 해시태그에 `경남`이 존재한다.

하지만 `창원`, `의창구`, `진전면` 같은 세부 지역을 API의 공식 지역 코드로 직접 조회할 수 있다는 근거는 현재 문서에서 확인되지 않았다.

### 결정

- 전국 공고 수집
- `경남` 해시태그 수집
- 공고 본문/지원대상에서 창원·시군·읍면 조건 추가 판정

을 조합한다.

`경남`만 조회해서 전국 지원사업을 놓치는 구조를 만들지 않는다.

---

## 5. 응답 → 레이더 Mapping

기업마당 API에는 일부 구형 RSS 필드와 신규형 필드가 함께 제공되는 것으로 보인다.

레이더는 아래 우선순위로 정규화한다.

| 기업마당 응답 | 레이더 대상 | 비고 |
| --- | --- | --- |
| `pblancId` / `seq` | `support_notice_occurrences.source_notice_id` | **중요 stable ID 후보** |
| `pblancNm` / `title` | `raw_title`, 정규화 `support_notices.title` | 원문 보존 |
| `pblancUrl` / `link` | `source_url` | 기업마당 게시 URL |
| `jrsdInsttNm` / `author` | `managing_organization` | 소관기관 |
| `excInsttNm` | `implementing_organization` | 수행기관 |
| `bsnsSumryCn` / `description` | 사업개요/원문 요약 | HTML 정리 필요 가능 |
| `reqstMthPapersCn` | `application_process_summary` | 신청방법·서류 |
| `refrncNm` | `contact_summary` | 문의처 |
| `rceptEngnHmpgUrl` | `application_url` 후보 | DB 필드 추가 검토 |
| `pldirSportRealmLclasCodeNm` / `lcategory` | Source 분야 | 내부 category와 별도 |
| `creatPnttm` / `pubDate` | occurrence `source_published_at` | 날짜 파싱 |
| `reqstBeginEndDe` / `reqstDt` | `application_start_at`, `deadline_at` | 문자열 분리/파싱 |
| `trgetNm` | `eligibility_summary` 입력 | 상세 공고로 재검증 필요 |
| `flpthNm` + `fileNm` | `support_documents` | 첨부파일 |
| `printFlpthNm` + `printFileNm` | `support_documents` 또는 본문 PDF | 일반 첨부와 구분 필요 |
| `hashTags` | occurrence metadata / 분류 힌트 | 내부 taxonomy 아님 |
| `totCnt` | 수집 batch 메타데이터 | 공고 테이블에 저장 불필요 |

---

## 6. `application_url` 보완 제안

기존 Phase 1 문서의 `support_notices` 필드에는 `canonical_url` 중심으로 정리되어 있다.

기업마당은 `사업신청URL(rceptEngnHmpgUrl)`을 별도로 제공할 수 있으므로 다음 필드를 추가 검토한다.

- `application_url`

구분:

- `canonical_url`: 공고의 가장 권위 있는 원문/대표 URL
- `application_url`: 실제 신청 시스템 URL
- occurrence `source_url`: 해당 Source에서 발견한 게시 URL

세 URL을 섞지 않는다.

---

## 7. 중복 판정에 활용

기업마당 `pblancId`는 기업마당 내부 occurrence 식별자로 사용한다.

예:

```text
source = bizinfo
source_notice_id = PBLN_...
```

그러나 원기관 홈페이지의 같은 공고에는 기업마당 ID가 없으므로 `pblancId`만으로 전체 Source 중복을 해결할 수 없다.

다중 Source 중복은 계속 다음을 사용한다.

1. 원기관 공고번호/ID
2. canonical URL
3. 사업명 + 기관 + 신청기간
4. 첨부 content hash
5. 제목/본문 유사도

---

## 8. 첨부파일 처리

API가 첨부파일 경로와 이름을 제공하므로 Phase 2에서 초기 문서 수집이 가능하다.

Phase 1/2 원칙:

- 원본 파일명 보존
- source URL 보존
- 동일 파일 content hash 계산 가능 구조
- 파일종류 PDF/HWP/HWPX 등 기록
- 자동 OCR/본문분석은 별도 Phase

기업마당의 `printFlpthNm`은 일반 첨부와 성격이 다를 수 있으므로 `document_type`을 구분한다.

예:

- `attachment`
- `notice_print`

---

## 9. 서비스키 보안

`crtfcKey`는 요청 URL query parameter로 전달된다.

### 금지

- `/app/` 브라우저 JavaScript에 서비스키 삽입
- GitHub에 키 커밋
- 전체 요청 URL을 audit/error log에 그대로 저장
- 실패 로그에 `crtfcKey` 노출

### 권장

```text
/app 지원사업 화면
        ↓
Netlify Function 또는 승인된 서버 수집기
        ↓
기업마당 API
```

서비스키는 서버 환경변수에서 읽는다.

로그에는:

- source
- batch ID
- pageIndex
- 응답 status
- item count
- error code/안전한 요약

정도만 남기고 키는 redaction한다.

---

## 10. 초기 수집 전략

### 처음

1. 최근 공고 제한 batch
2. 전체 분야
3. 전국 + 경남 relevance 후처리
4. `pblancId` 기준 idempotent upsert occurrence
5. notice candidate 생성
6. 중복 후보 확인

### 이후

마지막 성공 수집 이후 변경분만 가져오는 안정적인 방법이 API에 있는지 추가 확인한다.

현재 공식 요청 파라미터 문서에는 `updated_since`와 같은 증분 cursor가 명시적으로 보이지 않는다.

따라서 초기 설계에서는 최근 window 재수집 + `pblancId/content hash` 비교를 고려한다.

---

## 11. 현재 미확인 사항

다음은 실제 API key 사용 전 확정하지 않는다.

- 호출 rate limit
- 최대 `pageUnit`
- 응답 정렬순서 보장
- 삭제/취소 공고 표시 방식
- 공고 수정 시 `pblancId` 유지 여부
- 한 공고 복수 첨부 표현 방식
- JSON 실제 escaping/HTML 형태
- HTTP 캐시/TTL 의미
- API SLA

---

## 12. 다음 기술검증

사용자 승인 후 별도 비운영 환경에서:

1. 기업마당 API 사용신청
2. 서버 환경변수에 test key 등록
3. 최소 1 page JSON 호출
4. 실제 schema capture
5. `pblancId` idempotency 확인
6. 경남 필터와 전국 결과 비교
7. 첨부 URL 확인
8. 중복 sample 5~10건 검증

이 검증 전 Production 자동수집은 시작하지 않는다.
