# 일러스트 슬롯 placeholder 구현 계획 v1

기준 문서:
- `PUBLIC_ILLUSTRATION_STYLE_GUIDE_V1.md`
- `PUBLIC_ILLUSTRATION_SLOT_MAP_V1.md`

## 목적
실제 일러스트 제작 전에 Draft/Deploy Preview에서 C/D/E/F 위치를 사용자가 직관적으로 확인할 수 있도록 짧은 박스형 placeholder를 표시한다.

## 선행 조건
- PR #59의 A/B 적용 및 이미지 최적화 작업을 먼저 독립적으로 마무리한다.
- PR #59에 이 작업을 섞지 않는다.

## 표시 대상
- C: `about.html` — `태장 한눈에 보기` 다음
- D: `index.html` — `ABOUT TAEJANG / 사람의 강점이 일이 되도록` 영역
- E: `business.html` — 실제 운영 3개 카드와 `PARTNERSHIP FLOW` 사이
- F: `partnership.html` — `지역사회공헌·ESG 협력` 상세 영역

## 표시 형식
각 슬롯은 실제 그림이 아닌 기획용 placeholder임을 명확히 한다.

구성 예:
- 작은 배지: `C`
- 작은 영문: `ILLUSTRATION SLOT`
- 한 줄 주제
- 작은 상태: `후속 일러스트 예정` 또는 `제작 후보`

## 디자인
- 아이보리/크림 배경
- 옅은 세이지/올리브 테두리
- 둥근 모서리
- 낮은 높이와 충분한 여백
- 긴 설명 금지
- GitHub/문서/와이어프레임 UI처럼 보이지 않게 함
- PC/mobile 모두 가로 스크롤 없음

## 슬롯별 문구

### C
`참여기업 4개사 → 태장 → 맞춤 직무 → 실제 사업과 일자리`
상태: `후속 일러스트 예정`

### D
`농업 기반 → 사람의 강점 → 맞춤 직무 → 지속 가능한 사업`
상태: `제작 후보`

### E
`기업의 필요한 업무 → 작업 구조화 → 맞춤 역할 → 운영·검수·결과`
상태: `제작 후보`

### F
`지역의 필요 → 기업·기관과 태장 협의 → 함께 실행 → 다음 협력으로 확장`
상태: `제작 후보`

## 금지
- 실제 일러스트 생성 금지
- A/B 변경 금지
- 기존 partnership 공식 일러스트 4장 변경 금지
- workplace/greeting/archive/location에 새 수채화 placeholder 추가 금지
- Production 배포 금지

## 검수 목표
Deploy Preview에서 사용자가 각 슬롯을 보고:
- 이 위치에 그림이 필요한가
- 어떤 구도가 적합한가
- 페이지가 과밀해지는가
- C/D/E/F 중 삭제할 슬롯이 있는가
를 판단할 수 있어야 한다.
