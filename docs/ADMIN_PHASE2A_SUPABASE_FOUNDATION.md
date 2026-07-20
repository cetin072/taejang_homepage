# 관리자 시스템 Phase 2A · Supabase 운영 기반

> 상태: 설계·마이그레이션 후보. 아직 Supabase 프로젝트에 실행하지 않습니다.

## 목표

PR #15의 관리자 프로토타입과 PR #16의 공개 콘텐츠 허브를 하나의 운영 데이터 모델로 연결하기 위한 기반을 확정합니다.

이번 단계에서는 실제 로그인, 데이터 저장, 이미지 업로드, 운영 배포를 연결하지 않습니다. 비밀키와 실제 직원 정보도 저장소에 넣지 않습니다.

## 운영 역할

- `staff`: 글 작성, 임시저장, 게시 요청
- `admin`: 검토, 수정 요청, 승인, 게시·숨김
- `super_admin`: 관리자 권한 전체와 계정·역할 관리

계정 상태는 `active`, `suspended`, `departed`로 관리합니다. 모든 쓰기 작업은 현재 상태가 `active`인지 데이터베이스에서 다시 확인합니다.

## 콘텐츠 구분

하나의 `contents` 테이블에서 다음 두 종류를 관리합니다.

1. `native`: 홈페이지 안에서 전문을 읽는 자체 게시물
2. `external`: 네이버 블로그·인스타그램·유튜브·X·언론보도 원문으로 연결되는 카드

공통 공개 필드:

- 제목, 요약, 카테고리
- 출처와 콘텐츠 종류
- 썸네일 경로
- 원문 게시일과 홈페이지 공개일
- 중요 콘텐츠 여부
- 공개 상태

자체 게시물 전용 필드:

- 상세 본문 JSON
- 기존 상세 URL과 연결할 slug
- 첨부자료 목록

외부 카드 전용 필드:

- 원문 URL
- 원문 버튼 문구
- 출처: `naver-blog`, `instagram`, `youtube`, `x`, `press`

## 상태 흐름

`draft → in_review → changes_requested 또는 approved → published`

- 직원은 본인이 담당한 `draft`, `changes_requested` 콘텐츠를 수정할 수 있습니다.
- 직원은 게시 요청까지만 할 수 있습니다.
- 관리자 이상만 승인·게시·숨김 처리할 수 있습니다.
- 게시된 revision을 고정해, 승인되지 않은 수정본이 공개되지 않도록 합니다.
- 삭제는 즉시 물리 삭제하지 않고 `archived` 또는 soft delete를 우선합니다.

## 관리자 화면 대응

| 관리자 입력 | 데이터 필드 |
| --- | --- |
| 자체 글 / 외부 카드 | `content_kind` |
| 출처 | `source` |
| 카테고리 | `category` |
| 제목 | revision `title` |
| 요약 | revision `summary` |
| 본문 | revision `body` |
| 원문 링크 | revision `external_url` |
| 원문 게시일 | revision `source_published_at` |
| 홈페이지 노출일 | revision `published_at` |
| 상단 고정 | revision `featured` |
| 공개 상태 | `workflow_state` |

## 공개 홈페이지 읽기

공개 홈페이지는 `public_content_feed` 뷰만 읽습니다.

- `published` 상태만 반환
- 승인된 `published_revision_id`만 반환
- 내부 메모, 작성자·승인자, 감사 정보는 반환하지 않음
- 기존 `assets/js/content.js` 형식으로 변환할 수 있는 필드명 제공
- Supabase 연결 전과 장애 시에는 기존 정적 데이터가 계속 표시되도록 fallback 유지

## 보안 원칙

- 브라우저에는 Supabase URL과 anon key만 사용합니다. anon key는 공개 클라이언트 식별값이지만 저장소에 실제 값은 넣지 않습니다.
- `service_role` 키는 브라우저, GitHub 저장소, 관리자 HTML에 절대 넣지 않습니다.
- 실제 관리자 권한 변경과 발행 자동화는 이후 서버 함수 또는 신뢰 가능한 실행 경로에서 처리합니다.
- RLS가 최종 통제이며 버튼 숨김은 보안 수단으로 간주하지 않습니다.
- 감사 로그에는 비밀번호, 토큰, 비밀키, 민감한 인사 사유, 본문 전문을 저장하지 않습니다.

## 이번 PR의 산출물

- `supabase/migrations/20260720_001_cms_foundation.sql`: 검토용 마이그레이션 후보
- `docs/operations/SUPABASE_SETUP.md`: 대표님이 나중에 수행할 프로젝트 생성·값 보관 절차
- `.env.example`: 필요한 변수 이름만 기록한 예시

## 다음 단계

1. 대표님이 Supabase 프로젝트 생성
2. SQL Editor에서 마이그레이션 후보를 검토 후 실행
3. 최초 `super_admin` 계정 생성
4. PR #18에서 실제 로그인 연결
5. PR #19에서 작성·검토·승인 연결
6. PR #20에서 공개 홈페이지 읽기 연결

## 이번 단계에서 하지 않는 것

- 실제 Supabase 프로젝트 생성·SQL 실행
- 직원 계정 생성
- Netlify 환경변수 변경
- service role 키 사용
- 공개 홈페이지 데이터 소스 교체
- 이미지 Storage 정책 실행
- main 병합 또는 운영 배포