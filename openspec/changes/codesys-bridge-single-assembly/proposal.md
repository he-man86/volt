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
- No wire change.

## Impact

- `packages/volt-cli`: the CODESYS bridge build/packaging (`scripts/build-cli.ps1`, the csproj), `start_volt_codesys.py`,
  `Volt.Ide.Codesys/AssemblyResolver.cs`, `PipeHost`/`BridgePipeHost` start path, `LoadedCopies`/`HealthResponse`
  (if `loadConflicts` becomes unreachable), docs + DIALECT V6, the packaging and start-script tests.
- Clients: none (PLCAssist keeps the same wire; `loadConflicts` absent as today on a healthy start).
