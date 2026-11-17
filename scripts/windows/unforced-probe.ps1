param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$Out,
  [double[]]$Offsets = @(0.5, 1, 1.5, 2, 2.5),
  [int]$Repeats = 3,
  [int]$PlainCloses = 3,
  [int]$HistoryPages = 150000,
  [int]$OpenTabs = 30,
  [int]$WatchSeconds = 30,
  [int]$SettleSeconds = 10
)

$ErrorActionPreference = "Stop"

Add-Type -Namespace UnforcedProbe -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr window, System.Text.StringBuilder name, int size);
[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr window, IntPtr state);
public static System.Collections.Generic.List<string> AppWindows() {
  var found = new System.Collections.Generic.List<string>();
  EnumWindows((window, state) => {
    if (!IsWindowVisible(window)) return true;
    var name = new System.Text.StringBuilder(128); GetClassNameW(window, name, 128);
    if (name.ToString() != "Microsoft.UI.Windowing.Window") return true;
    uint owner; GetWindowThreadProcessId(window, out owner);
    found.Add(window.ToInt64().ToString() + ":" + owner.ToString());
    return true;
  }, IntPtr.Zero);
  return found;
}
'@

$entry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{47A92F18-32B0-4548-A1EF-72C217FE1836}_is1"
$folder = Join-Path $env:LOCALAPPDATA "Programs\Ardia"
$exe = Join-Path $folder "Ardia.exe"
$marker = Join-Path $folder "Ardia.test-build"
$port = 9463
$Out = [IO.Path]::GetFullPath($Out)
$work = Join-Path (Split-Path -Parent $Out) "unforced-probe-work"
$data = Join-Path $work "data"
$source = Join-Path $work "source"
$syncFolder = Join-Path $work "sync-folder"
$pages = Join-Path $work "pages"
$plainRows = New-Object System.Collections.Generic.List[object]
$rows = New-Object System.Collections.Generic.List[object]
$details = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function Note([string]$line) {
  Write-Host "unforced-probe: $line"
  $script:notes.Add($line)
}

function Browsers { return @(Get-CimInstance Win32_Process -Filter "Name='Ardia.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '(^|\s)"?--type=' }) }

function Visible-Windows {
  $found = @()
  foreach ($item in [UnforcedProbe.Native]::AppWindows()) {
    $parts = $item.Split(":")
    $found += [pscustomobject]@{ Hwnd = [long]$parts[0]; Pid = [int]$parts[1] }
  }
  return $found
}

function Close-All([string]$what) {
  foreach ($round in 1..3) {
    $browsers = @(Browsers)
    if (-not $browsers.Count) { return }
    $ids = @($browsers | ForEach-Object { [int]$_.ProcessId })
    foreach ($window in @(Visible-Windows | Where-Object { $ids -contains $_.Pid })) {
      [UnforcedProbe.Native]::PostMessageW([IntPtr]$window.Hwnd, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
    }
    $deadline = (Get-Date).AddSeconds(60)
    while (@(Browsers).Count -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  }
  $left = @(Browsers)
  if ($left.Count) {
    Note "$what`: $($left.Count) Ardia still running after closing its windows three times; stopped"
    foreach ($browser in $left) { Stop-Process -Id $browser.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }
}

function Log-Lines([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  return @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)
}

function Wait-LogLine([string]$path, [string]$pattern, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $found = @(Log-Lines $path | Where-Object { $_ -match $pattern })
    if ($found.Count) { return $found[0] }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Start-Old([string]$log, [string[]]$extra = @()) {
  $process = Start-Process -FilePath $exe -ArgumentList (@("--log-file=$log") + $extra) -PassThru
  $null = $process.Handle
  $deadline = (Get-Date).AddSeconds(180)
  $window = $null
  while (-not $window -and (Get-Date) -lt $deadline) {
    $window = @(Visible-Windows | Where-Object { $_.Pid -eq $process.Id }) | Select-Object -First 1
    if (-not $window) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $window) { throw "Ardia ($($process.Id)) showed no window within 180 s" }
  return [pscustomobject]@{ Process = $process; Window = $window }
}

function Page-Count {
  try { return @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2 | Where-Object { $_.type -eq "page" }).Count } catch { return -1 }
}

function Link-Opened([string]$name) {
  try {
    $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1)
    return [bool](@($targets | Where-Object { $_.url -like "*$name.html" }).Count)
  } catch {
    return $false
  }
}

function Stamp([string[]]$lines, [string]$pattern) {
  $line = @($lines | Where-Object { $_ -match $pattern } | Select-Object -First 1)
  if ($line.Count -and $line[0] -match '^\S+ (\d+) ') { return [int]$Matches[1] }
  return $null
}

function Quit-Timings([string]$log) {
  $lines = @(Log-Lines $log)
  $closed = Stamp $lines '^window \d+ closed '
  $arrived = Stamp $lines 'test: willQuit arrived'
  $answeredLine = @($lines | Where-Object { $_ -match 'test: willQuit answered after (\d+) ms' } | Select-Object -Last 1)
  $answered = if ($answeredLine.Count -and $answeredLine[0] -match 'answered after (\d+) ms') { [int]$Matches[1] } else { $null }
  $quitting = Stamp $lines '^launch \d+ quitting$'
  $asking = Stamp $lines 'asking the engine to quit'
  $written = @($lines | Where-Object { $_ -match 'telemetry and documents written in (\d+) ms' } | Select-Object -Last 1)
  $flush = if ($written.Count -and $written[0] -match 'written in (\d+) ms') { [int]$Matches[1] } else { $null }
  $ending = Stamp $lines 'process ending'
  return [pscustomobject]@{
    Closed = $closed; Arrived = $arrived; AnsweredAfter = $answered; Quitting = $quitting; Asking = $asking; Flush = $flush; Ending = $ending
    Wait = if ($null -ne $arrived -and $null -ne $quitting) { $quitting - $arrived } else { $null }
    QuitToEnd = if ($null -ne $arrived -and $null -ne $ending) { $ending - $arrived } else { $null }
  }
}

function Format-Ms($value) { if ($null -eq $value) { return "-" } return "$value" }

function Profile-Size([string]$what) {
  $documents = @(Get-ChildItem -LiteralPath $data -File -ErrorAction SilentlyContinue)
  $documentBytes = ($documents | Measure-Object -Property Length -Sum).Sum
  $largest = @($documents | Sort-Object Length -Descending | Select-Object -First 8 | ForEach-Object { "$($_.Name) $($_.Length)" })
  $syncFiles = @(Get-ChildItem -LiteralPath $syncFolder -Recurse -File -ErrorAction SilentlyContinue)
  $syncBytes = ($syncFiles | Measure-Object -Property Length -Sum).Sum
  $history = Get-Item -LiteralPath (Join-Path $data "Chromium\Default\History") -ErrorAction SilentlyContinue
  Note "$what`: documents folder $($documents.Count) files, $documentBytes bytes (largest: $($largest -join ', ')); sync folder $($syncFiles.Count) files, $syncBytes bytes; the app's Chromium History $(if ($history) { $history.Length } else { 'missing' }) bytes"
}

function Plain-Close([int]$index) {
  $log = Join-Path $Out "plain-$index.log"
  Close-All "before plain close $index"
  $old = Start-Old $log
  Start-Sleep -Seconds $SettleSeconds
  $tabs = Page-Count
  $clock = [Diagnostics.Stopwatch]::StartNew()
  [UnforcedProbe.Native]::PostMessageW([IntPtr]$old.Window.Hwnd, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
  $exited = $old.Process.WaitForExit(90000)
  $exitMs = [int]$clock.ElapsedMilliseconds
  $t = Quit-Timings $log
  $script:plainRows.Add([pscustomobject]@{
      Index = $index; Tabs = $tabs; Arrived = if ($null -ne $t.Arrived -and $null -ne $t.Closed) { $t.Arrived - $t.Closed } else { $null }
      AnsweredAfter = $t.AnsweredAfter; Wait = $t.Wait; Flush = $t.Flush; QuitToEnd = $t.QuitToEnd
      Exit = if ($exited) { "$exitMs ms, code $($old.Process.ExitCode)" } else { "still running after 90 s" }
    })
  $script:details.Add("### plain close $index")
  $script:details.Add('```')
  foreach ($line in @(Log-Lines $log | Where-Object { $_ -match '(?i)closed|willQuit|quitting|asking the engine|telemetry and documents|process ending|\[sync\]|staged profile|error' })) { $script:details.Add($line) }
  $script:details.Add('```')
  Write-Host "unforced-probe plain $index`: tabs=$tabs answered after $(Format-Ms $t.AnsweredAfter) ms, wait $(Format-Ms $t.Wait) ms, flush $(Format-Ms $t.Flush) ms, quit to end $(Format-Ms $t.QuitToEnd) ms"
  Close-All "after plain close $index"
}

function Relaunch-Round([double]$offset, [int]$repeat) {
  $name = "o$offset-r$repeat"
  $oldLog = Join-Path $Out "$name-old.log"
  $newLog = Join-Path $Out "$name-new.log"
  $page = Join-Path $pages "$name.html"
  Set-Content -LiteralPath $page -Value "<!doctype html><meta charset=utf-8><title>$name</title><p>$name</p>" -Encoding utf8NoBOM
  $link = ([Uri]$page).AbsoluteUri
  Close-All "before $name"
  $old = Start-Old $oldLog
  Start-Sleep -Seconds $SettleSeconds
  $clock = [Diagnostics.Stopwatch]::StartNew()
  [UnforcedProbe.Native]::PostMessageW([IntPtr]$old.Window.Hwnd, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
  $launchAt = [int]($offset * 1000)
  while ($clock.ElapsedMilliseconds -lt $launchAt) { Start-Sleep -Milliseconds 5 }
  $new = Start-Process -FilePath $exe -ArgumentList @("--log-file=$newLog", $link) -PassThru
  $null = $new.Handle
  $launchMs = [int]$clock.ElapsedMilliseconds

  $appearances = New-Object System.Collections.Generic.List[object]
  $open = @{}
  $tracked = @{ ([int]$old.Process.Id) = "old"; ([int]$new.Id) = "new" }
  $oldExitMs = $null
  $newExitMs = $null
  $linkMs = $null
  $nextScan = 0
  $nextLink = 0
  $endMs = $launchMs + $WatchSeconds * 1000
  while ($clock.ElapsedMilliseconds -lt $endMs) {
    $now = [int]$clock.ElapsedMilliseconds
    if ($now -ge $nextScan) {
      foreach ($browser in @(Browsers)) { if (-not $tracked.ContainsKey([int]$browser.ProcessId)) { $tracked[[int]$browser.ProcessId] = "other" } }
      $nextScan = $now + 500
    }
    $seen = @{}
    foreach ($window in @(Visible-Windows)) {
      if (-not $tracked.ContainsKey($window.Pid)) { continue }
      $seen[$window.Hwnd] = $true
      if (-not $open.ContainsKey($window.Hwnd)) {
        $appearance = [pscustomobject]@{ Hwnd = $window.Hwnd; Pid = $window.Pid; Role = $tracked[$window.Pid]; FromMs = $now; ToMs = $null }
        $open[$window.Hwnd] = $appearance
        $appearances.Add($appearance)
      }
    }
    foreach ($hwnd in @($open.Keys)) {
      if (-not $seen.ContainsKey($hwnd)) { $open[$hwnd].ToMs = $now; $open.Remove($hwnd) }
    }
    if ($null -eq $oldExitMs -and $old.Process.HasExited) { $oldExitMs = $now }
    if ($null -eq $newExitMs -and $new.HasExited) { $newExitMs = $now }
    if ($null -eq $linkMs -and $now -ge $nextLink) {
      if (Link-Opened $name) { $linkMs = $now }
      $nextLink = $now + 500
    }
    Start-Sleep -Milliseconds 50
  }

  $endBrowsers = @(Browsers)
  $endIds = @($endBrowsers | ForEach-Object { [int]$_.ProcessId })
  $endWindowed = @(Visible-Windows | Where-Object { $endIds -contains $_.Pid } | ForEach-Object Pid | Select-Object -Unique)
  $oldCode = if ($old.Process.HasExited) { $old.Process.ExitCode } else { $null }
  $newCode = if ($new.HasExited) { $new.ExitCode } else { $null }
  $afterLaunch = @($appearances | Where-Object { $_.FromMs -ge $launchMs })
  $vanished = @($afterLaunch | Where-Object { $null -ne $_.ToMs })
  $windowText = if ($afterLaunch.Count) {
    ($afterLaunch | ForEach-Object {
        $life = if ($null -eq $_.ToMs) { "survived" } else { "gone after $($_.ToMs - $_.FromMs) ms" }
        "$($_.Role) $($_.Pid) at +$($_.FromMs - $launchMs) ms, $life"
      }) -join "; "
  } else { "none" }
  $t = Quit-Timings $oldLog
  $row = [pscustomobject]@{
    Offset = $offset; Repeat = $repeat; LaunchMs = $launchMs; Windows = $windowText; Vanished = $vanished.Count
    Old = if ($null -ne $oldExitMs) { "+$($oldExitMs - $launchMs) ms, code $oldCode" } else { "running" }
    New = if ($null -ne $newExitMs) { "+$($newExitMs - $launchMs) ms, code $newCode" } else { "running" }
    Link = if ($null -ne $linkMs) { "+$($linkMs - $launchMs) ms" } else { "no" }
    End = if ($endWindowed.Count -eq 1 -and $endBrowsers.Count -eq 1) { "yes" } elseif ($endBrowsers.Count -eq 0) { "NO: nothing running" } else { "NO: $($endBrowsers.Count) running, $($endWindowed.Count) with a window" }
    Wait = $t.Wait; AnsweredAfter = $t.AnsweredAfter
    Arrived = if ($null -ne $t.Arrived -and $null -ne $t.Closed) { $t.Arrived - $t.Closed } else { $null }
    NewLogged = (Log-Lines $newLog).Count
  }
  $script:rows.Add($row)
  $pattern = '(?i)quitting|relaunch|reopen|process ending|start failed|error|fatal|opened|closed|willQuit|launch links|asking the engine|telemetry and documents|\[sync\]'
  $script:details.Add("### $name")
  $script:details.Add("")
  $script:details.Add("- close posted at 0 ms; the new launch at $launchMs ms (old pid $($old.Process.Id), new pid $($new.Id))")
  foreach ($appearance in $appearances) { $script:details.Add("- window $($appearance.Hwnd) of $($appearance.Role) $($appearance.Pid): shown $($appearance.FromMs) ms, hidden $(Format-Ms $appearance.ToMs) ms") }
  $script:details.Add("- old exit $($row.Old); new exit $($row.New); link $($row.Link); end: $($row.End)")
  $script:details.Add("old log:")
  $script:details.Add('```')
  foreach ($line in @(Log-Lines $oldLog | Where-Object { $_ -match $pattern })) { $script:details.Add($line) }
  $script:details.Add('```')
  $script:details.Add("new log ($($row.NewLogged) lines):")
  $script:details.Add('```')
  foreach ($line in @(Log-Lines $newLog | Where-Object { $_ -match $pattern })) { $script:details.Add($line) }
  $script:details.Add('```')
  $script:details.Add("")
  Write-Host "unforced-probe $name`: windows=$windowText old=$($row.Old) new=$($row.New) link=$($row.Link) end=$($row.End) wait=$(Format-Ms $t.Wait)"
  Close-All "after $name"
}

if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "'$Setup' does not exist" }
if ((Test-Path -LiteralPath $entry) -or (Test-Path -LiteralPath $folder)) { throw "Ardia is already installed for this user" }
$install = Start-Process -FilePath (Resolve-Path -LiteralPath $Setup).Path -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "the installer exited with $($install.ExitCode)" }
Note "installed $Setup ($((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion))"

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
foreach ($made in @($data, $syncFolder, $pages)) { New-Item -ItemType Directory -Force -Path $made | Out-Null }
$historyFile = Join-Path $source "Local\Google\Chrome\User Data\Default\History"
$generated = & python (Join-Path $PSScriptRoot "unforced-history.py") $historyFile $HistoryPages 80
if ($LASTEXITCODE -ne 0) { throw "the history generator failed" }
Note "source profile: $generated"
Set-Content -LiteralPath (Join-Path $data "onboarding.json") -Value '{"completedAt":1700000000000,"version":1}' -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $data "config.json") -Value '{"settings":{"openLinksInLittleArdia":false}}' -Encoding utf8NoBOM
$tabLinks = @(1..$OpenTabs | ForEach-Object {
    $tab = Join-Path $pages "tab-$_.html"
    Set-Content -LiteralPath $tab -Value "<!doctype html><meta charset=utf-8><title>tab $_</title><p>open tab $_</p>" -Encoding utf8NoBOM
    ([Uri]$tab).AbsoluteUri
  })
Set-Content -LiteralPath $marker -Value "unforced-probe" -Encoding ascii
$env:ARDIA_BACKGROUND = "1"
$env:ARDIA_DATA_DIR = $data
$env:ARDIA_REMOTE_DEBUGGING_PORT = "$port"

try {
  $env:ARDIA_TEST = "stageProfile=$syncFolder"
  $env:ARDIA_INSTANCE = "importSourceDir=$source"
  $stageLog = Join-Path $Out "stage.log"
  $staging = [Diagnostics.Stopwatch]::StartNew()
  $stager = Start-Old $stageLog $tabLinks
  $done = Wait-LogLine $stageLog 'staged profile: (synced in|failed|history never loaded|no browser)' 1200
  Note "staging took $([int]$staging.Elapsed.TotalSeconds) s: $(@(Log-Lines $stageLog | Where-Object { $_ -match 'staged profile' }) -join ' | ')"
  if (-not $done) { Note "staging never said it finished" }
  Note "open pages while staging: $(Page-Count)"
  Start-Sleep -Seconds $SettleSeconds
  Close-All "after staging"
  $env:ARDIA_TEST = ""
  $env:ARDIA_INSTANCE = ""
  Profile-Size "the staged profile"

  foreach ($index in 1..$PlainCloses) {
    try { Plain-Close $index } catch { Note "plain close $index failed in the probe: $($_.Exception.Message)"; Close-All "after a probe error" }
  }
  foreach ($offset in $Offsets) {
    foreach ($repeat in 1..$Repeats) {
      try { Relaunch-Round $offset $repeat } catch { Note "offset $offset round $repeat failed in the probe: $($_.Exception.Message)"; Close-All "after a probe error" }
    }
  }
  Profile-Size "the profile at the end"
  $gate = @(Log-Lines (Join-Path $Out "plain-1.log") | Where-Object { $_ -match 'test gate:' } | Select-Object -First 1)
  Note "test gate in plain close 1: $(if ($gate.Count) { $gate[0] } else { 'no line' })"
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = (Get-Date).AddHours(-3) } -ErrorAction SilentlyContinue |
      Where-Object { $_.ProviderName -in @("Application Error", "Windows Error Reporting") -and $_.Message -match "Ardia\.exe" })
  Note "Application log Ardia crash events: $($events.Count)"
} finally {
  Close-All "at the end"
  Get-Process -Name Ardia -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  $report = New-Object System.Collections.Generic.List[string]
  $report.Add("## Unforced relaunch probe on nightly.3 (Sync on, $HistoryPages imported history pages, $OpenTabs tabs)")
  $report.Add("")
  foreach ($line in $notes) { $report.Add("- $line") }
  $report.Add("")
  $report.Add("### Plain closes")
  $report.Add("")
  $report.Add("| close | open pages | willQuit after close ms | JS answered after ms | willQuit to quitting ms | flush ms | willQuit to process ending ms | process exit after close |")
  $report.Add("|---|---|---|---|---|---|---|---|")
  foreach ($row in $plainRows) { $report.Add("| $($row.Index) | $($row.Tabs) | $(Format-Ms $row.Arrived) | $(Format-Ms $row.AnsweredAfter) | $(Format-Ms $row.Wait) | $(Format-Ms $row.Flush) | $(Format-Ms $row.QuitToEnd) | $($row.Exit) |") }
  $report.Add("")
  $report.Add("### Relaunches after the close")
  $report.Add("")
  $report.Add("| offset s | round | willQuit after close ms | JS answered after ms | willQuit to quitting ms | windows after the launch | vanished | old exit (after launch) | new exit (after launch) | link opened | one Ardia with a window at end | new log lines |")
  $report.Add("|---|---|---|---|---|---|---|---|---|---|---|---|")
  foreach ($row in $rows) {
    $report.Add("| $($row.Offset) | $($row.Repeat) | $(Format-Ms $row.Arrived) | $(Format-Ms $row.AnsweredAfter) | $(Format-Ms $row.Wait) | $($row.Windows -replace '\|', '/') | $($row.Vanished) | $($row.Old) | $($row.New) | $($row.Link) | $($row.End) | $($row.NewLogged) |")
  }
  $report.Add("")
  foreach ($line in $details) { $report.Add($line) }
  $report | Set-Content -LiteralPath (Join-Path $Out "unforced-probe.md")
  if ($env:GITHUB_STEP_SUMMARY) { $report | Select-Object -First ($rows.Count + $plainRows.Count + 30) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY }
}
