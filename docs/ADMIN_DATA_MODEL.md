# 관리자 시스템 논리 데이터 모델

이 문서는 SQL이 아닌 엔터티·필드·관계 초안입니다. 실제 migration은 Phase 0 결정과 보안 검토 후 별도 작업합니다.

## 1. 엔터티 관계

- 인증 사용자 1명은 `profiles` 1개를 가지며 `profile_roles`를 통해 역할을 가집니다.
- `content_items`는 현재 상태·공개 ID·현재 revision을 관리하고, 실제 본문 snapshot은 `revision_history`와 `content_sections`에 둡니다.
- 콘텐츠는 `content_media`로 여러 미디어를 사용하고 `attachments`를 가질 수 있습니다.
- 검토·승인은 `approvals`가 특정 revision을 가리킵니다.
- 모든 주요 행위는 `audit_logs`, 사용자 알림은 `notifications`에 남깁니다.

## 2. 테이블별 필드 초안

| 테이블 | 주요 필드 | 관계·공개 여부 | 삭제 정책 |
| --- | --- | --- | --- |
| `profiles` | `id`, `display_name`, `work_email`, `status`, `created_at`, `last_login_at` | Auth 사용자 1:1, 비공개 | 비활성화, 업무 기록의 작성자 참조 유지 |
| `roles` | `id`, `code`, `name`, `description` | 권한 기준, 비공개 | 사용 중 삭제 금지 |
| `profile_roles` | `profile_id`, `role_id`, `granted_by`, `granted_at` | 사용자 N:M 역할 | 회수 이력은 로그 보존 |
| `categories` | `id`, `content_type`, `name`, `slug`, `sort_order`, `active` | 콘텐츠 N:1, 이름은 공개 가능 | 비활성화 우선 |
| `content_items` | `id`, `public_id`, `type`, `status`, `current_revision_id`, `published_revision_id`, `author_id`, `publish_at`, `published_at`, `visibility`, timestamps, soft-delete 필드 | 콘텐츠의 식별·상태, 승인본 일부 공개 | soft delete |
| `revision_history` | `id`, `content_id`, `revision_no`, `title`, `summary`, `intro`, `seo_title`, `seo_description`, `change_note`, `created_by`, `created_at` | 콘텐츠 1:N, 승인·게시 revision 고정 | 원칙적으로 보존 |
| `content_sections` | `id`, `revision_id`, `heading`, `body_text`, `block_type`, `sort_order` | revision 1:N, 승인본만 발행 | revision과 함께 보존 |
| `media_assets` | `id`, `storage_key`, `original_name`, `mime_type`, `size`, `width`, `height`, `checksum`, `alt`, `approval_status`, 동의·로고 승인 상태, `uploaded_by`, timestamps | 공개 승인본만 공개 | soft delete, 참조 중 삭제 금지 |
| `content_media` | `content_id` 또는 `revision_id`, `media_id`, `role`, `sort_order`, `caption`, `alt_override` | 콘텐츠 N:M 미디어 | 연결 해제 기록 검토 |
| `attachments` | `id`, `content_id`, `storage_key`, `type`, `version`, `public_status`, `approved_by`, `published_at` | 공개본만 공개 | 대체·보관 후 soft delete |
| `approvals` | `id`, `content_id`, `revision_id`, `action`, `comment`, `reviewer_id`, `created_at` | 특정 revision 승인 | 보존 |
| `audit_logs` | `id`, `actor_id`, `action`, `target_type`, `target_id`, `before_summary`, `after_summary`, `reason`, `session_ref`, `created_at` | 비공개, 관리자 제한 | 보존기간 후 최소화·파기 |
| `notifications` | `id`, `recipient_id`, `type`, `content_id`, `message`, `read_at`, `created_at` | 비공개 | 기간 만료 삭제 |
| `site_settings` | `key`, `value`, `visibility`, `updated_by`, `updated_at` | 허용된 업무 설정만 | revision·로그 후 변경 |

## 3. enum 초안

### 콘텐츠 상태

`draft`, `review_requested`, `changes_requested`, `approved`, `scheduled`, `published`, `archived`, `trashed`

### 콘텐츠 유형

MVP: `notice`, `workplace`, `activity`. 후속: `press_release`, `recruitment`, `banner`, `popup`, `document`, `faq`, `company_info`, `greeting`.

### 역할

`author`, `reviewer`, `publisher`, `super_admin`, `developer`. 역할과 권한을 코드에 하드코딩할지 DB 권한표로 관리할지는 Phase 0에서 결정하되, DB RLS는 신뢰 가능한 역할 claim 또는 서버 검증을 사용합니다.

### 공개 범위

`private`, `preview`, `public`, `limited`, `archived`. 공개 콘텐츠 기준의 `PUBLIC`, `LIMITED`, `INTERNAL`, `VERIFY` 분류와 연결하되 동일 개념으로 혼용하지 않습니다.

## 4. revision 저장 방식

- 자동저장은 작업 revision을 갱신할 수 있지만 검토 요청 시 불변 snapshot을 만듭니다.
- 승인 기록은 snapshot revision ID를 가리킵니다.
- 승인 뒤 내용·미디어가 바뀌면 새 revision을 만들고 상태를 재검토로 전환합니다.
- `published_revision_id`는 현재 공개 중인 snapshot을 가리켜 즉시 이전 공개본으로 복구할 수 있게 합니다.
- diff는 화면 편의를 위해 생성할 수 있으나, 복구 원본은 snapshot입니다.

## 5. soft delete

`deleted_at`, `deleted_by`, `previous_status`, `delete_reason`을 기록합니다. 기본 쿼리는 삭제 항목을 제외하고, 휴지통만 포함합니다. 복원 시 이전 상태와 참조를 확인하며 영구삭제는 최고관리자와 보존기간 조건을 요구합니다.

## 6. 첨부파일과 미디어

- 첨부파일은 콘텐츠와 연결되지만 버전과 공개 상태를 독립 관리합니다.
- 미디어는 여러 콘텐츠에서 재사용할 수 있으며 `content_media`가 역할과 순서를 가집니다.
- 같은 파일의 원본·웹본·썸네일은 하나의 asset과 파생본 메타로 묶습니다.
- 파일이 사용 중이면 삭제 대신 교체·보관을 우선합니다.

## 7. 승인과 감사

- `approvals`에는 검토 요청, 수정 요청, 승인, 승인 취소를 revision 기준으로 기록합니다.
- 게시자는 승인된 동일 revision만 게시할 수 있습니다.
- `audit_logs`는 행위 추적용이며 콘텐츠 복구용 revision과 분리합니다.
- 로그에는 비밀번호·토큰·동의서 원문·민감한 본문 전체를 넣지 않습니다.

## 8. 공개·비공개 경계

- 공개 API·정적 JSON에는 승인된 `published_revision`과 공개 승인 미디어·첨부만 포함합니다.
- 초안, 내부 메모, 검토 의견, 사용자 계정, 감사 로그, 동의 원본 참조는 공개 출력에서 제외합니다.
- 관리자 DB의 공개 가능 필드도 RLS와 발행 allowlist를 모두 통과해야 합니다.

## 9. 확장성

- 새 콘텐츠 유형은 공통 필드와 유형별 metadata를 분리해 추가합니다.
- 기업 협력 문의·처리 기록은 공개 콘텐츠와 별도 도메인 테이블로 확장합니다.
- 다국어가 필요하면 revision별 언어 variant를 별도 엔터티로 추가합니다.
- 현재 `content.js`의 공개 ID 6개는 migration 시 `public_id`로 유지해 기존 URL을 보호합니다.

관련 문서: [관리자 시스템 요구사항](ADMIN_SYSTEM_REQUIREMENTS.md), [관리자 보안 계획](ADMIN_SECURITY_PLAN.md), [관리자 도입 의사결정](ADMIN_DECISION_LOG.md)
