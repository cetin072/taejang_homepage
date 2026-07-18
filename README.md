# 태장 홈페이지

농업회사법인 태장 주식회사의 공식 정적 홈페이지입니다.

## 기술 구조

- HTML: 페이지 구조와 문구
- CSS: `assets/css/styles.css`
- JavaScript: `assets/js/`
- 이미지: `images/`
- 배포 설정: `netlify.toml`

프레임워크나 별도 빌드 과정 없이 브라우저에서 HTML 파일을 열어 확인할 수 있는 순수 HTML/CSS/JavaScript 사이트입니다.

## 주요 페이지

- `index.html`: 메인 홈페이지
- `workplace.html`: 우리의 일터 목록·상세
- `activities.html`: 태장의 활동 목록·상세
- `privacy.html`, `terms.html`, `404.html`: 안내·정책 페이지

## 로컬 확인

정적 파일이므로 간단한 웹 서버에서 열어 확인합니다.

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 엽니다. 이미지, 메뉴, 활동·일터 목록, 모바일 화면을 함께 확인합니다.

## 공동 개발 방식

1. `main`은 운영 기준 브랜치이며 직접 수정하지 않습니다.
2. 모든 작업은 기능 브랜치에서 진행합니다.
3. 변경 내용과 확인 결과를 정리해 PR 검토를 요청합니다.
4. 검토와 사용자 승인 후에만 `main`에 반영합니다.
5. Netlify 운영 배포는 사용자 승인 후에만 진행합니다.

세부 기준은 [AGENTS.md](AGENTS.md)와 `docs/` 문서를 따릅니다.

## 운영 기준

- [자산 관리 기준](docs/operations/ASSET_POLICY.md)
- [Codex 작업 흐름](docs/operations/CODEX_WORKFLOW.md)
- [반복 명령 템플릿](docs/operations/COMMAND_LIBRARY.md)
- [성능 원칙](docs/operations/PERFORMANCE_POLICY.md)
- [프로젝트 폴더 구조](docs/operations/PROJECT_STRUCTURE.md)

## 콘텐츠 주의 사항

공개 저장소에는 민감정보, 주주명부, 주민등록번호, 비공개 계약 자료, 초상권 확인 전 사진을 올리지 않습니다. 태장 공식 정보와 대외 표현은 별도 기준 문서를 기준으로 검토합니다.
