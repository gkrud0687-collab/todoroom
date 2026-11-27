# 꼬물이 마을 (TodoRoom)

친구 4명이 같이 쓰는 윈도우용 데스크톱 펫 투두 앱 (Electron + Firebase).

- 설치: [Releases](../../releases/latest)에서 `TodoRoom-Setup-버전.exe`를 받아 실행. 한 번 깔면 다음부터는 자동 업데이트.
- 새 버전 내기: `package.json`의 `version`을 올려서 `main`에 올리면, GitHub Actions가 윈도우에서 빌드하고 Release를 만든다 (`.github/workflows/release.yml`).
- 키: `src/firebase-config.js`는 저장소에 없다. 빌드 때 Secrets의 `FIREBASE_CONFIG_JS`로 만든다. 로컬에서는 `src/firebase-config.example.js`를 복사해서 값을 넣는다.
- 자세한 내용: `빌드와_업데이트_안내.md`, `TodoRoom_재구현_명세서.md`(0.5.1 기준이라 오래됨 — 코드가 우선)
