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

- [ ] 3.6 `build`: severity absent when unmapped; positions optional and 1-based; `durationMs`. The CODESYS word table
      reads `IMessage.Severity` as its numeric value (2.7); first measure on live 3.5.22.40 which values a build gives
      (a suppressed warning included), raw values logged, before the table is written. TwinCAT keeps the `,col` group
      and serves a column only where a pane states one (2.6: 4024 states none).
      ZERO-FALLBACK (owner policy, overrides 2.6's "niche: accepted loss"): a build whose `success` is false MUST carry at
      least one error diagnostic. A compiler line the parser cannot place (TwinCAT's "Internal error: …" with no
      file(line) shape) is carried as a diagnostic with its text and NO position — positions are optional in this shape,
      so nothing is invented. Red test first: a failed build with an unparseable error line answers that line, never an
      empty list.
- [ ] 3.7 `grep`: `name`.
- [ ] 3.8 The CLI, `volt-control`, the relay and the VS Code extension read the new shape (their offline suites).
- [ ] 3.9 OpenRPC generator: enums from the declarations, `ProgressFrame`, `BridgeErrorCode`/`ConflictCode`, the common
      error set, the channel column; `wire.html` rewritten to current behaviour only (no history, no counts).
- [ ] 3.9a INTERNAL_ERROR only for a Volt bug (owner 2026-10-24: "before this refactor we got a lot of internal errors
      back .. this is not very clean"). Census every uncoded throw reachable from the wire (`WireVocabularyTests`
      `UncodedThrow`: 164 before the rework, 177 at 1464605aaf — the refusals the rework added were mostly coded, but each
      uncoded one is answered INTERNAL_ERROR by PipeServer / ConflictFor). Classify each: a request or an IDE state gets
      its own code (BAD_REQUEST, UNSUPPORTED, UNREADABLE, PLC_DISCONNECTED, …) behind a test; only an invariant guard (a
      state Volt itself must never reach) stays INTERNAL_ERROR. The census becomes a ratchet that only goes down, and the
      contract suite gains a case per reclassified site where a request can reach it. Report before → after.
- [ ] 3.10 All C# suites, `bun test test/unit`, typecheck, lint, `bun run check` green.

## 4. Live

- [ ] 4.1 The OpenRPC contract suite updated to the new shape and green on both vendors.
- [ ] 4.2 The wire transcripts re-recorded ONCE for the new shape (`release:matrix --record-transcripts`), then compared
      identical on a second run.
- [ ] 4.3 The mixed-version cell against the previous release (protocol stays 1, owner 2026-10-24): its client sends no
      `protocol` and is refused by name before any op; our client's `protocol` member is refused by its strict reader by
      name. Both directions refused by name, never misread.
- [ ] 4.4 Small matrix per push (`--only codesys-3.5.22.40-64,twincat-32,vendor-parity --jobs 1`).

## 5. Close

- [ ] 5.1 `plcassist-note.md` final, sent to PLC Assist with the release.
- [ ] 5.2 The full release matrix once, green; docs match the code; archive.
