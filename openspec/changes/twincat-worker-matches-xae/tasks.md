## 1. Measure

- [ ] 1.1 Live: the full TwinCAT e2e and the release-matrix TwinCAT cell with the x86 single-file worker
      (`ide.ps1 -BridgeDir dist\TwincatBridge`) on TcXaeShell 4024. Green = go; a failure is fixed test-first or reported.

## 2. Build

- [ ] 2.1 Connector: pick the worker by the XAE's bitness; offline test per cell (32-bit XAE → x86, 64-bit → x64).
- [ ] 2.2 Delete `Volt.Ide.Twincat.Explorer`, `Reader.X86Helper` and their gates; installer ships both worker builds.
- [ ] 2.3 Gates: install/uninstall, release matrix TwinCAT, docs (DIALECT C2t, ARCHITECTURE, README). The 64-bit XAE cell stays
      offline-tested until `twincat-later` installs 4026.
