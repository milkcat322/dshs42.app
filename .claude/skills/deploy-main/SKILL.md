---
name: deploy-main
description: 메인 웹(dshs42.app) 배포 — beta 에서 확인을 마친 origin/main 을 메인 웹 저장소(prod 원격, milkcat322/dshs42.app)에 push 한다. 사용자가 "메인 웹에 업로드", "메인에 올려줘", "dshs42.app 에 반영", "메인 배포" 라고 할 때만 사용한다. 평소 개발 push(Check Push)에는 쓰지 않는다.
---

# 메인 웹 배포

개발은 지금처럼 beta 저장소(`origin`, milkcat322/dshs-study → `dshs42-beta.netlify.app`)에서 한다.
메인 웹 저장소(`prod`, milkcat322/dshs42.app → `dshs42.app`)에는 **사용자가 요청할 때만**, beta 에 올라가 확인을 마친 그대로를 올린다.

## 1. prod 원격 준비

```
git remote get-url prod
```

없으면 추가한다 (원격 설정은 PC 마다 따로라 팀원 PC 에는 없을 수 있다):

```
git remote add prod https://github.com/milkcat322/dshs42.app.git
```

## 2. beta 와 맞추기

1. 아직 올리지 않은 변경이 있으면 먼저 Check Push 로 beta(`origin`)에 올린다. 메인에는 beta 에 없는 커밋을 올리지 않는다.
2. `git fetch origin` 과 `git fetch prod`
3. 이번에 메인에 새로 들어갈 커밋을 사용자에게 짧게 보여 준다:
   `git log --oneline prod/main..origin/main` (prod 가 비어 있으면 첫 배포라고 알린다)
4. 메인에서만 생긴 커밋이 있는지 확인한다: `git log --oneline origin/main..prod/main`
   있으면 push 하지 말고 사용자에게 묻는다 (메인 저장소를 직접 고친 경우).

## 3. Push

```
git push prod origin/main:refs/heads/main
```

로컬 작업 중인 HEAD 가 아니라 **beta 에 올라간 `origin/main`** 을 그대로 올린다. 강제 push(`--force`)는 사용자가 명시적으로 요청할 때만 한다.

## 4. 알리기

올린 커밋 범위와 `sw.js` 의 `CACHE` 버전을 알리고, Netlify 가 `dshs42.app` 에 배포하면 `https://dshs42.app/sw.js` 의 버전으로 반영을 확인할 수 있다고 안내한다.
