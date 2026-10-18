## 1. Measure

- [x] 1.1 Live: the full TwinCAT e2e and the release-matrix TwinCAT cell with the x86 single-file worker
      (`ide.ps1 -BridgeDir dist\TwincatBridge`) on TcXaeShell 4024. Green = go; a failure is fixed test-first or reported.
      Measured 2026-10-18 (build-cli [3b] publish line, TcXaeShell 15.0 / 3.1.4024.74 32-bit): the worker ran under
      WOW64 (32-bit), one per pipe, and spawned no `VoltTwincatExplorer.exe` (in-process read). TwinCAT Project14 e2e
      317 pass / 97 skip / 0 fail (= the x64+helper baseline); multi-application (`TwinCAT MultiProject`) 12/12. The
      matrix cell's judgement (`judge`, release-matrix-cells.ts) over that run's `VOLT_E2E_REPORT`: GREEN twincat-32.
      `release-matrix.ts` itself has no worker-folder option (it builds and serves bin\Release) - 2.3 gives it one.

## 2. Build

- [x] 2.1 Connector: pick the worker by the XAE's bitness; offline test per cell (32-bit XAE → x86, 64-bit → x64).
      `TwincatWorkers(X86, X64)` + `ProcessBitness.Is32Bit` (Volt.Wire, `IsWow64Process`) in `TwincatFleet.Tick`; a missing
      build of the XAE's bitness spawns nothing and is named once (`Unservable`), an unreadable bitness waits a pass.
      `TwincatFleetTests` written red first (did not compile), then green: 6 new cases (each bitness, mixed pair, missing
      build ×2, unreadable bitness); Connector suite 152/152.
- [x] 2.2 Delete `Volt.Ide.Twincat.Explorer`, `Reader.X86Helper` and their gates; installer ships both worker builds.
      Deleted the project (+ sln entry, worker csproj reference), the served/`--check` helper protocol in `TcHierarchy`
      (now `Reads(xae, worker)`: match or `IDE_UNSUPPORTED` naming both bitnesses), `TwincatHierarchyReaderRuntimeTests`.
      `build-cli.ps1` copies the [3b] x86 single-file into `dist\Connector\x86\`; payload/installer: `connector\VoltBridgeTwincat.exe`
      (x64, on the connector runtime) + `connector\x86\VoltBridgeTwincat.exe` (x86). `build:installer` (2026-10-18, from a
      scratch worktree: another session's `volt console` locked `Volt.Cli\bin\Release`): green, both workers in `dist\stage\connector`,
      no `VoltTwincatExplorer.exe`, `binary-targets.ts` 422 binaries OK (x86/x64 pinned per worker).
- [x] 2.3 Gates: install/uninstall, release matrix TwinCAT, docs (DIALECT C2t, ARCHITECTURE, README). The 64-bit XAE cell stays
      offline-tested until `twincat-later` installs 4026.
      `ide.ps1` builds/spawns the worker of the shell's bitness (`-r win-x86|win-x64 --self-contained`, refuses a `-BridgeDir`
      worker of the other bitness); `release-matrix.ts` builds per cell bitness (`bridgeBuilds`, unit-tested). `test-install.ts`
      expects `connector\x86\VoltBridgeTwincat.exe`; `bun run test:install` NOT run (it writes HKCU PATH/Run on this machine).
      Docs: DIALECT C2t, ARCHITECTURE, READMEs (volt-cli, connector, installer, scripts), Volt.iss. Live (instance `wmx`,
      TcXaeShell 15 32-bit, the staged `connector\x86` worker, no helper process): TwinCAT Project14 e2e 317 pass / 97 skip /
      0 fail (fetch all 134 ms for 19 items, empty push 274 ms). Gates: Engine 2988+1 skip, Cli 301, Contracts 42, Repo.Gates
      242, Ide.Twincat 593, Ide.Codesys 457 (one flake of `CodesysRebuildLossTests.A_kept_or_retitled_network_says_nothing`
      in the first full run, green alone and in two reruns), Connector 152; typecheck, lint (0 errors), check 16/16, volt-cli
      unit 160.
