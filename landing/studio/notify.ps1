param([string]$TitleB64, [string]$MessageB64, [string]$UrlB64 = "")

# UTF-8 args via base64 — omija ANSI code page Windowsa (CP1250).
$Title   = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TitleB64))
$Message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($MessageB64))
$Url     = if ($UrlB64) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($UrlB64)) } else { "http://localhost:4000" }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Size = New-Object System.Drawing.Size(520, 380)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(26, 31, 43)
$form.ForeColor = [System.Drawing.Color]::White
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false; $form.MinimizeBox = $false

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = $Title
$lbl.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$lbl.ForeColor = [System.Drawing.Color]::FromArgb(46, 204, 113)
$lbl.Location = New-Object System.Drawing.Point(20, 18)
$lbl.Size = New-Object System.Drawing.Size(470, 28)
$form.Controls.Add($lbl)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.ReadOnly = $true; $box.ScrollBars = 'Vertical'
$box.Text = $Message
$box.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$box.BackColor = [System.Drawing.Color]::FromArgb(34, 40, 54)
$box.ForeColor = [System.Drawing.Color]::White
$box.BorderStyle = 'None'
$box.Location = New-Object System.Drawing.Point(20, 54)
$box.Size = New-Object System.Drawing.Size(470, 230)
$form.Controls.Add($box)

$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Text = 'Otwórz SEO Coach'
$btnOpen.Size = New-Object System.Drawing.Size(190, 38)
$btnOpen.Location = New-Object System.Drawing.Point(20, 296)
$btnOpen.BackColor = [System.Drawing.Color]::FromArgb(46, 204, 113)
$btnOpen.ForeColor = [System.Drawing.Color]::Black
$btnOpen.FlatStyle = 'Flat'
$btnOpen.Add_Click({ Start-Process $Url; $form.Close() })
$form.Controls.Add($btnOpen)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Zamknij'
$btnClose.Size = New-Object System.Drawing.Size(120, 38)
$btnClose.Location = New-Object System.Drawing.Point(370, 296)
$btnClose.BackColor = [System.Drawing.Color]::FromArgb(60, 66, 82)
$btnClose.ForeColor = [System.Drawing.Color]::White
$btnClose.FlatStyle = 'Flat'
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

[void]$form.ShowDialog()
