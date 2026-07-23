# Phase 1 운영 적용 전 체크리스트

이 문서는 운영 적용을 승인하지 않는다. 모든 항목과 별도 사용자 승인이 완료된 작업에서만 사용한다.

## 변경 전

- [ ] 운영 Supabase 백업·복구 담당자와 절차 확인
- [ ] 운영·비운영·Deploy Preview 프로젝트와 URL 재확인
- [ ] migration 목록과 migration history 대조
- [ ] 비운영 `db push --dry-run`, clean migration, DB lint, pgTAP, Auth/Data API 성공
- [ ] Netlify `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 확인
- [ ] service role·secret·DB 연결문자열이 브라우저·저장소·로그에 없음
- [ ] 최소 2명의 활성 최고관리자와 복구 담당자 준비

## 데이터·화면

- [ ] 실제 부서·작업반·멤버십 시작/종료일 검토
- [ ] 초기 일정·공지·작업방법·안내의 대상·기간 검토
- [ ] 민감정보·개인 연락처·상담 내용 미입력 확인
- [ ] Android Chrome, Samsung Internet, iPhone Safari, Windows Chrome, Edge 수동 검수 완료
- [ ] 200% 확대, 키보드, 포커스, 스크린리더, KST 자정·차량 시간 확인
- [ ] Draft PR GitHub Actions·Netlify Deploy Preview 성공

## 적용·롤백

- [ ] 적용 시간·담당자·공개 홈페이지 영향 없음 확인
- [ ] migration 실패·로그인 불가·권한 우회·데이터 범위 오류를 즉시 롤백 기준으로 합의
- [ ] 마지막 정상 배포와 검증된 DB 복구 절차만 사용
- [ ] 적용 직후 가상 최고관리자·일반 근로자 계정으로 로그인·로그아웃·범위·비활성 차단 확인
- [ ] 시범운영 문제 접수와 긴급 중지 책임자 지정
