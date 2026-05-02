# ftermfetch — native PowerShell system info display for FTerm
$esc = [char]27
$C  = "${esc}[38;2;88;166;255m"
$C2 = "${esc}[38;2;149;213;255m"
$Wh = "${esc}[38;2;230;237;243m"
$G  = "${esc}[38;2;63;185;80m"
$Y  = "${esc}[38;2;255;193;7m"
$P  = "${esc}[38;2;188;140;255m"
$D  = "${esc}[38;2;110;118;129m"
$B  = "${esc}[1m"
$R  = "${esc}[0m"

try {
    $os  = Get-CimInstance Win32_OperatingSystem  -ErrorAction Stop
    $cpu = Get-CimInstance Win32_Processor        -ErrorAction Stop | Select-Object -First 1
} catch {
    Write-Host "ftermfetch: could not retrieve system information." -ForegroundColor Red
    return
}

$totalGb  = [math]::Round($os.TotalVisibleMemorySize / 1048576, 1)
$freeGb   = [math]::Round($os.FreePhysicalMemory     / 1048576, 1)
$usedGb   = [math]::Round($totalGb - $freeGb, 1)
$memPct   = [math]::Round(($usedGb / $totalGb) * 100)
$cpuModel = ($cpu.Name -replace '\(R\)|®|™|\(TM\)', '' -replace '\s+', ' ').Trim()
$cpuCores = $cpu.NumberOfLogicalProcessors
$cpuGhz   = if ($cpu.MaxClockSpeed) { "$([math]::Round($cpu.MaxClockSpeed / 1000.0, 1)) GHz" } else { '' }

$osName = $os.Caption -replace 'Microsoft ', ''
$upSec  = ([datetime]::Now - $os.LastBootUpTime).TotalSeconds
$ud = [math]::Floor($upSec / 86400)
$uh = [math]::Floor(($upSec % 86400) / 3600)
$um = [math]::Floor(($upSec % 3600)  / 60)
$upStr = if ($ud -gt 0) { "${ud}d ${uh}h ${um}m" } elseif ($uh -gt 0) { "${uh}h ${um}m" } else { "${um}m" }

$user  = $env:USERNAME
$host_ = $env:COMPUTERNAME
$cwd   = (Get-Location).Path
$w     = if ([Console]::WindowWidth -gt 10) { [Console]::WindowWidth } elseif ($env:COLUMNS -as [int] -gt 10) { [int]$env:COLUMNS } else { 80 }
$h     = if ([Console]::WindowHeight -gt 0) { [Console]::WindowHeight } elseif ($env:LINES -as [int] -gt 0) { [int]$env:LINES } else { 24 }
$tSize = "${w} x ${h}"

# Detect shell from parent process; fall back to PS version
$shell = try {
    $ppid   = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop).ParentProcessId
    $pName  = (Get-Process -Id $ppid -ErrorAction Stop).Name.ToLower()
    switch ($pName) {
        'pwsh'       { 'pwsh' }
        'powershell' { 'Windows PowerShell' }
        'cmd'        { 'cmd.exe' }
        default      { $pName }
    }
} catch {
    if ($PSVersionTable.PSVersion.Major -ge 7) { 'pwsh' } else { 'Windows PowerShell' }
}

# Value budget: info column starts at col 51 in side-by-side, so available = w-51
# Use w-16 for stacked (full width minus kv prefix)
$sideBySide = $w -ge 100
$infoBudget = if ($sideBySide) { [math]::Max(8, $w - 51) } else { [math]::Max(8, $w - 16) }

$maxCwd   = $infoBudget - 15   # subtract kv prefix length
$cwdS     = if ($cwd.Length -gt $maxCwd) { '...' + $cwd.Substring($cwd.Length - ($maxCwd - 3)) } else { $cwd }
$maxCpu   = $infoBudget - 15
$cpuModel = if ($cpuModel.Length -gt $maxCpu) { $cpuModel.Substring(0, $maxCpu - 3) + '...' } else { $cpuModel }

# Memory bar: budget minus kv prefix(15) minus "X.X / X.X GB  XX%"(~22) minus 2 spaces
$barBudget = $infoBudget - 15 - 22
$barLen    = [math]::Max(4, [math]::Min(20, $barBudget))
$filled    = [math]::Round($memPct / 100 * $barLen)
$mColor    = if ($memPct -gt 80) { $Y } else { $G }
$memBar    = "${mColor}$('█' * $filled)${D}$('░' * ($barLen - $filled))${R}"

# Separator width: span the info column width
$sepLen = [math]::Max(10, [math]::Min(40, $infoBudget))
$sep    = "${D}  $('─' * $sepLen)${R}"

function kv { param($key, $val)
    $dots = '.' * [math]::Max(2, 11 - $key.Length)
    "  ${D}>${R} ${B}${C2}${key}${R}${D}${dots}${R}${Wh}${val}${R}"
}

$rows = @(
    "  ${Wh}${B}${user}${R}${D}@${R}${Wh}${B}${host_}${R}",
    $sep,
    (kv 'OS'       $osName),
    (kv 'Shell'    $shell),
    (kv 'CPU'      $cpuModel),
    (kv 'Cores'    "${cpuCores} x ${cpuGhz}"),
    (kv 'Memory'   "${usedGb} / ${totalGb} GB  ${memBar}  ${memPct}%"),
    (kv 'Terminal' $tSize),
    (kv 'CWD'      $cwdS),
    $sep
)

# Strip ANSI codes to get true visual length of a string
function visLen { param($s) ($s -replace '\x1b\[[0-9;]*m', '').Length }

# Logo art lines — tagline printed separately so it doesn't misalign the info column
$logoArt = @(
    "${C}${B}  ███████╗████████╗███████╗██████╗ ███╗   ███╗${R}",
    "${C}${B}  ██╔════╝╚══██╔══╝██╔════╝██╔══██╗████╗ ████║${R}",
    "${C}${B}  █████╗     ██║   █████╗  ██████╔╝██╔████╔██║${R}",
    "${C}${B}  ██╔══╝     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║${R}",
    "${C}${B}  ██║        ██║   ███████╗██║  ██║██║ ╚═╝ ██║${R}",
    "${C}${B}  ╚═╝        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝${R}"
)
$logoWidth = visLen $logoArt[0]   # measure visual width from first line
$tagline   = "${C2}  ── The AI-Powered Terminal  ${P}v0.1.1  ${D}↑ ${Wh}${upStr}${R}"

[Console]::WriteLine('')

if ($sideBySide) {
    # Pad logo to rows height so every info row has a companion
    $logo = [System.Collections.ArrayList]$logoArt
    while ($logo.Count -lt $rows.Count) { [void]$logo.Add('') }

    for ($i = 0; $i -lt $rows.Count; $i++) {
        $l = $logo[$i]
        $r = $rows[$i]
        # Pad logo line to exact $logoWidth so info column is always at same position
        $pad = ' ' * [math]::Max(0, $logoWidth - (visLen $l))
        [Console]::WriteLine("${l}${pad}   ${r}")
        Start-Sleep -Milliseconds 30
    }
    [Console]::WriteLine('')
    [Console]::WriteLine($tagline)
} else {
    if ($w -ge 52) {
        foreach ($l in $logoArt) {
            [Console]::WriteLine($l)
            Start-Sleep -Milliseconds 55
        }
        [Console]::WriteLine('')
        [Console]::WriteLine($tagline)
    } else {
        [Console]::WriteLine("${C}${B}  FTerm${R}  ${C2}v0.2.0${R}")
    }
    [Console]::WriteLine('')
    foreach ($r in $rows) {
        [Console]::WriteLine($r)
        Start-Sleep -Milliseconds 30
    }
}

[Console]::WriteLine('')
