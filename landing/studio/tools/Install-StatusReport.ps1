# Instaluje launcher statusu blog studio w folderze Autostart biezacego uzytkownika.
# Przy kazdym zalogowaniu uruchamia status-watch.js, ktory pokazuje popup ze statusem
# ~2 min i ~2 h po starcie. NIE wymaga uprawnien administratora (folder Autostart usera).
# Tymczasowe: gdy autopilot bedzie stabilny, odpal Uninstall-StatusReport.ps1.

$ErrorActionPreference = 'Stop'

$watch = Join-Path $PSScriptRoot 'status-watch.js'
$report = Join-Path $PSScriptRoot 'status-report.js'
if (-not (Test-Path $watch))  { throw "Brak pliku: $watch" }
if (-not (Test-Path $report)) { throw "Brak pliku: $report" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node nie jest w PATH - popraw PATH albo wpisz pelna sciezke do node.exe" }

$studioDir = Split-Path $PSScriptRoot -Parent
$startup = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startup 'HealthDesk-StatusReport.vbs'

# VBS uruchamia node ukryte (okno 0). Chr(34) = cudzyslow, by bezpiecznie objac sciezki ze spacjami.
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$studioDir"
q = Chr(34)
sh.Run q & "$node" & q & " " & q & "$watch" & q, 0, False
"@

Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII
Write-Host "Zainstalowano launcher w Autostarcie:"
Write-Host "  $vbsPath"
Write-Host ""
Write-Host "Popup ze statusem pojawi sie ~2 min i ~2 h po kazdym zalogowaniu."
$uninstall = Join-Path $PSScriptRoot 'Uninstall-StatusReport.ps1'
Write-Host "Test teraz:   node `"$report`" --popup"
Write-Host "Wylaczenie:   powershell -ExecutionPolicy Bypass -File `"$uninstall`""
