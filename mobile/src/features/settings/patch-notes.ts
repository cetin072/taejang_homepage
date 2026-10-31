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
