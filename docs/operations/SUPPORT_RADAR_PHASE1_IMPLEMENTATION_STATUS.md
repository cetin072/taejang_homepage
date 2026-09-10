# 태장 지원사업 레이더 — Phase 1 구현 상태

기준 Issue: #161, #167, #169  
구현 PR: #168  
기준일: 2026-09-11  
상태: **Phase 1 MVP 기능·자동검수 완료 / 브라우저 Preview 사람 UX 검수 대기 / Production 미적용**

## 1. 구현 완료

### 기업 프로필
- 기업 기본정보
- 사업장·농장 위치
- 법인/기업 유형
- 업종·사업분야
- 보유/미보유/예정/만료/미확인 자격
- 장애인표준사업장·장애인고용기업 상태
- 협력기관
- 현재·과거 수혜사업
- 버전형 snapshot 저장
- 운영총괄 수정 / 대표이사 조회
- 과거 평가가 당시 profile version을 계속 참조
- 프로필 변경 후 기존 평가 재평가 필요 표시

### 공고·정보원
- Source Registry
- 수동 공고 등록
- 정규화 공고와 source occurrence 분리
- 첨부문서 메타데이터 구조
- 교차 Source 중복 후보 검색
- 자동 병합 금지
- 운영총괄 확인 후 기존 공고에 새 Source 연결 또는 별도 공고 등록
- 기본 공식 Source 카탈로그: 기업마당, e나라도움, KEAD, 경남기업119

### 적합도 판단
- Rule Engine v1
- Hard Gate
- A 직접 / B 공동 / C 협력 경로 분리
- 100점 적합도
- 자격/전략연관/경제가치/실행가능성/선정가능성/시급성 세부 점수
- 부족 자격과 확인질문 기록
- 평가 버전 이력
- 기업 프로필 변경 후 최신 profile 기준 재평가 가능

### 사람 의사결정·업무흐름
- 운영총괄 신청/보류/제외
- 담당자 배정/해제
- 담당자용 `내 지원사업`
- 기관 문의 → 자료 수집 → 신청서 작성 → 제출 → 선정/미선정/취소 진행상태
- 사람의 검토 완료 이력 별도 저장
- 평가 / 검토 / 최종결정의 시각과 주체 분리
- 주요 mutation audit

### 대시보드·보고
- 지원사업 대시보드
- 전체 공고 / 상세 / 검색
- 기업 프로필 빠른 진입
- 주간 보고
- 긴급 확인 후보
- 85점 이상 / 500만원 이상 / 차량·시설·장비 현물 / 우선분야 / 7일 내 마감 / 희소 전국공모 trigger
- trigger-only가 아니라 현재 태장 관련성으로 2차 필터
- 누적 KPI: 적격후보, 신청, 선정, 지원금, 현물가치, 놓친 중요공고, 중요 미검토, 발견→첫 검토시간

## 2. 자동검수 완료

PR #168의 2026-09-11 검증 기준:
- 최신 `main` 공통 플랫폼 변경을 force 없이 반영
- Public Homepage Checks #564: SUCCESS
- Phase 1A Supabase Integration #775: SUCCESS
- Netlify Deploy Preview: ready

통과 항목:
- active static platform checks
- staging safety checks
- isolated local Supabase start
- 전체 migration clean reset/reapply
- DB lint
- pgTAP DB/RLS/security tests
- 기존 실제 Auth/Data API 통합 회귀
- Support Radar 전용 실제 Auth/RLS/Data API 통합 회귀

### Support Radar 실제 Auth/RLS 통합검사

파일: `tests/support-radar-auth-integration.mjs`

local Supabase에서 실제 signup/access token과 Data API/RPC/RLS를 사용해 다음을 검증한다.
- 운영총괄이 기업 프로필을 생성·수정할 수 있음
- 기업 프로필 수정은 overwrite가 아니라 새 version을 생성함
- 두 번째 저장에서 version이 +1 증가함
- 프로필 변경 후 과거 평가가 stale/re-evaluation 대상으로 표시됨
- 최신 profile version으로 재평가 가능
- 운영총괄이 Source와 수동 공고를 생성할 수 있음
- deterministic Rule Engine v1을 실행할 수 있음
- 운영총괄만 최종 apply/hold/exclude 판단을 수행함
- apply 결정 시 application workflow가 생성됨
- 운영총괄이 담당자를 배정할 수 있음
- 배정 전 일반 직원은 공고를 볼 수 없음
- 배정 후 담당자는 자기 공고만 볼 수 있음
- 다른 미배정 직원은 RPC와 direct table RLS 모두에서 해당 공고를 볼 수 없음
- 배정 담당자는 application 진행상태를 변경할 수 있음
- 미배정 직원은 진행상태를 변경할 수 없음
- 대표이사는 기업 프로필/대시보드/공고를 조회할 수 있음
- 대표이사는 기업 프로필·최종결정·진행상태 mutation을 할 수 없음
- 기업 프로필/Source/공고/평가/결정/배정/진행상태 변경이 Audit ledger에 기록됨

따라서 기능·DB·권한 경계에서 현재 확인된 Phase 1 blocker는 없다.

## 3. Phase 1에서 의도적으로 하지 않음

- 기업마당 live API 자동수집
- e나라도움 live 자동수집
- 대규모 웹 크롤링
- PDF OCR / HWP 자동분석
- 외부 AI API 자동평가
- 이메일 자동발송
- 카카오 자동발송
- 신청서 자동작성/제출
- Production Supabase migration 적용
- Production 배포

위 항목은 Source 계약·비용·보안·사용자 승인 게이트에 따라 Phase 2/3에서 진행한다.

## 4. 이제 남은 사람 Preview 검수

자동화로 검증 가능한 핵심 저장·권한·RLS·Audit은 완료했다. 남은 검수는 브라우저 실제 사용성과 모바일 UX다.

1. 운영총괄 계정으로 `/app/` 진입 후 지원사업 레이더 메뉴가 정상 노출되는지
2. 기업 프로필에 1~2클릭으로 진입되는지
3. 기업 프로필 수정 폼, 저장 전 변경요약, 저장 성공 안내, 새 버전 표시가 자연스러운지
4. 수동 공고 등록 → 상세 → Rule 평가 → 신청/보류/제외 → 담당자 배정 화면 흐름이 끊기지 않는지
5. 담당자 계정에서 `내 지원사업` 메뉴와 배정된 공고만 정상 노출되는지
6. 담당자가 진행상태와 다음 행동을 모바일에서도 편하게 저장할 수 있는지
7. 대표이사 계정에서 read-only UX가 명확한지
8. 주간보고·긴급확인·KPI 화면이 실제 데이터와 함께 읽기 쉬운지
9. Android 모바일에서 스크롤·입력·버튼·카드 배치가 업무 사용에 지장이 없는지

사람 검수에서는 다음만 MVP blocker로 수정한다.
- 화면 진입 불가
- 저장 불가
- 권한 오류
- 핵심 흐름 단절
- 잘못된 데이터 저장/표시
- 모바일에서 실제 사용이 곤란한 수준의 문제

미세 디자인, 추가 통계, 자동화 확장, AI 고도화는 Phase 1 MVP 확정을 막지 않는다.

## 5. 승인 게이트

사용자 명시 승인 전 다음은 금지한다.
- Draft 해제 / Ready for review
- `main` merge
- Production Netlify 배포
- Production Supabase 적용
- 외부 API key 발급 또는 비용 발생
- 유료 AI/API 도입
- 파괴적 DB 변경

사람 Preview 검수 완료 후 blocker가 없거나 수정·재검증이 끝난 시점에만 MVP v0.1 확정 및 다음 승인 게이트를 검토한다.
