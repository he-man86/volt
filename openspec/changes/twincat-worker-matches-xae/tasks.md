## 1. Measure

- [x] 1.1 Live: the full TwinCAT e2e and the release-matrix TwinCAT cell with the x86 single-file worker
      (`ide.ps1 -BridgeDir dist\TwincatBridge`) on TcXaeShell 4024. Green = go; a failure is fixed test-first or reported.
      Measured 2026-10-18 (build-cli [3b] publish line, TcXaeShell 15.0 / 3.1.4024.74 32-bit): the worker ran under
      WOW64 (32-bit), one per pipe, and spawned no `VoltTwincatExplorer.exe` (in-process read). TwinCAT Project14 e2e
      317 pass / 97 skip / 0 fail (= the x64+helper baseline); multi-application (`TwinCAT MultiProject`) 12/12. The
      matrix cell's judgement (`judge`, release-matrix-cells.ts) over that run's `VOLT_E2E_REPORT`: GREEN twincat-32.
      `release-matrix.ts` itself has no worker-folder option (it builds and serves bin\Release) - 2.3 gives it one.

## 2. Build

- [ ] 2.1 Connector: pick the worker by the XAE's bitness; offline test per cell (32-bit XAE → x86, 64-bit → x64).
- [ ] 2.2 Delete `Volt.Ide.Twincat.Explorer`, `Reader.X86Helper` and their gates; installer ships both worker builds.
- [ ] 2.3 Gates: install/uninstall, release matrix TwinCAT, docs (DIALECT C2t, ARCHITECTURE, README). The 64-bit XAE cell stays
      offline-tested until `twincat-later` installs 4026.
