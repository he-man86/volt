## Volt's assessment and plan (2026-10-07)

**Confirmed, and the cause is exactly PLCAssist's suspicion, one level more precise.** Reproduced on CODESYS 3.5.21.40
(SP21 Patch 4) with a fixture IDE, the packaged bundle in a download-style folder, that folder first on `sys.path`, no
`VOLT_BRIDGE_DLL`, and an `AssemblyLoad` stack trace per load. On our machine the double load was not latent: EVERY request
failed (`MissingFieldException: Volt.Contracts.WireJson.Read` in `PipeServer.Handle`, so not even `health` answered — the
pipe dropped), with the customer's `System.Text.Json loaded 2 times` in the start log, download folder vs.
`%TEMP%\Volt\codesys-bridge\<pid>`.

Who loaded what (from the traces; IronPython 2.7.12 is what SP21 runs scripts in, decompiled to confirm):

- `clr.AddReferenceToFileAndPath(staged)` loads the bridge with IronPython's own `Assembly.LoadFile`, which makes it
  IronPython's. IronPython's `AssemblyResolve` handler is registered before the bridge's own and answers every request
  from an assembly IT loaded, and every request with NO requesting assembly (the CLR raises those while reading a member's
  signature), by `LoadFile` from the FIRST `sys.path` folder holding the file. CODESYS puts the script's folder on
  `sys.path` before the staged folder (which `AddReferenceToFileAndPath` appends at the end).
- So `Volt.Wire`, `Volt.Contracts`, `Volt.Engine*`, `Volt.Relay` and one `System.Text.Json` came from the DOWNLOAD
  folder (`PythonContext.CurrentDomain_AssemblyResolve → Assembly.LoadFile`), while a request IronPython declined reached
  `BridgeAssemblyResolver`, which loaded a second `System.Text.Json` from the STAGED folder (`Assembly.LoadFrom`).
- Requests reach the resolvers at all because Volt's netstandard assemblies reference `System.Text.Json` 10.0.0.0 and
  10.0.0.12 ships, so the CLR's own binding always misses. Which resolver answers a given request (and so which copy a
  member binds) depends on load order — which is why it broke on 3.5.22.10 and on our 3.5.21.40 but worked by luck on
  PLCAssist's 3.5.21.40.
- A second route to the same split, found by the offline test: `_stage` began with `_prune`, a bare `rmtree` of every
  staged folder. A running session's folder is only PARTLY locked (the assemblies already loaded), so a second run of the
  script — or a second CODESYS starting Volt — deleted the running bridge's not-yet-loaded dependencies, and the next lazy
  load was answered from wherever else a copy was found (the download folder, again).
- The two earlier field cases are the same family: `WireJson.Write` (3.5.21.50) and `PipeClient.Call(…JsonElement…)`
  (3.5.17) are both members whose signatures carry `System.Text.Json` types, bound across the split.

**The fix (one copy, one folder, whatever the start path):**

1. `start_volt_codesys.py` loads the bridge with `Assembly.LoadFrom` and hands that assembly to `clr.AddReference` —
   IronPython then does not own it and leaves its requests alone — and first takes every `sys.path` folder holding
   `Volt.Ide.Codesys.dll` off `sys.path`, so a request with no requester finds nothing there and reaches the bridge's own
   resolver. Every dependency now loads from the folder the bridge was loaded from (staged, or the source when staging
   falls back).
2. `_prune` removes the bridge DLL first and leaves the folder whole when that fails (a session has it loaded).
3. A conflict still present at start makes the bridge serve nothing: `health.unsupported` carries a fixed sentence naming
   every copy and ending "Restart CODESYS and start the bridge once.", every row is idle, and every other op answers
   `IDE_UNSUPPORTED` with that sentence. **No new code:** `IDE_UNSUPPORTED` already means "this IDE cannot be served; do
   not retry the call; the IDE has to change", which is the right reaction (here: restart it), and Volt's own frontends and
   connector already show it and stop retrying. PLCAssist can tell the two apart by `health.loadConflicts` being present.
   Limit: the refusal reaches a client only where the frame layer itself still binds (the field 3.5.22.10 shape, where
   errors arrived as `INTERNAL_ERROR` frames). In the shape we reproduced even `PipeServer` was split, so the connection
   drops, as before, and the refusal is in the CODESYS message window and the Volt log.

No wire change. Test: `Volt.Ide.Codesys.Tests/StartScriptLoadTests` runs the shipped script verbatim in IronPython 2.7.12
(NuGet) in an AppDomain whose base holds no Volt assembly, the script's folder on `sys.path`: once, twice in one session,
and with staging failing. Red on the old script (Volt.* from the download folder; with only the load change, a second
`System.Text.Json`; with both of those but the old `_prune`, the second run leaves the bridge without its `System.Text.Json`), green on the new one.

## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what a field session reported, and
our reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested
change are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's
intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**On a customer's CODESYS 3.5.22.10, the shipped bridge 0.1.17381 (volt `4e968f52b9`) failed EVERY call with a
`MissingMethodException`, and the bridge's own load-conflict report (`loadConflicts`, codesys-minimum-version) says
why: the SAME `System.Text.Json` was loaded twice into the IDE process, from two folders.**

Field record (PLCAssist chat `b300f16e`, 2026-10-07 08:23 UTC, brand-new user: one download 08:17, one enrolment
08:19, bar connected 08:22; `refs` and `build` both answered `INTERNAL_ERROR`):

```
MissingMethodException: Method not found: 'System.Nullable`1<System.Text.Json.JsonElement> Volt.Wire.PipeRequest.get_Body()'.
[load conflict: System.Text.Json loaded 2 times:
  10.0.0.12 (file 10.0.1226.42308, product 10.0.12+95017c711e…) at C:\Users\SCM\Downloads\PLCAssistBridge-CODESYS-eb45f438\codesys-scriptcommands\System.Text.Json.dll;
  10.0.0.12 (file 10.0.1226.42308, product 10.0.12+95017c711e…) at C:\Users\SCM\AppData\Local\Temp\Volt\codesys-bridge\22164\System.Text.Json.dll]
```

Identical version and build, two paths: the original download folder (where `start_volt_codesys.py` lives and runs
from) and the per-session staged copy (`_stage` in `start_volt_codesys.py`). Two load contexts give two distinct
`JsonElement` types, so `Volt.Wire` bound to one cannot find a member typed with the other — every pipe call fails.

The same family was seen twice before, then unexplained (no load report existed yet):
- 2026-09-28, CODESYS 3.5.21.50: `MissingFieldException … Volt.Contracts.WireJson.Write` (Finnish Windows).
- 2026-09-30, CODESYS 3.5.17: `MissingMethodException … Volt.Wire.PipeClient.Call(String, Object, Action<JsonElement>, Int32)`.
Both name members whose signatures carry `System.Text.Json` types.

**REPRODUCED by PLCAssist on CODESYS 3.5.21.40 (2026-10-07), bridge 0.1.17381, packaged zip, nothing else changed:**
- CODESYS puts a script's OWN folder on IronPython's `sys.path` (measured: `['…\CODESYS\ScriptLib\4.1.0.0',
  '<the folder of the running script>']`). The README tells users to run `start_volt_codesys.py` via *Execute Script
  File*, so the bridge folder is on `sys.path` for every real user.
- Started that way (bridge folder first on `sys.path`, the fixture open), `health` answers
  `loadConflicts: ["System.Text.Json loaded 2 times: 10.0.0.12 … at <bridge folder>\codesys-scriptcommands\System.Text.Json.dll;
  10.0.0.12 … at %TEMP%\Volt\codesys-bridge\<pid>\System.Text.Json.dll"]` — the customer's report, exactly.
- On 3.5.21.40 the calls still WORK with the two copies loaded (`refs` → 32 items); on the customer's 3.5.22.10 every
  call fails. So the double load is universal and latent; whether it breaks depends on which copy each caller binds.
- Started the way every volt/PLCAssist test starts it — a wrapper script in ANOTHER folder exec-ing
  `start_volt_codesys.py` — there is ONE copy (all from `%TEMP%`). Running the start script twice in one session also
  gives one copy. That is why no test ever saw it.
- Repro script: open a project, `sys.path.insert(0, <bridge>\codesys-scriptcommands)`, exec `start_volt_codesys.py`,
  then `health` over the relay and read `loadConflicts`.

Our reading (to verify):
- `start_volt_codesys.py` stages the DLLs to `%TEMP%\Volt\codesys-bridge\<pid>\` and loads the COPY
  (`clr.AddReferenceToFileAndPath(staged)`); its own comment says "the deps can still resolve from the original
  folder, and _stage falls back to it".
- The script's folder (the download folder) is on IronPython's `sys.path` because CODESYS runs the script from there,
  and IronPython resolves assemblies by probing `sys.path` — so a dependency request can be answered from the ORIGINAL
  folder by IronPython while the bridge's own resolver (`BridgeAssemblyResolver`, `Assembly.LoadFrom` keyed off the
  staged DLL's location) answers from the staged copy. Whichever resolver runs first for a given request decides
  which copy a caller binds to; that order may differ per CODESYS release (3.5.22.10 here; it does not reproduce on
  our 3.5.21.40, where the same release passes every live suite).
- Other candidates: the script run twice in one IDE session (first run falling back to the source when staging was
  incomplete, e.g. antivirus holding a freshly downloaded DLL; second run loading the staged copy).

What is not known: which resolver loaded the Downloads copy, and whether 3.5.22 changes the resolve order or ships
its own STJ that changes it.

## What Changes

- **Every Volt dependency is loaded exactly once per IDE process, from one folder.** However the bridge is started
  (script run once or twice, staging complete or fallen back, any CODESYS release from the supported floor up), a
  request for `System.Text.Json`, `Volt.*` or another shipped dependency resolves to the copy already loaded, never
  to a second path.
- If a second copy is still detected at start (`loadConflicts` non-empty), the bridge refuses with a clear coded
  error naming the two paths and the fix (restart the IDE, start the bridge once) instead of failing every call with
  `INTERNAL_ERROR` / `MissingMethodException`. The code and wording are volt's choice; PLCAssist will map it.
- No change to the wire protocol.

## Impact

- `packages/volt-cli/scripts/start_volt_codesys.py` (`_stage`, the load sequence) and/or the bridge's assembly resolver
  (`BridgeAssemblyResolver`) — volt's call.
- Possibly the health/start path that already computes `loadConflicts`.
- Clients: PLCAssist maps the new refusal code if one is added; otherwise none.
