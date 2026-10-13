param([Parameter(Mandatory=$true)][string]$OwnedAppDirectory)
$resolvedAppDirectory = [System.IO.Path]::GetFullPath($OwnedAppDirectory)
if (-not $resolvedAppDirectory.StartsWith('C:\Users\ennvoy.lin\AppData\Local\Temp\pd-portable-040-', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Not an owned portable fixture' }
$ownedExecutable = [System.IO.Path]::Combine($resolvedAppDirectory, 'Polydesk.exe')
$ownedCandidates = @(Get-CimInstance Win32_Process -Filter "Name = 'Polydesk.exe'" | Where-Object { $_.ExecutablePath -eq $ownedExecutable -and $_.CommandLine -notlike '*--type=*' })
if ($ownedCandidates.Count -ne 1) { throw 'Expected one owned main process' }
$ownedProcess = Get-Process -Id $ownedCandidates[0].ProcessId
if ($ownedProcess.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Owned main window missing' }
$ownedPid = $ownedProcess.Id
$posted = $ownedProcess.CloseMainWindow()
$ownedProcess.Dispose()
if (-not $posted) { throw 'Unable to request native close' }
@{ nativeClosePosted = $posted; ownedMainPid = $ownedPid } | ConvertTo-Json -Compress
