## Volt's assessment and plan (2026-10-07)

**Measured (1.1).** The CODESYS bundle shipped 15 assemblies into `CODESYS.exe`: `Volt.Ide.Codesys`, `Volt.Contracts`,
`Volt.Engine`, `Volt.Engine.Host`, `Volt.Relay`, `Volt.Wire`, `System.Text.Json` 10.0.0.12, `System.Text.Encodings.Web`,
`System.IO.Pipelines`, `Microsoft.Bcl.AsyncInterfaces` (all 10.0.0.12), `System.Memory` 4.0.5.0, `System.Buffers`,
`System.Numerics.Vectors`, `System.Runtime.CompilerServices.Unsafe`, `System.Threading.Tasks.Extensions` (live on SP21:
DIALECT V3/V6). Every `Volt.*` netstandard assembly referenced `System.Text.Json` **10.0.0.0**; the bridge itself
10.0.0.12 — the mismatch that sent every load through a resolver. ILRepack 2.0.48 (`/internalize`) merges all 15 into
`Volt.Ide.Codesys.dll` (1.8 MB) with nothing refused; its only warnings are duplicate `ILLink.Substitutions.xml`
resources (trimmer data, inert on net48). The merged assembly references **only** `mscorlib`, `System`, `System.Core`,
`System.Numerics`, `netstandard` 2.0.0.0 and `System.ValueTuple` 4.0.5.0 — the framework's own. `System.ValueTuple`
4.0.5.0 is not new: `System.Text.Json` referenced it before, the bundle never shipped it, and net48 binds it from the
framework (it worked live on every SP21 run). Its stamped `FileVersion`/`ProductVersion` survive the merge (the release
health reports is read off it). Nothing needed a fallback.

**Built.** The merge is a build target (`Volt.Ide.Codesys.csproj`, `VoltBundle`, after `Build`): ILRepack, run by
`dotnet`, writes `bin\<cfg>\net48\bundle\Volt.Ide.Codesys.dll`; the plain output beside it stays unmerged, because the
offline suites reach Volt's internals across assembly boundaries and the merge internalizes them. `build-cli.ps1` ships
the `bundle` folder only (→ `dist\Codesys`, → the connector's `codesys-scriptcommands`, → the payload and installer);
`ide.ps1` serves the bundle; the install gate checks the merged DLL's stamp. Staging stays: one DLL, plus the relay
sidecars (`*.json`) the bridge reads from its own folder.

**Deleted, because the merge makes it unreachable:** `BridgeAssemblyResolver` (and the module-initializer attribute it
declared), the start script's `_off_sys_path`, the start refusal over a load conflict (`PipeHost.CannotServe`,
`BridgePipeHost`'s `cannotServe`), the start log's `bound:`/`LOAD CONFLICT` lines and the later-load watch
(`BoundAssemblies`, `PipeHost.WatchLaterLoads`), `LoadedCopies`, the copies a failed call listed (`CallFailure`), and
the version-mismatch comments (`Directory.Packages.props`). The start log now names the one file the bridge was loaded
from. `Assembly.LoadFrom` in the start script stays — not for the resolver race, but because a second run of the script
must get the copy already loaded (IronPython's own `LoadFile` loads a new path as a second copy).

**The wire: `health.loadConflicts` is removed, and so is the load suffix on `INTERNAL_ERROR`. This IS a wire change,
and PLCAssist should know it, but it breaks no reader.** After the merge the field could only ever say two things:
nothing (a single Volt assembly cannot be loaded twice by the start script — `LoadFrom` returns the loaded identity), or
a FALSE finding — `System.Text.Json` is still judged by name, and the only `System.Text.Json` assemblies left in the
process are other plugins' (Volt's is internal to its own assembly). For the TwinCAT worker (net10, its own process, one
load context, `System.Text.Json` from the shared framework) it was always empty. Keeping a field whose only reachable
value is wrong is a fallback, so it goes. What PLCAssist sees:
- `health.loadConflicts`: never present. It was already absent on every healthy start, so a reader that treats absent
  as healthy reads the same thing. The load-conflict flavour of `IDE_UNSUPPORTED` ("…loaded more than once… Restart
  CODESYS and start the bridge once.") can no longer be sent; `IDE_UNSUPPORTED` remains, for a missing capability only.
  PLCAssist can drop the mapping that told the two apart by `loadConflicts`.
- An uncoded failure's `INTERNAL_ERROR` message is `<ExceptionType>: <message>`, always — the `[loaded: …]` /
  `[load conflict: …]` suffix on binding failures is gone. A reader that kept the whole message keeps working.

**TwinCAT** stays out of scope: measured above, nothing of Volt's is resolved by a foreign handler in the worker.

**Verified live (4.1), each run its own fixture IDE (`ide.ps1 -Instance single-assembly`), started from a download-style
folder (`…\PLCAssistBridge-CODESYS\codesys-scriptcommands`, holding the bundle and the scripts) that is FIRST on
`sys.path`, `VOLT_BRIDGE_DLL` unset:**

| CODESYS | bridge | Volt/STJ assemblies loaded | `health.loadConflicts` | `refs` / `build` |
|---|---|---|---|---|
| 3.5.21.40 (SP21) | merged (`3003317785`) | `Volt.Ide.Codesys` once, staged; no `System.Text.Json` assembly | absent | served; e2e 292 pass / 0 fail (push, fetch, build included) |
| 3.5.22.40 (SP22) | shipped 0.1.17381 (`4e968f52b9`) | SP22's own STJ 8.0.0.5 + 10.0.0.2, Volt's 10.0.0.12 from download AND staged folder; Volt.* from the download folder | STJ loaded 4 times | served (the customer's 3.5.22.10 failure did not reproduce on .40) |
| 3.5.22.40 (SP22) | predecessor fix (`65578d1e58`) | Volt's own once, staged; SP22's own STJ 8.0.0.5 + 10.0.0.2 beside it | STJ loaded 3 times | **refused: `IDE_UNSUPPORTED` on every call** |
| 3.5.22.40 (SP22) | merged | `Volt.Ide.Codesys` once, staged; SP22's own STJ untouched | absent | served |

The SP22 row for the predecessor is the strongest case for this change: **SP22 loads `System.Text.Json` itself**
(8.0.0.5 and 10.0.0.2 from its `LacBinaries\GAC_MSIL`, before Volt starts), so the predecessor's name-based conflict
rule refused every call on every SP22 install even though Volt's own copy was loaded once. The merged bridge has no
such rule and no such dependency. DIALECT V6 records all of it. To target SP22 at all, `ide.ps1` gained an explicit
`-CodesysVersion` (default `3.5.21.40`, never the newest installed: recordings stay SP21).

## Why

`codesys-single-load-dependencies` (archived 2026-10-07) fixed a customer's double `System.Text.Json` load by making
OUR `AssemblyResolve` handler win the race against IronPython's (load the bridge with `Assembly.LoadFrom`, take the
download folder off `sys.path`) and by refusing when a second copy is still seen (`loadConflicts` → `IDE_UNSUPPORTED`).
That removes the observed route but keeps the race: every bridge dependency still reaches `CODESYS.exe` through an
`AssemblyResolve` handler, because Volt's assemblies reference `System.Text.Json` 10.0.0.0 while 10.0.0.12 ships and the
CLR binds strong names by exact version. Any other handler in the process (IronPython, another plugin carrying its own
STJ) can answer first. The owner does not want a fix that depends on winning that race, nor a refusal as the fallback.

## What Changes

- Everything Volt loads into `CODESYS.exe` ships as ONE assembly, `Volt.Ide.Codesys.dll`, with its dependencies merged
  and internalized at build (`Volt.*`, `System.Text.Json` and its net48 dependencies). Nothing is left to resolve, and
  an internalized STJ cannot collide with any other copy in the process.
- Deleted with it: `BridgeAssemblyResolver`, the start script's `sys.path` surgery, the `loadConflicts` start refusal,
  and the version-mismatch workaround — whatever the merge makes unreachable. Staging stays (in-place updates while
  CODESYS holds the file), as a single-file copy.
- TwinCAT is out of scope unless measured otherwise: its bridge is a separate worker process, not loaded into the IDE.
- No wire change. (Revised in the assessment above: `health.loadConflicts` and the `INTERNAL_ERROR` load suffix go,
  compatibly for every reader.)

## Impact

- `packages/volt-cli`: the CODESYS bridge build/packaging (`scripts/build-cli.ps1`, the csproj), `start_volt_codesys.py`,
  `Volt.Ide.Codesys/AssemblyResolver.cs`, `PipeHost`/`BridgePipeHost` start path, `LoadedCopies`/`HealthResponse`
  (if `loadConflicts` becomes unreachable), docs + DIALECT V6, the packaging and start-script tests.
- Clients: none break (PLCAssist: `loadConflicts` never present — absent as on every healthy start before; see the
  assessment for what it can drop).
