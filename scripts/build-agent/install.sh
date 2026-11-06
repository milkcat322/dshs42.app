#!/bin/bash
# Claude 제작 맡기기를 이 맥에 설치합니다 (launchd 가 10분마다 run.mjs 를 깨움 · 승인된 작업이 있을 때만 Claude 실행).
#   bash scripts/build-agent/install.sh            설치 (다시 실행하면 새로 설치)
#   bash scripts/build-agent/install.sh uninstall  제거
# 필요한 것: 이 맥의 Claude Code 로그인, 저장소 쓰기 권한(milkcat322/dshs-study · dshs42-admin), 열쇠 파일 ~/.dshs42-build-agent.json
set -euo pipefail
LABEL="app.dshs42.build-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then rm -f "$PLIST"; echo "제거했어요"; exit 0; fi

NODE="$(command -v node)"; CLAUDE="$(command -v claude)"
[ -n "$NODE" ] && [ -n "$CLAUDE" ] || { echo "node 와 claude 가 PATH 에 있어야 해요"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/run.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$CLAUDE"):$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/dshs42-build-agent.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/dshs42-build-agent.launchd.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "설치했어요: $PLIST (기록: ~/Library/Logs/dshs42-build-agent.log)"
[ -f "$HOME/.dshs42-build-agent.json" ] || echo "주의: 열쇠 파일 ~/.dshs42-build-agent.json 이 없어요. 관리자에게 열쇠 등록을 부탁하세요 (agenttasks.sql 의 agent_keys)."
