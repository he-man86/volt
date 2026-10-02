## 1. Measure
- [ ] 1.1 On a TwinCAT fixture copy (`ide.ps1 up -Vendor twincat -Instance tc-settings`): change each compiler setting
      the CODESYS descriptor carries (disable a warning, set one as error, …) in the IDE, save, and diff the project files
      and every automation-interface property that changes. Record where each lives in DIALECT.md (a row per fact).
- [ ] 1.2 Read the CODESYS descriptor's row format (`CodesysObjectModel.Descriptors.cs`) and the LSP reader
      (`config.ts projectDiagnosticsFrom`) so the TwinCAT text is byte-identical for the same settings.

## 2. Build (red first)
- [ ] 2.1 A TwinCAT driver test on a double: a project with C0371 disabled materializes `Project Settings.projectsettings`
      with `Disabled warnings:     C0371`, identical to the CODESYS descriptor for the same settings.
- [ ] 2.2 The TwinCAT driver materializes the descriptor from the vendor's stored settings (1.1); a row with no vendor
      source is omitted and named in DIALECT.md — no default. Read-only like on CODESYS (a push of it is refused by name).
- [ ] 2.3 Parity test across both drivers' doubles: same settings → same descriptor text.

## 3. Verify
- [ ] 3.1 Live on TwinCAT: disable a warning in XAE, pull, the descriptor shows it; the LSP stops reporting that warning
      on the pulled project (one LSP test on the pulled text).
- [ ] 3.2 Full C# suites, `bun test test/unit` (volt-cli), `bun run check`.
