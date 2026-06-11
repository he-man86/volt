@echo off
REM Build the VoltBridge CODESYS .package file
REM Requires: .NET 8 SDK, PowerShell
REM Usage: build-package.bat

setlocal
set PACKAGE_DIR=%~dp0
set BUILD_DIR=%PACKAGE_DIR%build
set BRIDGE_PROJ=%PACKAGE_DIR%..\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj
set OUT_PACKAGE=%PACKAGE_DIR%VoltBridge-1.0.0.package

echo Building VoltBridge.Codesys...
dotnet publish "%BRIDGE_PROJ%" -c Release -o "%BUILD_DIR%\PlugIns" --nologo -v q
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Copying package files...
copy /Y "%PACKAGE_DIR%package.manifest" "%BUILD_DIR%\"
copy /Y "%PACKAGE_DIR%PlugIns\install.bat" "%BUILD_DIR%\PlugIns\"
xcopy /E /I /Y "%PACKAGE_DIR%ScriptLib" "%BUILD_DIR%\ScriptLib"

echo Creating .package...
powershell -Command "Compress-Archive -Path '%BUILD_DIR%\*' -DestinationPath '%OUT_PACKAGE%' -Force"
echo Package created: %OUT_PACKAGE%
