# Creates a Desktop shortcut to Pine Flats VPS Access
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $here 'node_modules\electron\dist\electron.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Pine Flats VPS Access.lnk'

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)

if (Test-Path $electron) {
  $sc.TargetPath = $electron
  $sc.Arguments = "`"$here`""
  $sc.WorkingDirectory = $here
} else {
  $bat = Join-Path $here 'Start-VPS-Access.bat'
  $sc.TargetPath = $bat
  $sc.WorkingDirectory = $here
}

$sc.WindowStyle = 1
$sc.Description = 'Pine Flats VPS SSH access (desktop app)'
$sc.Save()

Write-Host "Shortcut created: $shortcutPath"
