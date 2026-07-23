(() => {
  'use strict';

  async function acknowledge(notice, button, messageId) {
    if (!notice?.requires_acknowledgement || notice.acknowledged) return notice;
    button.disabled = true;
    window.TaejangStaffInformationUI.message(messageId, '확인 내용을 저장하고 있습니다.');
    try {
      const result = await window.TaejangApp.rpc('acknowledge_notice', {
        p_notice_id: notice.id,
        p_notice_version: notice.version_no
      });
      if (!result?.ok) {
        if (result?.code === 'NOTICE_VERSION_CHANGED') {
          throw new Error('NOTICE_VERSION_CHANGED');
        }
        throw new Error(result?.code || 'ACK_FAILED');
      }
      window.TaejangStaffInformationUI.message(messageId, '내용을 확인한 시각을 저장했습니다.');
      document.dispatchEvent(new CustomEvent('taejang-notice-acknowledged', {
        detail: { id: notice.id, version: notice.version_no }
      }));
      return { ...notice, acknowledged: true, acknowledged_at: result.acknowledged_at };
    } catch (error) {
      const text = error.message === 'NOTICE_VERSION_CHANGED'
        ? '공지가 변경되었습니다. 최신 내용을 다시 불러옵니다.'
        : '확인 내용을 저장하지 못했습니다. 잠시 후 다시 시도하세요.';
      window.TaejangStaffInformationUI.message(messageId, text, true);
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  window.TaejangNoticeAcknowledgement = { acknowledge };
})();
