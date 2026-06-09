# Usuwa launcher statusu z Autostartu (gdy autopilot juz stabilny - bez wiecej popupow).
# Sprzata tez ewentualne stare zadania z Harmonogramu (gdyby zostaly z wczesniejszej wersji).
$ErrorActionPreference = 'SilentlyContinue'

$startup = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startup 'HealthDesk-StatusReport.vbs'
if (Test-Path $vbsPath) {
  Remove-Item -LiteralPath $vbsPath -Force
  Write-Host "  - usunieto launcher: $vbsPath"
} else {
  Write-Host "  (brak launchera w Autostarcie)"
}

foreach ($name in 'HealthDesk-StatusReport-Boot', 'HealthDesk-StatusReport-2h') {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "  - usunieto zadanie: $name"
  }
}
Write-Host "Gotowe - popupy statusu wylaczone."
