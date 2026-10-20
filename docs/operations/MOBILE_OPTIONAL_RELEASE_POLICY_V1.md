# 모바일 선택 업데이트 안내 정책 V1 — 개발 완료 후보 / 운영 미적용 (#484, #492)

## 확정 범위와 데이터 흐름

2026-10-20 사용자 지시를 따른다. 기존 UpdateLifecycle·versionCode 비교·공식 Play 이동을 재사용하고 새 화면/설정 메뉴/외부 서비스/관리용 쓰기 RPC는 추가하지 않는다.

`Play 설치 가능 확인 → 관리자 정책 갱신 → 기존 staff-config의 공개 REST GET → 앱 버전 비교 → 선택 모달 → Play 또는 나중에`

기존 설정 중 직원 개인정보와 분리된 공개 앱 버전 저장소가 없어, PR #492에서 준비한 단일 행 `public.mobile_optional_release_policy`만 사용한다. 다른 업무 테이블이나 범용 설정 엔진을 공유하지 않는다. 필드는 버전·코드·문구·공식 Play URL·활성 상태·수정 시각뿐이다. 신규 직원/근태 자료·계정·권한 변경은 없다.

- migration `20261020012500`은 **enabled=false**로 시작한다. anon/authenticated는 RLS SELECT만 가능하고 INSERT/UPDATE/DELETE 등 권한은 없다. 관리자는 승인된 서버 관리 경로에서만 이 행을 갱신한다. 브라우저 직원 계정에 쓰기 권한을 주지 않는다.
- staff-config는 기존 공개 URL·키·응답 계약을 유지하고, 최대 1.8초 동안 정책을 GET한다. 누락/비활성/잘못된 응답/타임아웃이면 기존 환경 정책으로 돌아간다. `force_update=false`와 정식 HTTPS Play 주소는 V1의 모든 응답에 고정한다. **minimum·maintenance·release notes는 기존 설정을 보존**한다. 최소 버전 제한도 구버전을 막을 수 있으므로 첫 운영 전 기존 minimum 두 값이 null임을 확인한다. 기존 값이 달라졌다면 임의 삭제하지 않고 별도 판단을 받는다.
- 첫 운영의 legacy latest 환경변수는 기존 null 유지가 전제다. 그렇지 않으면 DB disabled/장애 때 legacy optional 안내로 돌아갈 수 있으므로 활성화 전에 중단·조정한다. 운영자가 확인하지 않은 환경변수를 미리 바꾸거나 향후 예약 배포에 숨은 변경을 남기지 않는다.
- 현재 운영 기본값처럼 force=false/minimum=null/maintenance=false일 때, 정책 장애는 직원 로그인·근태·공지 기능을 막지 않는다. Supabase URL·공개 키 자체가 없는 오류는 기존 로그인 설정 장애(503)이며 업데이트 정책 장애와 구분한다. staff-config 전체의 외부 통신 장애까지 기존 0.1.3의 초기 로그인 설정 조회를 오프라인 사용 가능하게 바꾸지는 않는다.

## 화면·세션과 구버전 호환성

목표 제목은 `새로운 업데이트가 있습니다`, 설명은 `태장 직원앱의 새로운 버전이 나왔습니다.\n\n지금 업데이트하시겠습니까?`이다. 현재 소스의 기존 모달은 `업데이트하기` / `나중에` 버튼, 기존 색상·스크롤·확대 가능한 글자와 56/48px 이상의 터치 영역을 유지한다. 나중에는 실행 중 대상 버전이 바뀌거나 복귀해도 다시 묻지 않고 완전 재실행 후 다시 판단한다. 동일·상위 설치 code에는 표시하지 않는다.

| 설치 버전 | latest 0.1.5/code6 | 동작 |
| --- | --- | --- |
| 0.1.3/code4 | code6 | 선택 안내 |
| 0.1.4/code5 | code6 | 선택 안내 |
| 0.1.5/code6 | code6 | 없음 |
| code7 이상 | code6 | 없음 |
| 정책 조회 실패 | 알 수 없음 | 기존 기능 유지, 강제 안내 없음 |

- 이미 설치된 0.1.3은 **완전 종료 후 시작 시** 정책을 읽는다. 복귀 조회를 서버만으로 추가할 수 없다. 원본 `2115ada603ca17a2ac1aa84d24c75bb9c4953088`의 config/release-policy/UpdateLifecycle을 변경 없이 테스트 fixture에 고정했고 SHA256과 실제 실행으로 응답·표시·닫기·HTTPS Play 이동·재시작을 검사한다. APK/Galaxy 실행 증거는 아니다.
- 기존 0.1.3 및 이미 배포된 0.1.4/0.1.5의 **하드코딩된 버튼 문구**는 서버에서 바꿀 수 없다. 기존 버튼 `업데이트`도 같은 Play 경로로 작동한다. 새 `업데이트하기` 문구와 세션 내 버전 변경에도 닫기 유지 보완은 향후 해당 코드가 포함된 정상 Play 앱에 적용된다. 이번에 기존 code6 바이너리를 교체·재업로드하지 않는다.
- 0.1.3에는 새 market→HTTPS 재시도 코드가 없으므로 정책은 항상 `https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff`를 제공한다. 최신 앱은 기존 market→같은 HTTPS fallback을 유지한다. APK·QA 앱 설치나 앱 삭제/재가입으로 대체하지 않는다.

## 자동 검증과 경계

- 기존 React Native 컴포넌트 실행 검사: 비교 표, 선택/나중에/재실행, 버튼·스크롤·접근성, Play fallback, 실패·타임아웃, QA 제외. 고정 0.1.3 소스는 cold start·이전 버튼·HTTPS 경로를 별도 검사한다.
- 격리 pgTAP: 단일 disabled seed, 공개 필드만 존재, SELECT RLS, anon/authenticated 실제 읽기 및 DML 거부, 잘못된 버전·URL·두 번째 행 거부.
- 격리 PostgREST: 익명 GET와 쓰기 거부, **정책 행만** disabled→enabled→disabled로 복원, 실제 REST 응답을 기존 함수에 연결. 직원/Auth/근태 fixture를 만들지 않는다. clean migration replay와 기존 전체 Auth/RLS 회귀도 CI에서 실행한다.
- 기존 UAR 뒤 Preview staff-config 실제 GET·no-store·공개 로그인 설정·강제 false·최소 null·공식 URL을 확인한다. shared Hosted에는 이번 migration을 적용하지 않으므로 Preview에서 활성 정책까지 검증했다고 주장하지 않는다. 활성 경로는 격리 검증 결과로 구분한다.
- 직원앱 랜딩 `다시 보기`/모션은 수정·별도 재검수하지 않는다. 기존 CI가 자동 실행해 실패하면 원래 실패 그대로 별도 blocker로 기록한다. 검사 삭제/성공 위장/병합은 하지 않는다.

## Production 최초 적용 — 별도 승인이 필요한 체크리스트

**이 PR은 운영 적용/정책 활성화/Play 출시를 승인하지 않는다. Draft 유지.**

1. PR 최종 HEAD·변경 파일·필수 CI/별도 실패를 확인한다. 2026-10-20 조회 시 Production은 deploy `6ad5ceebc8f40a52617b97b2` / source `8489a199...`, Hosted에는 정책 테이블·migration이 없다. 실행 직전 다시 읽고 확인한다.
2. 적용 대상은 공유 Supabase `jgsxpdflgkqroecfjzxq`의 위 migration **하나**, Netlify 사이트 `9caa5a1a-f86d-4a9f-aed4-f560e1c2101f`의 함수 변경이다. 전체 migration 밀어넣기/history repair 금지. 기존 데이터 백업·복원 가능성, 기존 객체 충돌 부재, 정확 SQL/checksum, ACL·RLS 및 disabled seed를 검토한 후 **Production migration 승인**을 받는다. 해당 표만 생성하며 직원·공지·근태·Auth를 수정하지 않는다.
3. 적용 후 disabled 한 행, 익명 SELECT, 비특권 쓰기 거부와 원본 업무 자료 보존을 확인한다. 별도 Hosted 쓰기 침투 검사는 승인 범위에서만 수행한다. 실패 시 활성화하지 않는다. 롤백의 기본은 **disabled 유지**이며 다른 업무 표·데이터나 migration history를 되돌리지 않는다. 새 테이블 삭제가 필요하면 의존성을 확인한 별도 승인 migration으로 처리한다.
4. 기존 Netlify 함수는 DB를 읽지 않는다. 최초 1회 정상적인 **48시간 예약·main Git-only** 운영 배포가 필요하다. 다음 기준 슬롯은 기존 정책상 2026-10-21 17:20 KST이나 실행 직전 마지막 실제 공개·최신 main·슬롯/사전 DB 검사를 재확인한다. `prevent_non_git_prod_deploys`, ignore/build gate, hook/슬롯/SHA 검사를 해제·위조하지 않는다. 환경변수 변경만으로 이미 배포된 함수를 바꿀 수 없다.
5. 그 배포가 공개할 main의 직원관리·공지·아카이브 등 다른 변경을 **각각 검수·수용**하고 포함 diff 전체에 운영 배포 승인을 받아야 한다. 미검수 변경이 섞이면 배포하지 않는다. 이 PR을 부분 업로드하거나 published SHA만 임시 빌드하는 우회 경로를 만들지 않는다. 코드 롤백도 이전 source를 보존한 승인 Git 변경과 정상 보호 배포로 처리한다.
6. 새 published SHA·함수 응답을 확인한다. legacy latest/minimum=null, force=false, maintenance=false가 기존 상태와 일치하고 정책 disabled 상태여야 한다. 실패하면 disabled로 두고 중단한다.
7. Play Console의 **Alpha/대상 국가·테스터 계정·기기**에서 0.1.5/code6을 실제 설치 가능함을 재확인한다. 2026-10-19 게시/사용자 Galaxy 업데이트 정상은 Issue #484의 기존 증거이며 모든 직원의 설치 가능 증거로 확대하지 않는다. 현재 연결 도구에는 Play Console의 실시간 출시/설치 가능 자동 검증 API가 없어 신규 서비스·자동화는 추가하지 않았다. 관리형 게시 대기·심사 중·부분 rollout 미대상 직원이 있으면 활성화하지 않는다.
8. 대상·이전 행·새 버전/code·Play 증거·롤백 값을 기록한 후 **정책 활성화 별도 승인**을 받는다. 승인된 관리자 SQL/관리 경로만 사용한다. 예시는 실행하지 않은 목표 값이며, 이전 값 조건으로 경쟁 변경을 막는다.

```sql
-- 실행 전 SELECT로 이전 행/수정 시각을 기록한다. 이미 다른 관리자가 바꿨으면 중단.
update public.mobile_optional_release_policy
set enabled=true, latest_version='0.1.5', latest_version_code=6,
    update_title='새로운 업데이트가 있습니다',
    update_message=E'태장 직원앱의 새로운 버전이 나왔습니다.\n\n지금 업데이트하시겠습니까?',
    store_url='https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff',
    updated_at=now()
where singleton_id=1 and enabled=false and latest_version_code=6
  and updated_at = '<사전 조회한 updated_at>'::timestamptz
returning *;
```

9. 변경 1행과 public REST/staff-config readback을 확인한다. 0행이면 재시도/덮어쓰기하지 않고 경쟁 상태를 조사한다. **별도 홈페이지 재배포 없이** 응답이 바뀌어야 한다. 문제 시 승인된 관리 경로에서 현재 code/수정 시각 조건을 붙여 `enabled=false`로 되돌리고 읽어 확인한다. minimum/legacy latest 전제가 달라졌다면 임의 변경하지 않고 중단한다.
10. 아직 구버전인 별도 테스터의 기존 **정식 Play 앱**에서 완전종료→시작→안내→나중에→정상 사용→완전재시작→Play 이동→무삭제 업데이트를 검수한다. 사용자 Galaxy는 이미 code6으로 업데이트했으므로 구버전 검수 대상이 아니다. 실제 출퇴근 시험 기록을 생성하지 않는다. 앱 코드·물리 기기·운영 활성화 결과를 각각 기록한다.

## 이후 0.1.6/0.1.7 반복 운영

개발·검사 → 새 versionCode의 정식 AAB를 기존 Play 트랙에 업로드 → 심사/관리형 게시 완료 → 대상 직원 실제 설치 가능 확인 → 현재 정책 행을 백업·이전 updated_at/code 확인 → 별도 승인된 관리 경로로 새 version/code/문구를 한 행 갱신 → 공개 REST/staff-config 응답과 구버전 Play 이동 확인.

최초 함수 배포 이후에는 **버전 정책 행 갱신만** 필요하다. 새 화면·추가 DB·홈페이지 전체 재배포·유료 서비스는 필요 없다. 실패하면 현재 정책을 disabled로 돌리거나 이전 승인 행을 경쟁 조건 확인 후 복원한다. 이 절차는 Play의 실제 설치 가능 여부를 자동 보장하지 않는다.
