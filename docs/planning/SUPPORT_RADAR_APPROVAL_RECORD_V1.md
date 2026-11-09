# 태장 지원사업 레이더 — Phase 1 승인 기록 v1

Status: **확정**  
승인일: 2026-09-09  
Parent Issue: #161  
Planning PR: #162

## 1. 승인 내용

사용자는 2026-09-09 현재 Phase 1 설계 패키지를 기준으로 실제 구현 단계로 진행하는 것을 승인했다.

다음 문서를 Phase 1 구현의 확정 기획 기준으로 사용한다.

- `SUPPORT_RADAR_PHASE1_V1.md`
- `SUPPORT_RADAR_SOURCE_RESEARCH_V1.md`
- `SUPPORT_RADAR_BIZINFO_API_MAPPING_V1.md`
- `SUPPORT_RADAR_DATA_RLS_V1.md`
- `SUPPORT_RADAR_SCORING_GOLDEN_SET_V1.md`
- `SUPPORT_RADAR_UX_V1.md`

기존 문서 헤더에 `검토 중`, `확정 기획 초안` 등 과거 상태 표현이 남아 있더라도, **이 승인 기록 이후 Phase 1 v1 범위에서는 본 승인 기록이 최신 상태 판단 기준**이다.

## 2. 승인된 핵심 방향

- 별도 앱/저장소/로그인 체계를 만들지 않고 기존 태장 업무플랫폼 내부 모듈로 구현한다.
- `/staff/`, `/app/`, Supabase Auth/Profile/Employee/Role/RLS/RPC/Audit, Netlify 구조를 재사용한다.
- 공고 Source occurrence와 정규화 공고를 분리한다.
- 태장 Company Profile을 버전 관리한다.
- `Hard Gate → A 직접/B 공동/C 협력 → 100점 적합도 → AI 보완 → 사람 최종결정` 순서를 사용한다.
- AI 추천과 운영총괄의 신청/보류/제외 결정은 분리하고 이력을 보존한다.
- 운영총괄은 전사 실무 운영 기준으로 지원사업 전체 결정·배정·Profile/Source 관리를 수행한다.
- 담당자는 배정받은 지원사업의 문의·자료수집·신청진행·결과등록을 수행한다.
- Phase 1은 수동/반자동 입력과 Golden Set 검증을 우선하며 대규모 크롤링·자동 신청·승인 없는 유료 API는 제외한다.

## 3. 구현 시작 허용 범위

이 승인으로 Phase 1 구현 Issue #167의 개발 시작을 허용한다.

우선순위:
1. 데이터/RLS/Audit 기반
2. 수동 공고 등록과 태장 Profile
3. Rule Engine v1 및 A/B/C 판정
4. 운영총괄/담당자 MVP 화면
5. Golden Set 검증
6. 공식 Source 자동수집은 별도 Source 계약이 확인된 것부터 후속 연결

`#163`의 미확인 Source 조사는 자동수집 연결의 선행조건이지만, **수동/반자동 Phase 1 MVP 자체를 막지는 않는다.**

## 4. 계속 유지되는 승인 게이트

이번 승인은 Phase 1 개발 시작 승인이다. 다음은 별도 승인 없이 진행하지 않는다.

- `main` 병합
- Ready for review 전환
- Netlify Production 배포
- Supabase Production 변경
- 외부 API key 발급/등록 또는 비용 발생
- 기존 Auth/Profile/Employee/RLS 공통 의미 변경
- 파괴적 DB 변경

## 5. 개발 기준

- 최신 `origin/main`을 기준으로 구현 브랜치를 시작한다.
- 기능 브랜치 + Draft PR을 사용한다.
- forward-only migration을 사용한다.
- 지원사업 신규 모듈 중심으로 격리한다.
- 실제 민감정보를 fixture, 로그, GitHub 문서에 넣지 않는다.
- 구현 완료 전 확정 기획 항목을 `구현 완료 / 부분 구현 / 후속 / 의도적 제외`로 대조한다.
