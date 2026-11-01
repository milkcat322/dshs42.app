---
name: check-push
description: Check Push — push 직전에 원격(git)을 확인하고, 다른 팀원의 새 커밋이 있으면 먼저 받아 합친 뒤 push 한다. 사용자가 "Check Push", "체크 푸시", "push 해줘", "올려줘" 라고 하거나, 한 작업 단위를 마쳐 변경을 팀에 올릴 때 사용한다.
---

# Check Push

dshs-study 팀의 push 방식. 여러 명이 같은 시간에 `main` 에서 작업하므로, push 직전에 원격을 확인하고 달라진 게 있으면 반영한 뒤 push 한다.

## 1. 올릴 내용 정리

1. `git status` 와 `git diff` 로 바뀐 내용을 확인한다. 이번 작업과 상관없는 변경이 섞여 있으면 사용자에게 묻는다.
2. 올리면 안 되는 것이 없는지 확인한다: service_role 키, VAPID 비밀키, 비밀번호, 테스트용 임시 파일.
3. 프론트 파일(`.js`, `index.html` 등)을 고쳤으면 `sw.js` 의 `CACHE` 버전을 올렸는지 확인한다.
4. 이번 세션에서 팀 모두가 알아야 할 규칙·주의점이 새로 생겼으면 `CLAUDE.md` 에 한 줄로 추가한다.
5. 학생에게 보이는 기능이 바뀌었으면 `updates.js` 맨 위에 업데이트 소식을 추가했는지 확인한다 (주요 변화는 `major: true`).
6. 무엇을 왜 바꿨는지 알 수 있는 한국어 메시지로 커밋한다.
7. **DEVLOG 갱신**: `node .claude/hooks/devlog-worker.mjs --mode write` 를 실행한다 (대화를 요약해 이 세션의 DEVLOG 기록을 쓰거나 고친다. 1~3분 걸리니 명령 시간 제한을 5분 이상으로). 바뀌었으면 `git add DEVLOG.md` 후 커밋한다. DEVLOG 를 손으로 쓰지 않는다 (같은 세션 기록이 두 번 생긴다). 빠뜨리면 pre-push 훅이 push 를 막고 알려 준다.

## 2. 원격 확인 (Check)

```
git fetch origin
git log --oneline HEAD..@{u}
```

- 새 커밋이 없으면 3단계로.
- 새 커밋이 있으면 사용자에게 누가 무엇을 올렸는지(`git log`, `git diff --stat HEAD...@{u}`) 짧게 알리고 `git pull --rebase --autostash` 로 받는다.
- 충돌하면 `CLAUDE.md` 의 "동시 작업과 충돌" 절차대로 **양쪽 기능을 모두 살려** 합친다. 판단이 어려운 충돌은 사용자에게 묻는다.
- 합친 뒤 확인: 충돌 표시(`<<<<<<<`, `>>>>>>>`) 검색, `node --check dshs-study.js sw.js`, `dshs-study.js` 맨 끝 `init();` 한 번.

## 3. Push

```
git push
```

- 원격에 없는 브랜치면 `git push -u origin HEAD`.
- `.claude/hooks/pre-push.mjs` 가 그사이 새 커밋을 발견해 막거나, push 가 non-fast-forward 로 거절되면 2단계부터 다시 한다.
- 강제 push(`--force`)는 사용자가 명시적으로 요청할 때만 한다.

## 4. 알리기

사용자에게 짧게 알린다: 올린 커밋, 합쳐 넣은 팀원 커밋(있었다면), 충돌을 어떻게 풀었는지. `main` 에 올렸으면 Netlify 가 자동 배포한다는 것도.
