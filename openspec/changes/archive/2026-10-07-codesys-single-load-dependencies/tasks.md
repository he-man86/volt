## 0. Analyse

- [x] 0.1 Confirm or refute the reading in the proposal: in the field case the two `System.Text.Json` copies come
      from the download folder (the script's folder) and the staged `%TEMP%\Volt\codesys-bridge\<pid>` copy. Find which
      resolver (IronPython's `sys.path` probing, `BridgeAssemblyResolver`, the CLR's own probing, a second script run)
      loaded the download-folder copy. If refuted, record why here and stop.
      **Confirmed** (2026-10-07, live on 3.5.21.40 with an AssemblyLoad stack trace per load): the download-folder copies were loaded by IronPython's own `AssemblyResolve` handler (`PythonContext.CurrentDomain_AssemblyResolve → Assembly.LoadFile`, probing `sys.path` in order), which answers for assemblies IronPython loaded (`clr.AddReferenceToFileAndPath` made the bridge one) and for requests with no requesting assembly; the staged `System.Text.Json` was loaded by `BridgeAssemblyResolver` (`Assembly.LoadFrom`). See "Volt's assessment and plan" in proposal.md and DIALECT V6.

## 1. Reproduce

- [x] 1.1 Reproduce a double load: CODESYS 3.5.22.x if available; otherwise force the suspected orders on 3.5.21 (run
      the start script twice in one session; make staging fall back; start from a folder on `sys.path`). Record the
      `loadConflicts` report and whether calls fail.
      Reproduced on 3.5.21.40 started from the bundle folder (folder first on `sys.path`): `LOAD CONFLICT: System.Text.Json loaded 2 times` (download folder; `%TEMP%\Volt\codesys-bridge\29164`), and EVERY request failed — `MissingFieldException: Volt.Contracts.WireJson.Read` in `PipeServer.Handle`, the pipe dropped before any frame, `health` included. The offline test found a second route: a second run of the script deleted the running bridge's not-yet-loaded dependencies (`_prune`), leaving the next lazy load to be answered from elsewhere.
- [x] 1.2 Re-check the two earlier field cases (3.5.21.50 `WireJson.Write`, 3.5.17 `PipeClient.Call`) against the
      cause found — same family or not.
      Same family: `WireJson.Write` (3.5.21.50) and `PipeClient.Call(…Action<JsonElement>…)` (3.5.17) are members whose signatures carry `System.Text.Json` types; in the reproduction `PipeClient.Call` bound the staged copy and `WireJson.Write` the download one. No log of either session exists to show which route (sys.path or `_prune`) produced their second copy.

## 2. Test red

- [x] 2.1 A test that fails while a second copy of a shipped dependency can be loaded through the found path.
      `Volt.Ide.Codesys.Tests/StartScriptLoadTests`: the shipped script, verbatim, in IronPython 2.7.12 (NuGet, the version SP21 ships) in an AppDomain with no Volt assembly in its base, the script's folder on `sys.path`; once, twice in one session, staging failing. Red on the old script (`Volt.Wire` from the download folder), then on each partial fix (a second `System.Text.Json`; no `System.Text.Json` at all after a re-run).

## 3. Fix

- [x] 3.1 One copy per dependency per process, whatever the start path.
      `start_volt_codesys.py`: `Assembly.LoadFrom` + `clr.AddReference(assembly)` instead of `AddReferenceToFileAndPath`; every `sys.path` folder holding `Volt.Ide.Codesys.dll` taken off first; `_prune` removes the bridge DLL first and leaves a folder whole while a session has it loaded.
- [x] 3.2 A detected second copy at start refuses with a clear coded error (name both paths, say "restart the IDE and
      start the bridge once") instead of `INTERNAL_ERROR` on every call.
      A conflict at start: the bridge serves nothing — `health.unsupported` = "Volt's own assemblies are loaded more than once in this CODESYS process, so the bridge serves nothing: <each conflict, both paths>. Restart CODESYS and start the bridge once.", rows idle, every other op `IDE_UNSUPPORTED` with that sentence (no new code — see proposal.md). Pinned by `BridgeStartLogTests`. Delivered as a frame only where the frame layer binds; measured live with the old script + new DLLs: the start refuses (message window, log) but `PipeServer` itself is split, so the connection drops as before.

## 4. Verify

- [x] 4.1 The reproduction in 1.1 now loads one copy and calls succeed (or refuses with the new code where a copy was
      already loaded by something outside volt's control).
      Live, same start (bundle folder first on `sys.path`), fixed build: every Volt assembly and `System.Text.Json` once, all from `%TEMP%\Volt\codesys-bridge\16960`; `bound: load conflicts: none`; `health` without `loadConflicts`; `refs` answered (37 items); `build` answered (0 errors).
- [x] 4.2 Full C# suites green; PLCAssist's live suites (`volt-features`, `plc-version-gate`) green on 3.5.21.
      Volt.Ide.Codesys.Tests, Volt.Engine.Tests, Volt.Repo.Gates, Volt.Contracts.Tests, Volt.Cli.Tests, Volt.Connector.Tests and `bun run check` green. PLCAssist's own live suites (`volt-features`, `plc-version-gate`) are theirs to run — not run here.
