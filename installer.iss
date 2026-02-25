; Inno Setup script for HealthDesk installer
; Requires: Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
; Build first: python build.py
; Then: iscc installer.iss

#define MyAppName "HealthDesk"
#define MyAppVersion "1.2.4"
#define MyAppPublisher "HealthDesk"
#define MyAppExeName "HealthDesk.exe"

[Setup]
AppId={{A7E3F2D1-8B4C-4D5E-9F6A-1B2C3D4E5F6A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=Output
OutputBaseFilename=HealthDesk_Setup_{#MyAppVersion}
SetupIconFile=assets\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile=LICENSE_TERMS.rtf
PrivilegesRequired=lowest
AppUpdatesURL=https://github.com/JarekSaternus/HealthDesk/releases
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "Uruchamiaj automatycznie z Windows"; GroupDescription: "Dodatkowe opcje:"

[Files]
Source: "dist\HealthDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Odinstaluj {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Uruchom {#MyAppName}"; Flags: nowait postinstall
