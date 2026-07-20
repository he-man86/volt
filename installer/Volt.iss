; Volt one-installer — a full wizard (Welcome -> components -> install -> finish). ONE exe sets up both use
; cases: the desktop app + (optionally) the opencode CLI and the VS Code-family extension.
; Per-user install (no admin/UAC): Volt's env vars + login item + Start Menu shortcut are all HKCU, so
; PrivilegesRequired=lowest. Auto-update is the connector's job (Updater.cs) — it downloads a newer Setup.exe and
; re-runs it /VERYSILENT, so Inno upgrades in place; CloseApplications lets that replace the running connector.
;
; Defines are passed by volt-scripts/build-installer.ts:
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
; Always log. Without this a failed install (e.g. exit 5 = Setup couldn't close a running Volt process) leaves
; NOTHING to diagnose — just an exit code. DeinitializeSetup mirrors the log into Volt's shared log store below.
SetupLogging=yes
; In-place updates do NOT use Restart Manager. RM can't reliably free the files of a running Volt install: the
; connector is a self-contained .NET app ({app}\clrjit.dll stays loaded while it runs) and the TwinCAT worker is a
; headless process — RM's graceful close can't touch either (a plain "yes" then aborts, exit 5), and its async
; force-close races the file copy, so an update intermittently fails with a sharing violation on clrjit.dll. Instead
; we stop our own processes deterministically in PrepareToInstall (below) before the copy — race-free, and identical
; on every machine. (AppMutex would only re-introduce the problem: it blocks BEFORE PrepareToInstall runs.)
CloseApplications=no

[Tasks]
Name: "opencode"; Description: "Install the opencode CLI — the AI agent (via winget)"; GroupDescription: "Optional components:"
; One task per VS Code-family editor — each offered only if its launcher is on PATH, each independently
; checkable. This IS the configuration surface: the wizard checkboxes interactively, /TASKS="vscode,cursor"
; for a scripted install.
Name: "vscode";   Description: "Install the Volt extension into VS Code";  GroupDescription: "Optional components:"; Check: EditorOnPath('code')
Name: "windsurf"; Description: "Install the Volt extension into Windsurf"; GroupDescription: "Optional components:"; Check: EditorOnPath('windsurf')
Name: "cursor";   Description: "Install the Volt extension into Cursor";   GroupDescription: "Optional components:"; Check: EditorOnPath('cursor')

[InstallDelete]
; [Files] only ADDS/overwrites — it never removes what an older version left, so stale files survive upgrades
; forever. This retires the pre-0.2.0 leak: those payloads carried a package.json, and opencode INSTALLS a config
; dir's declared deps at runtime — creating opencode-config\node_modules and needing a registry on machines that may
; have none. Keep in sync with CFG_NEVER_SHIP in volt-scripts/build-payload.ts: same list, two enforcement points
; (never ship it / delete what older versions shipped).
;
; NAMED ENTRIES, not the whole dir: InstallDelete runs BEFORE [Files], and Inno does NOT roll back deletions when
; an install aborts (a locked file, a cancel). Wiping {app}\opencode-config would leave an aborted upgrade with the
; dir GONE and OPENCODE_CONFIG_DIR still pointing at it — opencode silently degrades to vanilla, no error. These
; five are junk in every version, so deleting them is safe even if the install then fails.
Type: files; Name: "{app}\opencode-config\package.json"
Type: files; Name: "{app}\opencode-config\package-lock.json"
Type: files; Name: "{app}\opencode-config\bun.lock"
Type: files; Name: "{app}\opencode-config\.gitignore"
Type: filesandordirs; Name: "{app}\opencode-config\node_modules"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
; The connector self-configures env (OPENCODE_CONFIG_DIR + PATH), the Start Menu shortcut and its login item on
; startup, then runs the tray. --silent = launched by us, not a double-click.
Filename: "{app}\VoltConnector.exe"; Parameters: "--silent"; Flags: nowait runhidden
; Optional components — only on an interactive install (skip on the connector's silent in-place update).
Filename: "{cmd}"; Parameters: "/c winget install --exact --id SST.opencode --accept-source-agreements --accept-package-agreements"; Tasks: opencode; Check: NotSilent; StatusMsg: "Installing the opencode CLI (this can take a minute)…"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c code --install-extension ""{app}\volt-vscode.vsix"" --force";     Tasks: vscode;   Check: NotSilent; StatusMsg: "Installing the Volt extension into VS Code…";  Flags: runhidden
Filename: "{cmd}"; Parameters: "/c windsurf --install-extension ""{app}\volt-vscode.vsix"" --force"; Tasks: windsurf; Check: NotSilent; StatusMsg: "Installing the Volt extension into Windsurf…"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c cursor --install-extension ""{app}\volt-vscode.vsix"" --force";   Tasks: cursor;   Check: NotSilent; StatusMsg: "Installing the Volt extension into Cursor…";   Flags: runhidden

[UninstallDelete]
; Anything created inside opencode-config AFTER install is untracked by Inno, so it would survive uninstall and keep
; {app} alive — a dirty uninstall. test:install can't catch it (it never runs opencode, so nothing is created).
Type: filesandordirs; Name: "{app}\opencode-config"

[UninstallRun]
; Revert env + stop the running tray/workers BEFORE Inno deletes files. Single uninstaller — no second entry.
Filename: "{app}\VoltConnector.exe"; Parameters: "--uninstall"; Flags: waituntilterminated runhidden; RunOnceId: "VoltEnvRevert"

[Code]
var
  LauncherCache: TStringList; // "<launcher>=1" / "<launcher>=0" — see EditorOnPath

function EditorOnPath(Launcher: String): Boolean;
var Code: Integer;
begin
  // Offer an editor's extension task only if its launcher is on PATH. All three (code/windsurf/cursor) are
  // VS Code forks and take the same `--install-extension <vsix> --force`, so PATH presence is the whole check.
  //
  // Memoized: Inno re-evaluates a [Tasks] Check every time it rebuilds the task list, and each miss costs a
  // hidden cmd.exe. Three launchers × every evaluation adds up — including on the connector's /VERYSILENT
  // auto-update, where the tasks can't run at all (Check: NotSilent gates their [Run] lines). PATH won't change
  // mid-install, so one probe per launcher is enough.
  if LauncherCache = nil then LauncherCache := TStringList.Create;
  if LauncherCache.IndexOf(Launcher + '=1') >= 0 then begin Result := True; exit; end;
  if LauncherCache.IndexOf(Launcher + '=0') >= 0 then begin Result := False; exit; end;

  Result := Exec(ExpandConstant('{cmd}'), '/c where ' + Launcher, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if Result then LauncherCache.Add(Launcher + '=1') else LauncherCache.Add(Launcher + '=0');
end;

function NotSilent(): Boolean;
begin
  // On the connector's /VERYSILENT self-update we only refresh the app — don't re-run winget/code.
  Result := not WizardSilent();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
  Result := ''; // never block the install on this — a leftover lock is the failure we're preventing, not causing
  // THE in-place-update fix (see CloseApplications=no above): deterministically stop every running Volt process so
  // its files unlock before the copy. Runs on the "Preparing to Install" step, right before [Files] — no RM, no race.
  //   - /T on the connector also reaps its child bridge workers.
  //   - NOT codesys.exe: the CODESYS bridge runs IN-PROC inside the user's IDE — killing it would close their IDE.
  //   - Volt.exe (Electron desktop + the CLI) without /T, so we don't tree-kill the opencode child (a different image).
  Exec(ExpandConstant('{cmd}'),
    '/c taskkill /F /T /IM VoltConnector.exe /IM VoltBridgeTwincat.exe >nul 2>&1 & taskkill /F /IM Volt.exe >nul 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(700); // let the OS release the file handles before [Files] runs
end;

procedure DeinitializeSetup();
var Dir: String;
begin
  // Mirror Setup's own log into Volt's shared log store (%LOCALAPPDATA%\Volt\logs — the same folder the
  // connector + bridges write, which the tray's Log window reads). Install failures are otherwise invisible:
  // Inno leaves its log in %TEMP% under a name nobody thinks to look for, and an auto-update install runs with
  // no human watching at all. DeinitializeSetup always runs, including on an aborted install — which is exactly
  // the case worth keeping. Best-effort: never let logging break an install.
  //
  // Timestamped to the SECOND, not the day: a failed auto-update is usually followed within minutes by a retry
  // or a manual reinstall, and a per-day name would let that success overwrite the failure — destroying the one
  // log worth having. Cheap (~300 KB each) and the store is the tray Log window's, so they're visible, not lost.
  Dir := ExpandConstant('{localappdata}\Volt\logs');
  if ForceDirectories(Dir) then
    // Both separators must be a real Char — GetDateTimeString takes Char, not String, and '' breaks it at
    // runtime (silently: the copy just never happens). They're unused here anyway: the format has no '/' or ':'.
    CopyFile(ExpandConstant('{log}'), Dir + '\install-' + GetDateTimeString('yyyy-mm-dd_hhnnss', '-', '-') + '.log', True);
end;
