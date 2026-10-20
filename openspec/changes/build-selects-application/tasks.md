## 1. Measure

- [x] 1.1 Live TwinCAT 4024 MultiProject: the call that builds ONE PLC project, its diagnostics scoped to it, and what
      TwinCAT's own "Before building: Save all changes" saves in that case (DIALECT row).
      **2026-10-20 (DIALECT D46):** `SolutionBuild.BuildProject("<config>|<platform>", "<plcproj relative to the .sln>",
      true)` compiles that PLC project alone, synchronously; `LastBuildInfo` counts it alone; the Build pane holds the last
      build only (so each PLC project's diagnostics are read right after its build); the save-all still saves every
      changed document of the solution, not only the built project's.

## 2. Tests red

- [x] 2.1 Transport: `build` with `applications: [root]` builds only that application on both drivers (fakes record which).
      Engine `BuildSelectsApplicationTests`, transport `PipeTransportTests`, CLI `BlackBoxTests`, CODESYS
      `CodesysDiagnosticChildNameTests` (one build command, that application's messages), TwinCAT
      `TcBuildSelectsApplicationTests` (`BuildProject`, panes read right after it); e2e `multi-application`.
- [x] 2.2 A root that names no application → `BAD_REQUEST` naming it; nothing built. An empty list is refused the same way.
- [x] 2.3 Absent `applications` → every application built, as today.

## 3. Implement

- [x] 3.1 `BuildRequest.Applications`, `BuildService`, both drivers; `volt build --app`.
- [ ] 3.2 OpenRPC, `wire.html`; schema re-pinned at protocol 2 (owner and PLC Assist agree on the release first).
      OpenRPC regenerated and `wire.html` updated; the pin test is skipped until the protocol-2 step re-pins it.
