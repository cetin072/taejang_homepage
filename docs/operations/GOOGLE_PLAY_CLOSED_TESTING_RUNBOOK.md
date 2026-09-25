# 태장 직원앱 Google Play 비공개 테스트 제출 기준

기준일: 2026-09-23  
대상 앱: 태장 직원앱  
Android package: `com.cetin072.taejang.staff`

이 문서는 Google Play Console의 비공개 테스트(Closed testing) 등록 시 현재 앱 구현을 기준으로 사용하는 운영 체크리스트입니다. 화면 문구나 정책이 바뀌면 최신 Google Play 정책과 실제 앱 구현을 다시 대조합니다.

## 1. 기본 방향

- 신규 개인 Google Play 개발자 계정에서 먼저 Closed testing을 진행한다.
- Internal testing은 필수 선행 단계로 사용하지 않는다.
- 최소 12명이 14일 연속 Closed testing에 opt-in 상태를 유지해야 Production 접근 신청 조건을 충족한다.
- 실무상 15~20명 이상 등록을 권장한다.
- 테스트 기간 중 버그 수정과 새 버전 배포는 가능하다.
- Production 공개는 사용자 최종 승인 전 금지한다.

## 2. 앱 식별 정보

- 앱 이름: `태장`
- 패키지명: `com.cetin072.taejang.staff`
- 기본 언어: 한국어(대한민국)
- 유형: 앱
- 가격: 무료
- 최초 Android versionCode: `1`
- 현재 Play candidate: versionName `0.1.1` / versionCode `2`

패키지명은 최초 Play 업로드 이후 장기 식별자로 취급한다. 새 Play 빌드마다 versionCode를 증가시킨다.

## 3. 개인정보·계정 삭제 URL

Play Console 개인정보처리방침:
- `https://taejang.co.kr/employee-app-privacy.html`

계정 및 데이터 삭제 요청 URL:
- `https://taejang.co.kr/account-deletion.html`

앱은 계정 생성 기능을 제공하므로:
- 앱 안에서 개인정보처리방침으로 이동할 수 있어야 한다.
- 앱 안에서 계정 삭제 요청 경로를 제공해야 한다.
- 앱이 없어도 웹에서 계정 삭제 요청을 시작할 수 있어야 한다.

현재 구현은 앱의 로그인 화면 및 계정 설정에서 위 두 웹페이지로 연결한다.

## 4. 앱 콘텐츠 선언

### 로그인 세부정보 / 앱 액세스
- 대부분의 직원 기능은 로그인 필요.
- Play 검토용 전용 계정을 준비한다.
- 검토 계정은 실제 운영 개인 계정을 재사용하지 않는다.
- 검토자가 가입 승인 대기 없이 즉시 로그인할 수 있는 활성 계정이어야 한다.
- 검토 계정 정보는 Play Console의 App Access에만 기록하고 저장소에 비밀번호를 커밋하지 않는다.
- 검토 계정으로 최소한 일반직원 홈, 공지, 출퇴근 화면을 확인할 수 있게 한다.

### 광고
- 광고 포함 여부: **아니요**
- 광고 SDK, 맞춤형 광고, 광고 추적을 현재 사용하지 않는다.

### 정부 앱
- 정부 앱: **아니요**

### 금융 기능
- 금융 기능: **없음**

### 건강
- 건강 관련 앱/기능: **아니요**

### 앱 카테고리
- 권장 카테고리: **비즈니스(Business)**
- 회사 내부 직원의 출퇴근·공지·업무 연결 앱이라는 실제 기능과 일치시킨다.

### 대상층
- 실제 태장 직원 연령 구성을 확인해 설정한다.
- 미성년 직원이 없다면 성인(18세 이상) 대상으로 설정한다.
- 어린이를 대상 사용자로 선택하지 않는다.

## 5. 데이터 보안(Data Safety) 작성 기준

아래는 현재 코드와 DB 계약을 기준으로 한 초안이다. Play Console 화면의 실제 질문 단위로 다시 대조한다.

### 수집됨
1. 개인 정보
   - 이름
   - 이메일 주소
   - 전화번호
   - 사용자/계정 식별정보
   - 입사일, 부서·직책·역할·계정 상태 등 기타 직원 계정 정보

2. 위치
   - 정밀 위치(위도·경도 및 정확도)
   - 출근/퇴근 버튼을 누를 때 foreground에서만 수집
   - 회사 도착 여부, 거리 계산, 근태 예외 처리 목적으로 사용
   - background location은 수집하지 않음

3. 앱 활동 / 업무 활동
   - 출퇴근 요청·기록과 처리 상태
   - 공지 확인 여부·확인 시각
   - 홍보 권한 사용자의 초안·본문·링크·상신 상태 등 사용자 생성 업무 콘텐츠

4. 기기 또는 기타 식별자
   - 앱 설치 식별자
   - Expo Push Token
   - 플랫폼과 앱 버전
   - 알림 전송 상태

### 현재 수집하지 않는 것으로 보는 항목
- 금융/결제 정보
- 건강 정보
- 주소록/연락처 목록
- SMS/통화 기록
- 마이크 오디오
- 카메라 또는 휴대폰 사진 라이브러리 원본
- 웹 검색/탐색 기록
- 광고 ID를 이용한 광고 프로파일링

새 SDK나 기능이 추가되면 반드시 다시 감사한다.

### 데이터 공유
- 현재 태장은 사용자 데이터를 판매하거나 광고 목적으로 공유하지 않는다.
- Supabase, Expo, Netlify 등은 앱 기능 제공을 위해 태장을 대신해 처리하는 서비스 제공자로 사용한다.
- Play Data Safety의 "공유" 정의는 서비스 제공자 예외가 적용되는지 실제 계약·처리 목적을 기준으로 최종 확인한다.

### 처리 목적
- 앱 기능
- 계정 관리
- 보안 및 부정 이용 방지
- 회사 업무·근태·공지 운영

광고·마케팅 프로파일링 목적으로 사용하지 않는다.

### 선택/필수
- 계정 기본정보: 가입·로그인에 필수
- 출퇴근 위치: 출퇴근 기능 이용 시 필요
- 알림 기기정보: 알림 권한을 허용하고 푸시 등록을 사용하는 경우
- 홍보 콘텐츠: 해당 업무 권한이 있는 사용자가 직접 작성하는 경우

### 보안
- 사용자 기기와 서버 간 통신은 HTTPS 사용
- Supabase Auth/RLS 및 서버 RPC를 권한 경계로 사용
- 인증 세션은 Android SecureStore에 보관
- 비밀번호/서비스 키를 앱 로그나 저장소에 평문 보관하지 않음

### 데이터 삭제
- 계정 생성 기능: **있음**
- 계정 삭제 요청 기능: **있음**
- 외부 웹 삭제 요청 페이지: **있음**
- 법률·근로관계·급여·감사 등 정당한 보존 사유가 있는 기록은 필요한 기간 보존될 수 있음을 개인정보처리방침에서 공개

## 6. 위치 권한 설명

Play 심사 및 개인정보 공개에서 다음 의미를 유지한다.

> 태장 직원앱은 직원이 출근 또는 퇴근 버튼을 누를 때 회사 도착 여부를 확인하기 위해 현재 위치를 사용합니다. 위치는 foreground에서만 확인하며 백그라운드 위치 추적을 사용하지 않습니다. 확인된 위치와 정확도는 출퇴근 기록 검증과 예외 처리에 사용될 수 있습니다.

앱 설명·개인정보처리방침·Data Safety의 위치 설명이 서로 달라지면 안 된다.

## 7. 스토어 등록정보 초안

### 짧은 설명
`태장 직원의 출퇴근, 공지 확인과 업무 연결을 위한 직원용 앱`

### 상세 설명
`태장`은 농업회사법인 태장 주식회사 직원이 사용하는 업무용 앱입니다.

주요 기능:
- 오늘의 출근·퇴근 상태 확인 및 출퇴근 기록
- 회사 공지 확인과 중요공지 알림
- 역할에 따른 업무 기능 연결
- 홍보 담당 직원의 콘텐츠 작성·임시저장·상신·보완 확인
- 태장 공식 홈페이지와 공식 채널 바로가기

출퇴근 위치 확인은 직원이 출근·퇴근 버튼을 누르는 시점에만 사용하며 백그라운드 위치 추적을 하지 않습니다.

앱 이용에는 태장 직원 계정과 회사의 계정 승인이 필요할 수 있습니다.

### 연락처
- 웹사이트: `https://taejang.co.kr`
- 지원 이메일: `taejang2025@naver.com`
- 전화: `055-293-8626`

## 8. 스토어 이미지 준비

필수 화면을 실제 출시 후보 앱에서 캡처한다.
- 로그인
- 직원 홈
- 출퇴근
- 공지
- 역할별 대표 업무 화면

실제 직원 개인정보·실제 공지 민감내용이 보이지 않도록 전용 QA 계정/샘플 데이터를 사용한다.

## 9. AAB 및 서명 Gate

Closed testing의 실제 첫 릴리스 전:
- Play용 Android App Bundle(`.aab`) 생성
- release/upload signing 확정
- versionCode 중복 방지
- package `com.cetin072.taejang.staff` 확인
- target SDK 정책 확인
- 비밀키/keystore/서비스계정 파일 저장소 커밋 금지
- AAB 설치 후 실제 Galaxy 기기에서 로그인/출퇴근/공지/재실행 확인

현재 GitHub CI의 standalone APK는 개발·실기기 QA 산출물이며 Play 제출용 AAB 및 장기 서명 운영과 구분한다.

### Issue #333 Play AAB signing pipeline

현재 Expo 프로젝트에는 EAS 설정(`eas.json`)이나 Expo project ID가 없으므로, 이번 Closed testing AAB에는 EAS를 새로 연결하지 않는다. 대신 Play App Signing을 전제로 한 Android **upload key**를 GitHub Actions의 repository secrets에서만 복원해 AAB를 서명한다. Google Play는 업로드 후 자체 app-signing key로 사용자 배포 APK를 서명하며, 이 workflow는 Play Console에 업로드하거나 어떤 트랙도 게시하지 않는다.

- workflow: `.github/workflows/mobile-app.yml`의 `android-play-aab`
- 실행: Actions의 수동 실행(`workflow_dispatch`)에서 `build_play_aab`을 선택한 승인된 release build만 수행한다.
- artifact: `taejang-employee-mobile-play-aab`
- AAB 파일: `app-release.aab`
- PR 및 일반 `main` push: signing secret을 읽지 않으며, Play AAB job은 skip한다. 기존 ARM64 APK QA job은 계속 실행한다.

workflow 실행 전 repository secrets에 아래 네 값을 등록한다. 이 값이 하나라도 없으면 Play AAB job은 실행하지 않으며 debug signing으로 대체하지 않는다.

- `ANDROID_UPLOAD_KEYSTORE_BASE64`: upload keystore(`.jks`) 전체를 Base64로 인코딩한 값
- `ANDROID_UPLOAD_KEY_ALIAS`: upload key alias
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`: keystore 비밀번호
- `ANDROID_UPLOAD_KEY_PASSWORD`: key 비밀번호

upload keystore는 소유자가 생성·보관하고, GitHub Secrets 외의 승인된 복구 보관소에도 안전하게 백업한다. keystore 파일, Base64 문자열, 비밀번호, service-account JSON은 저장소·Issue·PR·빌드 로그에 넣지 않는다. 첫 AAB 업로드 시 Play Console의 Play App Signing 안내를 확인하고 upload key로 제출한다. 이후 업데이트도 같은 upload key를 사용한다.

workflow는 release AAB 존재, JAR 서명 유효성, Android debug certificate 미사용, arm64 native library, package, target SDK 36 이상, foreground location/notification 권한, background location 부재를 검증한 뒤에만 artifact를 남긴다.

기존 `android-standalone`은 실기기 QA 전용 ARM64 **debug APK**를 만든다. 이 APK는 Play 제출물이 아니며, release 변형은 upload key가 주입된 `android-play-aab`에서만 생성한다.

## 10. Closed testing 운영

- 1차로 사용자 본인을 테스터 목록에 등록할 수 있다.
- 직원 Google Play 이메일이 모이면 같은 Closed testing 목록에 추가한다.
- 최소 12명이 opt-in한 상태가 된 시점부터 14일 연속 조건을 관리한다.
- 12명 딱 맞추지 않고 15~20명 이상 확보한다.
- 테스트 중 새 버전을 올려도 되며 테스터는 참여 상태를 유지한다.
- 피드백, crash, 로그인, 위치권한, 알림, 업데이트 문제를 기록한다.

## 11. Production 전 최종 확인

- Closed testing 최소 인원·기간 충족
- Production access 승인
- Play 정책 및 Data Safety 재검수
- 개인정보처리방침과 실제 앱 동작 일치
- 계정 삭제 요청 경로 정상
- 앱 접근용 검토 계정 정상
- AAB/서명/업데이트 검증
- 실제 사용자 QA
- 사용자 최종 승인

위 조건 전에는 Production 공개하지 않는다.
