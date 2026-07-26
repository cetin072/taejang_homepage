# 태장 홈페이지 문의폼 Netlify 설정

홈페이지 코드는 `index.html`의 `taejang-inquiry` 폼을 Netlify Forms로 접수하도록 구성되어 있습니다.

코드에서 완료된 항목:

- 정적 HTML 폼에 `data-netlify="true"` 적용
- 폼 이름 `taejang-inquiry`
- 문의 완료 페이지 `/thanks.html`
- 이메일 필드 이름을 `email`로 지정해 알림 메일에서 바로 답장 가능
- 허니팟 필드 `bot-field` 적용
- 개인정보 수집·이용 동의 필수
- 주민등록번호, 장애·건강정보 등 민감정보 입력 금지 안내

## Netlify에서 한 번 해야 하는 설정

이 설정은 저장소 코드로 대신할 수 없으며 Netlify 프로젝트 관리자 화면에서 진행합니다.

1. 태장 홈페이지 프로젝트를 엽니다.
2. `Forms` → `Usage and configuration`에서 Form detection이 활성화되어 있는지 확인합니다.
3. 최신 Deploy Preview 또는 운영 배포가 완료된 뒤 `taejang-inquiry` 폼이 Active forms에 나타나는지 확인합니다.
4. `Project configuration` → `Notifications` → `Emails and webhooks` → `Form submission notifications`로 이동합니다.
5. `Add notification`을 선택합니다.
6. 알림 대상 폼을 `taejang-inquiry`로 지정합니다.
7. 수신 이메일을 `info@taejang.co.kr`로 입력해 저장합니다.
8. 실제 개인정보 대신 시험용 이름·이메일로 한 번 제출해 다음을 확인합니다.
   - Netlify Forms 제출 목록에 표시되는지
   - `info@taejang.co.kr`로 알림이 오는지
   - 알림 메일에서 답장했을 때 시험 제출자의 이메일이 수신자로 잡히는지
   - 제출 후 `/thanks.html`이 열리는지

## 운영 원칙

- 문의 제출 내역은 문의 처리 완료일부터 6개월 후 삭제합니다.
- Netlify Forms 제출 목록도 같은 보유기간에 맞춰 정기적으로 삭제합니다.
- 주민등록번호, 장애·건강정보, 계좌정보 등 민감하거나 불필요한 정보는 요청하지 않습니다.
- 스팸으로 분류된 문의가 있을 수 있으므로 필요할 때 Spam submissions도 확인합니다.
- 알림 메일이 오지 않더라도 Netlify의 `Forms` 제출 목록을 우선 확인합니다.

## 공식 문서

- Forms setup: https://docs.netlify.com/manage/forms/setup/
- Form notifications: https://docs.netlify.com/manage/forms/notifications/
- Form submissions: https://docs.netlify.com/manage/forms/submissions/
- Spam filters: https://docs.netlify.com/manage/forms/spam-filters/
