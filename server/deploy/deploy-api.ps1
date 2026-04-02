param(
    [string]$VpsHost = "api.healthdesk.site",
    [string]$VpsUser = "claude",
    [string]$RemoteAppDir = "/opt/healthdesk-api/server",
    [string]$RemoteVenvPy = "/opt/healthdesk-api/venv/bin/python",
    [string]$RemoteService = "healthdesk-api",
    [string]$RemoteEnvFile = "/home/claude/healthdesk-api/.env",
    [string]$RemoteBackupDir = "/opt/backups"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localAuth = Join-Path $repoRoot "server\app\auth.py"
$localAds = Join-Path $repoRoot "server\app\routers\ads.py"
$sshTarget = "$VpsUser@$VpsHost"

if (-not (Test-Path $localAuth) -or -not (Test-Path $localAds)) {
    throw "Missing local API files. Run this from the HealthDesk repo."
}

Write-Host "Deploy target: $sshTarget"
Write-Host "Remote app dir: $RemoteAppDir"
Write-Host ""

Write-Host "Uploading changed files..."
scp $localAuth "${sshTarget}:/tmp/healthdesk-auth.py"
scp $localAds "${sshTarget}:/tmp/healthdesk-ads.py"

$remoteScript = @"
set -euo pipefail

echo "Creating backup..."
sudo mkdir -p "$RemoteBackupDir"
sudo tar -czf "$RemoteBackupDir/healthdesk-api-\$(date +%F-%H%M%S).tar.gz" "$RemoteAppDir"

echo "Installing updated files..."
sudo cp /tmp/healthdesk-auth.py "$RemoteAppDir/app/auth.py"
sudo cp /tmp/healthdesk-ads.py "$RemoteAppDir/app/routers/ads.py"
sudo chown www-data:www-data "$RemoteAppDir/app/auth.py"
sudo chown www-data:www-data "$RemoteAppDir/app/routers/ads.py"

echo "Checking API_SECRET_KEY in env..."
if ! grep -q '^API_SECRET_KEY=' "$RemoteEnvFile"; then
  echo "WARNING: API_SECRET_KEY is missing in $RemoteEnvFile"
fi

echo "Compiling Python files..."
cd "$RemoteAppDir"
"$RemoteVenvPy" -m compileall app

echo "Restarting service..."
sudo systemctl restart "$RemoteService"

echo "Service status:"
sudo systemctl status "$RemoteService" --no-pager

echo
echo "Health check:"
curl -fsS https://api.healthdesk.site/

echo
echo "Desktop ad endpoint:"
curl -fsS "https://api.healthdesk.site/api/ads/get?client_id=test&platform=desktop"
"@

Write-Host "Running remote deploy steps..."
ssh $sshTarget "bash -lc '$remoteScript'"

Write-Host ""
Write-Host "Deploy finished."
