# HealthDesk — install git pre-commit hook (Windows/PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\Install-GitHooks.ps1

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
    Write-Error "Not inside a git repository."
    exit 1
}

$src = Join-Path $repoRoot "scripts\hooks\pre-commit"
$dst = Join-Path $repoRoot ".git\hooks\pre-commit"

if (-not (Test-Path $src)) {
    Write-Error "Source hook not found: $src"
    exit 1
}

Copy-Item -Path $src -Destination $dst -Force
Write-Host "Installed pre-commit hook: $dst" -ForegroundColor Green
Write-Host "Hook runs: npm run build -> cargo check -> gemini review -> codex security review" -ForegroundColor Cyan
Write-Host "Gemini/Codex CLIs are optional — hook tolerates missing tools." -ForegroundColor Cyan
