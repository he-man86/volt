#Requires -Version 5.1
# Build + (re)launch the Beckhoff standalone bridge from the repo, attaching to a
# running TwinCAT (TcXaeShell). CODESYS is NOT launchable here: Volt.Bridge.Codesys is
# an OutputType=Library loaded in-process — use script/codesys-bridge.ps1 for it.
param([string]$Port = "8555", [string]$Project = "Beckhoff")

if ($Project -ne "Beckhoff") {
    Write-Output "bridge.ps1 only launches the Beckhoff bridge (a standalone exe). CODESYS is loaded in-proc — use script/codesys-bridge.ps1 instead."
    exit 1
}

# The project/folder/csproj name differs from the AssemblyName (= the produced exe).
$projName = "Volt.Bridge.Beckhoff"
$asmName  = "BeckhoffBridge"
$csproj = "C:\Users\marce\OneDrive\Documenten\Github\volt\packages\volt-bridge\src\$projName\$projName.csproj"
$outDir = "C:\Users\marce\AppData\Local\Temp\opencode\bridge-$($Project.ToLower())"
$logDir = "C:\Users\marce\AppData\Local\Temp\opencode"

taskkill /F /IM "$asmName.exe" 2>$null
& "C:\Program Files\dotnet\dotnet.exe" publish $csproj -c Release -o $outDir --nologo -v q 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "BUILD FAILED"; exit 1 }
Start-Process -FilePath "$outDir\$asmName.exe" -WindowStyle Hidden -RedirectStandardOutput "$logDir\$($Project)-out.log" -RedirectStandardError "$logDir\$($Project)-err.log"
Start-Sleep -Seconds 3
$status = curl.exe -s http://127.0.0.1:$Port/health
if ($status -match "healthy") { Write-Output "$Project bridge UP on :$Port" } else { Write-Output "$Project bridge DOWN" }
