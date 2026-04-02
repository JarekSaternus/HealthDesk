# Deploy

## Landing Page

Build:
```bash
cd landing
node build.js
```

Deploy na `cyber_Folks` przez FTP:
```bash
cd landing
node deploy.js
```

Uwagi:
- upload idzie do `/public_html`
- skrypt używa `landing/deploy.js`
- po deployu strona powinna być live na `https://healthdesk.site/`

## API na VPS

### PowerShell

Uruchom z katalogu repo:
```powershell
powershell -ExecutionPolicy Bypass -File .\server\deploy\deploy-api.ps1
```

Z własnym hostem/userem:
```powershell
powershell -ExecutionPolicy Bypass -File .\server\deploy\deploy-api.ps1 -VpsHost api.healthdesk.site -VpsUser claude
```

### Bash

```bash
bash server/deploy/deploy-api.sh
```

Z własnym hostem/userem:
```bash
VPS_HOST=api.healthdesk.site VPS_USER=claude bash server/deploy/deploy-api.sh
```

## Co robi deploy API

- wrzuca `server/app/auth.py`
- wrzuca `server/app/routers/ads.py`
- robi backup `/opt/healthdesk-api/server`
- podmienia pliki na VPS
- robi `compileall`
- restartuje usługę `healthdesk-api`
- odpala szybki health check

## Założenia produkcyjne

- kod API na VPS: `/opt/healthdesk-api/server`
- venv: `/opt/healthdesk-api/venv`
- env: `/home/claude/healthdesk-api/.env`
- systemd service: `healthdesk-api`

## Wymagania

- lokalnie: `ssh` i `scp`
- dostęp SSH do VPS
- na VPS ustawiony `API_SECRET_KEY`

## Studio

Autostart Windows dla Blog Studio:
`C:\Users\jarek\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\start-studio.vbs`

Aktualnie wskazuje na:
`C:\Users\jarek\codex\healthdesk-tauri\landing\studio`
