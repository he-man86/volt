{ The running processes, from Windows' own process snapshot — included by Volt.iss's [Code].

  NOT WMI (environment-dependency-audit 2.7). The installer found Volt's processes through WMI's scripting API
  (its process class): on a machine whose Windows Management Instrumentation service is disabled or broken, ConnectServer
  raised and Setup ended on a raw Pascal runtime error — an install, update or uninstall refused for a fact about a
  service Volt does not use otherwise. CreateToolhelp32Snapshot is kernel32 itself: it lists every process with its
  image NAME (what WMI's `Name` was) without opening any, and QueryFullProcessImageNameW reads a process's PATH with
  PROCESS_QUERY_LIMITED_INFORMATION — which an elevated process of the same user grants, where WMI's ExecutablePath
  read null. Setup is a 32-bit process (Setup.e32), so PROCESSENTRY32W is the 32-bit layout: 556 bytes. }

type
  TProcessEntry32W = record
    dwSize: DWord;
    cntUsage: DWord;
    th32ProcessID: DWord;
    th32DefaultHeapID: DWord;   { ULONG_PTR: 4 bytes in the 32-bit Setup }
    th32ModuleID: DWord;
    cntThreads: DWord;
    th32ParentProcessID: DWord;
    pcPriClassBase: Longint;
    dwFlags: DWord;
    szExeFile: array[0..259] of Char;
  end;

  { One running process: its id, its image name (always), and its full path ('' when even
    PROCESS_QUERY_LIMITED_INFORMATION is refused — a protected process, or another user's). }
  TVoltProcess = record
    Pid: DWord;
    Name: String;
    Path: String;
  end;
  TVoltProcesses = array of TVoltProcess;

function CreateToolhelp32Snapshot(Flags: DWord; Pid: DWord): THandle; external 'CreateToolhelp32Snapshot@kernel32.dll stdcall';
function Process32FirstW(Snapshot: THandle; var Entry: TProcessEntry32W): BOOL; external 'Process32FirstW@kernel32.dll stdcall';
function Process32NextW(Snapshot: THandle; var Entry: TProcessEntry32W): BOOL; external 'Process32NextW@kernel32.dll stdcall';
function OpenProcess(Access: DWord; Inherit: BOOL; Pid: DWord): THandle; external 'OpenProcess@kernel32.dll stdcall';
function QueryFullProcessImageName(Process: THandle; Flags: DWord; Name: String; var Size: DWord): BOOL; external 'QueryFullProcessImageNameW@kernel32.dll stdcall';
function TerminateProcess(Process: THandle; ExitCode: UINT): BOOL; external 'TerminateProcess@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): BOOL; external 'CloseHandle@kernel32.dll stdcall';

const
  TH32CS_SNAPPROCESS = $00000002;
  PROCESS_TERMINATE = $0001;
  PROCESS_QUERY_LIMITED_INFORMATION = $1000;

{ The path a process runs from, '' when it cannot be read. }
function ImagePath(Pid: DWord): String;
var H: THandle; Size: DWord; Buf: String;
begin
  Result := '';
  H := OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, Pid);
  if H = 0 then Exit;
  try
    Size := 1024;
    Buf := StringOfChar(#0, Size);
    if QueryFullProcessImageName(H, 0, Buf, Size) then Result := Copy(Buf, 1, Size);
  finally
    CloseHandle(H);
  end;
end;

{ The entry's image name: szExeFile up to its terminating #0. }
function EntryName(var E: TProcessEntry32W): String;
var I: Integer;
begin
  Result := '';
  for I := 0 to 259 do
  begin
    if E.szExeFile[I] = #0 then Exit;
    Result := Result + E.szExeFile[I];
  end;
end;

{ Every running process. A snapshot that cannot be taken RAISES, naming the Windows error — never an empty list,
  which would read as "nothing of Volt's runs" and let an update overwrite a running connector. }
function RunningProcesses: TVoltProcesses;
var Snap: THandle; E: TProcessEntry32W; N: Integer; More: Boolean;
begin
  SetArrayLength(Result, 0);
  Snap := CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (Snap = 0) or (Snap = THandle(-1)) then
    RaiseException('the Windows process snapshot failed: ' + SysErrorMessage(DLLGetLastError));
  try
    E.dwSize := 556;
    More := Process32FirstW(Snap, E);
    if not More then RaiseException('the Windows process snapshot listed nothing: ' + SysErrorMessage(DLLGetLastError));
    N := 0;
    while More do
    begin
      SetArrayLength(Result, N + 1);
      Result[N].Pid := E.th32ProcessID;
      Result[N].Name := EntryName(E);
      if E.th32ProcessID = 0 then Result[N].Path := '' else Result[N].Path := ImagePath(E.th32ProcessID);
      N := N + 1;
      E.dwSize := 556;
      More := Process32NextW(Snap, E);
    end;
  finally
    CloseHandle(Snap);
  end;
end;

const
  ERROR_ACCESS_DENIED = 5;

{ Stop one process (exit code 0, as WMI's Terminate(0) did). 0 when stopped, else the Windows error that refused it —
  read right after the refusing call, before CloseHandle. ERROR_ACCESS_DENIED is an ELEVATED process seen from this
  per-user setup (its path IS readable through PROCESS_QUERY_LIMITED_INFORMATION; terminating it is not granted). }
function TerminatePid(Pid: DWord): DWord;
var H: THandle;
begin
  H := OpenProcess(PROCESS_TERMINATE, False, Pid);
  if H = 0 then
  begin
    Result := DLLGetLastError;
    Exit;
  end;
  try
    if TerminateProcess(H, 0) then Result := 0 else Result := DLLGetLastError;
  finally
    CloseHandle(H);
  end;
end;
