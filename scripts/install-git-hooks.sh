#!/usr/bin/env bash
# HealthDesk — install git pre-commit hook (Linux/macOS/Git Bash)
# Usage: bash scripts/install-git-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
SRC="$REPO_ROOT/scripts/hooks/pre-commit"
DST="$REPO_ROOT/.git/hooks/pre-commit"

if [ ! -f "$SRC" ]; then
  echo "Source hook not found: $SRC" >&2
  exit 1
fi

cp "$SRC" "$DST"
chmod +x "$DST"

echo "Installed pre-commit hook: $DST"
echo "Hook runs: npm run build -> cargo check -> gemini review -> codex security review"
echo "Gemini/Codex CLIs are optional — hook tolerates missing tools."
