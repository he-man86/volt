; Volt's installer (openspec installer-rebuild). ONE per-user Inno Setup installer for every Volt app: the desktop
; app, the `volt` CLI + the LSP on PATH, the tray connector (+ the TwinCAT worker) and the CODESYS bridge. Written
; from the product as it is, declaratively: what Volt puts on the machine is in [Files] / [Icons] / [Registry] /
; [UninstallDelete], so the uninstaller removes exactly that. [Code] holds only what Inno cannot declare: stopping
; Volt's own processes, waiting for a running CLI (never killing it), the exact PATH entry, and the log mirror.
;
; Auto-update is the connector's (Updater.cs): it downloads a newer Volt-win-Setup.exe, verifies its SHA-256 against
; the release asset's digest, and runs it /VERYSILENT — this same file, upgrading in place.
;
; Defines passed by scripts/build-installer.ts:
;   AppVersion  the release version       StageDir   dist/stage — the install tree itself (bin\ connector\ codesys\ desktop\)
;   OutputDir   where Volt-win-Setup.exe lands        SetupIcon  the app .ico

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; A stable AppId keys upgrades + the single uninstall entry. Do not change it across versions.
AppId={{6F3A9C2E-1D4B-4E7A-9B2C-56A0D3E1F002}
AppName=Volt
AppVersion={#AppVersion}
AppPublisher=Volt
; Fixed: the CODESYS start script published to Documents\Volt finds the bridge at this path (`_INSTALL_SUBDIR`).
DefaultDirName={localappdata}\Programs\Volt
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
; Every binary Volt ships is x64 (the .NET runtime, the LSP; the one x86 exe is the TwinCAT hierarchy reader, which
; runs under WOW64). Without these Inno treats the install as 32-bit: {sys}/registry redirection, and Setup would
; start on an x86 Windows it cannot serve. x64compatible = x64, and ARM64 Windows with its x64 emulation.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Volt-win-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#SetupIcon}
UninstallDisplayName=Volt
UninstallDisplayIcon={app}\desktop\VoltDesktop.exe
; Always log: a failed install otherwise leaves nothing but an exit code. DeinitializeSetup mirrors it into
; %LOCALAPPDATA%\Volt\logs, where the tray's Log window reads.
SetupLogging=yes
; NOT the Restart Manager. It closes applications by the files they hold — a running `volt.exe` among them, which may
; be mid-`volt push` to a live PLC — and its asynchronous force-close raced the file copy (a sharing violation on the
; connector's runtime, then a silent rollback). [Code] stops Volt's own processes by PATH instead, and waits for a CLI.
CloseApplications=no
; PATH is the one thing Volt publishes for agents: broadcast WM_SETTINGCHANGE("Environment") on install AND uninstall,
; so Explorer — and every shell or editor started from it — sees the change without a new logon.
ChangesEnvironment=yes
; The uninstall log describes THIS install only, not every build installed over it. Files a later build drops are
; still removed: [UninstallDelete] takes the four folders whole.
UninstallLogMode=overwrite

[InstallDelete]
; The CLI's own git (MinGit) is ONE tree: [Files] below only adds and overwrites, so an update that bumps the pin would
; leave every file only the older MinGit had beside the new ones — a mixed git. Cleared first, at install time (after
; PrepareToInstall waited for a running CLI). Held by Volt.Repo.Gates/BundledGitGateTests and test:install step 3.
Type: filesandordirs; Name: "{app}\bin\git"

[Files]
; dist/stage IS the install tree: four folders, copied 1:1.
Source: "{#StageDir}\bin\*";       DestDir: "{app}\bin";       Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\connector\*"; DestDir: "{app}\connector"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\codesys\*";   DestDir: "{app}\codesys";   Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\desktop\*";   DestDir: "{app}\desktop";   Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; The Start Menu entry. It was written by the connector at runtime (the Velopack era), so a dev build could repoint it.
Name: "{userprograms}\Volt"; Filename: "{app}\desktop\VoltDesktop.exe"; WorkingDir: "{app}\desktop"

[Registry]
; The login item, so the tray survives a reboot. Declared, so the uninstaller removes exactly this value.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "VoltConnector"; ValueData: """{app}\connector\VoltConnector.exe"" --silent"; Flags: uninsdeletevalue
; PATH is NOT here: `uninsdeletevalue` on HKCU\Environment\Path deletes the user's WHOLE PATH. [Code] adds and
; removes the one exact entry instead.

[Run]
; Start the tray. Not `postinstall`: it must run on the silent auto-update too.
Filename: "{app}\connector\VoltConnector.exe"; Parameters: "--silent"; Flags: nowait

[UninstallDelete]
; The four folders whole — including any file an earlier build installed and this one no longer ships.
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\connector"
Type: filesandordirs; Name: "{app}\codesys"
Type: filesandordirs; Name: "{app}\desktop"
Type: dirifempty;     Name: "{app}"
; The visible copies of the CODESYS scripts the connector publishes at startup (VoltEnv.PublishCodesysScripts).
Type: files;          Name: "{userdocs}\Volt\start_volt_codesys.py"
Type: files;          Name: "{userdocs}\Volt\stop_volt_codesys.py"
Type: dirifempty;     Name: "{userdocs}\Volt"

[Code]
{ Every Volt line in a log starts `volt: ` — the install gate (scripts/test-install.ts) reads them, and
  build-installer.ts refuses a build whose [Code] lost one. Setup's lines go to Inno's own log (mirrored by
  DeinitializeSetup); the uninstaller writes no log of its own unless passed /LOG, so its lines are also appended
  to the shared store, one file per day, every line `volt:`-prefixed. }
procedure VLog(Msg: String);
var Dir: String;
begin
  Log('volt: ' + Msg);
  if IsUninstaller() then
  begin
    Dir := ExpandConstant('{localappdata}\Volt\logs');
    if ForceDirectories(Dir) then
      SaveStringToFile(Dir + '\uninstall-' + GetDateTimeString('yyyy-mm-dd', '-', '-') + '.log',
        GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + ' [uninstall] volt: ' + Msg + #13#10, True);
  end;
end;

function SilentRun: Boolean;
begin
  if IsUninstaller() then Result := UninstallSilent() else Result := WizardSilent();
end;

function AppDir: String;
begin
  Result := ExpandConstant('{app}');
end;

{ Runs from a FOLDER under <app> — never <app> itself: the uninstaller (<app>\unins000.exe, or the next free number) waits there for its own
  second phase, and stopping it with the rest ended the uninstall with exit code 0 and nobody waiting for it. }
function UnderApp(Path: String): Boolean;
begin
  Result := (Pos(Lowercase(AddBackslash(AppDir)), Lowercase(Path)) = 1)
    and (CompareText(RemoveBackslash(ExtractFileDir(Path)), RemoveBackslash(AppDir)) <> 0);
end;

{ The CLI: <app>\bin\volt.exe — a volt.exe in a bin\ folder. Matched by PATH, never by image name alone. }
function IsCli(Path: String): Boolean;
begin
  Result := (CompareText(ExtractFileName(Path), 'volt.exe') = 0)
    and (CompareText(ExtractFileName(RemoveBackslash(ExtractFileDir(Path))), 'bin') = 0);
end;

{ The processes (Processes.iss: Windows' own snapshot — NOT WMI, which a machine may have disabled) running from under
  <app>, with their paths — ONE mechanism for both finding and stopping, and path-scoped: a dev tray or a volt.exe
  running from a checkout is never touched. }
#include "Processes.iss"

{ Wall-clock milliseconds, for the CLI wait: the process scans between two sleeps take time of their own. }
function GetTickCount: DWord; external 'GetTickCount@kernel32.dll stdcall';

{ The first CLI that may be running from under <app>: its pid and path. Every process NAMED volt.exe is examined, and
  one whose path cannot be read at all counts as the CLI (fail closed): waiting on a stranger costs an update; stopping
  the TwinCAT worker under a running `volt push` costs a PLC project. }
function FindCli(var Pid: Integer; var Path: String): Boolean;
var Procs: TVoltProcesses; I: Integer; Exe: String;
begin
  Result := False;
  Procs := RunningProcesses;
  for I := 0 to GetArrayLength(Procs) - 1 do
  begin
    if CompareText(Procs[I].Name, 'volt.exe') <> 0 then Continue;
    Exe := Procs[I].Path;
    if (Exe = '') or (UnderApp(Exe) and IsCli(Exe)) then
    begin
      Pid := Procs[I].Pid;
      if Exe = '' then Path := '(path unreadable - waited on, never stopped)' else Path := Exe;
      Result := True;
      Exit;
    end;
  end;
end;

{ Stop every process running from under <app> that is not the CLI: the connector, the TwinCAT worker, the desktop
  app, the LSP (its host restarts it on demand) — by path, so a CLI never is. NOT CODESYS: its bridge runs in-proc in the user's IDE, loaded
  from a per-session temp copy, so it holds no file here. Rounds until none is left: the connector can spawn a
  worker between two passes. False — and a FAILED line naming them — when some still run after 30 s.
  The CLI wait came first, but a `volt push` can start between that wait and a round here (an agent loop, the editor
  or the desktop app calling the CLI) and connect to the TwinCAT worker this is about to stop: every round looks for
  a CLI again BEFORE it stops anything, and on finding one stops nothing more and sets CliStarted — the caller goes
  back to waiting. }
var StopRefusal: String;   { why StopOwn gave up at once (an elevated Volt process), for the setup's message }

function StopOwn(var CliStarted: Boolean): Boolean;
var Procs: TVoltProcesses; I, Found, CliPid: Integer; Started, Err: DWord; Exe, Key, CliPath: String; Seen: TStringList;
begin
  CliStarted := False;
  StopRefusal := '';
  Seen := TStringList.Create;
  try
    { A wall-clock 30 s: counted rounds (60 x 500 ms) measured 44-51 s (with the WMI queries the
      process snapshot replaced), each round's scan taking time of its own. }
    Started := GetTickCount;
    while GetTickCount - Started < 30000 do
    begin
      if FindCli(CliPid, CliPath) then
      begin
        VLog('volt.exe started (pid ' + IntToStr(CliPid) + ', ' + CliPath + ') while Volt''s processes were being stopped - back to waiting for it');
        if Seen.Count > 0 then
        begin
          Seen.Delimiter := ',';
          VLog('stopped ' + IntToStr(Seen.Count) + ' Volt process(es) under ' + AppDir + ' before it started: ' + Seen.DelimitedText);
        end;
        CliStarted := True;
        Result := False;
        Exit;
      end;
      Found := 0;
      Procs := RunningProcesses;
      for I := 0 to GetArrayLength(Procs) - 1 do
      begin
        Exe := Procs[I].Path;
        if (Exe <> '') and UnderApp(Exe) and not IsCli(Exe) then
        begin
          Found := Found + 1;
          Key := ExtractFileName(Exe) + ' (pid ' + IntToStr(Procs[I].Pid) + ')';
          Err := TerminatePid(Procs[I].Pid);
          { An ELEVATED Volt process (started "as administrator"): WMI never read its path, so the old stop did not
            see it and went on into a locked file; the snapshot reads it, and this per-user setup may not stop it.
            Waiting cannot change that - give up now, naming it (gate 2c+3 review). }
          if Err = ERROR_ACCESS_DENIED then
          begin
            StopRefusal := Key + ' runs elevated (as administrator) and this setup may not stop it - close it, or run the setup as administrator';
            VLog('FAILED to stop Volt''s processes under ' + AppDir + ': ' + StopRefusal);
            Result := False;
            Exit;
          end;
          if (Err <> 0) and (Seen.IndexOf(Key) < 0) then
            VLog('Windows refused to stop ' + Key + ': ' + SysErrorMessage(Err));
          if Seen.IndexOf(Key) < 0 then Seen.Add(Key);
        end;
      end;
      if Found = 0 then
      begin
        Seen.Delimiter := ',';
        VLog('stopped ' + IntToStr(Seen.Count) + ' Volt process(es) under ' + AppDir + ': ' + Seen.DelimitedText);
        Result := True;
        Exit;
      end;
      Sleep(500);
    end;
    Seen.Delimiter := ',';
    VLog('FAILED to stop Volt''s processes under ' + AppDir + ' within 30 s: ' + Seen.DelimitedText);
    Result := False;
  finally
    Seen.Free;
  end;
end;

{ A running CLI is NEVER killed — it may be mid-`volt push` to a live PLC. Interactive: a Retry/Cancel box naming
  it. Silent (the connector's auto-update, a scripted uninstall): poll every 2 s up to /VOLTWAIT=<s> (default an
  hour), then give up. True when no CLI runs (any more); False when the run gave up or the user cancelled. }
function WaitForCli(Action: String): Boolean;
var Pid, Limit: Integer; Started: DWord; Path, Raw: String;
begin
  Result := True;
  if not FindCli(Pid, Path) then Exit;
  Raw := ExpandConstant('{param:VOLTWAIT|3600}');
  Limit := StrToIntDef(Raw, -1);
  if Limit < 0 then RaiseException('/VOLTWAIT=' + Raw + ' is not a number of seconds');
  VLog('waiting for volt.exe (pid ' + IntToStr(Pid) + ', ' + Path + ') before the ' + Action + ' - it is never stopped');
  if SilentRun then
  begin
    Started := GetTickCount;
    while FindCli(Pid, Path) do
    begin
      if GetTickCount - Started >= Limit * 1000 then
      begin
        VLog('gave up waiting for volt.exe (pid ' + IntToStr(Pid) + ') after ' + IntToStr(Limit) + ' s - no ' + Action + ' was done');
        Result := False;
        Exit;
      end;
      Sleep(2000);
    end;
  end
  else
    while FindCli(Pid, Path) do
      if MsgBox('Volt''s command-line tool is running (volt.exe, pid ' + IntToStr(Pid) + '):' + #13#10 + Path + #13#10#13#10 +
                'It may be writing to a PLC, so it is not stopped. Let it finish, then click Retry.' + #13#10 +
                'Cancel leaves Volt as it is.', mbError, MB_RETRYCANCEL) = IDCANCEL then
      begin
        VLog('gave up waiting for volt.exe (pid ' + IntToStr(Pid) + '): the ' + Action + ' was cancelled');
        Result := False;
        Exit;
      end;
  VLog('volt.exe exited - the ' + Action + ' continues');
end;

{ The CLI wait, then the stop — again from the wait when a CLI starts during the stop (StopOwn). 0 = Volt's processes
  are stopped and no CLI runs; 1 = the run gave up waiting for a CLI (or the user cancelled); 2 = StopOwn failed. }
function WaitThenStop(Action: String): Integer;
var CliStarted: Boolean;
begin
  repeat
    if not WaitForCli(Action) then begin Result := 1; Exit; end;
    if StopOwn(CliStarted) then begin Result := 0; Exit; end;
  until not CliStarted;
  Result := 2;
end;

{ A tray (VoltConnector.exe) running from under <app>, any layout. }
function ConnectorRunning: Boolean;
var Procs: TVoltProcesses; I: Integer; Exe: String;
begin
  Result := False;
  Procs := RunningProcesses;
  for I := 0 to GetArrayLength(Procs) - 1 do
  begin
    Exe := Procs[I].Path;
    if UnderApp(Exe) and (CompareText(ExtractFileName(Exe), 'VoltConnector.exe') = 0) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

{ Start the installed tray again when none runs — at the end of every setup that reached PrepareToInstall
  (DeinitializeSetup), and after an uninstall that did not happen. A run that gave up waiting for a CLI stopped
  nothing, but the auto-update's tray exited before it launched this setup; a run that stopped Volt's processes and
  then aborted (a locked file in [Files], a rollback) would otherwise leave no tray and no TwinCAT worker until the
  next login. After a completed install [Run] has started the tray, and this finds it running. }
procedure RelaunchConnector;
var Exe: String; Code: Integer;
begin
  if ConnectorRunning then
  begin
    VLog('the connector is running - nothing to relaunch');
    Exit;
  end;
  Exe := AppDir + '\connector\VoltConnector.exe';
  if not FileExists(Exe) then
  begin
    VLog('no installed connector under ' + AppDir + ' to relaunch');
    Exit;
  end;
  if Exec(Exe, '--silent', '', SW_HIDE, ewNoWait, Code) then VLog('relaunched the connector: ' + Exe)
  else VLog('FAILED to relaunch the connector ' + Exe + ': ' + SysErrorMessage(Code));
end;

{ PATH is a ';'-separated list: entries compared trimmed and case-insensitively, so the add and the remove agree by
  construction. Never a substring test — '\Volt\binx' contains '\Volt\bin'. }
function PathHasEntry(PathVal, Dir: String): Boolean;
var Rest, Part: String;
begin
  Result := False;
  Rest := PathVal + ';';
  while Pos(';', Rest) > 0 do
  begin
    Part := Trim(Copy(Rest, 1, Pos(';', Rest) - 1));
    Rest := Copy(Rest, Pos(';', Rest) + 1, Length(Rest));
    if CompareText(Part, Dir) = 0 then begin Result := True; Exit; end;
  end;
end;

{ Remove exactly Dir from the user PATH and give back the value AddPathEntry found, byte for byte: the value is split
  into its exact parts (n separators, n+1 parts, empty ones included — a trailing ';' is an empty last part), the
  parts that are Dir dropped, the rest joined again. A value that held nothing but Dir did not exist before the add,
  so it is deleted, not left empty. RegWriteStringValue keeps an existing value's type (REG_EXPAND_SZ stays expand,
  REG_SZ stays literal). True when Dir was there. }
function RemovePathEntry(Dir: String): Boolean;
var PathVal, Rest, Part, Kept: String; Left: Integer;
begin
  Result := False;
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal) then Exit;
  Kept := '';
  Left := 0;
  Rest := PathVal + ';';
  while Pos(';', Rest) > 0 do
  begin
    Part := Copy(Rest, 1, Pos(';', Rest) - 1);
    Rest := Copy(Rest, Pos(';', Rest) + 1, Length(Rest));
    if CompareText(Trim(Part), Dir) = 0 then Result := True
    else
    begin
      if Left > 0 then Kept := Kept + ';';
      Kept := Kept + Part;
      Left := Left + 1;
    end;
  end;
  if not Result then Exit;
  if Left = 0 then
  begin
    if not RegDeleteValue(HKEY_CURRENT_USER, 'Environment', 'Path') then VLog('FAILED to remove ' + Dir + ' from the user PATH');
  end
  else if not RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Kept) then
    VLog('FAILED to remove ' + Dir + ' from the user PATH');
end;

{ Append Dir so that RemovePathEntry gives the value back unchanged: no value → one holding only Dir (REG_EXPAND_SZ,
  Windows' own type for it); 'X' → 'X;Dir'; a value that is empty or ends in ';' keeps its last (empty) part after
  Dir: '' → 'Dir;', 'X;' → 'X;Dir;'. An existing value keeps its type. }
procedure AddPathEntry(Dir: String);
var PathVal: String;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal) then
    RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Dir)
  else if not PathHasEntry(PathVal, Dir) then
  begin
    if (PathVal = '') or (Copy(PathVal, Length(PathVal), 1) = ';') then PathVal := PathVal + Dir + ';'
    else PathVal := PathVal + ';' + Dir;
    RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal);
  end;
  { Measured, not assumed: read back. }
  if RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', PathVal) and PathHasEntry(PathVal, Dir) then
    VLog('PATH carries ' + Dir)
  else
    VLog('FAILED to put ' + Dir + ' on the user PATH');
end;

{ An uninstaller in <app>: unins000.exe by default, but Inno numbers on (unins001, ...) when the log there is not one
  it can reuse. }
function HasUninstaller: Boolean;
var FR: TFindRec;
begin
  Result := FindFirst(AppDir + '\unins???.exe', FR);
  if Result then FindClose(FR);
end;

{ Set when setup reaches PrepareToInstall: from there on it may have stopped the tray (or the auto-update's tray has
  exited), so DeinitializeSetup brings one back whatever happened next. }
var Prepared: Boolean;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Mode: String;
begin
  Result := '';
  Prepared := True;
  if WizardSilent() then Mode := 'silent' else Mode := 'interactive';
  VLog('install {#AppVersion} -> ' + AppDir + ', mode=' + Mode + ', existing=' + IntToStr(Integer(HasUninstaller)));
  { The CLI wait comes FIRST, before anything is stopped: StopOwn stops the TwinCAT worker
    (connector\VoltBridgeTwincat.exe), the other end of the pipe a running `volt push` writes a live PLC project
    through — stopping it first would cut that push mid-write while volt.exe itself was spared. A give-up leaves
    Volt exactly as it was. The tray is relaunched by DeinitializeSetup on every outcome. }
  case WaitThenStop('update') of
    1: Result := 'Volt''s command-line tool (volt.exe) is running, so Volt was not updated. The update is offered again later.';
    2: if StopRefusal <> '' then
         Result := 'Volt was not updated: ' + StopRefusal + '. Nothing was changed.'
       else
         Result := 'Volt could not stop its own processes under ' + AppDir + ' - nothing was changed. See the setup log.';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then AddPathEntry(AppDir + '\bin');
end;

function InitializeUninstall(): Boolean;
var Mode: String;
begin
  if UninstallSilent() then Mode := 'silent' else Mode := 'interactive';
  VLog('uninstall {#AppVersion} from ' + AppDir + ', mode=' + Mode);
  { The wait before anything is stopped or removed (an uninstall that gives up leaves Volt exactly as it was, tray
    included); the stop before Inno deletes a file — a running self-contained .NET process holds its own runtime
    open, and an uninstall that could not stop one would remove part of <app> and report success. Both here, where
    the uninstall can still refuse; a stopped tray is relaunched if the user then declines (DeinitializeUninstall). }
  Result := WaitThenStop('uninstall') = 0;
  if (not Result) and (StopRefusal <> '') and not UninstallSilent() then
    MsgBox('Volt was not uninstalled: ' + StopRefusal + '.', mbError, MB_OK);
  { A give-up after a CLI started DURING the stop, or a failed stop, may have stopped the tray. }
  if not Result then RelaunchConnector;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if RemovePathEntry(AppDir + '\bin') then VLog('PATH no longer carries ' + AppDir + '\bin')
    else VLog('PATH no longer carries ' + AppDir + '\bin (it did not)');
  end;
end;

{ An uninstall that stopped the tray and then removed nothing (the user declined the confirmation) gives it back. }
procedure DeinitializeUninstall();
begin
  if FileExists(AppDir + '\connector\VoltConnector.exe') then RelaunchConnector;
end;

procedure DeinitializeSetup();
var Dir: String;
begin
  if Prepared then RelaunchConnector;
  { Mirror Setup's own log into the shared store (%LOCALAPPDATA%\Volt\logs). Inno leaves it in %TEMP% under a name
    nobody looks for, and an auto-update runs with no human watching. Always runs, an aborted install included —
    the case worth keeping. Timestamped to the second: a failed update followed by a retry must not overwrite it. }
  Dir := ExpandConstant('{localappdata}\Volt\logs');
  if ForceDirectories(Dir) then
    CopyFile(ExpandConstant('{log}'), Dir + '\install-' + GetDateTimeString('yyyy-mm-dd_hhnnss', '-', '-') + '.log', True);
end;
