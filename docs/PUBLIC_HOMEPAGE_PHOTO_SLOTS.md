# 공개 홈페이지 사진·시각 슬롯 운영 기준

촬영·수집·파일명·모바일 크롭 기준은 [`PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md`](PUBLIC_HOMEPAGE_PHOTO_SHOOTING_CHECKLIST.md)를 사용합니다.

사진 공개동의서, 직원 안내문, 촬영 담당자 체크리스트와 철회 처리는 [`PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md`](PUBLIC_PHOTO_CONSENT_AND_SHOOT_DAY_GUIDE.md)를 사용합니다.

실제 공개용 파일을 넣는 폴더의 규칙은 [`../images/homepage/README.md`](../images/homepage/README.md)를 확인합니다.

## 핵심 원칙

PHOTO 번호는 **편집·검수용 식별자**입니다. 현재 공개 HTML의 시각 구조가 번호보다 우선합니다.

과거에는 PHOTO 01~08을 모두 `images/homepage/photo-NN.webp`와 1:1로 연결하는 방식으로 운영했지만, 현재 홈페이지는 Hero 영상과 페이지별 승인 이미지가 추가되어 일부 슬롯은 다른 공개 자산을 의도적으로 사용합니다.

따라서 다음을 구분합니다.

- `현재 화면에서 실제 사용 중인 시각 자산`
- `photo-slots.js`의 기본/fallback 설정
- `과거 호환을 위해 보존하는 photo-NN.webp 자산`

기존 정적 `<img>`가 있는 경우 `assets/js/photo-slots.js`는 이미지를 교체하지 않습니다. 즉, 정적 HTML에 승인된 페이지별 이미지가 명시되어 있으면 그 이미지가 현재 공개 Source of Truth입니다.

## 현재 공개 구조

| 식별자 | 현재 공개 위치 | 현재 실제 자산 | 운영 상태 |
| --- | --- | --- | --- |
| PHOTO 01 | 과거 메인 Hero 사진 | `images/homepage/photo-01.webp` 보존 | **현재 메인에는 미사용.** Hero는 공식 YouTube 영상 2개 슬라이더를 사용합니다. 승인 없이 사진 Hero로 되돌리지 않습니다. |
| PHOTO 02 | 메인 민화·문화 굿즈 | `images/homepage/photo-02.webp` | 현재 사용 |
| PHOTO 03 | 메인 지역사회공헌·ESG 카드 | `assets/images/business/environment-cleanup-group.webp` | 현재 사용. `photo-03.webp`는 과거 호환 자산으로 보존합니다. |
| PHOTO 04 | 메인 일터 큰 사진 | `images/homepage/photo-04.webp` | 현재 사용. 재촬영 교체 후보 |
| PHOTO 05 | 메인 일터 보조 사진 | `images/homepage/photo-05.webp` | 현재 사용. 재촬영 교체 후보 |
| PHOTO 06 | 메인 일터 보조 사진 | `images/homepage/photo-06.webp` | 현재 사용. 재촬영 교체 후보 |
| PHOTO 07 | `about.html` 회사소개 대표사진 | `images/homepage/photo-07.webp` | 현재 사용 |
| PHOTO 08 | `about.html` 대표 인사말 미리보기 | `images/homepage/photo-08-about-preview.webp` | 현재 사용 |
| 대표이사 원본 공개사진 | `greeting.html` | `images/homepage/photo-08.webp` | 현재 사용 |
| 최신 소식 | 메인·아카이브 카드 | 각 콘텐츠의 `thumbnail` | 콘텐츠 데이터가 Source of Truth |

### PHOTO 08 파생본 규칙

`photo-08.webp`는 대표 인사말 상세 페이지의 공식 인물사진입니다.

`photo-08-about-preview.webp`는 같은 대표 인사말을 회사소개 페이지의 카드/미리보기 비율에 맞게 사용하는 승인된 공개 파생본입니다. 이 둘을 오류로 보고 자동 통일하지 않습니다.

### PHOTO 03 규칙

메인의 PHOTO 03 편집 식별자는 유지하지만 현재 공개 이미지는 환경정비 활동의 최신 승인 단체사진인 `assets/images/business/environment-cleanup-group.webp`입니다.

`images/homepage/photo-03.webp`는 현재 메인 공개 카드의 Source of Truth가 아니며, 승인 없이 다시 활성화하지 않습니다.

### PHOTO 01 규칙

현재 메인 Hero는 사진이 아니라 공식 영상 슬라이더입니다. `photo-01.webp`는 삭제하지 않지만 현재 화면의 고정 슬롯으로 취급하지 않습니다.

Hero를 사진으로 되돌리거나 사진+영상을 병행하는 변경은 별도 기획·Preview 승인 대상으로 봅니다.

## PHOTO 04~06 재촬영 방향

현재 세 장이 모두 포장 작업에 가까워 역할 구분이 약합니다. 새 사진을 확보할 때는 아래 세 장면을 분명히 나눕니다.

1. **PHOTO 04 — 전체 작업 현장**
   - 직원 2명 안팎이 함께 작업하는 장면
   - 작업대와 실제 일터 분위기가 함께 보이는 가로 사진

2. **PHOTO 05 — 한 사람의 집중 작업**
   - 검수·분류·조립·포장 등 한 단계에 집중하는 모습
   - 손과 작업물, 도구가 자연스럽게 보이는 사진

3. **PHOTO 06 — 함께 확인하는 장면**
   - 직원과 담당자 또는 직원 2명이 작업물·작업순서·체크리스트 등을 함께 확인하는 모습
   - 단순 포장 손사진과 겹치지 않게 촬영

새 사진은 공개 승인 확인 전 저장소에 넣지 않습니다. 교체 후에는 `index.html`, `business.html`, `workplace.html` 등 실제 재사용 위치별 crop과 alt를 함께 검증합니다.

## PHOTO 09~11

`images/homepage/photo-09.webp`, `photo-10.webp`, `photo-11.webp`는 과거 번호 체계에서 만들어진 호환 자산입니다.

- 현재 공개 고정 슬롯이 아닙니다.
- 최신 소식 카드에도 사용하지 않습니다.
- 사용자 승인 없이 삭제하거나 다시 슬롯으로 활성화하지 않습니다.

## 사진 적용·교체 절차

1. 실제 현재 공개 위치와 연결된 자산을 먼저 확인합니다.
2. 공개 승인된 최종 사진만 사용합니다.
3. 기존 경로를 교체하는 경우 WebP 최적화와 이미지 budget을 확인합니다.
4. PC와 모바일의 `object-position`을 각각 확인합니다.
5. 실제 장면과 alt가 일치하는지 확인합니다.
6. 하나의 사진이 여러 페이지에 재사용되면 모든 페이지의 문맥을 함께 확인합니다.
7. `assets/js/photo-slots.js`의 기본 설정과 정적 HTML이 다를 경우, 의도된 페이지별 승인 이미지인지 먼저 확인합니다.
8. 공개 화면의 현재 구조를 단순 번호 규칙 때문에 되돌리지 않습니다.

## 검수 모드

`PHOTO_REVIEW_MODE`는 번호 배지 표시를 위한 검수 도구입니다. 현재 Production에서는 `false`를 유지합니다.

새 사진 교체 Preview에서는 필요할 때만 일시적으로 번호 식별을 사용하며, 공식 공개 전에는 다시 공개 모드와 대체 텍스트를 확인합니다.
