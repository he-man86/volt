; Volt one-installer — a full wizard (Welcome -> components -> install -> finish), replacing the silent Velopack
; Setup. ONE exe sets up both use cases: the desktop app + (optionally) the opencode CLI and the VS Code extension.
; Per-user install (no admin/UAC): Volt's env vars + login item + Start Menu shortcut are all HKCU, so
; PrivilegesRequired=lowest. Auto-update is the connector's job (Updater.cs) — it downloads a newer Setup.exe and
; re-runs it /VERYSILENT, so Inno upgrades in place; CloseApplications lets that replace the running connector.
;
; Defines are passed by volt-scripts/build-app.ts:
;   AppVersion  the release version (X.Y.Z)   StageDir   the assembled payload (connector at root + bin/ etc.)
;   OutputDir   where Volt-win-Setup.exe lands  SetupIcon  the app .ico

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; A stable AppId keys upgrades + the single uninstall entry. Do not change it across versions.
AppId={{6F3A9C2E-1D4B-4E7A-9B2C-56A0D3E1F002}
AppName=Volt
AppVersion={#AppVersion}
AppPublisher=Volt
DefaultDirName={localappdata}\Programs\Volt
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Volt-win-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#SetupIcon}
UninstallDisplayName=Volt
UninstallDisplayIcon={app}\desktop\Volt.exe
; Close a running connector/GUI so an in-place update can replace their files (Restart Manager).
CloseApplications=yes

[Tasks]
Name: "opencode"; Description: "Install the opencode CLI — the AI agent (via winget)"; GroupDescription: "Optional components:"
Name: "vscode";   Description: "Install the Volt VS Code extension";                    GroupDescription: "Optional components:"; Check: VSCodeInstalled

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
; The connector self-configures env (OPENCODE_CONFIG_DIR + PATH), the Start Menu shortcut and its login item on
; startup, then runs the tray. --silent = launched by us, not a double-click.
Filename: "{app}\VoltConnector.exe"; Parameters: "--silent"; Flags: nowait runhidden
; Optional components — only on an interactive install (skip on the connector's silent in-place update).
Filename: "{cmd}"; Parameters: "/c winget install --exact --id SST.opencode --accept-source-agreements --accept-package-agreements"; Tasks: opencode; Check: NotSilent; StatusMsg: "Installing the opencode CLI (this can take a minute)…"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c code --install-extension ""{app}\volt-vscode.vsix"" --force"; Tasks: vscode; Check: NotSilent; StatusMsg: "Installing the Volt VS Code extension…"; Flags: runhidden

[UninstallRun]
; Revert env + stop the running tray/workers BEFORE Inno deletes files. Single uninstaller — no second entry.
Filename: "{app}\VoltConnector.exe"; Parameters: "--uninstall"; Flags: waituntilterminated runhidden; RunOnceId: "VoltEnvRevert"

[Code]
function VSCodeInstalled(): Boolean;
var Code: Integer;
begin
  // Offer the extension task only if VS Code's `code` launcher is on PATH.
  Result := Exec(ExpandConstant('{cmd}'), '/c where code', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function NotSilent(): Boolean;
begin
  // On the connector's /VERYSILENT self-update we only refresh the app — don't re-run winget/code.
  Result := not WizardSilent();
end;
