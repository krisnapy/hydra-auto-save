param([Parameter(Mandatory=$true)][int]$RootPid)
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process)
$selected = @($RootPid)
do {
  $previous = $selected.Count
  $selected = @(@($selected) + @($all | Where-Object { $selected -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId) | Select-Object -Unique)
} while ($selected.Count -gt $previous)
$items = @(Get-Process -Id $selected -ErrorAction SilentlyContinue)
@{
  processCount = $items.Count
  workingSetBytes = [long](($items | Measure-Object WorkingSet64 -Sum).Sum)
  privateBytes = [long](($items | Measure-Object PrivateMemorySize64 -Sum).Sum)
  processes = @($items | ForEach-Object { @{ id = $_.Id; cpuSeconds = $_.CPU } })
} | ConvertTo-Json -Depth 4 -Compress
