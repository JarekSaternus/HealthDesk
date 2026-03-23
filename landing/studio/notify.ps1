param([string]$Title, [string]$Message)

# Big popup in center of screen (MessageBox) + toast in tray
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName PresentationFramework

# MessageBox (always on top, centered)
[System.Windows.MessageBox]::Show($Message, $Title, 'OK', 'Information') | Out-Null
