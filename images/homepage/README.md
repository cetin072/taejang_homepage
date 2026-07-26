# 홈페이지 공개용 이미지 폴더

이 폴더에는 **공개 승인이 끝난 홈페이지용 변환본만** 저장합니다.

원본 사진, 공개동의서, 동의 관리대장, 사용 금지 사진은 이 저장소에 넣지 않습니다. 원본과 동의 자료는 접근 권한이 제한된 공유 드라이브에서 별도로 관리합니다.

## 고정 파일명

| 슬롯 | 파일명 | 주요 위치 |
| --- | --- | --- |
| PHOTO 01 | `photo-01.webp` | 메인 대표사진 |
| PHOTO 02 | `photo-02.webp` | 메인 민화 작업 |
| PHOTO 03 | `photo-03.webp` | 메인 환경·사회공헌 활동 |
| PHOTO 04 | `photo-04.webp` | 메인 일터 큰 사진 |
| PHOTO 05 | `photo-05.webp` | 메인 일터 보조 사진 1 |
| PHOTO 06 | `photo-06.webp` | 메인 일터 보조 사진 2 |
| PHOTO 07 | `photo-07.webp` | 회사소개 대표사진 |
| PHOTO 08 | `photo-08.webp` | 대표이사 사진 |
| PHOTO 09 | `photo-09.webp` | 최근 활동 첫 번째 카드 |
| PHOTO 10 | `photo-10.webp` | 최근 활동 두 번째 카드 |
| PHOTO 11 | `photo-11.webp` | 최근 활동 세 번째 카드 |

## 사진 교체 순서

1. 공개 승인된 최종 사진을 WebP로 변환합니다.
2. 위 표의 고정 파일명으로 이 폴더에 넣습니다.
3. `assets/js/photo-slots.js`에서 해당 번호의 `enabled`를 `true`로 바꿉니다.
4. `objectPosition`과 `mobileObjectPosition`을 조정해 PC와 모바일 크롭을 확인합니다.
5. 검수 중에는 `PHOTO_REVIEW_MODE = true`를 유지합니다.
6. 공식 공개 직전에 모든 사진과 대체 텍스트를 확인한 뒤 `PHOTO_REVIEW_MODE = false`로 바꿉니다.

고정 파일명을 사용하므로 다음 교체부터는 같은 이름의 WebP 파일만 바꾸면 됩니다. 파일명에는 직원 이름, 장애정보, 건강정보를 넣지 않습니다.