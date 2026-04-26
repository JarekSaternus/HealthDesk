param([string]$TitleB64, [string]$MessageB64)

# UTF-8 args via base64 — omija problem ANSI code page Windowsa (CP1250)
# który psuł polskie znaki przy execFile('powershell', [...args]) z Node.
$Title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TitleB64))
$Message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($MessageB64))

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName PresentationFramework

# MessageBox (always on top, centered)
[System.Windows.MessageBox]::Show($Message, $Title, 'OK', 'Information') | Out-Null
