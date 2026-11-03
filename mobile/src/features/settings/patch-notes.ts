export type PatchNoteEntry = {
  id: string;
  date: string;
  title: string;
  summary: string;
  items: readonly string[];
};

// Bundled with the app, including QA builds. Dates describe source changes,
// not Google Play publication. Keep older entries when adding a new one.
// Pattern reference: cetin072/worklog-voice-pwa at e3a8a50bd7d7e8f3fe47970268dd04ee84448f78:
// mobile/src/features/settings/patch-notes.ts. No runtime dependency on that app.
export const MOBILE_PATCH_NOTES: readonly PatchNoteEntry[] = [
  {id:'2026-11-03-employee-tabs',date:'2026-11-03',title:'출퇴근·내 연차 하단 메뉴',summary:'화면 아래의 큰 메뉴로 출퇴근과 내 연차를 나눴습니다.',items:['내 연차에서 남은 개수와 앞으로 쉴 날짜를 먼저 확인합니다.','연차 신청은 날짜 선택 후 큰 확인 화면에서 다시 확인합니다.','지난 신청은 따로 펼쳐 확인할 수 있습니다.']},
  {id:'2026-11-02-full-day-leave',date:'2026-11-02',title:'연차 신청 단순화',summary:'반차 선택을 빼고 날짜만 선택하도록 정리했습니다.',items:['하루는 연차 1개, 이틀은 2개를 사용합니다.','하루/여러 날 구분과 신청일 확인은 그대로 유지합니다.']},
  {id:'2026-11-02-leave-ui',date:'2026-11-02',title:'연차 신청 화면 간소화',summary:'홈에서 큰 연차 신청 버튼으로 바로 시작합니다.',items:['하루/여러 날을 구분하고 날짜 목록·총 일수를 확인합니다.','자세한 규칙은 신청 안내에서 펼쳐볼 수 있습니다.','QA 화면 체험에서도 실제 저장 없이 연차 화면을 확인할 수 있습니다.']},
  {
    id:'2026-11-02-leave-changes',date:'2026-11-02',title:'연차 수정·취소 요청',
    summary:'앱에서 연차를 수정하거나 승인된 연차의 취소를 요청할 수 있습니다.',
    items:['승인 전 신청은 여러 번 수정할 수 있습니다.','승인된 일정은 사용일 전까지 1회 수정 요청할 수 있고, 이후에는 관리자에게 문의합니다.','승인 후 취소·수정은 관리자 확인 전까지 기존 일정이 유지되며 처리 결과를 앱에서 확인합니다.'],
  },
  {
    id: '2026-11-02-clock-out-reminder', date: '2026-11-02',
    title: '출퇴근 미기록 안내 준비',
    summary: '근무시간과 기록을 기준으로 출근·퇴근 미기록 안내를 준비했습니다.',
    items: ['출근한 직원이 예정 퇴근 시각 5분 뒤에도 퇴근을 기록하지 않았을 때 안내하는 조건을 추가했습니다.', '알림은 검수 및 운영 활성화 후 제공되며 현재 실제 발송은 꺼져 있습니다.'],
  },
  {
    id: '2026-11-01-leave-request', date: '2026-11-01', title: '내 연차 확인·신청',
    summary: '관리자가 등록한 남은 연차를 확인하고 연차를 신청합니다.',
    items: ['종일·반차를 사용일 최소 3일 전에 신청합니다.', '승인 대기·승인·반려 상태를 확인하고 대기 중인 신청을 취소할 수 있습니다.'],
  },
  {
    id: '2026-11-01-notice-card-balance',
    date: '2026-11-01',
    title: '공지 카드 색상과 정렬 개선',
    summary: '홈 공지사항을 다른 카드와 어울리도록 정리했습니다.',
    items: ['공지 영역을 차분한 녹색 계열로 조정했습니다.', '공지 제목과 안내·전체보기 버튼을 가운데로 정렬했습니다.', '퇴근 완료 시에도 출근과 같은 카드 회전 효과를 표시합니다.'],
  },
  {
    id: '2026-10-31-settings-patch-notes',
    date: '2026-10-31',
    title: '설정에서 패치노트 확인',
    summary: '태장 앱에서 달라진 내용을 설정에서 다시 볼 수 있습니다.',
    items: [
      '설정 → 패치노트에서 날짜별 변경 내역을 최신순으로 확인합니다.',
      '앱을 업데이트하면 새로운 변경 내역이 함께 추가됩니다.',
      '인터넷 연결이 없어도 앱에 포함된 변경 내역을 읽을 수 있습니다.',
    ],
  },
  {
    id: '2026-10-30-home-cards',
    date: '2026-10-30',
    title: '홈 화면 카드 정리',
    summary: '홈에서 출퇴근과 공지사항을 더 쉽게 구분할 수 있도록 정리했습니다.',
    items: [
      '홈 카드의 모양과 간격을 통일했습니다.',
      '공지사항 카드를 밝은 파란색으로 구분해 쉽게 찾을 수 있습니다.',
    ],
  },
  {
    id: '2026-10-22-notice-cards',
    date: '2026-10-22',
    title: '공지사항 확인 개선',
    summary: '최근 공지사항과 새 글 표시를 더 쉽게 확인할 수 있도록 바꿨습니다.',
    items: [
      '최근 공지사항 3개를 간결한 카드로 보여줍니다.',
      '공지 제목과 미확인 표시를 쉽게 확인하고 전체 공지와 상세 내용으로 이동합니다.',
    ],
  },
];
