# Issue #139 초기 로딩 측정 기록

상태: Draft PR 검증 기록

## 측정 대상

로그인·access-context 확인 이후 `app/assets/app-ui.js`가 feature module을 요청하고 첫 `taejang-app-ready`를 replay할 때까지의 **모듈 로드 대기 구간**이다. Supabase config/session/access-context RPC 시간은 이 파일의 앞 단계이므로 이 측정에 포함하지 않는다.

## 방법

동일한 20개 feature module, 각 모듈의 독립적인 응답 지연 25ms라는 제어된 loader harness로 비교했다. 실제 네트워크·기기 성능 수치는 Preview에서 별도 사람이 확인해야 하며, 아래 값은 직렬 대기 제거 효과를 재현 가능하게 기록한 것이다.

| 방식 | 모듈 로드 대기 | 변화 |
| --- | ---: | ---: |
| 변경 전: 직렬 `reduce` | 500ms (20 × 25ms) | 기준 |
| 변경 후: 병렬 `Promise.all` | 25ms | 475ms 단축 (95%) |

## 보존한 안전 계약

- 모든 module이 load 또는 failure 상태가 될 때까지 첫 `taejang-app-ready` replay를 막는다.
- `async = false`를 유지해 동적 classic script의 삽입 순서 실행을 보존한다.
- employee-management, 가입승인, navigation priority가 등록되기 전 메뉴를 노출하지 않는다.
- Auth/RLS/API·DB 계약은 변경하지 않는다.

## Preview 확인 항목

- 실제 로그인 후 App Shell이 먼저 안정적으로 표시되는지
- 운영총괄 직원관리·가입승인과 일반/홍보 역할 메뉴가 초기 진입에서 누락되지 않는지
- 느린 모바일 네트워크에서 loading 상태와 재시도 안내가 유지되는지
