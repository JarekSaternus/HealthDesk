# GitHub Releases — setup instrukcja

## 1. Zainstaluj gh CLI
```
winget install GitHub.cli
```
Restart terminala po instalacji.

## 2. Zaloguj sie
```
gh auth login
```
Wybierz: GitHub.com -> HTTPS -> Browser login

## 3. Stworz repo
```
cd C:\Users\jarek\projekt\zegar-cwieczenia
gh repo create healthdesk --public --source=. --remote=origin --push
```

Albo prywatne (releases nadal publiczne):
```
gh repo create healthdesk --private --source=. --remote=origin --push
```

## 4. Stworz release z exe
```
gh release create v1.0.0 "Output/HealthDesk_Setup.exe" --title "HealthDesk v1.0.0" --notes "Pierwsza wersja HealthDesk - aplikacji do zdrowej pracy przy komputerze."
```

## 5. Pobierz link do release
```
gh release view v1.0.0 --json assets -q ".assets[0].url"
```

Link bedzie w formacie:
`https://github.com/TWOJ_USER/healthdesk/releases/download/v1.0.0/HealthDesk_Setup.exe`

## 6. Zaktualizuj landing page
Zamien `href="HealthDesk_Setup.exe"` na link z GitHub Releases w index.html.

## Dlaczego GitHub Releases?
- Chrome/Edge nie blokuje pobierania z github.com
- Automatyczny CDN (szybkie pobrania na calym swiecie)
- Wersjonowanie — latwo wydawac aktualizacje
- Zaufana domena — uzytkownicy czuja sie bezpieczniej
