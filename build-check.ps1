$log = "$env:TEMP\clide-build-check-$(Get-Date -Format yyyyMMddHHmmss).log"

Write-Output "=== RUNNING BUILD ==="
npm run build 2>&1 | Out-String -Stream | Tee-Object -Variable buildOut | Select-Object -Last 40

$v = $buildOut | Select-String -Pattern "^BUILD-EXIT:(\d+)$"
If ($v) { Write-Output "BUILD-EXIT:$($v.Matches.Groups[1].Value)" }
Else { Write-Output "NO-BUILD-EXIT-LINE" }