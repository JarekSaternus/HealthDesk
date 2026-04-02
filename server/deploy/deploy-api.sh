#!/usr/bin/env bash
set -euo pipefail

# HealthDesk API deploy helper
#
# Run from repo root or any directory:
#   bash server/deploy/deploy-api.sh
#
# Optional overrides:
#   VPS_HOST=api.healthdesk.site VPS_USER=claude bash server/deploy/deploy-api.sh

VPS_HOST="${VPS_HOST:-api.healthdesk.site}"
VPS_USER="${VPS_USER:-claude}"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"

REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/healthdesk-api/server}"
REMOTE_VENV_PY="${REMOTE_VENV_PY:-/opt/healthdesk-api/venv/bin/python}"
REMOTE_SERVICE="${REMOTE_SERVICE:-healthdesk-api}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-/home/claude/healthdesk-api/.env}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-/opt/backups}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

LOCAL_AUTH="${REPO_ROOT}/server/app/auth.py"
LOCAL_ADS="${REPO_ROOT}/server/app/routers/ads.py"

if [[ ! -f "${LOCAL_AUTH}" || ! -f "${LOCAL_ADS}" ]]; then
  echo "Missing local API files. Run this from the HealthDesk repo."
  exit 1
fi

echo "Deploy target: ${SSH_TARGET}"
echo "Remote app dir: ${REMOTE_APP_DIR}"
echo

echo "Uploading changed files..."
scp "${LOCAL_AUTH}" "${SSH_TARGET}:/tmp/healthdesk-auth.py"
scp "${LOCAL_ADS}" "${SSH_TARGET}:/tmp/healthdesk-ads.py"

echo "Running remote deploy steps..."
ssh "${SSH_TARGET}" bash <<EOF
set -euo pipefail

echo "Creating backup..."
sudo mkdir -p "${REMOTE_BACKUP_DIR}"
sudo tar -czf "${REMOTE_BACKUP_DIR}/healthdesk-api-\$(date +%F-%H%M%S).tar.gz" "${REMOTE_APP_DIR}"

echo "Installing updated files..."
sudo cp /tmp/healthdesk-auth.py "${REMOTE_APP_DIR}/app/auth.py"
sudo cp /tmp/healthdesk-ads.py "${REMOTE_APP_DIR}/app/routers/ads.py"
sudo chown www-data:www-data "${REMOTE_APP_DIR}/app/auth.py"
sudo chown www-data:www-data "${REMOTE_APP_DIR}/app/routers/ads.py"

echo "Checking API_SECRET_KEY in env..."
if ! grep -q '^API_SECRET_KEY=' "${REMOTE_ENV_FILE}"; then
  echo "WARNING: API_SECRET_KEY is missing in ${REMOTE_ENV_FILE}"
fi

echo "Compiling Python files..."
cd "${REMOTE_APP_DIR}"
"${REMOTE_VENV_PY}" -m compileall app

echo "Restarting service..."
sudo systemctl restart "${REMOTE_SERVICE}"

echo "Service status:"
sudo systemctl status "${REMOTE_SERVICE}" --no-pager

echo
echo "Health check:"
curl -fsS https://api.healthdesk.site/

echo
echo "Desktop ad endpoint:"
curl -fsS "https://api.healthdesk.site/api/ads/get?client_id=test&platform=desktop"
EOF

echo
echo "Deploy finished."
