# 홍보 편집기 도입 기록

- 선택: Tiptap core, StarterKit, Image 3.34.0 (MIT), ProseMirror 기반. npm에서 실제 배포 버전 확인(2026-11-14). https://github.com/ueberdosis/tiptap / https://tiptap.dev/docs/editor/getting-started/overview
- 이유: 기존 순수 JS ERP에 작은 편집 영역으로 붙일 수 있으며 한글 입력, 문서 구조, 선택/실행 취소를 직접 구현하지 않는다. 기존 DB·사진 압축·승인 흐름을 재사용한다.
- 대안: contenteditable 직접 구현은 IME/undo/선택 관리 부담이 크다. 전체 CMS 도입은 기존 승인/권한/DB를 중복시킨다. Markdown 입력은 직원에게 문법 학습을 요구하므로 채택하지 않는다.
- 원본 변경 없음. 로컬 `src/promotion/editor.js`만 태장 화면에 맞춰 작성. `node scripts/build-promotion-editor.mjs`로 추적된 브라우저 번들을 재생성한다. Netlify 빌드도 같은 명령을 실행한다.
- 초기 번들 약 400 KiB(비압축). ERP 전용이며 공개 페이지에는 편집기를 로드하지 않는다. 공개 문서 렌더러는 별도 소형 무의존성 JS다.
- esbuild 0.28.2는 빌드 도구로만 사용. 0.27.3의 Windows 개발 서버 취약점이 audit에 확인되어 고친 버전으로 올렸다. 개발 서버 기능은 사용하지 않는다.
- 서드파티 라이선스 전문: docs/reference/PROMOTION_EDITOR_THIRD_PARTY_NOTICES.md.
- 보안 경계: public_body는 실행 코드가 아닌 버전 있는 문서 데이터. 공개 렌더링은 태그/속성 허용 목록과 이스케이프, URL 프로토콜 제한, 승인된 public_media URL 일치 검사로 제한. 원시 HTML/임의 이미지 URL 렌더링 금지.
- 비용: 유료 SaaS 없음. 향후 npm audit과 버전 고정 업데이트 후 편집기 왕복/한글/선택/사진 검수를 반복한다.
