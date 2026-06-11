@echo off
REM Build the VoltBridge CODESYS .package file
REM Build Plugin project only when CODESYS is installed (needs Core.dll)
setlocal
set PACKAGE_DIR=%~dp0
set BUILD_DIR=%PACKAGE_DIR%build
set OUT_PACKAGE=%PACKAGE_DIR%VoltBridge-1.0.0.package

echo Cleaning...
rd /s /q "%BUILD_DIR%" 2>nul
mkdir "%BUILD_DIR%\PlugIns"
mkdir "%BUILD_DIR%\ScriptLib\Stubs\scriptengine"

echo Building VoltBridge.Codesys (console)...
dotnet publish "%PACKAGE_DIR%..\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj" -c Release -o "%BUILD_DIR%\PlugIns" --nologo -v q
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Building VoltBridge.Codesys.Plugin...
dotnet build "%PACKAGE_DIR%..\src\VoltBridge.Codesys.Plugin\VoltBridge.Codesys.Plugin.csproj" -c Release -o "%BUILD_DIR%\PlugIns" --nologo -v q
if %ERRORLEVEL% neq 0 (
    echo Plugin build skipped (CODESYS not installed — plugin will deploy later).
) else (
    echo Plugin DLL included.
)

echo Copying package files...
copy /Y "%PACKAGE_DIR%package.manifest" "%BUILD_DIR%\"
copy /Y "%PACKAGE_DIR%PlugIns\install.bat" "%BUILD_DIR%\PlugIns\"
xcopy /E /I /Y "%PACKAGE_DIR%ScriptLib" "%BUILD_DIR%\ScriptLib"

echo Creating .package...
powershell -Command "Compress-Archive -Path '%BUILD_DIR%\*' -DestinationPath '%BUILD_DIR%.zip' -Force"
move /Y "%BUILD_DIR%.zip" "%OUT_PACKAGE%"
echo Package created: %OUT_PACKAGE%
