# Capability access behavior matrix

Issue #148의 홍보·홈페이지 경로 감사 기준이다. 이 문서는 역할명을 브라우저 권한의 source of truth로 쓰지 않으며, `get_my_access_context_v2`의 capability와 서버 `private_actor_can()` 결과를 기준으로 한다.

| 영역 | capability | promotion_staff | promotion_lead | operations_manager | ceo | super_admin |
| --- | --- | --- | --- | --- | --- | --- |
| 홍보 작성 | `promotion.write`, `promotion.edit_own` | 허용 | 허용 | 허용 | 불가 | 불가 |
| 타인 미발행본 수정 | `promotion.edit_any_unpublished` | 불가 | 불가 | 허용 | 불가 | 불가 |
| 홍보 검토 | `promotion.review_lead` / `promotion.review_operations` / `promotion.review_ceo` | 불가 | 팀장 단계 | 운영 단계 | 대표 단계 | 불가 |
| 발행 대기 | `promotion.queue_publication` | 불가 | 허용 | 허용 | 불가 | 불가 |
| 공개·숨김·보관 | `promotion.hide`, `promotion.republish`, `promotion.archive` | 불가 | 승인·미발행 보관 및 기존 삭제요청 범위 | 허용 | 불가 | 불가 |
| 복구 | `promotion.restore` | 불가 | 불가 | 허용 | 불가 | 불가 |
| 홈페이지 초안 | `homepage.draft` | 불가 | 자신의 요청만 | 허용 | 불가 | 불가 |
| 홈페이지 검토·승인 반영 | `homepage.review`, `homepage.approve_apply` | 불가 | 불가 | 허용 | 불가 | 불가 |
| 홈페이지 safe-slot 직접 수정 | `homepage.direct_edit` | 불가 | 불가 | 허용 | 불가 | 불가 |

`operations_manager`의 operational capability는 registry의 `operations_manager_auto_grant`로만 확장된다. `super_admin`은 기술 capability만 별도 actual-role grant를 받으며 일반 운영 권한의 우회가 아니다. 모바일 역할 시뮬레이션은 effective capability만 낮추고 종료 시 원래 capability를 복원한다.

## 의도적으로 남긴 route 사용

`app/assets`의 route 비교는 v1 capability contract가 없는 순차 배포 fallback, 화면 제목·역할 표기, 또는 기존 목록의 표시 범위에만 남긴다. mutation/read RPC의 권한 최종 판단은 public wrapper의 capability gate가 담당하며, 이전 구현은 `private_*_pre148`으로 이동해 실행 권한을 회수했다. 공개 홈페이지의 `get_public_homepage_overrides()`는 익명 읽기 계약을 유지하므로 capability gate 대상이 아니다.
