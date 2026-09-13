-- Support Radar Phase 1 verified official source catalog.
-- Verified 2026-09-10. This seeds metadata only; no API key, crawl or auto-ingestion is enabled.

begin;

insert into public.support_sources (
  code,name,organization_name,base_url,source_scope,access_method,
  official_source,api_auth_required,terms_review_status,automation_status,priority,notes
) values
  (
    'bizinfo','기업마당 지원사업정보','중소벤처기업연구원',
    'https://www.bizinfo.go.kr/apiList.do','national','api',
    true,true,'allowed','manual_only',10,
    '공식 정책정보 API 확인. 지원사업정보 API는 서비스키 사용신청 필요. Phase 1에서는 키 미설정·자동수집 OFF.'
  ),
  (
    'enaradoom','국고보조금통합관리시스템 e나라도움','기획재정부',
    'https://www.bojo.go.kr/','national','open_data',
    true,false,'unreviewed','manual_only',20,
    '공식 보조금 포털 및 Open API 제공목록 확인. 공모사업 자동수집 endpoint 계약은 Phase 2 연결 전에 별도 확정.'
  ),
  (
    'kead_standard','한국장애인고용공단 장애인표준사업장 지원','한국장애인고용공단',
    'https://www.kead.or.kr/spdsysdesc/cntntsPage.do?menuId=MENU0693','specialized','html',
    true,false,'unreviewed','manual_only',5,
    '태장 핵심 우선 Source. 표준사업장 제도·지원·자료실 공식 페이지. 자동접근 허용 여부 확정 전 수동 등록만 사용.'
  ),
  (
    'gyeongnam119','경남기업119','경상남도',
    'https://www.gyeongnam.go.kr/giup/index.gyeong','province','html',
    true,false,'unreviewed','manual_only',15,
    '경상남도 및 중앙정부 지원사업을 제공하는 공식 기업지원 포털. 자동수집 허용조건 확정 전 수동 등록만 사용.'
  )
on conflict (code) do nothing;

commit;
