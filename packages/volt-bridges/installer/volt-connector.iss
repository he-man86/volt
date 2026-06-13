; Volt Connector — per-user Windows installer (no admin / no UAC).
;
; Don't compile this by hand — run  ..\..\..\script\build-installer.ps1, which
; builds the connector bundle + the .vsix and invokes ISCC with the right /D
; defines. To compile directly:
;   ISCC.exe /DVoltVersion=1.2.3 /DVsixGlob="full\path\volt-vscode-1.2.3.vsix" volt-connector.iss
;
; The heavy lifting (install the extension into detected editors, launch the
; connector) is delegated to script\install-volt.ps1 so there is ONE install
; engine shared with the repo/dev path.

#ifndef VoltVersion
  #define VoltVersion "0.0.0"
#endif
#ifndef ConnectorDir
  #define ConnectorDir "..\dist\Connector"
#endif
#ifndef VsixGlob
  #define VsixGlob "..\..\volt-vscode\volt-vscode-*.vsix"
#endif
#ifndef EnginePs1
  #define EnginePs1 "..\..\..\script\install-volt.ps1"
#endif

[Setup]
AppId={{B7E6F1A2-3C4D-4E5F-9A0B-1D2E3F4A5B6C}
AppName=Volt Connector
AppVersion={#VoltVersion}
AppPublisher=Volt
DefaultDirName={localappdata}\Programs\Volt
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist\installer
OutputBaseFilename=VoltConnector-Setup-{#VoltVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayName=Volt Connector

[Files]
; The connector bundle (VoltConnector.exe + bridge workers + script commands)
; installs straight into the install dir the extension auto-launches from.
Source: "{#ConnectorDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; The extension and the shared install engine, renamed to stable names.
Source: "{#VsixGlob}"; DestDir: "{app}"; DestName: "volt.vsix"; Flags: ignoreversion
Source: "{#EnginePs1}"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; Install the extension into every detected editor and launch the connector
; (which self-registers the start-at-login entry). -InstallDir == -ConnectorSource
; so the engine sees the bundle is already in place and skips the copy.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-volt.ps1"" -ConnectorSource ""{app}"" -InstallDir ""{app}"" -Vsix ""{app}\volt.vsix"""; \
  StatusMsg: "Installing the Volt extension and starting the connector..."; \
  Flags: runhidden

[UninstallRun]
; Stop the connector and drop the login item before files are removed.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-Process VoltConnector -ErrorAction SilentlyContinue | Stop-Process -Force; Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name VoltConnector -ErrorAction SilentlyContinue"""; \
  RunOnceId: "StopVolt"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Upgrades: stop a running connector so its files aren't locked during copy.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process VoltConnector -ErrorAction SilentlyContinue | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
