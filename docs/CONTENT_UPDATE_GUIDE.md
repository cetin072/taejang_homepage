# 콘텐츠 업데이트 가이드

`workplace.html`과 `activities.html`의 목록·상세 콘텐츠는 `assets/js/content.js`의 데이터와 `assets/js/listing.js`의 공통 렌더링으로 관리합니다. HTML에 같은 글을 따로 복사하지 않습니다.

## content.js 구조

각 글은 다음 필드를 사용합니다.

- `id`: 상세 URL의 `?id=` 값
- `category`: 목록 필터에 자동 표시되는 공개 카테고리
- `date`: `YYYY.MM.DD` 형식의 작성일
- `title`, `summary`: 목록과 상세에 표시되는 제목·요약
- `sections`: 도입문과 중간 제목·본문을 담는 배열
- `thumb`, `hero`, `gallery`: 실제 승인 사진 경로
- `listingPhoto`, `photo`: 사진이 없을 때 안내박스에 표시할 제목·파일명·방향·주의사항

## workplace와 activities 구분

- `workplace`: 직무, 작업환경, 일터 운영 이야기
- `activities`: 공지, 일터 소식, 기업·지역 협력, 행사 기록

현재 공개 카테고리는 데이터에 있는 값만 필터에 자동 표시됩니다. 빈 카테고리를 미리 만들지 않습니다.

## ID와 날짜 규칙

- 기존 글의 `id`는 링크 호환을 위해 바꾸지 않습니다.
- 새 ID는 영문 소문자와 하이픈으로 작성합니다. 예: `workplace-layout-check`, `community-cleanup-day`
- 날짜는 반드시 `YYYY.MM.DD` 형식으로 입력합니다.
- 목록은 `listing.js`에서 날짜 최신순으로 자동 정렬합니다. 같은 날짜는 `content.js`의 데이터 등록 순서를 유지합니다.

## 사진이 없을 때 데이터 작성법

사진이 아직 없으면 존재하지 않는 `img src`를 넣지 않습니다.

```js
thumb: null,
hero: null,
gallery: [],
photoRequired: true,
listingPhoto: {
  title: "민화 작업 과정",
  filename: "minhwa-1.jpg",
  orientation: "가로형 또는 정방형"
},
photo: {
  title: "민화 작업 과정",
  filename: "minhwa-2.jpg",
  orientation: "가로형 또는 정방형",
  note: "손과 작업물 중심으로 촬영"
}
```

안내용 `filename`은 경로가 아니라 촬영 담당자용 파일명입니다. 자세한 기준은 [사진 운영 가이드](PHOTO_GUIDE.md)를 따릅니다.

## 실제 사진이 있을 때 데이터 작성법

공개 승인된 사진을 `images/`에 추가한 뒤 실제 경로만 연결합니다. 현재 사이트의 기존 이미지 경로 체계를 유지합니다.

```js
thumb: "images/minhwa-1.jpg",
hero: "images/minhwa-2.jpg",
gallery: [],
alt: {
  thumb: "도안과 붓을 사용해 민화 작업을 하는 모습",
  hero: "여러 사람이 함께 민화 작업을 하는 모습"
}
```

실제 사진을 연결한 영역의 안내박스 데이터와 주석은 함께 제거하거나 더 이상 렌더링되지 않도록 정리합니다. `alt`에는 파일명, 이름, 확인되지 않은 성과를 넣지 않고 실제 보이는 작업만 씁니다.

## 관련 글과 잘못된 ID

상세 화면은 같은 콘텐츠 유형에서 현재 글을 제외한 관련 글을 최대 2개 자동 표시합니다. 관련 글은 날짜 최신순으로 표시되며 사진 안내박스를 반복하지 않습니다. 존재하지 않는 `?id=`는 빈 화면 대신 목록으로 돌아가는 안내를 표시합니다.

## 테스트와 게시 절차

콘텐츠 수정 후에는 다음 순서로 확인합니다.

1. `node scripts/validate-content.js`
2. `node scripts/validate-content.test.js`
3. `git diff --check`
4. `node --check assets/js/content.js`와 `node --check assets/js/listing.js`
5. 정적 페이지 실행과 목록·필터·기존 상세 ID·잘못된 ID·관련 글 확인
6. Draft PR의 Deploy Preview 확인

### 자동 검증이 확인하는 항목

- ID·날짜·카테고리·필수 필드
- 기존 공개 ID 유지
- 사진 안내 파일명과 실제 이미지 경로
- 과거 긴 사진 파일명 재사용
- 메인 미리보기의 상세 링크 ID

### 사람이 확인해야 하는 항목

- 실제 사진 내용과 얼굴 공개 동의
- 기업 로고·상호 공개 승인
- 문장의 사실관계와 공개 적합성
- 모바일에서의 실제 시각 품질
- 외부 링크 목적지의 최신 상태

자동 검증을 통과해도 [홈페이지 공개 전 최종 검수 체크리스트](PUBLISH_CHECKLIST.md)를 완료하고 [공개 운영 절차](PUBLISH_WORKFLOW.md)에 따라 승인받아야 합니다.
