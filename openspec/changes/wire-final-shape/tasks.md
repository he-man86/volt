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

- [ ] 2.6 `build.success` vs "no `error` diagnostic" on both vendors over the e2e build cases: one rule if they agree.
- [ ] 2.7 Each vendor's severity words seen in the corpora and recordings: the host's declared word table.

## 3. Build, test-first (offline)

- [ ] 3.1 Contract types (`Volt.Contracts/Wire`) to the new shape; `Vendors.cs` and the per-vendor pipe minters out of
      Contracts (vendor ids from `VendorRegistry`); every change red first in `Volt.Contracts.Tests`.
- [ ] 3.2 Envelope: `protocol` required, `PROTOCOL_MISMATCH` before the body is read (`PipeServer`), protocol 1.
- [ ] 3.3 `health`: `languages`, `kinds`, optional `dirty` (both hosts, no fallback), status enum.
- [ ] 3.4 `refs`/`fetch`: `code` on unreadable entries; `knownApplications` required with `knownItems`.
- [ ] 3.5 `push`: `accepted` and `currentProjectVersion` deleted; lease as an error frame; `removed` in the receipt;
      `existing` on ITEM_EXISTS; `code` required.
- [ ] 3.6 `build`: severity absent when unmapped; positions optional and 1-based; `durationMs`.
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
