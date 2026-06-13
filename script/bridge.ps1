#Requires -Version 5.1
param([string]$Port = "8555", [string]$Project = "Beckhoff")

$name = if ($Project -eq "Beckhoff") { "VoltBridge.Beckhoff" } else { "VoltBridge.Codesys" }
$csproj = "C:\Users\marce\OneDrive\Documenten\Github\volt\packages\volt-bridges\src\$name\$name.csproj"
$outDir = "C:\Users\marce\AppData\Local\Temp\opencode\bridge-$($Project.ToLower())"
$logDir = "C:\Users\marce\AppData\Local\Temp\opencode"

taskkill /F /IM "$name.exe" 2>$null
& "C:\Program Files\dotnet\dotnet.exe" publish $csproj -c Release -o $outDir --nologo -v q 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "BUILD FAILED"; exit 1 }
Start-Process -FilePath "$outDir\$name.exe" -WindowStyle Hidden -RedirectStandardOutput "$logDir\$($Project)-out.log" -RedirectStandardError "$logDir\$($Project)-err.log"
Start-Sleep -Seconds 3
$status = curl.exe -s http://127.0.0.1:$Port/health
if ($status -match "healthy") { Write-Output "$Project bridge UP on :$Port" } else { Write-Output "$Project bridge DOWN" }
