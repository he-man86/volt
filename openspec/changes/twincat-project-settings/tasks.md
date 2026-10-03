## 1. Measure
- [x] 1.1 On a TwinCAT fixture copy (`ide.ps1 up -Vendor twincat -Instance tc-settings`): change each compiler setting
      the CODESYS descriptor carries (disable a warning, set one as error, …) in the IDE, save, and diff the project files
      and every automation-interface property that changes. Record where each lives in DIALECT.md (a row per fact).
      **Done 2026-10-03** (TcXaeShell 15.0 / TwinCAT 3.1.4024.74, Project14 copy, instance `twincat-project-settings`;
      `packages/volt-cli/scripts/probe-tc-project-settings.ps1` reads the AI + the `.plcproj`,
      `probe-tc-project-settings-gui.ps1` clicks warning checkboxes, ConsumeXml for the three AI settings; full step table in
      `scripts/tc-project-settings.log`; DIALECT **D37–D39**). Where each CODESYS row lives on TwinCAT:
      | row | TwinCAT source | AI? |
      |---|---|---|
      | Disabled warnings | `.plcproj` `PlcProjectOptions/XmlArchive`, OptionKey `{8F99A816-E488-41E4-9FA3-846536012284}`, `DisabledWarningIds` = `"33,371"` (bare ints, `,`, ascending) | **no** — ProduceXml byte-identical before/after |
      | Warnings as errors | **none** — two-state checkbox page; no `WarningAsError` member in LanguageModelManager 3.5.13.99 | — |
      | Replace constants | AI `IECProjectDef/CompilerSettings/ReplaceConstants`; file OptionKey `{E709B08B-B6E4-4966-8EED-D793A13114C6}` `ReplaceConstants` (absent until first set; `True`/`true` by writer) | yes, read+write |
      | Unicode identifiers | **none** (member exists in 3.5.13, no page, no file value) | — |
      | UTF-8 encoding | **none** (same) | — |
      | Max compiler warnings | AI `CompilerSettings/MaxWarnings`; file `{E709B08B-..}` `MaxCompilerWarnings` (absent until set) | yes, read+write |
      | Breakpoint logging | **none** (same as Unicode identifiers) | — |
      | Project defines | AI `CompilerSettings/CompilerDefines`; file `PropertyGroup/CompilerDefines` (absent while empty) | yes, read+write |
      Numbers: 8 CODESYS rows → 4 with a TwinCAT source (1 file-only, 3 AI+file), 4 with none. 48 warning ids on the
      4024.74 page, C0371 among them. Three facts step 2 must design for: (a) the AI is LIVE and the file is SAVED —
      ProduceXml answered `MaxWarnings=50` for an unsaved page edit while the file said `0`, and the warning list has
      ONLY the file; (b) the file keys for Replace constants and Max compiler warnings (`{E709B08B-..}`) are ABSENT
      until the setting is first changed, while the AI still answers the value in effect (baseline
      `ReplaceConstants=false MaxWarnings=100`; no `.plcproj` of the Project14 fixture has the key) — a file-only
      reader drops both rows on every untouched TwinCAT project, twincat-project14 included, although all 5 CODESYS
      corpora write `Max compiler warnings: 100`; (c) clearing the LAST disabled id is not persisted by TwinCAT (file
      keeps `"33"`; after reopen the IDE shows C0033 disabled again) — the file is what the IDE reloads; which set the
      open session's compiler uses before a reopen is UNMEASURED (D37), and the defect was seen once, on 4024.74 only.
      **Decision for step 2 (gate 1, replaces "read all four from the file for consistency"):** Replace constants, Max
      compiler warnings and Project defines come from the AI (`IECProjectDef/CompilerSettings`) — it answers the value
      in effect whether or not a key is stored, and it is LIVE, which is also how the CODESYS descriptor reads (the
      session's `ConfigurationService`, C24); Disabled warnings come from the `.plcproj` (its only source). The cost,
      stated: the warnings row is SAVED state while the other three are LIVE, so an unsaved warning edit is not seen
      until saved. The Project14 copy (an existing project with no stored key — a fresh project was not measured)
      answers `ReplaceConstants=false`, unlike every CODESYS corpus project (`on`). Corpora: of the 6, the one TwinCAT
      corpus (`twincat-project14`) carries no disabled warning (its fixture `.plcproj` has no `DisabledWarningIds`) →
      no re-pull needed for 3.x; 2 of the 5 CODESYS corpora disable C0371 (pro2193, lenze-mid).
- [x] 1.2 Read the CODESYS descriptor's row format (`CodesysObjectModel.Descriptors.cs`) and the LSP reader
      (`config.ts projectDiagnosticsFrom`) so the TwinCAT text is byte-identical for the same settings.
      **Done 2026-10-03.** The format is `Volt.Engine/Format/St/Descriptor` in auto-width mode: one `Label: value`
      line per NON-EMPTY value, padded to the widest DECLARED label + 2 — the label still counts when its value is
      empty. CODESYS declares 8 labels in this order: Disabled warnings, Warnings as errors, Replace constants, Unicode
      identifiers, UTF-8 encoding, Max compiler warnings, Breakpoint logging, Project defines → widest is "Max compiler
      warnings" (21) → column 23 (`Disabled warnings:` + 5 spaces + `C0371`, as in pro2193/lenze-mid). Values: warning
      ids `"C" + n.ToString("D4")`, ordinal-sorted, joined `", "` (empty set → line omitted); flags `on`/`off`, never
      blank; max warnings the integer's invariant string; defines the raw string (Flatten) — no CODESYS run with a
      define exists, so whether CODESYS and TwinCAT (`A,B`) spell the same defines the same way is UNMEASURED (D38),
      and so is what TwinCAT's `MaxWarnings=0` ("<no limit>") means against CODESYS's integer. For byte identity the
      TwinCAT builder must declare the SAME 8 labels in the SAME order (a row with no TwinCAT source is `Add(label,
      null)` — emits nothing, keeps the column), and render ids/flags/ints through the same helpers (move
      `WarningIds`/`Flag` formatting out of the CODESYS driver into Engine so both drivers share it). Identity is then
      row-for-row on the rows both vendors have (proven for Disabled warnings and Replace constants; Max compiler
      warnings and Project defines carry the UNMEASURED points above); a CODESYS file always carries the THREE flag
      rows TwinCAT cannot source — Unicode identifiers, UTF-8 encoding, Breakpoint logging (D39; Replace constants is
      CODESYS's fourth flag row and HAS a TwinCAT source, D38; Warnings as errors has no TwinCAT source either but is
      an id list, written only when it holds ids) — so whole files of a CODESYS and a TwinCAT project are never
      identical. The LSP reader
      (`projectDiagnosticsFrom`) is padding-agnostic: it finds the line by case-insensitive `disabled warnings:` /
      `warnings as errors:` prefix, splits after the first `:` on `,`, trims, and maps through `CONFIGURABLE_CHECKS`
      (C0371 → `inout-own-access`); it needs no change. The file is `Project Settings.projectsettings`, kind
      `ItemKind.PlcProjectSettings` (700, `.projectsettings`); today `Volt.Ide.Twincat` materializes nothing for it.
- [x] 1.G Gate 1 (2026-10-03): the six review findings, all documentation/probe findings — no product code changed,
      so there is no failing test to write first; each is fixed in the text it was about, none skipped.
      (1) medium — the step-2 decision now states the absent-key fact (fact (b) above) and reads the three AI-sourced
      rows from the AI, warnings from the file; `MaxWarnings=0` semantics named UNMEASURED (D38, task 3.4).
      (2) D37 no longer calls the file "the project's state": it is the RELOADED state; the open session's compiler
      after the unpersisted clear is UNMEASURED and the defect seen once on 4024.74 (task 3.3).
      (3) 1.2's "four flag rows" corrected to three (Unicode identifiers, UTF-8 encoding, Breakpoint logging); D39
      says the same. (4) D38 no longer claims "a fresh 4024 project": the measured one is the existing Project14 copy
      with no stored key; a fresh project is unmeasured. (5) `probe-tc-project-settings-gui.ps1` now takes
      `-State Disabled|Enabled`, reads the saved `.plcproj` before, refuses a warning already in that state, scales
      the 249px offset by window DPI (measured at 120 DPI only) and fails by name when the saved file disagrees after
      Save All (it was not re-run live; parse-checked, 0 errors); README entry rewritten. (6) Project-defines byte
      identity named UNMEASURED in D38 and 1.2 (task 3.4).
      Corpus counts used: `Max compiler warnings: 100` and `Replace constants: on` in 5 of 5 CODESYS corpora;
      `{E709B08B` in 0 files of the Project14 fixture / the 6 corpora; `Project defines` in 0 corpora.
      Gate numbers (no fixture/transpiler/LSP change in this step, so no fixture map or LSP suite): `bun run typecheck`
      5/5 packages exit 0; `bun run check` 15 passed, 0 failed; volt-cli `bun test test/unit` 4 pass, 0 fail; C# —
      Cli 246/246, Engine 1903 + 1 skipped / 1904, Connector 113/113, Ide.Twincat 298/298, Ide.Codesys 205/205
      (net48), Contracts 19/19, Repo.Gates 92/92 — 2876 passed, 0 failed.

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
- [ ] 3.3 (gate 1, review finding 2) Live on TwinCAT: disable C0033 only, Save All, re-enable it, Save All (the file
      keeps `"33"`, D37); WITHOUT reopening, plant a C0033 trigger and build. Whether the build reports it decides
      whether the file or the page is the oracle for the open session; record it in D37 (and whether the defect
      reproduces). Until then the descriptor reads the file and D37 names the gap.
- [ ] 3.4 (gate 1, review finding 1 + 6) Measure before 2.3 asserts byte identity on these rows: (a) what TwinCAT's
      `MaxWarnings=0` means (the page offers only `<no limit>`) against CODESYS's `MaxCompilerWarnings` for the same
      number; (b) a CODESYS project with two defines — the `Project defines` line CODESYS writes, against TwinCAT's
      stored `A,B`. Until measured, 2.3's parity test covers Disabled warnings and Replace constants only and names the
      other two rows as unmeasured.
