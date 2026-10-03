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
      row-for-row on the rows both vendors have (proven for Disabled warnings only; Replace constants, Max compiler
      warnings and Project defines carry UNMEASURED points — gate 2 corrected "and Replace constants": no CODESYS
      recording of `off` exists, task 3.4 (c)); a CODESYS file always carries the THREE flag
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
- [x] 2.1 A TwinCAT driver test on a double: a project with C0371 disabled materializes `Project Settings.projectsettings`
      with `Disabled warnings:     C0371`, identical to the CODESYS descriptor for the same settings.
      **Done 2026-10-03.** `TcProjectSettingsTests` (11 tests, red first: the suite did not compile without the
      type) over MEASURED documents re-captured on a Project14 copy (instance `twincat-project-settings`; C0371, then
      C0033, unchecked by `probe-tc-project-settings-gui.ps1` and saved): `fixtures/tc-project-settings/`
      `untouched|c0371|c0033-c0371.plcproj.xml` (the `.xml` suffix keeps them out of the Repo.Gates `*.plcproj`
      integrity gate — they are content, not openable projects), `nested-project.xml`, `plc-project-item.xml` (its
      measured temp path replaced by `%PROJECT_PATH%`). The driver double walks `Project Settings` at folder `""`, kind
      700, and its manifest is `Disabled warnings:     C0371` / `Replace constants:     off` / `Max compiler warnings: 100`
      — the first line byte-identical to pro2193's and lenze-mid's CODESYS file. Two probe defects found on the way
      and fixed: the GUI probe compared the archive key's Name unquoted (it is stored `"{8F99A816-..}"`, so the
      read-back could never match), and `$plcItem = if (...)` let PowerShell unroll the COM tree item into its children.
- [x] 2.2 The TwinCAT driver materializes the descriptor from the vendor's stored settings (1.1); a row with no vendor
      source is omitted and named in DIALECT.md — no default. Read-only like on CODESYS (a push of it is refused by name).
      **Done 2026-10-03.** The format moved into the engine: `Volt.Engine/Format/Settings/ProjectSettingsFormat`
      (`ProjectSettings` record, null = no vendor source → row omitted, column kept; `WarningIds`, `Flag`), pinned
      against the pro2193 and bakon-nano corpus bytes (`ProjectSettingsFormatTests`, 5). CODESYS renders through it
      (`CodesysObjectModel.ReadProjectSettings`, offline-testable; its descriptor bytes unchanged). TwinCAT:
      `TcProjectSettings` (pure: `.plcproj` archive → disabled ids, refusing a non-integer by name; NestedProject
      `CompilerSettings` → the three live rows, refusing a document without them; the four D39 rows null),
      `TcObjectModel.ReadProjectSettings` (reads afresh each call, no catch), the walk names the item unconditionally
      via a `TcProjectSettingsNode` marker (KindCode/Name/ReadManifest route it; never handed to COM). DIALECT D37–D39
      carry the driver notes and the quoted-key fact. Read-only: the bridge used to refuse a pushed descriptor as
      INVALID_ST "Unexpected composite POU kind" (red, `ProjectSettingsReadOnlyPushTests`); the push pre-flight now
      refuses any read-only kind (`ItemKind.IsReadOnlyKind`) by name, UNSUPPORTED, by its name or its rename target,
      nothing written (both vendors — the engine is shared).
- [x] 2.3 Parity test across both drivers' doubles: same settings → same descriptor text.
      **Done 2026-10-03.** The drivers cannot share a process (net48 / net10.0-windows), so the parity is stated once in
      `test/shared/ProjectSettingsFacts.cs` (linked into both suites): C0371 disabled →
      `Disabled warnings:     C0371` (gate 2 dropped the `Replace constants:     off` row — see 2.G). `ProjectSettingsParityTests` (CODESYS, 2: the facts,
      and the whole pro2193 file) and `TcProjectSettingsTests.The_shared_rows_match_the_cross_driver_facts` assert each
      double against it; Replace constants, Max compiler warnings and Project defines are named UNMEASURED there (task 3.4), and the four
      CODESYS-only rows asserted absent on TwinCAT. Numbers (as first built): C# Engine 1910 + 1 skipped / 1911, Cli 246/246,
      Ide.Twincat 309/309, Ide.Codesys 207/207, Connector 113/113, Contracts 19/19, Repo.Gates 92/92 — 2896 passed,
      0 failed; `dotnet build Volt.sln -c Release` 0 errors; `bun run check` 15 passed, 0 failed; volt-cli
      `bun test test/unit` 4 pass. No LSP, fixture-map or recording change in this step.
- [x] 2.G Gate 2 (2026-10-03): three review findings, all fixed, none skipped.
      (1) medium — the read-only pre-flight checked only sets: a `deleteItem` of a read-only descriptor passed, the
      batch's earlier ops landed, and the delete reached the vendor object (TwinCAT: the synthesized settings marker,
      `TcObjectModel.Parent` → unnamed RuntimeBinderException; CODESYS: the live descriptor, removed). Red first:
      `ProjectSettingsReadOnlyPushTests.A_delete_of_a_read_only_descriptor_is_refused_by_name_and_nothing_lands`
      (theory: `.projectsettings` and `.library`, each after a valid PLC_PRG edit) — 2 failed, `accepted:true`. Fix:
      `PushService.ReadOnlyKindOf` takes any op (a delete by its name, a set by name or rename target); green, nothing
      written. (2) low — `ProjectSettingsFacts` called both rows CODESYS-recorded; `Replace constants:     off` is in no
      corpus (all 5 read `on`) and both drivers render it through the shared `Flag`. The row left `SharedRows` for
      `UnmeasuredRows` with the reason; the `ReplaceConstants` fact went with it (the CODESYS parity double no longer
      sets it); 1.2's "proven for … Replace constants" corrected; D38/D39 say the parity covers Disabled warnings only;
      task 3.4 gains (c). (3) low — the `WarningIds(object?, string)` wrapper in `CodesysObjectModel.Descriptors.cs`
      deleted. It was not quite dead: `ProjectSettingsDescriptorTests` (5) reached it by reflection, and it was the only
      out-of-file caller of the public `ProjectSettingsFormat.WarningIds`, so deleting it turned both red (5 failed;
      Repo.Gates `NoTestOnlyCodeInSrc` named `WarningIds`). Neither premise changed: the descriptor tests now drive
      the driver's real `ReadProjectSettings` + `ProjectSettingsFormat.Write` and assert the same `Disabled warnings`
      values; `ProjectSettingsFormat.WarningIds`/`Flag` are private to the format and its two row tests assert the
      same values through `Write`.
      Numbers: `dotnet build Volt.sln -c Release` 0 errors (the first attempt hit a transient lock on
      `Volt.Ide.Twincat/bin/Release/Volt.Engine.dll` held by another process, gone on retry); C# — Cli 246/246,
      Engine 1912 + 1 skipped / 1913 (+2, the delete theory), Connector 113/113, Ide.Twincat 309/309, Ide.Codesys
      207/207 (net48), Contracts 19/19, Repo.Gates 92/92 — 2898 passed, 0 failed; `bun run typecheck` 5/5 exit 0;
      `bun run check` 15 passed, 0 failed; volt-cli `bun test test/unit` 4 pass, 0 fail. No fixture, transpiler,
      recording or LSP change in this step, so no fixture map regeneration and no LSP suite (the LSP files modified in
      the tree belong to another change and are not part of this commit).

## 3. Verify
- [x] 3.1 Live on TwinCAT: disable a warning in XAE, pull, the descriptor shows it; the LSP stops reporting that warning
      on the pulled project (one LSP test on the pulled text).
      **Done 2026-10-03** (own TcXaeShell 15.0 / 4024.74, pid 42444, Project14 copy, `ide.ps1 up -Instance e2e-verify`,
      bridge built from the worktree of `62bcb30d65`). `probe-tc-project-settings-gui.ps1 -Warnings C0371 -State Disabled`
      → saved `.plcproj` `DisabledWarningIds` = `371` (verified by the probe's read-back); `volt init --vendor twincat` on
      the served project pulled 252 files, and `TwinCAT Project14/src/Project Settings.projectsettings` is
      `Disabled warnings:     C0371\nReplace constants:     off\nMax compiler warnings: 100\n` — the first line
      byte-identical to pro2193's CODESYS file. LSP test on those exact bytes: volt-lsp-iec `src/analysis/config.test.ts`
      "the pulled TwinCAT descriptor with C0371 disabled stops the VAR_IN_OUT own-access warning" (TwinCAT dialect: the
      trigger reports `inout-own-access` with no project settings, nothing with them); `config.test.ts` 17/17.
      Probe defect found and fixed: the GUI probe assumed Solution Explorer's `PLC` node expanded — on a fresh `ide.ps1`
      copy it is collapsed, `ByName` found nothing and PowerShell threw "Cannot index into a null array"; it now expands
      `PLC` and the PLC project first.
- [x] 3.2 Full C# suites, `bun test test/unit` (volt-cli), `bun run check`.
      **Done 2026-10-03** (worktree of `62bcb30d65` + this change + push-keeps-what-landed 3.1): C# Engine 1916 pass /
      1 skip, Cli 251, Contracts 31, Connector 115, Ide.Twincat 329, Ide.Codesys 226 (net48), Relay 46, Repo.Gates 94 —
      3008 pass, 0 fail; volt-cli `bun test test/unit` 4/4; `bun run check` 15 passed, 0 failed (after `bun run build`).
      e2e on own IDEs: CODESYS 248 pass / 24 skip / 0 fail (272 tests, 280 s); TwinCAT 248 pass / 24 skip / 0 fail (272 tests, 1041 s, Project14 — Project13's XAE had exited).
- [x] 3.3 (gate 1, review finding 2) Live on TwinCAT: disable C0033 only, Save All, re-enable it, Save All (the file
      keeps `"33"`, D37); WITHOUT reopening, plant a C0033 trigger and build. Whether the build reports it decides
      whether the file or the page is the oracle for the open session; record it in D37 (and whether the defect
      reproduces). Until then the descriptor reads the file and D37 names the gap.
      **Done 2026-10-03 — the PAGE is the open session's oracle; the defect REPRODUCED** (same XAE, recorded in D37).
      C0033 has no warning trigger on this target: the pointer conversion the LSP maps to C0033 (`w := p` with
      `p : POINTER TO INT; w : WORD`) is a TwinCAT ERROR here ("Cannot convert type 'POINTER TO INT' to type 'WORD'"),
      reported identically with C0033 disabled or enabled — so C0371 stood in, with a trigger measured to fire (FB
      `VltPrb_c33`: VAR_IN_OUT `io`, METHOD `M` writing it, called from PLC_PRG; "Access to VAR_IN_OUT 'io' declared
      in 'VltPrb_c33' from external context 'M'."). Sequence (each build after an edit of the trigger POU, so it
      recompiles): C0371 disabled on page + file (`33,371`) → no warning; C0033 re-enabled → file `371` → no warning;
      C0371 re-enabled (the LAST id) + Save All → the probe failed by name: the file KEEPS `371` (defect reproduced, a
      second time on 4024.74) → the build, without reopening, REPORTS the C0371 warning (twice). Control: with another
      id disabled and saved, the file drops `371` and the same build reports the warning. So between that unpersisted
      clear and the next warning save or reload, the descriptor (read from the file) says C0371 disabled while the open
      IDE's build gives it; the warning list has no other source (D37), so the descriptor keeps reading the file and D37
      names the window. Seen once more as a side effect: a later ConsumeXml + build saved the project and the file then
      matched the page (no disabled id).
- [x] 3.4 (gate 1, review finding 1 + 6) Measure before 2.3 asserts byte identity on these rows: (a) what TwinCAT's
      `MaxWarnings=0` means (the page offers only `<no limit>`) against CODESYS's `MaxCompilerWarnings` for the same
      number; (b) a CODESYS project with two defines — the `Project defines` line CODESYS writes, against TwinCAT's
      stored `A,B`; (c) (gate 2) Replace constants: a CODESYS project with it `off` (no corpus has one) against the
      TwinCAT project's `false`, or a TwinCAT `true` against CODESYS's `on`. Until measured, 2.3's parity test covers
      Disabled warnings only and names the other three rows as unmeasured.
      **Done 2026-10-03 — all three agree byte for byte; the parity facts now assert four rows** (`scripts/compile-options.log`,
      D38). CODESYS SP21 (own instance `e2e-verify-opts`, CodesysTestProject copy, `ide.ps1 -RunScript
      probe-codesys-compile-options.py`, which sets the descriptor's own `CompileOptions` object — Boolean / Int32 /
      String, all settable; raw `codesys-compile-options.log`) and TwinCAT (pid 42444, `probe-tc-compile-options.ps1`,
      ConsumeXml), each bridge then serving the descriptor and building an FB with three VAR_IN_OUT accesses.
      (a) the limit means the same: CODESYS 100 → 6 warnings (each access listed twice), 3 → 3 + "More than 3 warnings
      occured: Skipping all further warning messages", 1 → 1 + that line, **0 → 0** + that line; TwinCAT 100 → 3, 2 → 2,
      1 → 1, **0 → 0** (no summary line) — TwinCAT's page calls 0 `<no limit>`, its build shows none; both descriptors
      `Max compiler warnings: N` for each N. (b) both store the defines AS TYPED: `A,B` → `Project defines:       A,B`
      and `A, B` → `Project defines:       A, B` from both bridges. (c) `ReplaceConstants` false → `Replace constants:
      off`, true → `on`, from both. Tests: `ProjectSettingsFacts.SharedRows` = Disabled warnings + `Replace constants:
      off` + `Max compiler warnings: 100` (both doubles), `UnmeasuredRows` deleted; `DefinesRow` `Project defines:
      A, B` asserted by `ProjectSettingsParityTests.The_defines_row_matches_the_cross_driver_fact` (CODESYS double)
      and `TcProjectSettingsTests.The_defines_row_matches_the_cross_driver_fact` over a MEASURED NestedProject
      (`fixtures/tc-project-settings/nested-project-defines.xml`, ProduceXml after the probe set `A, B`). Ide.Twincat
      ProjectSettings 12/12, Ide.Codesys 8/8.
