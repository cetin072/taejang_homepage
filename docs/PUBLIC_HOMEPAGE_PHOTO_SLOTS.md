# 공개 홈페이지 사진 슬롯

촬영·수집·파일명·모바일 크롭 기준은 [`PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md`](PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md)를 사용합니다.

사진 공개동의서, 직원 안내문, 촬영 담당자 체크리스트와 철회 처리는 [`PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md`](PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md)를 사용합니다.

실제 공개용 파일을 넣는 폴더의 규칙은 [`../images/homepage/README.md`](../images/homepage/README.md)를 확인합니다.

## 운영 원칙

사진 후보는 처음부터 PHOTO 01~08과 최신 소식 카드 수에 맞춰 제한하지 않습니다. 촬영·수집 단계에서는 가능한 한 많이 확보하고, 실제 홈페이지에 여러 후보를 시험 배치한 뒤 결과를 보면서 줄입니다.

PHOTO 01~08은 편집용 식별자입니다. 사진이 들어간 뒤에도 미리보기 단계에서는 작은 번호 배지를 남겨 `PHOTO 04를 다른 사진으로 교체`처럼 정확히 지시할 수 있게 합니다. 메인 최신 소식 카드는 콘텐츠 데이터의 대표사진을 자동 표시하므로 PHOTO 09~11 번호를 사용하지 않습니다.

원본 사진은 공유 드라이브 등 외부 보관소에 모으고, 선정한 파일만 홈페이지용 크기·형식으로 변환해 GitHub 저장소에 복사합니다. Google Drive 파일 URL을 홈페이지 이미지 주소로 직접 사용하지 않습니다.

실제 사진을 적용할 때는 사진 사용 승인, 대체 텍스트, 모바일·PC 자르기 위치와 파일 용량을 함께 확인합니다.

## 연결표

| 번호 | 홈페이지 위치 | 공개 파일 경로 | 사진 용도·추천 | 권장 비율 |
| --- | --- | --- | --- | --- |
| PHOTO 01 | 메인 히어로 | `images/homepage/photo-01.webp` | 직원과 작업 현장이 함께 보이는 메인 대표사진 | 16:9 |
| PHOTO 02 | 메인 민화·문화 굿즈 | `images/homepage/photo-02.webp` | 민화 작업 또는 완성 작품, 손과 작업물이 함께 보이는 사진 | 4:3 |
| PHOTO 03 | 메인 환경·사회공헌 활동 | `images/homepage/photo-03.webp` | 임직원 환경정비 또는 공식 행사 | 4:3 |
| PHOTO 04 | 메인 태장의 일터 큰 사진 | `images/homepage/photo-04.webp` | 여러 직원이 함께 작업하는 전체 현장 | 3:2 |
| PHOTO 05 | 메인 태장의 일터 보조 사진 | `images/homepage/photo-05.webp` | 손, 도구, 재료 또는 작업 과정 | 4:3 |
| PHOTO 06 | 메인 태장의 일터 보조 사진 | `images/homepage/photo-06.webp` | 작업 안내, 교육 또는 함께 확인하는 모습 | 4:3 |
| PHOTO 07 | `about.html` 히어로 | `images/homepage/photo-07.webp` | 사업장 또는 구성원이 함께 있는 넓은 사진 | 16:9 |
| PHOTO 08 | `about.html` 대표 인사말 | `images/homepage/photo-08.webp` | 대표이사 공식 상반신 또는 업무 공간 사진 | 4:5 |
| 최신 소식 1~3 | 메인 최근 활동 카드 | 각 콘텐츠의 `thumbnail` | `TAEJANG_CONTENT.hub` 최신 3개 글의 대표사진을 자동 표시 | 4:3 |

`archive.html`과 메인 최신 소식은 같은 콘텐츠 순서와 대표사진을 사용합니다. 대표사진이 없으면 고정 번호 대신 `CONTENT PHOTO` 빈 영역을 표시합니다. PHOTO 09~11은 별도 홈페이지 사진 업로드 대상이 아닙니다.

## 사진 적용 방법

1. 공개 승인된 최종 사진을 PHOTO 01~08의 고정 파일명으로 `images/homepage/`에 넣습니다.
2. `assets/js/photo-slots.js`에서 PHOTO 01~08의 해당 번호만 `enabled`를 `true`로 변경합니다.
3. 최신 소식 카드는 콘텐츠의 `thumbnail`과 `thumbnailAlt`를 관리하면 메인에도 자동 반영됩니다.
4. `objectPosition`으로 PC 크롭을, `mobileObjectPosition`으로 모바일 크롭을 조정합니다.
5. 검수 중에는 `PHOTO_REVIEW_MODE = true`를 유지합니다.
6. 실제 PHOTO 01~08 사진이 들어가면 안내문은 숨고, 작은 PHOTO 번호 배지만 남습니다.
7. 공식 공개 직전에 모든 사진과 대체 텍스트를 확인한 뒤 `PHOTO_REVIEW_MODE = false`로 변경합니다.
8. 공개 모드에서는 실제 사진 위의 PHOTO 번호와 제작 안내가 표시되지 않습니다.

사진 파일이 없거나 `enabled`가 `false`인 슬롯은 기존 안내 영역을 유지하므로, 사진을 단계적으로 적용해도 빈 이미지 오류가 노출되지 않습니다.
