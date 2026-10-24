Requires: `volt-cli-rework` (archived 2026-10-24). Nothing below starts before the owner has read `design.md` and
answered its two questions (or let the recommended answers stand).

## 1. Before any code

- [x] 1.1 Blind foreign-client review of the DRAFTED shape: an agent given only `design.md` sections 1–7 and the current
      `wire.html`/OpenRPC (no repo), writing a client on paper; fold its findings into `design.md`.
- [x] 1.2 Measure the frame encoding (BOM, `\n` vs `\r\n` on both bridges' writers and readers) and state it.
- [x] 1.3 Owner review of `design.md`; record the answers to its two questions. Done 2026-10-24: both YES ("yes to both,
      go build it"), recorded in design.md "Owner decisions"; protocol stays 1.

## 2. Measurements the design depends on

Measured 2026-10-24 (step 2a = 2.1–2.5, step 2b = 2.6–2.7). The probes were single-use, outside the repo, and are
deleted; the live runs used this change's own `ide.ps1` instance `wire-final-shape` (CODESYS 3.5.21.40 fixture copy;
TwinCAT 3.1.4024.74 / TcXaeShell 15.0, Project14 copy), both closed cleanly. No product code changed.

Gate 2a+2b (2026-10-24): review findings folded (2.1 into `design.md`, 2.6 capture loss + column measured live, 2.7
keyed on the numeric value); no product code, fixture or recording changed, so no fixture-map regeneration. Green:
typecheck, lint (0 errors), `bun run check` (16/16), C# Contracts 62, Engine 3115 (+1 skipped), Cli 352, Connector 154,
Ide.Twincat 714, Ide.Codesys 485, Repo.Gates 255; volt-cli `bun test test/unit` 228 pass, 0 fail.

**Step 2a**

- [x] 2.1 `languages`: the shown set per bridge from its `LanguageRegistry` (expected `ST`, `LD`, `FBD` on both).
      **Measured:** both declarations are the same rows (`CodesysDriver.Seam.cs:19`, `BeckhoffDriver.Seam.cs:19`): shown
      `ST`, `LD`, `FBD`; hidden `CFC`, `SFC`, `IL`. `ShownBy(vendor)` = `["FBD","LD","ST"]` (ordinal) on both. **But the
      registry is not what a bridge shows:** `NetworkTextSwitch` (`VOLT_GRAPHICAL=1`, read once per process) hides LD and
      FBD in the shipped build (`NetworkText.cs:61`). Shown = `["ST"]` in production, `["FBD","LD","ST"]` with the switch
      on (`ide.ps1`, the suites; all 5 committed transcripts carry `networkText: true`). **For 3.3:** `languages` is the
      registry's shown set as the switch leaves it, read in one place — or a production `health` claims LD and FBD.
      (Gate 2a+2b: `design.md` section 2's `languages` row said "today `ST`, `LD`, `FBD` on both"; corrected to this.)
- [x] 2.2 `kinds`: each bridge's `KindRegistry` rows with their writable flag; equal to `items.html`'s table.
      **Measured:** both hosts declare `IecFormat.KindRows`: 33 rows, 22 with an extension, 11 members without one.
      Writable (`Source` or `WritableDescriptor`): `dut`, `gvl`, `itf`, `pou`, `task`; the other 17 read-only. Equal row
      for row and flag for flag to `items.html`'s generated extension table (`docs/assets/data.js` `extensions`): no
      difference. The table is the SHARED IEC one, not each vendor's: in the transcripts and corpora `tmc` and
      `external_types` occur only on TwinCAT; `image_pool`, `projectinfo`, `recipe`, `symbols`, `text_list`, `trace`,
      `visualization` only on CODESYS; `class_diagram`, `parameter_list` on neither. Three rows are containers that
      `items.html` says are never an item (`library_manager`, `recipe_manager`, `visualization_manager`: recursed like a
      folder, no file). **For the owner (3.3):** `health.kinds` copied from the declaration lists three extensions no
      item carries — list only the kinds that name an item, or the declaration verbatim.
- [x] 2.3 `ProjectEntry.version`: who sets it, on which vendor; define it or delete it.
      **Measured:** both drivers set it from the very value top-level `health.ideVersion` reads — CODESYS `IdeVersion`
      (`CodesysDriver.cs:183`, `:138`); TwinCAT `OwnSolution().Version`, which is where `_ideVersion` is assigned
      (`BeckhoffDriver.cs:180`, `TcObjectModel.Session.cs:162`, `TcObjectModel.cs:59`). Equal in all 5 transcripts
      (`3.5.18.30`, `3.5.21.40`, `3.5.21.60`, `3.5.22.40`, `3.1.4024.74`). One reader: the connector
      (`PerPipeProjectSource.cs:130` → `DetectedProject.IdeVersion`). **Delete it** (principle A: one fact, two
      spellings); the connector stamps `ideVersion` onto each row, as it already does `unsupported` and the identity.
- [x] 2.4 Project-name case on TwinCAT: can one solution hold two PLC projects differing only by case? (CODESYS: no.)
      **Measured live, COM on the `TIPC` node: no.** Creating PLC project `UNTITLED2` beside `Untitled2` is refused by
      the IDE ("Project file '…\UNTITLED2\UNTITLED2.plcproj' already exist") — a PLC project is a folder of its name and
      the file system ignores case. Renaming another PLC project to `untitled2` throws nothing and changes nothing (the
      same node renamed to a fresh name does rename). `LookupChild("untitled2")` answers `Untitled2`. Besides: the wire's
      TwinCAT `project` is the SOLUTION's name (`OwnSolution`: at most one row per worker), so within one bridge a name
      comparison never has two candidates; PLC project names are path segments, already compared ignoring case.
      Comparing `connect.project` / `expectedProjectName` ignoring case is safe on both vendors.
- [x] 2.5 `dirty`: when each IDE fails to answer (both hosts), so the absent case has a test of its own.
      **CODESYS** (`ScriptProject.dirty` by reflection, `CodesysObjectModel.cs:65`), live 3.5.21.40: `false` at start;
      after an unsaved push `false` at +0 s and +3 s, `true` at +8 s, still `true` after the delete. It answers; `health`
      serves the PREVIOUS background probe's snapshot (`ComposedSession`), so a change shows one probe later — which is
      also why every transcript's `health-after` reads `false`. No answer: no primary project → no row at all; the member
      missing on the object (`GetMember` null) → today `false`, to become absent; the getter throwing → the whole probe
      fails, the stale row is kept and the session marked degraded (`ComposedSession.cs:146`) — no `dirty` path of its
      own. Other CODESYS versions not probed. **TwinCAT** (`!DTE.Solution.Saved`, `TcObjectModel.cs:84`; a throw → null →
      `false`, `BeckhoffDriver.cs:169,181`; a row not served is never asked → `false`), live: after an unsaved push create
      and delete `Saved` stays `True` (`dirty` `false` at +0/+3/+8 s), reconfirming DIALECT D45 — yet it went `False` once
      a PLC project was created through the tree (2.4). So TwinCAT answers, but not about the PLC item edits a push
      makes. **Absent cases, each its own test in 3.3:** CODESYS member missing; TwinCAT `Saved` throwing; a TwinCAT row
      not served. **For the owner:** is TwinCAT's `Saved` the fact `dirty` names? By principle C a value that never
      follows PLC edits is not it: `dirty` absent on TwinCAT always, or kept as "the solution's structure changed".

**Step 2b**

- [x] 2.6 `build.success` vs "no `error` diagnostic" on both vendors over the e2e build cases: one rule if they agree.
      **Measured over every recorded build answer** (LSP recordings `codesys.build.json` 5659, `twincat.build.json` 5613,
      `twincat.build.new.json` 2524, `twincat-32.build.json` 39; corpus `expected-build.*` 5 + 1; transcripts 4 + 1;
      `vendor-facts.twincat.json` 56). **CODESYS: agree 5668 / 5668** (by construction: `CodesysObjectModel.Build.cs:28`
      derives success from the list). **TwinCAT: agree 8208 / 8234;** never `success: true` with an error, but 26
      answers (14 fixtures, 12 of them again in the `.new` checkpoint) are `success: false` with NO error diagnostic:
      `LastBuildInfo` says a project failed and the Output-pane parse found no error line. The 14: seven string
      constants too long (`cc_string_{plain_long_init,escape_first,escape_middle,escape_last,hex_escape}_too_long`,
      `cc_string_prefix_len_{1,2}`, `cc_wstring_init_too_long_2` — CODESYS: success with two warnings); four XADD
      (`operand_xadd`, `atomic_xadd_{dint,int,dword}`), `cc5_new_in_expression`, `decl_bracket_init_no_assign_fb`
      (CODESYS: errors). 0 occurrences in the six corpora. (The recorder keeps error and warning lines only,
      `record-language.ts:351`; an info line cannot be the missing error.) **They disagree, so no one rule:** "no error
      diagnostic" would report 14 failing TwinCAT builds as successes. `success` stays each vendor's own signal.
      **The 14 are a capture loss, measured live** (gate 2a+2b, instance `wire-final-shape`, Project14 copy, a probe FB
      instantiated in `PLC_PRG`, the Output panes read over COM): `s2 : STRING(2) := 'abcdef'` answers
      `success:false, diagnostics:[]`, and the Build pane holds `Internal error:System.ArgumentOutOfRangeException: Length
      cannot be less than zero.` + a .NET stack (`TypeChecker.CheckStringLiteralLength`), then `Compile complete -- 1
      errors, 0 warnings`. TwinCAT's compiler CRASHES on these fixtures and says so in a line with no
      `file(line) : error:` shape, so the parser (`TcObjectModel.Build.cs:285`) admits nothing: the IDE counts an error
      the wire does not carry. (The same probe with `__XADD` on this ARM-target project gives a shaped `Internal Error
      (ARM): RiscFrontEnd: Unknown operator`, so which crash shapes occur differs per target.) **Triage: niche: accepted
      loss (0 occurrences in the corpora)** — counted over the six corpora: 0 `__XADD(`, 0 `__NEW(`, 0 string
      initializers longer than their declared length, 0 multi-element FB-array `[(…), (…)]` initializers (29
      single-element ones in pro2193, which compile on both vendors). Not worked on in this change; the recordings stay
      as the IDE answered. 3.6 keeps `success` from `LastBuildInfo`, so such a build is never reported as passing.
      **Positions (3.6, B7):** CODESYS states none — `line` 0 on all 6446 diagnostics, `column` 0 on the 20 wire-level
      ones (DIALECT C27). TwinCAT: `line` ≥ 1 on 9569 (minimum 1: 1-based), 0 on 174 (a pane line with no position).
      **Column, measured live** (same probe, an unknown identifier at column 13 of the body line): the pane line is
      `…\VltProbe.TcPOU(5) : error: Identifier 'undefinedThing' not defined` — `(line)` only, no column, on all three
      errors; the wire carries `column: 0`. The parser's optional `,col` group (`TcObjectModel.Build.cs:285`) and the
      unit tests' `(3,1)` lines are a shape this XAE (3.1.4024.74) did not write. So TwinCAT 4024 states no column; 3.6
      keeps reading the group and serves a column only where a pane states one. TwinCAT's `line` 5 there counts the
      four declaration lines and then the body, with no `IMPLEMENTATION` line: Volt's text has that body line at 6.
- [x] 2.7 Each vendor's severity words seen in the corpora and recordings: the host's declared word table.
      **CODESYS:** the word is the enum name of `IMessage.Severity`, `_3S.CoDeSys.Core.Messages.Severity` (`[Flags]`,
      `MessageStorage.dll`), read from the metadata of every installed version. 3.5.18.30, 3.5.21.40, 3.5.21.60 (x86):
      `FatalError`=1, `Error`=2, `Warning`=4, `Information`=8, `Text`=16; **3.5.22.40 adds `SuppressedWarning`=32 and
      `SuppressedInformation`=64.** Seen on the wire: error 5427, warning 999, info 20 (the info ones are build chrome:
      "Build started", "Compile complete -- …"). **TwinCAT:** the Output-pane token the parser admits, ignoring case
      (`TcObjectModel.Build.cs:285`): `error`, `warning`, `message` — closed by the regex; a line with another word is no
      diagnostic. Seen: error 8790, warning 1102, info 41. **Declared tables:** CODESYS `FatalError`→error,
      `Error`→error, `Warning`→warning, `Information`→info, `Text`→info; TwinCAT `error`→error, `warning`→warning,
      `message`→info. **For the owner:** SP22's `SuppressedWarning` / `SuppressedInformation` — today's substring match
      counts a suppressed warning as `warning`; declared, each is either a row or absent (unclassified).
      **What the evidence does NOT show (gate 2a+2b):** the "seen" counts are the bridge's MAPPED words (the recorder
      stores `error`/`warning` after `Severity.Of`, `record-language.ts:351`, and drops info), so they say nothing about
      which CODESYS enum values occur. The enum is `[Flags]` and the driver reads `Severity.ToString()`
      (`CodesysObjectModel.Build.cs:105`): a combined value prints `Warning, SuppressedWarning`, an undefined bit prints
      a number, and neither is a single name. So the CODESYS table is keyed on the enum's NUMERIC value, not its
      `ToString()`: one row per single declared bit as above, and a value that is not exactly one declared bit is
      absent (unclassified), never substring-matched. Whether combined values occur is unmeasured (3.6 measures it).

## 3. Build, test-first (offline)

- [x] 3.1 Contract types (`Volt.Contracts/Wire`) to the new shape; `Vendors.cs` and the per-vendor pipe minters out of
      Contracts (vendor ids from `VendorRegistry`); every change red first in `Volt.Contracts.Tests`.
      **Built (3a):** `PipeRequest.protocol`, `PipeError.data` (`ProtocolMismatchData`, `StaleProjectVersionData`,
      `ICodedError.ErrorData`), `HealthResponse.languages`/`kinds` (`HealthKind`), `protocol`/`ops` non-null, `networkText`
      gone; `ProjectEntry` without `version`, `dirty` optional; `EmptyResult` for connect/disconnect; `UnreadableItem`/
      `UnreadableNode` `code`; `PushResponse` without `accepted`/`currentProjectVersion`, with `removed`, `conflicts`/
      `newItems` always present, `PushConflict.code` non-null and `existing`; `STALE_PROJECT_VERSION` moved to
      `BridgeErrorCodes` beside the new `PROTOCOL_MISMATCH`, `ConflictCodes.ProjectName` deleted. `Vendors.cs` deleted:
      hosts declare `CodesysDriver.Row` / `BeckhoffDriver.Row`; the CLI (`ClientVendors`, a `VendorRegistry`) and the
      connector (`ConnectorVendors`) know the vendors they ship beside; `PipeNames.Instance(vendor, pid)` is the one
      minter. Red first: `Volt.Contracts.Tests/WireFinalShapeTests` (10). New-vendor ratchet: CLI 5 → 0, Contracts 11 → 0.
- [x] 3.2 Envelope: `protocol` required, `PROTOCOL_MISMATCH` before the body is read (`PipeServer`), protocol 1.
      **Built (3a):** `PipeServer` reads the envelope strictly (`WireJson.Request`) and refuses a missing/other protocol
      with `data.bridgeProtocol`; `PipeClient`, the e2e `pipe.ts` and the LSP `bridge.ts` state it; the CLI's own
      `health.protocol` pre-check (`BRIDGE_PROTOCOL`) is deleted and maps `PROTOCOL_MISMATCH` to its remedy; the protocol
      test seam (`BridgePipeHost(…, int? protocol)`) is deleted (ratchet 1 → 0); the relay forwards `error.data`. B1 is
      measured false for the PREVIOUS release (design "Built" 1). Tests: `BridgeProtocolTests` (rewritten, 10 cases).
- [x] 3.3 `health`: `languages`, `kinds`, optional `dirty` (both hosts, no fallback), status enum.
      **Built (3a):** `languages` = `NetworkTextSwitch.Shown(catalog.Languages.ShownBy(vendor))` (one place), `kinds` = the
      declared rows with an extension (verbatim, 2.2 default); `dirty` absent for a CODESYS project with no `dirty` member,
      a TwinCAT `Saved` that throws, a TwinCAT row not served (`CodesysDirtyTests` 3, `TcDirtyTests` 4); the connector
      stamps `ideVersion` onto its rows. Status enum: schema generation is 3.9.
- [x] 3.4 `refs`/`fetch`: `code` on unreadable entries; `knownApplications` required with `knownItems`.
      **Built (3a):** `UnreadableObject.Code` stated by each producer (design "Built" 7); `OpGuard.RequireKnownApplications`
      refused a baseline without it before any walk — reversed at gate 3a (finding 2: optional, absence defined); the CLI
      sends the sidecar's applications (none for a baseline rebuilt from `volt/ide`, design "Built" 4) and sends no fake `knownItems` on its two directed reads.
- [x] 3.5 `push`: `accepted` and `currentProjectVersion` deleted; lease as an error frame; `removed` in the receipt;
      `existing` on ITEM_EXISTS; `code` required.
      **Built (3a):** the lease throws `STALE_PROJECT_VERSION` with `data.currentProjectVersion` (0-op push too, which lands
      nothing); a refusal before the first write answers every other op `NOT_ATTEMPTED` and no receipt; a first op of which
      nothing stays lands nothing, one of which something stays is a landing (F8); `newItems`/`removed` are the push's own
      delta (`PushService.Receipt`), `unwalkedFolders` both walks' (design "Built" 2); the CLI updates its baseline as
      `baseline − removed + newItems`. Tests: `Volt.Engine.Tests/sync/WireFinalShapeTests` (14, over the pipe) and every
      push test re-read for the new answer (`Landed()` = `newProjectVersion` present, `Refused()` without NOT_ATTEMPTED).
Gate 3a (2026-10-24): the six review findings, each with a test; tests written beside the fix (not run red first).
1. **A case-only rename now retires the old spelling** (`PushService.Receipt`): the rename is decided by `SameSpelling`
   and "gone" by an exact-spelling lookup of the pre-apply key in the receipt. Test `WireFinalShapeTests.
   A_case_only_rename_answers_the_old_spelling_in_removed` (`baseline − removed + newItems` = the IDE's refs, ordinal).
2. **`knownApplications` is optional again, its absence defined** ("the client does not know them": nothing under an
   unread folder outside the walk's applications is judged removed); `OpGuard.RequireKnownApplications` deleted; the CLI's
   recovery pull sends none instead of `[]`. Reverses the F22 row — design "Built" 4, **for the owner**. Tests:
   `SidecarBaselineTests.A_baseline_less_pull_keeps_the_file_of_an_item_an_unread_device_hides_beside_a_pool_item_of_its_name`
   (CLI), `MultiApplicationTreeTests` (both forms), `WireFinalShapeTests.A_baseline_without_its_applications_is_served`.
   Census `WireVocabularyTests` BAD_REQUEST in OpGuard 2 → 1.
3. **Every raw TS client states `protocol`**: `stability/parallel-instances.test.ts`, `scripts/wire-transcript.ts` (the
   recorded request frames change: 4.2 re-records), `scripts/mixed-version.ts`'s health probe, `contract/openrpc-contract.
   test.ts` `frameOf` and its three hand-written envelopes. Live suites not run here (4.1 owns the contract run).
4. **`newItems` no longer depends on `returnSources`**: `newSources` keeps only the text of items a landed `set` left (the
   items `newItems` names); the receipt no longer adds `newSources` keys. Test `An_item_the_IDE_changed_beside_the_push_is_in_newItems_in_neither_mode`
   (both modes). `PushResponse.NewSources` doc no longer promises IDE-side rewrites.
5. **A partly-landed first op's path under a folder the receipt could not read is not `removed`**: the refused op's
   paths are judged by the receipt walk, which says nothing under its `unwalkedFolders`. Test
   `A_partly_landed_op_under_a_folder_the_receipt_could_not_read_is_not_removed`.
6. **The relay forwards the remote client's `protocol`** (`RelayInbound.Protocol` → `PipeClient.Forward`), so the bridge
   refuses a remote client of another protocol or none `PROTOCOL_MISMATCH` itself. Tests `RelayTunnelTests.
   A_remote_request_of_another_protocol_is_refused_PROTOCOL_MISMATCH` (none, 2); the protocol-seam ratchet pins those
   three sites (RelayFrames 1, PipeClient 2) as the relay's forwarding, nothing else.
Green: typecheck, lint (0 errors), `bun run check` 16/16; C# Contracts 68, Engine 3132 (+1 skipped), Cli 359, Connector
154, Ide.Twincat 718, Ide.Codesys 488, Repo.Gates 255, Relay 74; volt-cli `bun test test/unit` 228; volt-lsp-iec
`scripts/bridge.test.ts` 5. No fixture, recording or transpiler change, so no fixture-map regeneration; the LSP suites
are not this change's (no LSP source changed).

- [x] 3.6 `build`: severity absent when unmapped; positions optional and 1-based; `durationMs`. The CODESYS word table
      reads `IMessage.Severity` as its numeric value (2.7); first measure on live 3.5.22.40 which values a build gives
      (a suppressed warning included), raw values logged, before the table is written. TwinCAT keeps the `,col` group
      and serves a column only where a pane states one (2.6: 4024 states none).
      ZERO-FALLBACK (owner policy, overrides 2.6's "niche: accepted loss"): a build whose `success` is false MUST carry at
      least one error diagnostic. A compiler line the parser cannot place (TwinCAT's "Internal error: …" with no
      file(line) shape) is carried as a diagnostic with its text and NO position — positions are optional in this shape,
      so nothing is invented. Red test first: a failed build with an unparseable error line answers that line, never an
      empty list.
      **Built (3b):** `BridgeDiagnostic.severity` `string?`, `line`/`column` `int?`, `BuildResponse.durationMs` (`long`);
      `Severity.Of` (substring match, `info` fallback) deleted with its test file. CODESYS: `CodesysSeverity` keyed on the
      numeric `IMessage.Severity` (1, 2 → error; 4 → warning; 8, 16 → info; anything else absent and logged at Warn); the
      position scrape over the message text deleted (CODESYS states none). TwinCAT: the pane-token table
      (`SeverityOf`), the line/column only where the pane states them, and an unshaped line with the `error` token and a
      colon carried as an error with no item and no position (deduped across panes, never inside a shaped message's
      continuation). `BuildService`: a failed build with no error diagnostic gets one saying the IDE stated none Volt could
      read. **Live, CODESYS 3.5.22.40** (instance `wire-final-shape`, fixture copy, closed cleanly; probe single-use,
      deleted): build 1 (a C0196 warning) → 1 warning, 10 info; build 2 (the same, under `{warning disable C0196}`) → no
      message from the POU at all; build 3 (warning + suppressed + an undefined identifier) → 1 warning, 2 errors
      (C0046, C0018), `success:false`. Every message a single declared bit: 0 unclassified, 0 combined values. Run red
      first: `TcBuildOutputTests` (6 new; compile-red before the parser), Contracts `WireFinalShapeTests` (4, compile-red);
      written beside the fix: `BuildServiceTests` (2), `CodesysBuildOwnMessagesTests` (9 cases). design "Built (step 3b)" 5–6.
- [x] 3.7 `grep`: `name`.
      **Built (3b):** `GrepMatch.name` (was `path`), `cut: true` only on a cut line (B23: 500 UTF-16 code units, 499 when
      the 500th would split a surrogate pair, then `…`), `NotSearchedItem { name, code, reason }` (B16: an unreadable
      item's own code, `UNSUPPORTED` for a hidden body). Census `WireVocabularyTests` UNSUPPORTED +1 (GrepService). Also
      §7's `WRONG_PROJECT` message now names only what the request stated (`OpGuardTests`, 2 red first; design "Built
      (step 3b)" 7). Tests: `GrepServiceTests` (+1, 3 re-read), the CLI's two grep tests read `name`.
- [x] 3.8 The CLI, `volt-control`, the relay and the VS Code extension read the new shape (their offline suites).
      **Built (3b):** CLI — `BuildResult.durationMs`, `[unclassified]` for an absent severity, a position only when
      stated, grep prints `name`. volt-control — `BuildOutcome.durationMs`, `severity?`, `dirty?: boolean | null` on rows
      and health; `isIdeChangeEdge` makes no edge from an unknown `dirty` (red first, `status.test.ts`). VS Code — prints
      `durationMs` and `[unclassified]`. Relay — code already read the new receipt (3a); `relay-protocol.md` now says
      `protocol` on the relay request and the new push verdicts. Also offline scripts: `wire-transcript-lib` normalises
      `durationMs`, `wire-transcript.ts` reads a landing from `newProjectVersion`, the `vendor-facts` unit fakes answer the
      new push shape. **Not done here (4.1):** the live e2e suite still reads `accepted` in 52 files (196 reads) — it is
      4.1's to update with the contract suite.
- [x] 3.9 OpenRPC generator: enums from the declarations, `ProgressFrame`, `BridgeErrorCode`/`ConflictCode`, the common
      error set, the channel column; `wire.html` rewritten to current behaviour only (no history, no counts).
      **Built (3b):** `DocDataTests` reads the hosts' declarations (`*.Seam.cs`: vendors, shown/hidden languages, the IEC
      kind rows) for every vendor/language/kind enum; row statuses, severities, phases (`ProgressFrame.Phases`, new
      constants) as enums; `Request`, `ProgressFrame`, `ErrorFrame` (+ `ProtocolMismatchData`, `StaleProjectVersionData`),
      `BridgeErrorCode`, `ConflictCode` schemas; `body` optional; `x-errorCodes` = the common set (`PROTOCOL_MISMATCH`,
      `BAD_REQUEST`, `IDE_UNSUPPORTED` — not on `health` — `INTERNAL_ERROR`) then the op's own; `data.js` gains `codes`
      (each code's channels and the ops answering it as a frame), `languages`, `phases`, `commonFrameCodes`; framing,
      encoding and lifetime generated into `info.description`; every `x-outcomes` line rewritten to current behaviour.
      `wire.html` rewritten: framing table, progress, the `health` catalog, identity, the fetch combination table (B4),
      the gate table `ifVersion` × arm × force (B8, B9), the push answer and its phases (B2, B3), build, grep, the codes
      with the generated channel table; no history, no internal names, no counts. `cli.html`, `index.html`, `logs.html`
      lose `BRIDGE_PROTOCOL`/`accepted`. New gates: `The_contract_states_current_behaviour_only`,
      `The_vocabularies_come_from_the_hosts_declarations`, `The_frame_and_the_code_vocabularies_are_in_the_document`,
      `Every_progress_phase_is_a_declared_constant`; the wire.html op-count and "N of these codes" assertions are gone
      (F36: the tables are the count; index.html keeps its count). Wire shape re-pinned at protocol 1:
      `3231658c20c5ed48d450d9683df1b6172d81f5d3c53a2a8f65bb2a3774034221`.
Gate 3b (2026-10-24): the four review findings, each fixed; findings 1 and 2 run red first, finding 3's tests written
beside the fix.
1. **An unknown CODESYS severity is never a clean build** (`CodesysSeverity`): the enum is `[Flags]`, so a value carrying
   `FatalError`/`Error` IS an error whatever else it carries (`Error|SuppressedWarning`, `FatalError|Error`), and a value
   that is no number or carries a bit no installed version declares (`MayBeError`) makes `Build()` answer false (no
   severity guessed; `BuildService` then adds its "stated no error Volt could read"). A value of declared non-error bits
   that is no single row (a suppressed warning) stays unclassified and fails no build. Tests `CodesysBuildOwnMessagesTests`
   `A_value_carrying_an_error_bit_is_an_error_and_fails_the_build` (3, red), `A_value_with_an_undeclared_bit_has_no_severity_and_is_not_a_clean_build`
   (red; replaces the `128` row of the old theory, whose premise "fails no build" was the finding).
2. **An unknown `dirty` keeps the last STATED value** (`healthStep`, volt-control): clean → unknown → dirty raises the
   IDE-changed hint. Test `status.test.ts` `healthStep: an unknown read keeps the last STATED dirty…` (red).
3. **TwinCAT's unshaped `error:` line is carried only from a FAILED build's pane, and is no boundary**: `CollectPane`
   takes the pane's build verdict (`LastBuildInfo`, per PLC project on a named build; false for panes this session did
   not see a build write), and a quoted continuation holding `error:` stays in its message. Tests `TcBuildOutputTests`
   `AnUnshapedErrorWordInASuccessfulBuildsPaneIsNoDiagnostic`, `AnErrorWordInsideAQuotedContinuationStaysInItsMessage`.
   **For the owner:** the unshaped match is English (`error:`); a German XAE's `Interner Fehler:` reaches only
   `BuildService`'s generic error — not measured live, left as is.
4. **BOMs removed** from the seven files the step had given one (GrepModels, GrepService, PushService, CodesysDriver,
   GrepServiceTests, CodesysBuildOwnMessagesTests, WireVocabularyTests).
Green: typecheck, lint (0 errors), `bun run check` 16/16; C# Contracts 56 (−16 `SeverityTests` deleted, +4), Engine 3139
(+1 skipped), Cli 359, Connector 154, Ide.Twincat 726 (+8: 6 from 3.6, 2 gate), Ide.Codesys 500 (+12), Repo.Gates 255,
Relay 74; volt-cli `bun test test/unit` 228, volt-control 147, volt-vscode 39, volt-desktop 33; volt-lsp-iec
`scripts/bridge.test.ts` 5. No fixture, recording or transpiler change, so no fixture-map regeneration; no LSP source
changed, so the LSP suites are not this step's.

- [x] 3.9a INTERNAL_ERROR only for a Volt bug (owner 2026-10-24: "before this refactor we got a lot of internal errors
      back .. this is not very clean"). Census every uncoded throw reachable from the wire (`WireVocabularyTests`
      `UncodedThrow`: 164 before the rework, 177 at 1464605aaf — the refusals the rework added were mostly coded, but each
      uncoded one is answered INTERNAL_ERROR by PipeServer / ConflictFor). Classify each: a request or an IDE state gets
      its own code (BAD_REQUEST, UNSUPPORTED, UNREADABLE, PLC_DISCONNECTED, …) behind a test; only an invariant guard (a
      state Volt itself must never reach) stays INTERNAL_ERROR. The census becomes a ratchet that only goes down, and the
      contract suite gains a case per reclassified site where a request can reach it. Report before → after.
      **Built (3c):** before: 152 `throw new` of an uncoded BCL type in `src/` (outside Contracts and the CLI; the census
      regex at b23c70e660), plus 6 constructions the old regex did not see (3 factories returning a BCL type, 3 `new` in a
      factory body or a switch arm) and 3 BCL subtypes ConflictFor coded by TYPE (`UnrepresentableBodyException`,
      `ChildRefusedException`, `TcEnoRefusal` — `NotSupportedException`s). After: **0** uncoded (`No_throw_is_uncoded`;
      the regex now also counts a non-throw `new` and a factory returning a BCL type). The 158 constructions, per class:
      **42 invariants** (`VoltInvariantException`, new in Contracts, `INTERNAL_ERROR`, logged whole by `PipeServer`;
      ratchet `Invariants_only_go_down`, per file, fails on a rise only); **34 IDE_UNSUPPORTED** (the IDE's object model
      lacks a type, member or overload Volt calls — every `MissingMethodException`, every "not loaded"/"no such member");
      **33 UNSUPPORTED** (16 `BridgeException`, 17 `UnsupportedException` — new in Engine, a coded `NotSupportedException`
      for the paths that ROUTE on a vendor "cannot": the TwinCAT in-place write's fall-back to the builder, the
      unchanged-network render; the three subtypes now derive from it); **28 UNREADABLE** (the IDE answered a read with
      nothing or a shape Volt cannot read: XML, signatures, project settings, a checkout with no object); **9
      IDE_LOST_ITEM** (a create, move, write or TaskDef the IDE does not hold back); **4 PLC_DISCONNECTED** (no primary
      project, no XAE of the pid, no TwinCAT project bound, no PLC project in the solution); **1 ITEM_UNVERIFIED** (a
      CODESYS node whose name the IDE answers null); **8 caught inside** by a named type (`HierarchyReadException` 6 —
      a missing proxy still becomes IDE_UNSUPPORTED, else `Explorer`'s ITEM_UNVERIFIED; `PipeBindException` 1;
      `RelaySocketGoneException` 1). Also re-coded: the SP18 NWL constructor refusal UNSUPPORTED → IDE_UNSUPPORTED
      (the same situation). `ConflictFor`'s TYPE mapping deleted (code = the throw's, a network-text diagnostic's, else
      INTERNAL_ERROR), so a frame and a conflict answer one failure with one code. Vocabulary: IDE_UNSUPPORTED is also
      the code of ONE call's missing API (`ConflictCodes.FromBridge` and the unreadable channel gain it); `build` gains
      UNSUPPORTED (a project with no application). Wire shape re-pinned at protocol 1
      (`3d6beb32f772370bb701140ef99ceb8bbf57a25267e88289ba8ddc3288aad591`; one enum value added to `ConflictCode`, one
      frame code on `build`). Tests: `PushConflictCodeTests` (theory +3 rows: IDE_UNSUPPORTED, a foreign
      `NotSupportedException` and `InvalidOperationException` → INTERNAL_ERROR), `CallFailureEvidenceTests` (+1, an
      invariant's frame and log), `CodesysRefusalCodeTests` (2: build with no application UNSUPPORTED, no primary project
      PLC_DISCONNECTED), `CodesysContainerRefusalTests` (no object manager: the walk is refused IDE_UNSUPPORTED — it was
      a folder named unreadable), and the 69 test cases the change turned red (Engine 24, Ide.Twincat 30, Ide.Codesys
      15) re-read from the exception TYPE to the code (written beside the fix, not run red first); the
      `WireRulesHaveOneImplementationTests` mapping ratchet re-pinned (PushService 3 → 2; `UnsupportedException` and
      CODESYS `Reflection.SurfaceMismatch` pinned, each a definition or a route on a code, no mapping). **Contract suite (4.1):** no reclassified site is reachable by a request against the
      fixture IDEs — each needs an IDE lacking an API, an IDE answering a read with nothing, or a Volt bug; the build
      of a library project (no application) needs a fixture that has none. design "Built (step 3c)".
Gate 3c (2026-10-24): the ten review findings, each fixed — principle first, then the fix (design "Built (step 3c)"
3, 5–5f). Red first: 1, 2, 3, 4, 5, 7, 8, 9 (the restored C5), 10, and 6's invariant half; 6's channel-code half pins
what already held.
1. **A lookup's one mapping covers the driver's UNREADABLE**: `TreeLookup.Read` answers a sibling the IDE answered with
   nothing ITEM_UNVERIFIED naming the folder and the child, the driver's refusal inner (`ErrorCodeVocabularyTests`
   `A_sibling_the_IDE_answers_with_nothing_during_a_lookup_is_ITEM_UNVERIFIED_naming_the_folder`; FakeIde gains
   `UnreadableClassifies`). wire.html's "an unreadable folder is ITEM_UNVERIFIED" holds again.
2. **The delete-then-create advice is one refusal's**: `MemberWithoutDeclarationException` (Engine, UNREADABLE) from
   `MemberSites.Declaration`; `ReadLive` adds the advice to that type only (`An_update_whose_read_the_IDE_answers_with_nothing_is_UNREADABLE_without_the_delete_advice`;
   the existing delete-then-create test's fake throws the type the drivers throw; the two drivers' member tests assert it).
3. **The census counts every exception type Volt does not declare**, not a BCL list: `TcArchiveWriter`'s two parse-side
   `FormatException`s are `UnsupportedException` (not reachable from a request — `ParseObject` is the identity gate's
   reader; `TcArchiveIdentityTests.A_shape_TwinCAT_never_writes_is_refused_UNSUPPORTED`); the OS types below the wire are
   pinned per file (`BelowTheWire`: PipeAcl 6, ProcessElevation 1, RelayTunnel 1). Theory +10 rows.
4. **What fails a CODESYS walk is a binder failure, not a code**: `SurfaceMismatchException` (IDE_UNSUPPORTED) at the
   five former `MissingMethodException` sites and a node with no `get_name`; `Reflection.SurfaceMismatch` = that type,
   `MissingMemberException`, `AmbiguousMatchException`. A library manager without `GetAllLibraries` is named unreadable
   and the walk goes on (`CodesysMemberAvailabilityTests.A_library_manager_without_GetAllLibraries_is_named_unreadable_and_the_walk_goes_on`).
5. **A CODESYS name answered null has no identity**: `GetName` refuses UNREADABLE; the walk unwalks its folder and goes on
   (`CodesysContainerRefusalTests.A_child_whose_name_the_IDE_answers_null_unwalks_its_folder_and_the_walk_goes_on`);
   wire.html says so. No ITEM_UNVERIFIED frame from CODESYS — the OpenRPC's "(TwinCAT)" stands.
6. **A Volt bug is no unreadable object**: `SafeVersion` lets INTERNAL_ERROR through (`An_invariant_broken_during_a_read_fails_the_op_and_is_no_unreadable_entry`,
   red); the channel codes pinned (`A_read_refused_with_an_unreadable_channel_code_publishes_it`: a vendor language that is
   no word UNSUPPORTED, a read answered with nothing UNREADABLE, a foreign COM fault UNREADABLE). Report correction: since
   3c an `unreadable` entry also carries UNSUPPORTED for `ImplementationMarker.VendorLanguage`, `UnrepresentableBodyException`
   and `ChildRefusedException` (UNREADABLE before), and IDE_UNSUPPORTED for a missing API; ITEM_UNVERIFIED/IDE_LOST_ITEM
   on a read reach an entry as since 3a (none measured on a read path) — **for the owner**: undeclared on that channel.
7. **A Volt bug is logged whole on the push channel**: `ConflictFor` logs an INTERNAL_ERROR conflict at Error with
   `CallFailure.LogText` (`PushConflictCodeTests.A_Volt_bug_answered_as_a_conflict_is_logged_with_its_stack`, 3 rows).
8. **A missing facet is that node's**: `Facet` refuses UNSUPPORTED (`CodesysDeviceDescriptorTests.A_node_without_the_device_facet_is_refused_UNSUPPORTED`).
9. **The C5 re-premise is withdrawn**: the test is back to its committed oracle (folder named unreadable, subtree
   unwalked, `SimType` not published) and passes under finding 4's fix. The 69 type→code assertion changes stay: each
   asserts the code the step decided, not the type a refactor happened to throw; 4 of them now assert the routing type
   (`SurfaceMismatchException` ×2, `MemberWithoutDeclarationException` ×2), which is the original binder/member oracle.
10. **The CLI advises on IDE_UNSUPPORTED** "this IDE version lacks what the write needs; no retry helps — the IDE has to
   change" (`PartialPushCommandTests.An_op_the_IDE_lacks_the_API_for_advises_that_the_IDE_has_to_change`).
Counts after the gate: IDE_UNSUPPORTED 34 → 33 (6 of them `SurfaceMismatchException`), UNSUPPORTED 33 → 36 (+1 Facet,
+2 archive parse), UNREADABLE 28 → 29 (+1 a null name), ITEM_UNVERIFIED 1 → 0; constructions of a type Volt does not
declare in `src/` outside Contracts and the CLI: 0, plus 8 pinned below the wire. Wire shape unchanged
(`3d6beb32…`); no fixture, recording, transpiler or LSP change, so no fixture-map regeneration.
Green: typecheck, lint (0 errors), `bun run check` 16/16; C# Contracts 56, Engine 3151 (+1 skipped), Cli 361,
Connector 154, Ide.Twincat 728, Ide.Codesys 505, Repo.Gates 275, Relay 74; volt-cli `bun test test/unit` 228.
- [x] 3.6b ONE coordinate system for every line on the wire (owner principle, PLC Assist report 2026-10-24): a build
      diagnostic's `line` is the 1-based line in the item's FETCHED `sourceText` — the coordinates `grep` and network-text
      refusals already use — never the vendor's own count. Measured live (TwinCAT 3.1.4024.74, PLC Assist read/edit suite):
      an error on fetched line 51 inside a METHOD whose header is line 45 is reported `6` (member-relative); 2.6 also found
      TwinCAT counts declaration + body without the `IMPLEMENTATION` line. 3b passes the vendor's number through: a value in
      the wrong coordinates, as bad as an invented one (zero-fallback). The host maps the vendor's (object, member, line)
      to the item's fetched text line; where it cannot map with certainty, `line` is ABSENT. Red e2e test first on both
      vendors: an error at a known fetched line in the item body and in a METHOD body answers exactly that line. The
      schema states the coordinate system in `line's` description.
      **Built 2026-10-24** (design "Built (3.6b and step 4)" 1): the driver states the vendor's line in the object it
      names (seam: declaration lines, then code lines); `BuildService.Place` places it through the kind's
      `IItemFormat.LineOf` (`IecFormat`: the text read back must write itself, then `StWriter.Lines`), else no `line` and
      no `column`. Not placed: a property accessor's line (the wire names no accessor), a network or hidden body, a line
      past the object, a diagnostic naming no item. Tests: `BuildDiagnosticLineTests` (9), `StWriterLinesTests` (2),
      `ThirdVendorTransportTests` (Fakeco states its line by the seam and places it), the premise "the vendor's position
      is untouched" removed from `BuildDiagnosticNameTests` (overturned by this task). Live: `build-diagnostics.test.ts`
      "a line is the fetched text's line holding the fault, in the body and in a METHOD" green on TwinCAT 3.1.4024 (the
      exact fetched lines) and CODESYS 3.5.21.40 (absent: CODESYS states none); written beside the fix, not run red
      first. OpenRPC `BridgeDiagnostic.line`/`column` carry the description; `wire.html`, DIALECT D36, the CLI's and
      volt-control's printing (`name:line[:column] (member)`) follow. Wire shape re-pinned (`45202c77…`, protocol 1).
- [x] 3.10 All C# suites, `bun test test/unit`, typecheck, lint, `bun run check` green.
      Step 3d re-measured at `5b03b13771` (2026-10-24, clean tree, `dotnet build Volt.sln` 0 errors, then `--no-build`):
      Contracts 56, Engine 3151 (+1 skipped), Cli 361, Connector 154, Ide.Twincat 728, Ide.Codesys 505 (net48),
      Repo.Gates 275, Relay 74 — 0 failed; volt-cli `bun test test/unit` 228/228; typecheck 3/3 packages exit 0; lint
      exit 0, 0 errors (2443 warnings); `bun run check` 16 passed, 0 failed. Identical to the gate-3c counts; no product
      code changed. Re-run by the 3d gate agent at the same commit: Release build 0 errors (76 warnings); every suite
      above at the same count, 0 failed; typecheck 5/5 packages exit 0; lint exit 0; `bun run check` 16/16; volt-cli
      unit 228/228. **For the owner — an intermittent Cli failure:** the first `Volt.Cli.Tests` run in that re-run reported
      1 failed / 360 passed (6 m 23 s, run while lint, `check` and the bun unit tests ran alongside it). It was not
      reproduced in two more runs, one alone (361/361, 7 m 5 s) and one under the same load with a TRX logger (361/361,
      6 m 15 s). Its name was not captured because the first run had no logger. A test that fails once in three runs is
      a bug (`timeout-is-a-bug`), not noise; it goes to the next Cli step with `--logger trx` on every gate run. No
      fixture, recording, transpiler or LSP change, so no fixture-map regeneration and no LSP suite (VOLT_REQUIRE_FULL n/a).

## 4. Live

- [x] 4.1 The OpenRPC contract suite updated to the new shape and green on both vendors.
      **Done 2026-10-24.** The contract suite reads the new answer (a push's refusal is its first conflict that is no
      NOT_ATTEMPTED; `conflicts` always present), one raw frame gained `protocol`; it found one bridge defect, fixed red
      first: a `null` frame answered PROTOCOL_MISMATCH, now BAD_REQUEST (`PipeServer`, `PipeTransportTests`). 173/173 on
      TwinCAT 3.1.4024, all green on CODESYS 3.5.21.40. The whole live suite moved to the new shape with it (`landed()`
      for `accepted` ×186, the lease frame, `removed`/delta receipts, NOT_ATTEMPTED on a pre-flight refusal, `durationMs`,
      `languages`, `GrepMatch.name`, a failed build's unshaped line): TwinCAT 541 + the re-run files green (the first
      run's 26 reds were 18 stale reads and 8 caused by a parallel CODESYS run driving the TwinCAT pipe through
      `vendor-parity` — never run two vendors' suites at once), CODESYS 600/600.
- [ ] 4.2 The wire transcripts re-recorded ONCE for the new shape (`release:matrix --record-transcripts`), then compared
      identical on a second run.
- [ ] 4.3 The mixed-version cell against the previous release (protocol stays 1, owner 2026-10-24): its client sends no
      `protocol` and is refused by name before any op; our client's `protocol` member is refused by its strict reader by
      name. Both directions refused by name, never misread.
- [x] 4.3a PLC Assist report 2026-10-24 (bridge 0.1.17931, CODESYS SP21, intermittent, twice): a push that CREATED an
      item answered landed, yet the next refs had no entry for it in `items` — both items had a deliberate compile error
      (an FB with a type error; a PROGRAM referencing an uncreated DUT). Treat as a bridge bug until disproved: live
      repro on 3.5.22.40 and 3.5.21.x on an own instance (create such an item, refs at once, N≥50 rounds, plus a refs
      after 1 s), with VOLT_LOG_DEBUG=1. Classify: unreadable / unwalkedFolders / a silent skip (the 0.1.17931
      "unmapped kind" Debug-only skip, ProjectSnapshot) / the object not yet in the IDE tree. Fix at the root behind a
      red e2e test; a receipt naming an item refs then omits is never acceptable (zero-fallback).
      **Measured 2026-10-24, not reproduced:** `VOLT_LOG_DEBUG=1`, own instances, both reported shapes (an FB with a type
      error; a PROGRAM naming an uncreated DUT), create → refs at once → (on a miss) refs after 1 s → delete: CODESYS
      3.5.22.40 64-bit 100 rounds, 3.5.21.40 64-bit 100 rounds and 50 more with a `build` between the create and the refs
      — 0 misses. Classification: of the four classes only the 0.1.17931 silent skip could answer "landed" and omit the
      item from refs with no trace (`ProjectSnapshot`'s Debug-only "unmapped kind" skip); the rework removed it — an
      object whose type the IDE does not state now puts its folder in `unwalkedFolders`, on the receipt and on refs
      alike, never silently. Regression test (green on both vendors, 5 rounds per shape):
      `test/e2e/endpoints/create-then-refs.test.ts` — the receipt names the create and refs at once holds it at that
      version. No root fix without a reproduction; PLC Assist's next report on this release names the class
      (`unwalkedFolders`/`unreadable`) if it recurs.
- [ ] 4.3b Round-trip fidelity, PLC Assist read/edit suite 2026-10-24 (0.1.17931, both vendors): their deterministic
      2,451-line FB (`C:UsersmarceAppDataLocalplcassist-parkolt-fidelityVltRwBig.pou.txt`, also `.lines.json`, and
      `VltRwCrlf.pou.txt` (CRLF+BOM) / `VltRwLf.pou.txt`) pushed as one `set` create, then `fetch onlyItems`: 80 of 2,451
      lines differ BY INDEX on BOTH vendors (same count, so likely Volt's materializer, not an IDE). Lines 2373–2451 are
      the members (8 METHODs, then a PROPERTY with GET) — hypothesis: member ORDER or layout (blank lines, accessor
      shape) differs, shifting every member line. Push it live on our own instance on both vendors, diff line by line,
      and classify each difference: the IDE's own (stated in DIALECT with a measurement) or Volt's (fixed behind a red
      e2e test before the release). Also: a BOM pushed in `sourceText` came back kept — decide whether a BOM may live
      in `sourceText` at all (principle: the item text is UTF-8 text; a leading U+FEFF is either refused BAD_REQUEST or
      stripped and stated, never silently stored into the IDE).
      **Measured 2026-10-24, our instances (CODESYS 3.5.22.40 64-bit, TwinCAT 3.1.4024.74, `VltRwBig`/`VltRwLf`/`VltRwCrlf`
      pushed as one create each, fetched back, diffed by index), identical on both vendors, so all Volt's:**
      (a) **the 80 lines are ONE inserted line**: the fetched text has a blank line before `END_FUNCTION_BLOCK` (the
      `StWriter` layout separator: body, blank line, END line) where the pushed text had none, so every later line moves
      by one (`VltRwBig` 2452 → 2453 lines, first difference at 2372; `VltRwLf` 9 → 10). With that one line inserted the
      texts are equal — members, order, accessors, trailing whitespace, the 2,000-character line and the Unicode comment
      all round-trip. The IDE holds the same body either way (the reader strips the separator when present): the text,
      not the content, differs. (b) `\r\n` comes back `\n`. (c) a leading U+FEFF was stored into the IDE as the
      declaration's first character (both vendors). **Fixed: (c)** — refused BAD_REQUEST in the pre-flight, nothing
      lands (`PushSourceTextBomTests` red first, 2; e2e `push.test.ts` "refuses a sourceText that starts with a byte-order
      mark" green on both vendors; `wire.html`'s BAD_REQUEST row; census +1). **Open, for the owner — this task stays
      unticked:** (a) and (b) are Volt's canonical layout, not the IDE's. Making a client's text come back byte-identical
      means the writer's separator before an END line becomes the minimum (`\n`, the body keeping a blank line as its own
      trailing newline) — a change of the canonical file: every pulled POU file changes, 114 C# and 40 TS test texts and
      the six corpora's workspace files (oracle data) with it. Not built here (no format change without the owner);
      the alternative is to state the canonical text in `wire.html` ("a text that differs only in these comes back in
      the canonical layout") and keep it.
- [ ] 4.4 Small matrix per push (`--only codesys-3.5.22.40-64,twincat-32,vendor-parity --jobs 1`).

## 5. Close

- [x] 5.0 QUALITY RATING after (owner 2026-10-24): re-run the archived rework's scripts
      (`openspec/changes/archive/2026-10-24-volt-cli-rework/input/rating-measure.sh`, `rating-pins.sh`), same criteria and
      scale, into this change's `input/rating-after.md`: Engine, Ide.Codesys, Ide.Twincat, Contracts + Wire, before (the
      rework's 7 / 7.5 / 7 / 6.5) → after, each move tied to its evidence.
      **Done 2026-10-24:** `input/rating-after.md` — Engine 7 → 7, Ide.Codesys 7.5 → 7.5, Ide.Twincat 7 → 7, Contracts +
      Wire 6.5 → 7.5 (W1/W2, P3/P4 fixed; vendor symbols 33 → 17; uncoded throws 151 → 0).
- [ ] 5.1 `plcassist-note.md` final, sent to PLC Assist with the release.
- [ ] 5.2 The full release matrix once, green; docs match the code; archive.
