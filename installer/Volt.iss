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
UninstallDisplayIcon={app}\current\desktop\Volt.exe
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

; NO [InstallDelete]. It ran here until this audit, and did nothing: four of its five entries named
; {app}\current\opencode-config\*, but [InstallDelete] executes BEFORE the file copy and long before
; ssPostInstall repoints the junction - so `current` still resolved to the OUTGOING version, which the connector
; prunes anyway. The fifth named the flat {app}\opencode-config\node_modules, which RemoveFlatPayload
; already removes. The leak they were meant to retire (a package.json in the config dir, which makes opencode
; install deps at runtime) is prevented at the source by CFG_NEVER_SHIP in volt-scripts/build-payload.ts: the
; payload cannot contain them at all. Deleted rather than kept "just in case" - unauditable entries are how this
; file became untrustworthy.

[Files]
; NO restartreplace here, and it is worth knowing why before reaching for it. A file held open ABORTS AND ROLLS
; BACK the whole install: Inno retries the delete, then defaults the suppressed Abort/Retry/Ignore box to Abort
; and reverts everything — silently, exit 5. Observed in the wild: the connector updated while bin/volt.exe
; (which sorts AFTER the locked bin/volt-lsp-iec.exe, so the run never reached it) stayed several releases
; behind, the [Run] step never fired so the tray never restarted, and a shipped CLI feature looked broken for
; days. `restartreplace` looks like the cure and is NOT: it needs ADMINISTRATIVE rights to schedule a reboot-time
; replace, and Volt installs per-user. It was tried; setup still rolled back. The cure is closing our own
; processes first — see PrepareToInstall in [Code].
Source: "{#StageDir}\*"; DestDir: "{app}\app-{#AppVersion}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
; The CONNECTOR IS NOT LAUNCHED HERE - it is started from CurStepChanged(ssPostInstall), and that is load-bearing.
; Inno executes [Run] as part of the install step, BEFORE ssPostInstall creates {app}\current. A connector started
; from here finds no junction beside it and resolves everything against its own version directory. Three separate
; bugs came from this ordering, so the launch moved rather than the path being nudged again.
;
; These entries name the VERSION directory for the same reason: `current` does not exist yet. That is not a
; violation of the version-free invariant - that invariant governs values RECORDED OUTSIDE {app} (PATH,
; OPENCODE_CONFIG_DIR, the shortcut, the login item), and a [Run] filename is transient and internal to this
; install.
;
; Optional components. winget is interactive-only (heavy, needs network) - skipped on the connector's silent
; auto-update. The extension refresh is NOT: see WantExt.
Filename: "{cmd}"; Parameters: "/c winget install --exact --id SST.opencode --accept-source-agreements --accept-package-agreements"; Tasks: opencode; Check: NotSilent; StatusMsg: "Installing the opencode CLI (this can take a minute)…"; Flags: runhidden
; The extension refresh, however, MUST also run on the silent auto-update — otherwise the vsix (cheap, offline)
; freezes at the last interactive install while the auto-updated LSP moves on, and the editor drifts stale. WantExt
; encodes both cases: interactive → honor the checkbox; silent → refresh only editors that ALREADY have it.
; DO NOT uninstall before installing. That was tried, to stop superseded version folders accumulating (an editor
; left open across several auto-updates keeps one folder per build until it restarts), and it UNINSTALLED THE
; EXTENSION FOR REAL: Inno evaluates each [Run] entry's Check at execution time, in order, so the uninstall step
; flipped WantExt's silent-mode predicate (ExtInstalled) to False and the install right after it was SKIPPED.
; Every silent auto-update removed the extension and never put it back.
; Even with that ordering fixed, uninstall-then-install is non-atomic: an install that fails (locked files, editor
; running) leaves the user with no extension at all. The accumulating folders are UNREGISTERED — the editor loads
; exactly one version and garbage-collects the rest on a full restart — so they cost disk and confuse a human
; reading the directory, nothing more. A cosmetic problem is not worth a mode where Volt uninstalls itself.
Filename: "{cmd}"; Parameters: "/c code --install-extension ""{app}\app-{#AppVersion}\volt-vscode.vsix"" --force";     Check: WantExt('code','vscode');       StatusMsg: "Installing the Volt extension into VS Code…";  Flags: runhidden
Filename: "{cmd}"; Parameters: "/c windsurf --install-extension ""{app}\app-{#AppVersion}\volt-vscode.vsix"" --force"; Check: WantExt('windsurf','windsurf'); StatusMsg: "Installing the Volt extension into Windsurf…"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c cursor --install-extension ""{app}\app-{#AppVersion}\volt-vscode.vsix"" --force";   Check: WantExt('cursor','cursor');     StatusMsg: "Installing the Volt extension into Cursor…";   Flags: runhidden

; NO [UninstallDelete]. Its one entry named the flat {app}\opencode-config, a path the versioned layout never
; creates - the config dir now lives inside each app-<version>\, and usPostUninstall removes every one of those
; wholesale with rmdir /s /q. It was covering a layout that no longer exists.

[UninstallRun]
; The connector's own uninstall hook. It does NOT revert env any more - PATH, OPENCODE_CONFIG_DIR and
; VOLT_BRIDGE_DLL are reverted directly in CurUninstallStepChanged, because delegating that to a binary this same
; uninstall is deleting broke twice on ordering. What remains here is only what the connector knows and the
; installer does not: the login item, the Start Menu shortcut, and the copies of the CODESYS activation scripts
; published into Documents\Volt. Ordering against usUninstall is asserted from the log, not assumed.
Filename: "{app}\current\VoltConnector.exe"; Parameters: "--uninstall"; Flags: waituntilterminated runhidden; RunOnceId: "VoltEnvRevert"
; Take the sideloaded extension with us. It is useless without the `volt` CLI this uninstall removes from PATH —
; left behind it keeps loading, fails every command, and looks like a broken Volt rather than an absent one. Run
; unconditionally: an editor that never had it (or isn't on PATH) makes this a harmless no-op, and we must not
; depend on {app} files that Inno may already have deleted.
Filename: "{cmd}"; Parameters: "/c code --uninstall-extension volt-ai.volt-vscode";     Flags: runhidden; RunOnceId: "VoltExtVsCode"
Filename: "{cmd}"; Parameters: "/c windsurf --uninstall-extension volt-ai.volt-vscode"; Flags: runhidden; RunOnceId: "VoltExtWindsurf"
Filename: "{cmd}"; Parameters: "/c cursor --uninstall-extension volt-ai.volt-vscode";   Flags: runhidden; RunOnceId: "VoltExtCursor"

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
  // hidden cmd.exe. Three launchers × every evaluation adds up. PATH won't change mid-install, so one probe per
  // launcher is enough. (Reused by WantExt below, which runs on the silent auto-update too.)
  if LauncherCache = nil then LauncherCache := TStringList.Create;
  if LauncherCache.IndexOf(Launcher + '=1') >= 0 then begin Result := True; exit; end;
  if LauncherCache.IndexOf(Launcher + '=0') >= 0 then begin Result := False; exit; end;

  Result := Exec(ExpandConstant('{cmd}'), '/c where ' + Launcher, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if Result then LauncherCache.Add(Launcher + '=1') else LauncherCache.Add(Launcher + '=0');
  Log('volt: editor ' + Launcher + ' on PATH=' + IntToStr(Integer(Result)));
end;

function ExtInstalled(Launcher: String): Boolean;
var Code, I: Integer; Tmp: String; Lines: TArrayOfString;
begin
  // True when this editor already has the Volt extension. Capture `<launcher> --list-extensions` via a temp file
  // (Inno can't read a child's stdout directly) and look for our id. Used only on the silent auto-update, so we
  // refresh editors the user already opted into WITHOUT silently adding it to an editor they never chose.
  Result := False;
  Tmp := ExpandConstant('{tmp}\volt-ext-' + Launcher + '.txt');
  if not Exec(ExpandConstant('{cmd}'), '/c ' + Launcher + ' --list-extensions > "' + Tmp + '" 2>&1', '', SW_HIDE, ewWaitUntilTerminated, Code) then exit;
  if not LoadStringsFromFile(Tmp, Lines) then exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos('volt-ai.volt-vscode', Lowercase(Lines[I])) > 0 then begin Result := True; exit; end;
end;

function WantExt(Launcher, TaskName: String): Boolean;
begin
  // Whether to (re)install the extension into this editor. Interactive: honor the wizard checkbox. Silent (the
  // connector's /VERYSILENT self-update): refresh only editors that ALREADY have it — keeping the vsix in lockstep
  // with the auto-updated LSP instead of letting it freeze at the last interactive install.
  Result := False;
  if not EditorOnPath(Launcher) then exit;
  if WizardSilent() then Result := ExtInstalled(Launcher)
  else Result := WizardIsTaskSelected(TaskName);
  Log('volt: extension for ' + Launcher + ' -> install=' + IntToStr(Integer(Result)));
end;

function NotSilent(): Boolean;
begin
  // On the connector's /VERYSILENT self-update we only refresh the app — don't re-run winget/code.
  Result := not WizardSilent();
end;

/// Point {app}\current at a version directory. `rmdir` unlinks the reparse point WITHOUT touching the target —
/// a recursive delete here would delete the previous version's files through the junction. Verified: repointing
/// succeeds even while a process holds a file open under the old target, and that process keeps its handle.
function SetCurrentJunction(TargetDir: String): Boolean;
var Code: Integer; Cur: String;
begin
  Cur := ExpandConstant('{app}\current');
  Log('volt: activating ' + TargetDir + ' via junction ' + Cur);
  if not DirExists(TargetDir) then
    Log('volt: WARNING target directory does not exist - the payload did not land where expected');
  if DirExists(Cur) then
  begin
    Exec(ExpandConstant('{cmd}'), '/c rmdir "' + Cur + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Log('volt: unlinked existing junction, rmdir exit=' + IntToStr(Code));
  end
  else
    Log('volt: no existing junction (first install)');
  Result := Exec(ExpandConstant('{cmd}'), '/c mklink /J "' + Cur + '" "' + TargetDir + '"',
                 '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) and DirExists(Cur);
  if Result then
  begin
    Log('volt: junction active -> ' + TargetDir);
    // Probe the SAME subdirectory both ways. This separates the two failure modes that look identical from
    // the outside: 'the payload is not there' (both false) versus 'the junction does not resolve' (direct
    // true, through-junction false). Without it, a missing file at this point is unattributable - which is
    // where an entire debugging session went.
    Log('volt: probe direct  \bin exists=' + IntToStr(Integer(DirExists(TargetDir + '\bin'))));
    Log('volt: probe junction \bin exists=' + IntToStr(Integer(DirExists(Cur + '\bin'))));
  end
  else Log('volt: FAILED to create junction, mklink exit=' + IntToStr(Code));
end;

/// Remove the payload an older, FLAT install left directly in {app}. Without this both {app}\bin and
/// {app}\current\bin exist and whichever PATH lists first wins — a stale binary shadowing the new one, which is
/// the failure this whole change exists to end. Named entries only: Inno does not roll back deletions, and the
/// junction is never deleted recursively.
procedure RemoveFlatPayload;
var Code: Integer; A: String;
begin
  A := ExpandConstant('{app}');
  if DirExists(A + '\bin') or FileExists(A + '\VoltConnector.exe') then
    Log('volt: migrating a FLAT install - removing the old payload directly under ' + A)
  else
    Log('volt: no flat payload to migrate');
  Exec(ExpandConstant('{cmd}'),
    '/c rmdir /s /q "' + A + '\bin" 2>nul & rmdir /s /q "' + A + '\desktop" 2>nul' +
    ' & rmdir /s /q "' + A + '\opencode-config" 2>nul & rmdir /s /q "' + A + '\docs" 2>nul' +
    ' & del /q "' + A + '\Volt*.exe" "' + A + '\version.txt" "' + A + '\volt-vscode.vsix" 2>nul',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

/// Publish PATH + OPENCODE_CONFIG_DIR from the INSTALLER, not from the connector.
///
/// These were written by VoltConnector on startup, which makes them depend on a process's lifetime — and that
/// dependency caused four ordering bugs in a row: [Run] firing before the junction existed, uninstall cleanup
/// destroying the exe before [UninstallRun] could use it, the connector resolving a junction that was not there
/// yet, and finally setup exiting before the connector had written anything. The uninstall side was fixed by
/// doing the revert here instead, and has been solid since; this is the symmetric half.
///
/// Both values resolve through {app}\current — never a version directory. That is the invariant the whole layout
/// rests on: a versioned value would force every update to rewrite HKCU and would dangle whenever the pruner
/// removed the directory it named. The connector still calls its own Install() on startup; it is idempotent and
/// now computes the same version-free paths, so the two agree instead of racing.
/// True when Dir is already one of PATH's ';'-separated entries (case-insensitive - Windows paths are).
function PathHasEntry(PathVal, Dir: String): Boolean;
var Rest, Part: String;
begin
  Result := False;
  Rest := PathVal + ';';
  while Pos(';', Rest) > 0 do
  begin
    Part := Trim(Copy(Rest, 1, Pos(';', Rest) - 1));
    Rest := Copy(Rest, Pos(';', Rest) + 1, Length(Rest));
    if CompareText(Part, Dir) = 0 then begin Result := True; exit; end;
  end;
end;

procedure PublishEnv(TargetDir: String);
var PathVal, CurBin, CfgDir, DllPath: String;
begin
  CfgDir := ExpandConstant('{app}\current\opencode-config');
  if RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'OPENCODE_CONFIG_DIR', CfgDir) then
    Log('volt: OPENCODE_CONFIG_DIR=' + CfgDir)
  else
    Log('volt: FAILED to write OPENCODE_CONFIG_DIR');
  // Verify against the REAL directory, never through {app}\current. A reparse point is not reliably
  // resolvable by the process that just created it - measured: DirExists(current\bin) was FALSE 1ms after
  // mklink returned, while the same directory probed directly was TRUE, and the junction was perfect
  // seconds later. Checking through it made every verification here a coin flip and stopped the connector
  // from launching at all. The VALUE written to the registry stays the 'current' form - that is the
  // invariant; only the existence CHECK uses the path we just wrote the files to.
  if not DirExists(TargetDir + '\opencode-config') then Log('volt: WARNING opencode-config missing in ' + TargetDir);
  DllPath := ExpandConstant('{app}\current\codesys-scriptcommands\Volt.Cli.Ide.Codesys.dll');
  if FileExists(TargetDir + '\codesys-scriptcommands\Volt.Cli.Ide.Codesys.dll') then
  begin
    RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'VOLT_BRIDGE_DLL', DllPath);
    Log('volt: VOLT_BRIDGE_DLL=' + DllPath);
  end
  else
    Log('volt: CODESYS bridge DLL not present, VOLT_BRIDGE_DLL not set: ' + DllPath);
  CurBin := ExpandConstant('{app}\current\bin');
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal) then PathVal := '';
  // Entry-wise, NOT a substring test. Pos() would accept a PATH entry of '\current\binx' as already
  // containing '\current\bin', silently skipping the append - and a PATH entry that looks right but is not is
  // exactly the failure that shipped ('\Volt\currentin'). The uninstall side splits on ';' to strip entries, so
  // the add side splits too: add and remove agree by construction, not by two similar-looking string tests.
  if not PathHasEntry(PathVal, CurBin) then
  begin
    if (PathVal <> '') and (Copy(PathVal, Length(PathVal), 1) <> ';') then PathVal := PathVal + ';';
    if RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal + CurBin) then
      Log('volt: appended to user PATH: ' + CurBin)
    else
      Log('volt: FAILED to append to user PATH: ' + CurBin);
  end
  else
    Log('volt: PATH already contains ' + CurBin + ' - left unchanged');
  if not DirExists(TargetDir + '\bin') then Log('volt: WARNING bin missing in ' + TargetDir);
end;

/// Activate the version we just wrote — the LAST thing before [Run], so a failed copy never leaves `current`
/// pointing at an incomplete directory. If the junction cannot be created (a filesystem without reparse points),
/// fail loudly rather than silently leaving an install nothing can find.
procedure CurStepChanged(CurStep: TSetupStep);
var PostCode: Integer; ConnExe, Mode: String;
begin
  if CurStep = ssInstall then
  begin
    // One line at the top of every install that says WHAT this run is. A support log is far easier to read
    // when its first Volt line states the version, the target, whether it was silent (an auto-update) or
    // interactive (a human), and whether an install was already present (an upgrade vs a fresh install).
    if WizardSilent() then Mode := 'silent' else Mode := 'interactive';
    Log('volt: install {#AppVersion} -> ' + ExpandConstant('{app}') + ', mode=' + Mode
        + ', existing=' + IntToStr(Integer(DirExists(ExpandConstant('{app}\current')))));
  end;
  if CurStep = ssPostInstall then
  begin
    if not SetCurrentJunction(ExpandConstant('{app}\app-{#AppVersion}')) then
      MsgBox('Volt could not create the {app}\current link. The files are installed under app-{#AppVersion} but nothing will resolve them.',
             mbCriticalError, MB_OK)
    else
    begin
      RemoveFlatPayload;
      PublishEnv(ExpandConstant('{app}\app-{#AppVersion}'));
      // NOW start the connector — the junction exists, so VoltEnv resolves through {app}\current and every value
      // it publishes outside {app} is version-free, which is what makes an update a no-op for the environment.
      // The version directory, not the junction: see PublishEnv. A [Run]-style filename is transient and
      // internal to this install, so it is free to name the version; only RECORDED values must be stable.
      ConnExe := ExpandConstant('{app}\app-{#AppVersion}\VoltConnector.exe');
      if not FileExists(ConnExe) then
        Log('volt: connector MISSING, cannot start: ' + ConnExe)
      else if Exec(ConnExe, '--silent', '', SW_HIDE, ewNoWait, PostCode) then
        Log('volt: started the connector: ' + ConnExe)
      else
        Log('volt: FAILED to start the connector, error=' + IntToStr(PostCode) + ' (' + SysErrorMessage(PostCode) + ')');
    end;
  end;
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
  //   - volt-lsp-iec.exe: the ONE that actually broke updates. opencode spawns it (the config registers it by bare
  //     name) and it lives for the whole session, so it was almost always holding bin/volt-lsp-iec.exe. Missing it
  //     here meant Inno hit its retry loop, defaulted the suppressed Abort/Retry/Ignore box to ABORT, and ROLLED
  //     BACK the entire install — silently, exit 5. Everything sorting after it (notably bin/volt.exe) then stayed
  //     releases behind while the connector moved on. opencode restarts it on demand, so closing it costs nothing.
  //     `restartreplace` on [Files] is NOT an alternative: it needs admin rights to schedule a reboot-time replace,
  //     and Volt installs per-user.
  Log('volt: stopping running Volt processes before the file copy (VoltConnector, VoltBridgeTwincat, Volt, volt, volt-lsp-iec)');
  Exec(ExpandConstant('{cmd}'),
    '/c taskkill /F /T /IM VoltConnector.exe /IM VoltBridgeTwincat.exe >nul 2>&1 & taskkill /F /IM Volt.exe /IM volt.exe /IM volt-lsp-iec.exe >nul 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('volt: taskkill returned ' + IntToStr(ResultCode) + ' (128 = none were running, which is normal on a fresh install)');
  Sleep(1200); // let the OS release the file handles before [Files] runs
end;

/// The uninstall half of the same problem. A self-contained .NET app holds its OWN runtime open — clrjit.dll,
/// coreclr.dll, hostfxr.dll and friends — so uninstalling while the tray is running left ~40 undeletable files
/// behind, which keeps {app} alive and poisons the next install. [UninstallRun] cannot fix it: that entry IS the
/// connector, and it is still running when Inno starts deleting.
///
/// usUninstall fires BEFORE any file is removed, which is the only useful moment. Same list as
/// PrepareToInstall, same reasoning — Volt's own processes only, never the user's IDE.
/// Uninstall logging. Inno's SetupLogging=yes covers SETUP only - the uninstaller writes a log just when it is
/// passed /LOG, which a real user's uninstall never is. So an uninstall that half-worked (a leftover junction, a
/// PATH entry that survived) left no trace at all, and support had nothing to look at. Append our own line to the
/// shared store instead, where the tray Log window and the install logs already live. Log() too, so a /LOG run
/// keeps everything in one file. Best-effort: never let logging break an uninstall.
procedure ULog(Msg: String);
var Dir: String;
begin
  Log('volt: ' + Msg);
  Dir := ExpandConstant('{localappdata}\Volt\logs');
  if ForceDirectories(Dir) then
    SaveStringToFile(Dir + '\uninstall-' + GetDateTimeString('yyyy-mm-dd', '-', '-') + '.log',
      GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + ' [uninstall] ' + Msg + #13#10, True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var ResultCode, I: Integer; PathVal, NewPath, Part: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec(ExpandConstant('{cmd}'),
      '/c taskkill /F /T /IM VoltConnector.exe /IM VoltBridgeTwincat.exe >nul 2>&1 & taskkill /F /IM Volt.exe /IM volt.exe /IM volt-lsp-iec.exe >nul 2>&1',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    ULog('stopped running Volt processes, taskkill exit=' + IntToStr(ResultCode));
    Sleep(1200); // let the OS release the handles before Inno starts deleting
  end;
  // AFTER Inno's own removal — not in usUninstall. [UninstallRun] runs `current\VoltConnector.exe --uninstall`
  // to revert PATH + OPENCODE_CONFIG_DIR, and deleting the version directories any earlier destroys the exe
  // before it can do that: the env was left pointing at a Volt that no longer existed. Unlink `current` with
  // rmdir (a recursive delete would delete the version directory THROUGH the junction), then take the versions.
  // Revert the environment HERE, in the uninstaller itself, rather than delegating to
  // `VoltConnector.exe --uninstall` via [UninstallRun]. Delegating means the revert depends on the lifetime of a
  // binary this same uninstall is deleting — which broke twice already (once when cleanup ran before
  // [UninstallRun] and destroyed the exe first). Doing it directly cannot be defeated by ordering: no process to
  // launch, nothing to race. The [UninstallRun] entry stays for the parts only the connector knows about.
  if CurUninstallStep = usPostUninstall then
  begin
    ULog('reverting environment');
    RegDeleteValue(HKEY_CURRENT_USER, 'Environment', 'OPENCODE_CONFIG_DIR');
    RegDeleteValue(HKEY_CURRENT_USER, 'Environment', 'VOLT_BRIDGE_DLL');
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Volt');
    // PATH is a list — strip only Volt's own entries, never rewrite the whole value.
    if RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal) then
    begin
      NewPath := '';
      while Pos(';', PathVal) > 0 do
      begin
        Part := Copy(PathVal, 1, Pos(';', PathVal) - 1);
        PathVal := Copy(PathVal, Pos(';', PathVal) + 1, Length(PathVal));
        if (Part <> '') and (Pos('\programs\volt', Lowercase(Part)) = 0) then
        begin
          if NewPath <> '' then NewPath := NewPath + ';';
          NewPath := NewPath + Part;
        end;
      end;
      if (PathVal <> '') and (Pos('\programs\volt', Lowercase(PathVal)) = 0) then
      begin
        if NewPath <> '' then NewPath := NewPath + ';';
        NewPath := NewPath + PathVal;
      end;
      RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', NewPath);
      ULog('PATH rewritten without Volt entries');
    end;
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    // Retry: the junction cannot be unlinked while a process has it as its working directory, and the processes
    // killed above are not always fully reaped by the time we get here. A single attempt left `current` behind on
    // one run of the lifecycle gate while later runs were clean - a race, so treat it as one rather than sleeping
    // longer and hoping. Each attempt is logged, so a leftover now says WHY instead of just appearing.
    for I := 1 to 5 do
    begin
      Exec(ExpandConstant('{cmd}'),
        '/c rmdir "' + ExpandConstant('{app}\current') + '" 2>nul & for /d %I in ("' + ExpandConstant('{app}') + '\app-*") do @rmdir /s /q "%I"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      if not DirExists(ExpandConstant('{app}\current')) then Break;
      ULog('attempt ' + IntToStr(I) + ': {app}\current still present, retrying');
      Sleep(500);
    end;
    if DirExists(ExpandConstant('{app}\current')) then
      ULog('FAILED to remove {app}\current - something still holds it')
    else
      ULog('removed the junction and every version directory');
  end;
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
