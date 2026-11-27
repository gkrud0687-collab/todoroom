# 오늘 할 일 방(TodoRoom) 재구현 명세서

- 기준 버전: **0.5.1** (2026-11-25 빌드)
- 작성일: 2026-11-26
- 표기 규칙
  - **[사실]**: 소스 코드에서 직접 확인한 내용이에요. 뒤에 `(출처: 파일명)`을 붙였어요.
  - **[추정]**: 코드를 보고 판단했지만 실제로 실행해서 확인하지는 못한 내용이에요.
  - **[모름]**: 확인할 방법이 없었거나 정해지지 않은 내용이에요.
- 민감한 값(API 키, Firebase 프로젝트 식별값 등)은 `[삭제됨]`으로 바꿨어요.

---

## 1. 개요

1. 친구 4명이 각자 윈도우 PC에 설치해서 쓰는 데스크톱 펫형 "오늘 할 일" 프로그램이에요. 각자 고른 캐릭터가 작업표시줄 위를 돌아다녀요.
2. 하루 5개까지 할 일을 적고 체크하며, 할 일별 타이머와 뽀모도로로 시간을 재요. 집중을 마치면 캐릭터 간식(보상)이 쌓이고, 월간 1등은 선물상자를 받아요.
3. Firebase Realtime Database로 실시간 연결돼서, 접속한 친구의 캐릭터·할 일·기분이 내 화면에 보이고 확성기·던지기·축하를 주고받을 수 있어요(메신저 기능은 없음).

---

## 2. 기능 목록

### 2-1. 처음 실행과 캐릭터 선택
- **동작**
  - [사실] 설정 파일에 `uid`, `char`, `name`이 모두 있으면 바로 시작하고, 아니면 캐릭터 선택 창을 띄워요. (출처: main.js)
  - [사실] Firebase 익명 로그인을 써요. 이미 로그인 정보가 저장돼 있으면 그대로 쓰고, 없을 때만 새 익명 계정을 만들어요. (출처: src/fb.js `ensureUser`)
  - [사실] 캐릭터를 고르면 `claims/{캐릭터}` 값을 트랜잭션으로 내 uid로 바꿔요. 비어 있거나 이미 내 것일 때만 성공해요. 다른 캐릭터를 갖고 있었다면 그 claim은 지워요. (출처: src/setup.js)
- **화면**: [사실] 600×400 창 안에 캐릭터 카드 4장이 있어요. 남이 고른 캐릭터에는 `soldout_stamp.png`("품절" 도장)가 찍혀요. 아래쪽에 이름 입력칸(12자)과 "시작하기" 버튼이 있어요. (출처: setup.html, src/setup.js)
- **규칙**
  - [사실] 캐릭터는 4종(`black_cat` 검은 고양이, `hamster` 햄스터, `squirrel` 날다람쥐, `chick` 오리)이에요. 1캐릭터당 1명만 쓸 수 있어서 **최대 4명**이에요. (출처: src/fb.js `CHARS`, `CHAR_LABEL`)
  - [사실] 화면 표시명은 `chick`만 "오리"로 다르게 써요.

### 2-2. 할 일 창
- **동작** (모두 [사실], 출처: src/todo.js, src/fb.js)
  - 하루 최대 5개(`MAX_TODOS=5`)까지 적을 수 있고, 한 개당 60자(`MAX_TEXT=60`)까지예요.
  - 적은 뒤 Enter를 누르거나 칸 밖을 클릭(blur)하면 저장돼요. Esc를 누르면 취소돼요.
  - **기존 할 일의 글자를 모두 지우고 blur하면 그 할 일이 삭제돼요.**
  - 체크하면 `done=true`, `doneAt`이 기록되고 완료 효과음이 나요. 타이머가 돌던 중이면 시간을 정산하고 멈춰요.
  - 할 일 창에는 **오늘 0시 이후에 만든(`createdAt`) 할 일만** 만든 순서대로 보여요. 6번째부터는 안 보여요(`todaysTodos`).
- **화면** (출처: todo.html, src/todo.js)
  - [사실] 400×480 테두리 없는 투명 창이고, 배경은 `todo_frame.png`예요.
  - [사실] 맨 위: 핀(항상 위에 표시), 최소화, 닫기(× = 최소화).
  - [사실] 머리 부분: 내 캐릭터 얼굴, "○○의 오늘 할 일", 날짜(짧은 요일) · "완료/전체 완료" · 이번 달 보상 아이콘과 개수, 📮 우편함(안 읽은 확성기 수 빨간 배지), 보고서 버튼.
  - [사실] 할 일 줄 5칸: 체크박스, 글 입력칸, 걸린 시간, ▶/‖ 또는 뽀모도로 남은 시간, 🍅 버튼, 축하해 준 친구 얼굴, 삭제 ×.
  - [사실] 아래쪽 버튼: 색·글꼴, ⚙ 설정, 💬 기분, 확성기, 던지기, 자주 쓰는 할 일, 선물(랭킹), 오른쪽 끝에 접속한 친구 얼굴.
  - [사실] 팝업 패널은 한 번에 하나만 열려요(swatches, panel, moodPanel, megaPanel, throwPanel, scPanel, giftPanel, mailPanel).
- **꾸미기 규칙** (출처: src/fb.js `MEMO_COLORS`, src/todo.js, main.js)
  - [사실] 메모 색 8가지: `#F9E4EC #E3F1F8 #FFF4BA #E0EFE0 #EAE1F4 #ECE0D1 #E5E6E8 #FCF9F2`.
  - [사실] 글꼴은 `queryLocalFonts()`로 PC에 설치된 글꼴 목록에서 골라요. 권한은 `local-fonts`만 허용해요. 목록을 못 읽으면 기본 목록(맑은 고딕 등 8개)을 써요.
  - [사실] 글자 크기는 작게 13px · 보통 15px(기본) · 크게 17px 3단계예요. (출처: todo.html `#sizes`, src/todo.js)
- **자주 쓰는 할 일**: [사실] 최대 12개까지 저장하고, 누르면 오늘 할 일에 바로 추가돼요. (출처: src/todo.js `MAX_SHORTCUTS`)

### 2-3. 할 일 타이머
- [사실] ▶를 누르면 시작, ‖를 누르면 일시정지, 다시 ▶를 누르면 이어서 재요. **한 번에 하나만** 돌아가요. 다른 할 일을 시작하면 돌던 것은 정산하고 멈춰요. (출처: src/todo.js `startTimer`)
- [사실] 저장 방식은 `elapsed`(누적 ms)와 `runningSince`(시작 시각 ms, 멈추면 null)예요. 화면 표시값은 `elapsed + (now - runningSince)`예요. (출처: src/time.js `elapsedOf`)
- [사실] 타이머가 돌아가는 동안에는 내 캐릭터가 노트북 작업(work) 동작을 하고, presence에 `working:true`를 올려서 친구 화면에서도 똑같이 보여요. (출처: src/pet.js)

### 2-4. 캐릭터(펫)
- **화면**: [사실] 주 모니터 전체를 덮는 투명 창이 항상 위(`screen-saver` 레벨)에 떠 있어요. 마우스 클릭은 아래 창으로 통과시키다가, 캐릭터나 UI 위에 있을 때만 클릭을 받아요(`setIgnoreMouseEvents(true,{forward:true})`를 바꿔 가며 씀). (출처: main.js, src/pet.js)
- **크기·위치**: [사실] 512px 원본 프레임을 112px로 줄여서 그려요. 발바닥 기준선은 원본 483px이고, 바닥(GROUND)은 작업표시줄 윗선이에요. (출처: src/pet.js `SIZE`, `FOOT`, `GROUND`)
- **평소 동작**: [사실] 걷기 28, 서 있기 12, 앉기 14, 노트북 26, 졸기 20의 가중치로 무작위로 고르고, 직전 동작은 반복하지 않아요. 걷기 속도는 46px/초, 한 번에 최대 ±420px 이동해요. (출처: src/pet.js `decide`)
- **프레임 속도(FPS)**: [사실] idle 2.2, walk 8, sit 1.5, rest 1, work 2.5, happy 6, held 3, fall 3, hit 5, megaphone 3.
- **조작**
  - [사실] 드래그하면 들려 있는(held) 동작이 나오고, 놓으면 중력 2200px/s²로 떨어져서 바닥에 닿을 때 소리가 나요.
  - [사실] 내 캐릭터를 클릭하면 기뻐하고, 친구 캐릭터를 클릭하면 그 친구의 오늘 할 일 팝오버가 떠요(🎉 축하, 던지기 버튼 포함).
  - [사실] 내 캐릭터를 우클릭하면 메뉴(할 일 창 열기 / 내 캐릭터 숨기기 / 모든 캐릭터 숨기기 / 캐릭터·이름 바꾸기 / 종료)가 나와요. (출처: main.js `appMenuTemplate`)
- **상태 표시(이름표)**: [사실] 👑 지난달 보상왕, 🍅 집중 중 남은 분, ☕ 휴식, 💤 자리 비움이 이름표에 붙어요. (출처: src/pet.js `renderTag`)
- **기분 말풍선**: [사실] 30자까지 쓸 수 있어요(`MOOD_MAX`). 적은 날짜가 오늘일 때만 보이고(`todayMood`), presence의 `mood`로 친구 화면에도 보여요.
- **숨기기**: [사실] "내 캐릭터 숨기기"와 "모든 캐릭터 숨기기"가 있어요. 둘 중 하나라도 켜면 presence에 `hidden:true`가 올라가서, 친구 화면에서도 내 캐릭터가 사라져요.
- **음성**: [사실] 캐릭터마다 default(접속·클릭), happy(완료·보상), pickup(들기), hit(맞기) 4개 음성이 있어요.

### 2-5. 친구와의 상호작용
| 기능 | 동작 | 규칙 | 출처 |
|---|---|---|---|
| 확성기 | 모두의 화면에 큰 말풍선이 5.2초 떴다가 오른쪽 위 작은 카드로 바뀌어요. 카드는 클릭해야 읽음 처리돼요 | [사실] 40자(`MEGA_MAX`), 15초에 1번(`MEGA_COOLDOWN=15000`). 나에게도 읽음 상태로 한 부 저장 | src/events.js, src/pet.js, src/todo.js |
| 던지기 | 똥(poop) 또는 바나나를 던지면 던지는 동작 → 날아가는 아이템 → 맞는 동작과 어지러움 효과 | [사실] 3초에 1번(`THROW_COOLDOWN=3000`). 상대가 뽀모도로 **집중 중이면 불가**(보내는 쪽에서 막고, 받는 쪽에서도 무시) | src/pet.js `requestThrow`, `handleEvent` |
| 축하하기 | 친구가 할 일을 완료하면 친구 캐릭터가 기뻐하고 옆에 "축하하기" 버튼이 떠요. 누르면 무작위 문구가 말풍선으로 떠요 | [사실] 할 일 1개당 1명 1번(DB 규칙으로 강제). 문구 4개: 축하해요!/수고했어!/최고야!/대단해! | src/pet.js `sendCheer`, firebase-rules.json |
| 우편함 | 확성기, 받은 축하, 받은 던지기를 기록해요 | [사실] 최근 20개만 보관(`MAIL_KEEP`). 넘치는 건 클라이언트가 지워요. 삭제는 내 우편함에서만. 안 읽음 숫자는 확성기만 | src/todo.js `trimMail` |
| 읽음 표시 | 없음 | [사실] 상대가 읽었는지는 보이지 않아요 | — |

### 2-6. 뽀모도로
- **동작** (모두 [사실], 출처: src/pet.js `pomoCmd`, `finishFocus`, `finishBreak`)
  - 할 일 줄의 🍅로 시작해요. 그 할 일의 타이머도 함께 시작돼요.
  - 상태(`mode`)는 `focus` → `break` → `ready`이고, 일시정지 상태는 `paused`예요. 1초마다 끝났는지 확인해요.
  - 집중이 끝나면: 할 일 타이머를 정산하고 `pomos`를 +1, 이번 달 보상을 +1 해요(트랜잭션). 그다음 간식 먹기 → 기지개 동작, happy 음성, "○○ 획득! 짧은/긴 휴식 N분" 말풍선이 나와요.
  - `cycle`이 `every`의 배수일 때 긴 휴식, 아니면 짧은 휴식이에요.
  - 휴식이 끝나면 `ready` 상태가 되고 "쉬는 시간 끝! 다시 집중할까요?"를 물어봐요(🍅 시작 / 나중에).
- **설정**: [사실] 사람마다 따로 정해요. 기본값은 집중 25분, 짧은 휴식 5분, 긴 휴식 15분, 4회마다예요. 범위는 집중 1~180, 짧은 1~60, 긴 1~120, 간격 1~12예요. (출처: src/events.js `POMO_DEFAULT`, `pomoSettings`)
- **집중 중 방해 금지**: [사실] 던지기를 막고, 그동안 온 확성기는 띄우지 않고 모아 뒀다가 집중이 끝나면 "확성기 N개가 왔어요"라고 알려 줘요.
- **친구 화면**: [사실] presence의 `pomo{mode, endsAt(서버 시각), todoId}`로 🍅 남은 분과 ☕를 보여 주고, 20초마다 갱신해요.
- **상태 저장**: [사실] 진행 상태(`pomoState`)는 **각 PC의 로컬 설정 파일**에 저장돼요. 프로그램을 껐다 켜도 남은 시간이 있으면 이어져요.

### 2-7. 자리 비움(자동 멈춤)
- [사실] 메인 프로세스가 5초마다 `powerMonitor.getSystemIdleTime()`을 확인해요. 180초(3분) 이상이면 "자리 비움"이에요. 화면 잠금(`lock-screen`)이나 절전(`suspend`) 때는 바로 "자리 비움"이 돼요. (출처: main.js `startIdleWatch`)
- [사실] 자리 비움이 되면 집중 중인 뽀모도로는 `paused`가 되고, **마지막 입력 시점 기준**으로 남은 시간을 계산해요. 일반 할 일 타이머도 마지막 입력 시점까지만 정산하고 멈춰요. **휴식은 멈추지 않아요.** (출처: src/pet.js `onAway`)
- [사실] 입력이 다시 생기면(잠금 상태가 아닐 때, 유휴 5초 미만) 돌아온 걸로 보고, "다시 시작할까요?"를 물어봐요. 자동으로 다시 시작하지는 않아요. (출처: src/pet.js `onBack`)
- [사실] 자리 비움 동안 친구 화면에서는 내 캐릭터가 졸기(rest) 동작을 하고 💤 자리 비움이 보여요.

### 2-8. 보상·월간 랭킹·선물상자
- **보상 지급 기준**: [사실] 뽀모도로 **집중 1회를 끝까지 마칠 때마다** 1개예요. 할 일 완료 체크나 일반 타이머로는 보상이 없어요. 월별로 `rewards/{uid}/{YYYY-MM}`에 모여요. (출처: src/pet.js `finishFocus`)
- **보상 이름**: [사실] black_cat 츄르, squirrel 도토리, hamster 해바라기씨, chick 완두콩. (출처: src/events.js `REWARD`)
- **월간 1등 결정** (출처: src/pet.js `checkWinner`)
  - [사실] 각 클라이언트가 시작할 때와 30분마다, 지난달(`prevMonthKey`) 우승자가 아직 없으면 `rewards` 전체를 읽어 가장 많은 사람을 골라요.
  - [사실] 동점이면 무작위로 1명을 뽑아요. 0개뿐이면 우승자가 없어요.
  - [사실] `winners/{지난달}`에 "없을 때만 쓰기" 트랜잭션을 해서, 가장 먼저 성공한 클라이언트의 결과가 확정돼요. 그다음 접속자 모두에게 `king` 이벤트를 보내요.
- **선물상자**: [사실] 우승자 화면에 빨간 상자가 떨어져요. 클릭하면 흔들림과 드럼롤(2.6초) → 열림 프레임 → 2.95초에 선물이 나오고 tada(꽝이면 fail) 소리가 나요. 9.5초 뒤 사라져요. 선물은 클릭할 때 뽑아서 `winners/{월}/gift`에 한 번만 저장하고, `gifts/{uid}`에 추가해요. 접속한 친구에게 `giftopen` 알림도 보내요. (출처: src/pet.js `dropBox`)
- **선물 확률** ([사실], 출처: src/events.js `GIFT_TIERS`, `GIFTS`)

| 등급 | 가중치 | 선물(id: 표시 이름) |
|---|---|---|
| 대박 jackpot | 10 | cake: 딸기 케이크, crown: 왕관 |
| 좋음 good | 30 | icecream: 아이스크림, flowers: 꽃다발 |
| 보통 normal | 30 | candy: 사탕 한 알, sticker: 스티커 |
| 꽝 bust | 30 | sock: 짝 잃은 양말, stone: 돌멩이, can: 빈 깡통, dust: 먼지 뭉치, broken_umbrella: 구멍 난 우산, empty_snack: 빈 과자봉지 |

  등급 안에서는 균등 확률이에요. 선물은 목록에 모이기만 하고, 쓰는 기능은 없어요.

### 2-9. 15일 보고서와 자동 삭제
- [사실] 할 일은 만든 날(`createdAt`)부터 15일(`RETENTION_DAYS`)이 지나면 정리 대상이에요. (출처: src/time.js)
- [사실] 할 일 창이 처음 데이터를 받을 때 대상이 있고 오늘 아직 보고서를 안 봤으면(`lastReport`) 보고서 창(500×400)을 자동으로 띄워요. **보고서를 닫을 때** 대상 할 일을 지워요. PC가 꺼져 있었다면 다음에 켤 때 처리돼요. (출처: src/todo.js `checkReport`, src/report.js)
- [사실] 보고서 내용: 완료율, 완료 개수, 총 걸린 시간, 날짜별 막대(전체/완료), 시간이 가장 많이 걸린 할 일 상위 3개. 보고서 버튼으로 언제든 볼 수 있어요.

### 2-10. 다른 PC에서 같은 캐릭터로 쓰기 (0.5.0~)
- **비밀번호 연결**: [사실] 설정에서 6자 이상의 비밀번호를 정하면, 지금 쓰는 익명 계정에 이메일/비밀번호 자격을 연결해요(`linkWithCredential`). uid는 그대로예요. 이메일은 실제 메일함이 아니라 `u{uid 소문자}@[삭제됨]` 형식의 내부 주소예요. 연결하면 `users/{uid}/linked=true`가 저장돼요. (출처: src/todo.js `savePassword`, src/fb.js `loginEmail`)
- **다른 PC에서 들어가기**: [사실] 선택 화면에서 품절된 캐릭터를 누르면, 그 주인이 `linked`일 때만 비밀번호 입력칸이 나와요. `signInWithEmailAndPassword`로 로그인한 뒤 uid가 claim 주인과 같으면 설정을 저장하고 시작해요. (출처: src/setup.js `login`)
- **동시 실행 규칙: 나중에 켠 PC가 우선**
  - [사실] 각 PC는 설치 때 무작위 `device` ID를 만들어 둬요. (출처: main.js)
  - [사실] 시작할 때 `active/{uid} = {device, ts}`를 써요. 다른 PC가 이 값을 바꾸면, 먼저 켠 PC는 "양보(yield)" 상태가 돼요. (출처: src/pet.js)
  - [사실] 양보한 PC는 내 캐릭터를 숨기고, presence 쓰기·onDisconnect·inbox 수신을 멈춰요. 진행 중이던 뽀모도로는 **멈추고 시간만 저장**해요. 할 일 창에는 "지금은 다른 컴퓨터에서 쓰고 있어요 [여기서 쓰기]"가 떠요.
  - [사실] "여기서 쓰기"를 누르면 `active`를 다시 자기 것으로 써서 되찾아요. 양보 상태는 sessionStorage에 남겨서, 자정이나 월이 바뀔 때 창이 다시 로드돼도 캐릭터를 도로 가져오지 않아요.
- **공유 설정**: [사실] 자주 쓰는 할 일과 뽀모도로 시간은 `prefs/{uid}`로 두 PC가 같게 맞춰요. 글꼴, 글자 크기, 색, 소리, 숨기기는 PC마다 따로예요. 처음에는 클라우드 값이 우선이고, 클라우드에 값이 없으면 로컬 값을 올려요. (출처: src/todo.js)
- **양보한 PC의 뽀모도로**: [사실] 버튼이 잠기고, presence의 `pomo`를 읽어서 🍅 남은 시간만 보여 줘요.

### 2-11. 창·트레이·종료
- [사실] 할 일 창의 ×는 최소화만 해요. 완전히 종료하는 곳: 트레이 메뉴, 작업표시줄 점프 목록(`--todoroom-*` 인자로 실행 중인 프로그램에 전달), 캐릭터 우클릭 메뉴, 설정의 "프로그램 종료". (출처: main.js)
- [사실] 단일 인스턴스예요. 두 번 실행하면 기존 창을 열어요. (`requestSingleInstanceLock`)
- [사실] 할 일 창 위치와 핀(항상 위) 상태는 로컬 설정에 저장돼요.

### 2-12. 소리 설정
- [사실] 전체 켜기/끄기, 음량(기본 0.8), "친구가 보낸 소리 받기"(친구 음성, 확성기, 맞는 소리)를 설정할 수 있어요. (출처: src/sound.js `DEFAULT_SOUND`)

---

## 3. 화면 구성

| 창 | 크기·속성 | 주요 요소 | 사용 이미지 |
|---|---|---|---|
| 캐릭터 선택 (setup.html) | 600×400, 테두리 없음, 투명 | 제목, 카드 4장, 이름 입력, 시작하기 / (품절 캐릭터) 비밀번호, 들어가기, 취소, 안내 문구 | `character_frame.png`, `{char}_select.png`, `soldout_stamp.png`, `btn_close.png` |
| 펫 오버레이 (pet.html) | 주 모니터 전체, 투명, 항상 위, 작업표시줄에 안 보임 | 캐릭터들, 이름표, 기분 말풍선, 팝오버, 확성기 말풍선과 카드(오른쪽 위), 알림, 질문 말풍선, 보상 팝업, 선물상자, 토스트 | 아래 캐릭터 프레임, `speech_bubble.png`, `megaphone_bubble.png`, `poop_fly.png`, `poop_hit.png`, `banana.png`, `banana_hit.png`, `hit_effect_dizzy.png`, `crown_badge.png`, `tomato.png`, `focus_badge.png`, `assets/rewards/*`, `assets/gifts/*` |
| 할 일 창 (todo.html) | 400×480, 테두리 없음, 투명, 위치 기억 | 2-2 참고 | `todo_frame.png`, `btn_pin/minimize/close/report/color/settings/megaphone/throw_banana/shortcut/giftbox.png`, `checkbox_empty/checked.png`, `btn_start/pause/pomodoro/pomodoro_stop.png`, `trophy.png`, `focus_badge.png`, `megaphone.png`, `banana.png`, `poop_fly.png` |
| 15일 보고서 (report.html) | 500×400, 항상 위 | 통계 카드, 날짜별 막대, 상위 3개, 닫기·확인 | `report_frame.png`, `btn_close.png` |

**캐릭터 파일** ([사실], 출처: assets/characters, src/manifest.json)
- 경로는 `assets/characters/{char}/{char}_{동작}_{번호2자리}.png`, 크기는 512×512 투명 PNG예요.
- 그 밖에 `{char}_face.png`(얼굴 아이콘)와 `{char}_select.png`(선택 카드)가 있어요.

| 동작 | black_cat | hamster | squirrel | chick |
|---|---|---|---|---|
| idle | 3 | 3 | 3 | 3 |
| walk | 6 | 5 | 5 | 5 |
| sit | 2 | 2 | 2 | 2 |
| rest(졸기) | 2 | 2 | 2 | 2 |
| work(노트북) | 4 | 4 | 5 | 5 |
| happy | 4 | 4 | 4 | 4 |
| held(들림) | 2 | 2 | 2 | 2 |
| hit | 3 | 3 | 3 | 3 |
| throw | 3 | 3 | 3 | 3 |
| megaphone | 2 | 2 | 2 | 2 |
| eat(간식) | 3 | 3 | 3 | 3 |
| stretch(기지개) | 4 | 4 | 4 | 4 |

- [사실] 검은 고양이는 크림색 테두리(약 8px, `#FFF8F0`)가 그림에 들어가 있어요.
- [사실] 던질 때 손에 든 흰 공을 가리는 좌표가 캐릭터별로 있어요. (출처: src/events.js `THROW_HAND`)

**소리** ([사실], 출처: src/sound.js)
- 효과음: `window_open`, `window_close`, `character_drop`, `task_complete`, `item_throw`, `megaphone`, `gift_drumroll`, `gift_tada`, `gift_fail`(.wav)
- 음성: `assets/voices/{char}_voice_{default|happy|pickup|hit}.wav`, 16개

**쓰지 않는 파일**: [사실] `btn_complete.png`, `settings_frame.png`, `poop.png`, `character_hit.wav`, `character_pickup.wav`는 코드에서 참조하지 않아요. pickup·hit 소리는 캐릭터 음성으로 바꿨어요.

---

## 4. 기술 구조

| 항목 | 내용 | 근거 |
|---|---|---|
| 언어 | JavaScript(ES 모듈, 렌더러) + CommonJS(메인 프로세스), HTML/CSS | [사실] 소스 |
| 프레임워크 | Electron **38.8.6** | [사실] node_modules 설치 버전 |
| 실시간 DB·인증 | Firebase JS SDK **11.10.0** (app, auth, database) | [사실] |
| 번들러 | esbuild **0.28.2** (IIFE, 대상 chrome130, minify) | [사실] scripts/build.mjs |
| 패키징 | electron-builder **26.18.0**, Windows x64 **zip**(설치 프로그램 없음) | [사실] package.json |
| exe 아이콘·버전 정보 | resedit 3.1.1 + pe-library 2.0.3을 afterPack 훅으로 사용(Wine 없이) | [사실] scripts/after-pack.cjs |
| UI 라이브러리 | 없음(바닐라 DOM, 작은 `el()` 헬퍼) | [사실] src/fb.js |
| 개발 환경 Node | v22 | [사실] 빌드한 환경 기준. 최소 버전은 [모름] |

- **보안 설정**: [사실] `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`예요. 렌더러는 preload의 `window.api`로만 메인과 통신해요.
- **설치(개발자)**
  ```bash
  npm install
  npm run start   # bundle 후 electron 실행
  npm run dist    # release/TodoRoom-<버전>-win.zip 생성
  ```
- **설치(사용자)**: [사실] zip을 풀고 `TodoRoom.exe`를 실행해요. 코드 서명이 없어서 SmartScreen 경고가 뜰 수 있어요.
- **Firebase 준비**
  1. Realtime Database를 만들어요. 기존 프로젝트는 asia-southeast1 지역이었어요.
  2. Authentication에서 **익명**과 **이메일/비밀번호** 로그인을 켜요.
  3. 부록 A의 규칙을 게시해요.
  4. 설정값을 `src/fb.js`의 `firebaseConfig`에 넣어요.
- **오프라인 화면 점검(개발용)**: [사실] `TODOROOM_SNAP=<출력폴더>`와 `TODOROOM_P3/P4/P5/FX/TREAT/PANEL`을 붙여 xvfb에서 실행하면 창별 스크린샷을 저장해요. 각 창에 `window.__todoroomDebug` 훅이 있어요.

---

## 5. 실시간 연동 방식

### 5-1. 서버 구성
- [사실] 별도 서버 없이 **Firebase Realtime Database + Firebase Authentication**만 써요. 모든 로직은 클라이언트에서 돌아가요(Cloud Functions 없음).
- [사실] 사용자 그룹 구분(방 코드)이 없어서, **DB 하나 = 친구 그룹 하나**예요.

### 5-2. 데이터 구조 (경로 · 필드)

| 경로 | 필드 | 쓰는 쪽 | 설명 |
|---|---|---|---|
| `users/{uid}` | `name`(1~12자), `char`, `color?`, `mood?`, `updatedAt`, `linked?`(bool) | 본인 | 프로필 |
| `claims/{char}` | 값 = uid | 본인(트랜잭션) | 캐릭터 소유권(품절 판단) |
| `presence/{uid}` | `char`, `name`, `hidden`, `mood`, `working`, `away`, `pomo{mode,endsAt,todoId}`, `ts` | 본인 | 접속 상태. onDisconnect로 삭제 |
| `todos/{uid}/{todoId}` | `text`(≤60), `done`, `createdAt`, `doneAt?`, `elapsed?`, `runningSince?`, `pomos?`, `cheers/{cheererUid}`=ms | 본인(cheers만 친구) | 할 일 |
| `inbox/{uid}/{pushId}` | `type`, `from`, `name`, `char`, `ts`(서버 시각) + 종류별 필드 | 누구나 추가, 본인 삭제 | 실시간 신호 큐 |
| `mail/{uid}/{mailId}` | `type`, `from`, `name`, `char`, `ts`, `read` + `text`/`item`/`phrase`/`todoText` | 누구나 추가, 본인 수정·삭제 | 우편함(최근 20개) |
| `rewards/{uid}/{YYYY-MM}` | 숫자(0~100000) | 본인 | 월별 보상 개수 |
| `winners/{YYYY-MM}` | `uid`, `count`, `ts`, `gift?` | 처음 1회만(누구나), gift는 우승자 1회 | 월 우승자 |
| `gifts/{uid}/{pushId}` | `item`, `month`, `ts` | 본인 | 받은 선물 목록 |
| `active/{uid}` | `device`, `ts` | 본인 | 지금 쓰는 PC |
| `prefs/{uid}` | `shortcuts[]`, `pomo{focus,short,long,every}` | 본인 | PC 간 공유 설정 |

**inbox 이벤트 종류** ([사실], 출처: src/pet.js `handleEvent`, src/todo.js)
- `throw` {to, item: poop|banana}
- `cheer` {to, phrase, todoId}
- `megaphone` {text, mailId}
- `king` {month, winner, winnerName, winnerChar}
- `giftopen` {item, month}

### 5-3. 동기화 방식
- **신호 전달(inbox 패턴)** [사실]
  - 보내는 쪽이 **받을 사람마다** `inbox/{받는uid}`에 push해요. 화면에 같이 보여야 하면 접속자 전원과 자기 자신에게 보내요.
  - 받는 쪽은 `onChildAdded`로 받자마자 삭제해요. 서버 시각 기준 60초가 지난 이벤트는 무시해요(오프라인 동안 쌓인 것).
- **상태 공유(presence)** [사실]
  - 각자 `presence/{uid}`에 자기 상태를 쓰고, 모두가 `presence` 전체를 구독해요.
  - presence가 있고 `hidden`이 아니면 그 친구의 캐릭터를 만들고, 그 친구의 `todos/{uid}`도 구독해요.
- **연결 끊김 처리** [사실]
  - `.info/connected`가 true가 될 때마다 `onDisconnect(remove)`를 다시 걸고 presence를 다시 써요.
  - 0.5.1부터는 연결된 상태에서 내 presence가 지워지면 0.8초 뒤 다시 써요(자기 복구). 예전 연결의 onDisconnect가 늦게 실행돼서 지워지는 경우를 막기 위해서예요.
- **시간 기준** [사실]
  - 이벤트·presence의 `ts`는 `serverTimestamp()`를 써요. 뽀모도로 `endsAt`은 `.info/serverTimeOffset`으로 서버 시각으로 바꿔서 공유해요.
  - 할 일 `createdAt`과 타이머(`runningSince`)는 **각 PC의 로컬 시계**(`Date.now()`)를 써요.
- **동시 수정 방지** [사실]
  - claims, rewards 증가, winners 확정, 선물 확정은 `runTransaction`을 써요.
  - 축하는 DB 규칙("본인 아님 + 아직 없음")으로 1회를 강제해요.
- **여러 PC(같은 사용자)**: 2-10 참고. `active/{uid}`로 마지막에 켠 PC 하나만 presence와 inbox를 처리해요.

### 5-4. 핵심 코드 발췌 (실시간 동기화)

```js
// src/events.js — 친구 화면으로 신호 보내기 (받는 사람마다 inbox에 push)
export async function sendEvent(me, targets, data) {
  const payload = { ...data, from: me.uid, name: String(me.name || ''), char: String(me.char || ''), ts: serverTimestamp() };
  const unique = [...new Set(targets)];
  await Promise.all(unique.map((to) => push(ref(db, `inbox/${to}`), payload)));
}
```

```js
// src/pet.js — inbox 수신: 받자마자 지우고, 60초 지난 건 무시
inboxOff = onChildAdded(ref(db, `inbox/${uid}`), (snap) => {
  const ev = snap.val();
  remove(snap.ref).catch(() => {});
  if (!ev || typeof ev.ts !== 'number') return;
  if (Date.now() + serverOffset - ev.ts > 60000) return;
  handleEvent(ev);
});
```

```js
// src/pet.js — presence: 연결될 때마다 onDisconnect 재등록 + 지워지면 자기 복구
const writePresence = async () => {
  await onDisconnect(myRef).remove();
  await set(myRef, { char, name, hidden, mood, working, away, pomo, ts: serverTimestamp() });
};
onValue(ref(db, '.info/connected'), async (snap) => {
  connected = snap.val() === true;
  if (!connected || yielded || leaving) return;
  await writePresence();
});
onValue(myRef, async (snap) => {
  if (snap.exists() || !connected || yielded || leaving || healing) return;
  healing = true;
  await new Promise((r) => setTimeout(r, 800));
  if (!yielded && !leaving && connected) await writePresence();
  healing = false;
});
```

```js
// src/pet.js — 여러 PC: 마지막에 켠 PC가 우선
set(activeRef, { device, ts: serverTimestamp() });
onValue(activeRef, (s) => {
  const v = s.val(); if (!v || !v.device) return;
  if (v.device !== device && !yielded) yieldHere();          // 다른 PC가 가져감 → 숨기고 멈춤
  else if (v.device === device && yielded) location.reload(); // "여기서 쓰기"로 되찾음
});
```

---

## 6. 외부 프로그램 연동

- [사실] 이 프로젝트에는 **한글(HWP) 등 다른 프로그램과의 연동이 없어요.** 코드에 HWP, COM, 클립보드, 파일 감시 같은 연동 코드는 없어요.
- [사실] OS와 연결되는 부분은 Electron 기본 기능뿐이에요.
  - 트레이, 작업표시줄 점프 목록(`app.setUserTasks`)
  - 유휴 시간·잠금·절전 감지(`powerMonitor`)
  - 설치된 글꼴 목록(`queryLocalFonts`, `local-fonts` 권한)
- 제약 사항
  - [사실] 점프 목록과 exe 아이콘 처리는 Windows 전용이에요.
  - [사실] 펫 창은 **주 모니터에만** 떠요(`screen.getPrimaryDisplay()`).
  - [추정] 듀얼 모니터의 보조 화면에는 캐릭터가 나오지 않아요.
- [사실] **글자수 계산 기능은 이 프로젝트에 없어요.** 할 일 글자 제한(60자)과 확성기(40자), 기분(30자)은 단순히 `slice`와 `maxlength`로 잘라요. 별도 구상 중인 "한글 연동 글자수 게임"은 이 코드와 관계없는 다른 프로젝트예요.

---

## 7. 데이터 저장

| 무엇 | 어디에 | 얼마나 | 근거 |
|---|---|---|---|
| 할 일(글, 완료, 시간, 뽀모 수, 축하) | Firebase `todos/{uid}` | 만든 날부터 **15일** 뒤 보고서를 닫을 때 삭제. 보고서를 안 열면 그대로 남음 | [사실] report.js |
| 접속 상태 | Firebase `presence` | 접속 중에만. 끊기면 onDisconnect로 삭제 | [사실] |
| 실시간 신호 | Firebase `inbox` | 받는 즉시 삭제. 받는 사람이 접속하지 않으면 남아 있다가 다음 접속 때 지워짐(60초 지나면 화면에는 안 보임) | [사실] |
| 우편함 | Firebase `mail/{uid}` | 최근 **20개**. 우편함 목록을 볼 때 클라이언트가 정리 | [사실] todo.js `trimMail` |
| 월별 보상 | Firebase `rewards` | **삭제하지 않음**(계속 쌓임) | [사실] 삭제 코드 없음 |
| 월 우승자·선물 | Firebase `winners`, `gifts` | 삭제하지 않음 | [사실] |
| 프로필·캐릭터 소유권 | Firebase `users`, `claims` | 삭제하지 않음(캐릭터를 바꾸면 claim만 이동) | [사실] |
| 공유 설정·사용 PC | Firebase `prefs`, `active` | 삭제하지 않음 | [사실] |
| 로그인 정보 | Electron 렌더러 저장소(IndexedDB, Firebase 기본 동작) | 지우기 전까지 | [추정] Firebase 웹 SDK 기본값 |
| 로컬 설정 | `%APPDATA%/{앱이름}/config.json` (`app.getPath('userData')`) | 영구 | [사실] main.js. 정확한 폴더 이름은 [모름]: productName 기준이면 `TodoRoom` |

**config.json 키** ([사실], 출처: main.js `config:set`)
- `uid`, `char`, `name`, `color`, `pinned`, `sound{on,volume,friend}`, `hide{mine,all}`
- `mood{text,ts}`, `font`, `fontSize`, `shortcuts[]`, `lastReport`(YYYY-MM-DD)
- `pomo{...}`, `pomoState{mode,todoId,endsAt,remaining,cycle,long,byAway}`, `seenGiftMonth`
- `todoPos{x,y}`, `device`

---

## 8. 파일 구조

```
todo-room-app/
├─ main.js               메인 프로세스: 창 4개 생성, 트레이·점프 목록, 설정 파일, 유휴 감지, IPC, 개발용 스냅샷
├─ preload.js            window.api 노출(getConfig, setConfig, pomo, onIdleAway 등)
├─ pet.html              펫 오버레이 화면과 CSS
├─ todo.html             할 일 창 화면과 CSS(모든 팝업 패널 포함)
├─ setup.html            캐릭터 선택·로그인 화면
├─ report.html           15일 보고서 화면
├─ firebase-rules.json   Realtime Database 보안 규칙(부록 A)
├─ package.json          스크립트, electron-builder 설정
├─ scripts/
│  ├─ build.mjs          esbuild로 src/*.js → dist/*.js 번들
│  └─ after-pack.cjs     exe 아이콘·버전 정보 넣기
├─ src/
│  ├─ fb.js              Firebase 초기화, 익명 로그인, 상수(CHARS, MEMO_COLORS, MAX_TODOS), todaysTodos
│  ├─ events.js          sendEvent/sendMail, 쿨다운 상수, 보상·선물·뽀모도로 설정
│  ├─ time.js            elapsedOf, 시간 표시, dayKey, 보관 기간(15일)
│  ├─ sound.js           효과음·캐릭터 음성 재생, 소리 설정
│  ├─ pet.js             캐릭터 동작·물리, presence, inbox, 던지기·축하·확성기, 뽀모도로 엔진, 자리 비움, 우승자·선물상자, 여러 PC 처리
│  ├─ todo.js            할 일 CRUD·타이머, 꾸미기, 설정, 기분·확성기·던지기, 단축, 랭킹·선물, 우편함, 비밀번호, 공유 설정
│  ├─ setup.js           캐릭터 선택(claims 트랜잭션), 품절 캐릭터 로그인
│  ├─ report.js          15일 보고서와 기간 지난 할 일 삭제
│  └─ manifest.json      캐릭터별 애니메이션 프레임 경로 목록
├─ assets/
│  ├─ characters/{char}/ 캐릭터 프레임(3장 참고)
│  ├─ props/             말풍선, 확성기 말풍선, 똥·바나나(날아감·맞음), 어지러움 효과
│  ├─ ui/                창 프레임, 버튼, 체크박스, 품절 도장, 배지, 앱 아이콘
│  ├─ rewards/           보상 아이콘(작은 것, 획득 팝업용 큰 것)
│  ├─ gifts/             선물상자 3프레임 + 선물 12종
│  ├─ sounds/            효과음 11개(2개는 안 씀)
│  └─ voices/            캐릭터 음성 16개
├─ dist/                 번들 결과(빌드 산출물)
└─ release/              배포 zip(빌드 산출물)
```

---

## 9. 알려진 문제·아쉬운 점·미완성 기능

**알려진 문제**
1. [모름] **할 일 하나가 사라진 현상**(0.5.1을 다시 켰을 때, 사용자 보고)은 원인을 확인하지 못했어요. 코드상 가능한 원인은 아래와 같아요. 재현 정보는 아직 받지 못했어요.
   - [사실] 기존 할 일의 글을 모두 지우고 칸을 벗어나면 삭제돼요.
   - [사실] 오늘 0시 이전에 만든 할 일은 창에 보이지 않아요(데이터는 남아 있음).
   - [사실] 6번째 이후는 보이지 않아요.
   - [추정] 입력 중에 DB 갱신으로 목록이 다시 그려지면 입력 중인 글이 사라질 수 있어요.
2. [추정] **친구 화면에서 내 캐릭터가 사라지는 현상**(사용자 보고)은 예전 연결의 onDisconnect가 늦게 실행된 탓으로 보여요. 0.5.1에서 자기 복구를 넣었지만, 실제 네트워크에서는 확인하지 못했어요.
3. [모름] 0.4.0~0.5.1 기능(보상, 랭킹, 선물상자, 우편함, 비밀번호 연결, 여러 PC 처리, presence 자기 복구)은 **실제 Firebase에서 테스트하지 못했어요.** 오프라인 화면 캡처로만 확인했어요.
4. [모름] Windows에서 유휴 감지(`getSystemIdleTime`, 잠금·절전 이벤트)가 의도대로 동작하는지는 확인하지 못했어요.
5. [사실] 학원 PC에서 프로그램이 자동 삭제되는 일이 있었어요. [추정] 원인은 백신이나 복원 프로그램이고, 코드 서명이 없는 것도 영향이 있을 수 있어요.

**설계상 아쉬운 점** (모두 [사실])
- 보상 개수, 우승자 확정, 선물 뽑기를 모두 **클라이언트가 계산하고 저장**해요. 규칙상 본인 rewards는 마음대로 쓸 수 있어서 조작할 수 있어요. 우승자도 "먼저 쓰는 사람"의 계산이 확정돼요.
- inbox와 mail은 로그인한 누구나 아무에게 쓸 수 있어요. 앱 설정값만 있으면 친구가 아닌 사람도 익명으로 들어올 수 있어요(방 코드·초대 없음).
- 할 일 날짜와 월 구분은 각 PC의 **로컬 시계·시간대**를 따라요.
- 뽀모도로 진행 상태가 로컬 파일에만 있어서, PC를 옮기면 이어지지 않고 멈춰요.
- 선물상자: `winners/{월}/gift`는 저장됐는데 `gifts/{uid}` 추가가 실패하면 목록에서 빠질 수 있어요.
- 캐릭터 4종이 코드에 고정돼 있어요(CHARS, THROW_HAND, REWARD, VOICE_CHARS).
- 펫은 주 모니터에만 나와요.
- 비밀번호를 잊으면 프로그램 안에서 복구할 수 없어요(가짜 이메일이라 재설정 메일을 못 받음).
- 자동 업데이트가 없어서, 새 버전 zip을 4명에게 직접 나눠야 해요.

**미완성·보류 기능**
- [사실] 휴대폰 연동(PWA 제안만 하고 시작 안 함)
- [사실] 선물 사용 기능 없음(모으기만 함)
- [사실] 우편함 버튼이 이미지 없이 📮 이모지예요.
- [모름] `focus_badge.png`(메달)의 의미는 확정되지 않았어요. 지금은 "집중 중이라 던질 수 없음" 표시로 써요.
- [사실] 사용하지 않는 에셋 5개(3장 참고)

---

## 10. 다시 만든다면 바꾸고 싶은 점

1. **판정은 서버에서**: 보상 지급, 월 우승자, 선물 뽑기를 Cloud Functions(또는 별도 서버)로 옮겨 조작을 막아요. [추정] Cloud Functions는 Blaze(종량제) 요금제가 필요할 수 있어요.
2. **방(그룹) 개념 추가**: `rooms/{roomId}/...` 아래로 데이터를 모으고, 초대 코드와 멤버 목록으로 읽기·쓰기를 제한해요.
3. **연결 단위 presence**: `presence/{uid}/connections/{connId}`처럼 연결마다 따로 기록하는 Firebase 권장 방식으로 바꿔, 재연결 경쟁 문제를 구조적으로 없애요.
4. **서버 시각 통일**: `createdAt`, `runningSince`도 서버 시각(또는 오프셋 보정)을 쓰고, 날짜 경계용 시간대를 그룹 단위로 정해요.
5. **뽀모도로 상태를 DB에 저장**해서 PC를 옮겨도 이어지게 해요.
6. **입력 안정성**: 편집 중인 줄은 다시 그리지 않고, "빈 글 = 삭제" 대신 명시적인 삭제 버튼만 쓰게 해요(할 일 사라짐 문제 예방).
7. **캐릭터를 데이터로 관리**: manifest 하나에 프레임, 음성, 보상, 손 좌표를 모아서 캐릭터 추가가 코드 수정 없이 되게 해요.
8. **테스트**: Firebase Emulator로 2~4개 클라이언트 동시 테스트를 자동화해요.
9. **배포**: 코드 서명, 설치 프로그램(NSIS), 자동 업데이트(electron-updater)를 넣어요.
10. **멀티 모니터** 지원, TypeScript 도입.

---

## 핵심 코드 발췌 (타이머)

```js
// src/time.js — 걸린 시간 = 누적 + (실행 중이면 지금 - 시작 시각)
export function elapsedOf(t, now = Date.now()) {
  if (!t) return 0;
  const base = Math.max(0, Number(t.elapsed) || 0);
  const run = t.runningSince && !t.done ? Math.max(0, now - Number(t.runningSince)) : 0;
  return base + run;
}
```

```js
// src/todo.js — 한 번에 하나만: 다른 타이머는 정산하고 멈춘 뒤 시작
function startTimer(item) {
  const now = Date.now(); const patch = {};
  for (const t of items) if (t.id !== item.id && t.runningSince) {
    patch[`${t.id}/elapsed`] = elapsedOf(t, now); patch[`${t.id}/runningSince`] = null;
  }
  patch[`${item.id}/runningSince`] = now;
  update(ref(db, `todos/${uid}`), patch);
}
```

```js
// src/pet.js — 뽀모도로 진행: 1초마다 확인, 집중이 끝나면 보상 +1 후 휴식
setInterval(() => {
  if (!pomo) return;
  const now = Date.now();
  if (pomo.mode === 'focus' && now >= pomo.endsAt) finishFocus();
  else if (pomo.mode === 'break' && now >= pomo.endsAt) finishBreak();
}, 1000);

async function finishFocus() {
  const S = pomoSettings(config), now = Date.now(), id = pomo.todoId;
  const patch = todoPatchPause(id, now);
  patch[`${id}/pomos`] = (Number(myTodosAll[id]?.pomos) || 0) + 1;
  update(ref(db, `todos/${myUid}`), patch);
  runTransaction(ref(db, `rewards/${myUid}/${monthKey(now)}`), (n) => (Number(n) || 0) + 1);
  const cycle = (pomo.cycle || 0) + 1, long = cycle % S.every === 0;
  pomo = { mode: 'break', todoId: id, endsAt: now + (long ? S.long : S.short) * 60000, cycle, long };
  savePomo(); // 로컬 config + presence.pomo(서버 시각으로 변환)
}
```

```js
// main.js — 자리 비움: 5초마다 유휴 시간 확인(180초), 잠금·절전은 즉시
setInterval(() => {
  const idle = powerMonitor.getSystemIdleTime();
  if (!away && idle >= 180) goAway(idle);            // lastActive = now - idle*1000
  else if (away && !locked && idle < 5) { away = false; sendPet('idle:back'); }
}, 5000);
powerMonitor.on('lock-screen', lockOn); powerMonitor.on('suspend', lockOn);
```

**글자수 계산**: [사실] 이 프로젝트에는 해당 코드가 없어요(6장 참고).

---

## 부록 A. Firebase Realtime Database 규칙 (0.5.1)

[사실] 저장소의 `firebase-rules.json` 원문이에요. 민감한 값은 들어 있지 않아요.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "newData.hasChildren(['name', 'char'])",
        "name": {
          ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 12"
        },
        "char": {
          ".validate": "newData.val() === 'black_cat' || newData.val() === 'hamster' || newData.val() === 'squirrel' || newData.val() === 'chick'"
        },
        "$other": {
          ".validate": "$other === 'color' || $other === 'mood' || $other === 'updatedAt' || ($other === 'linked' && newData.isBoolean())"
        }
      }
    },
    "claims": {
      ".read": "auth != null",
      "$char": {
        ".write": "auth != null && (!data.exists() || data.val() === auth.uid) && (!newData.exists() || newData.val() === auth.uid)",
        ".validate": "$char === 'black_cat' || $char === 'hamster' || $char === 'squirrel' || $char === 'chick'"
      }
    },
    "presence": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "todos": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid",
        "$todoId": {
          ".validate": "newData.hasChildren(['text', 'done', 'createdAt'])",
          "text": {
            ".validate": "newData.isString() && newData.val().length <= 60"
          },
          "done": {
            ".validate": "newData.isBoolean()"
          },
          "createdAt": {
            ".validate": "newData.isNumber()"
          },
          "cheers": {
            "$cheerer": {
              ".write": "auth != null && auth.uid === $cheerer && auth.uid !== $uid && !data.exists()",
              ".validate": "newData.isNumber()"
            }
          }
        }
      }
    },
    "inbox": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        "$eventId": {
          ".write": "auth != null && ((!data.exists() && newData.child('from').val() === auth.uid) || (auth.uid === $uid && !newData.exists()))",
          ".validate": "!newData.exists() || (newData.hasChildren(['type', 'from', 'ts']) && newData.child('type').isString() && newData.child('type').val().length <= 20)"
        }
      }
    },
    "rewards": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid",
        "$month": {
          ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100000"
        }
      }
    },
    "winners": {
      ".read": "auth != null",
      "$month": {
        ".write": "auth != null && !data.exists()",
        ".validate": "newData.hasChildren(['uid', 'ts'])",
        "gift": {
          ".write": "auth != null && data.parent().child('uid').val() === auth.uid && !data.exists()",
          ".validate": "newData.isString() && newData.val().length <= 30"
        }
      }
    },
    "gifts": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "mail": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        "$mailId": {
          ".write": "auth != null && ((!data.exists() && newData.child('from').val() === auth.uid) || auth.uid === $uid)",
          ".validate": "!newData.exists() || (newData.hasChildren(['type', 'from', 'ts']) && newData.child('type').isString() && newData.child('type').val().length <= 20)"
        }
      }
    },
    "active": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "newData.hasChildren(['device', 'ts']) && newData.child('device').isString() && newData.child('device').val().length <= 64"
      }
    },
    "prefs": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

## 부록 B. Firebase 클라이언트 설정 형식

```js
const firebaseConfig = {
  apiKey: '[삭제됨]',
  authDomain: '[삭제됨]',
  databaseURL: '[삭제됨]',
  projectId: '[삭제됨]',
  storageBucket: '[삭제됨]',
  messagingSenderId: '[삭제됨]',
  appId: '[삭제됨]',
};
```

---

## 확실한 것

- 이 프로그램의 구성은 Electron 38.8.6 + Firebase JS SDK 11.10.0(Realtime Database, 익명·이메일 인증) + esbuild 0.28.2 + electron-builder 26.18.0이고, Windows x64 zip으로 배포해요.
- 서버 코드 없이 클라이언트끼리 RTDB의 presence(상태)와 inbox(신호) 두 패턴으로 동기화해요.
- 4개 캐릭터 = 최대 4명이고, `claims` 트랜잭션으로 캐릭터 중복을 막아요.
- 제한값
  - 할 일: 하루 5개, 60자
  - 기분 30자, 확성기 40자·15초, 던지기 3초
  - 축하: 할 일당 1인 1회
  - 우편함 20개, 할 일 보관 15일
  - 자리 비움: 3분
  - 뽀모도로 기본값: 25/5/15/4회
- 보상은 뽀모도로 집중 1회 완료당 1개이고, 월 1등(동점 시 무작위)이 선물상자를 받아요. 선물 확률은 10/30/30/30이에요.
- 여러 PC는 비밀번호 연결 후 "마지막에 켠 PC 우선"으로 처리하고, 자주 쓰는 할 일과 뽀모도로 시간만 공유해요.
- 한글(HWP) 연동과 글자수 계산 기능은 이 프로젝트에 없어요.

## 확인 필요

- 할 일 하나가 사라진 현상의 실제 원인(재현 정보 필요)
- presence 자기 복구(0.5.1)가 "친구 화면에서 내 캐릭터가 사라짐"을 실제로 해결하는지
- 0.4.0 이후 기능 전체의 실제 Firebase 동작(보상, 랭킹, 선물상자, 우편함, 비밀번호 연결, 여러 PC 전환)
- Windows에서 유휴 감지, 화면 잠금, 절전 감지의 실제 동작
- 로컬 설정 폴더의 정확한 이름(`%APPDATA%\TodoRoom` 여부)
- 로그인 정보가 저장되는 정확한 위치(Firebase 기본 IndexedDB로 추정)
- `focus_badge.png`의 최종 의미
- 빌드에 필요한 최소 Node 버전
- Cloud Functions 사용 시 요금제 조건(다시 만들 때 Firebase 공식 문서로 확인)
