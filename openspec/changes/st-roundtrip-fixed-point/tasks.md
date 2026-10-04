## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed; (A) FITS as an opt-in request flag, (B) does NOT fit — stable workspace diffs.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check (A) receipt text and (B) fixed point against volt's design: the canonical member order and blank line
      (`StWriter.cs:32-62`, stable workspace diffs), the receipt walk, the CLI baseline. Record FITS, or CONFLICTS +
      why + the volt-native alternative. Build only what fits.

## 1. Reproduce

- [x] 1.1 (2026-10-04: `test/Volt.Engine.Tests/sync/PushThenFetchShapeTests.cs`, 3 green on FakeIde: a created W1 fetches
      as the canonical text — 22 pushed lines → 23 fetched, the one extra the blank line before `END_FUNCTION_BLOCK`,
      ACTION Stop moved before PROPERTY Running; the receipt's `newItems` version equals the fetched version, so only
      the TEXT differs; fetch → push → fetch is stable. FakeIde fixed on the way: a content write dropped a property's
      accessors (replaced the member, never wrote GET/SET), so a pushed property read back empty.) Engine test: push the W1 text (body ending directly at `END_FUNCTION_BLOCK`, PROPERTY before ACTION), fetch
      it, and record the difference: one blank line before the END line, ACTION before PROPERTY.
- [x] 1.2 (gate 1, 2026-10-04) Review findings on step 1, each red first (`sync/FakeAccessorWriteTests.cs`, 3 red → 4 green):
      - FakeIde's accessor write kept the old body on a null `Body` (`?? acc.Implementation`) — FIXED: writes
        `Accessor.Code` (`""` for null) as CODESYS does; TwinCAT's null comes only from its own `Textual` (graphical
        body already written through the archive) and `StReader` never yields one, so no vendor asymmetry is taken.
      - the accessor body skipped `Held` — FIXED: a graphical GET/SET is held as its model (canonical layout,
        `RematerializeAs`), an UNSUPPORTED one keeps the IDE's body, as the member path.
      - an INTERFACE accessor took a declaration AND a body — FIXED: declaration only (CODESYS, D41), never a body (no
        slot on either vendor); TwinCAT's "nothing at all" is its pre-flight refusal, modelled by
        `ValidatesInterfaceAccessor` (pinned: refused, nothing written).
      - `Fetch_push_fetch_is_stable` possibly vacuous — MEASURED not vacuous: the restated canonical text IS written
        (`writecontent` count rises); the test now asserts that, and adds a canonical-form edit that is written and
        reads back byte for byte.
      - `Canonical` is StWriter + fake, not the R14 recording — ACCEPTED as stated: its doc now says R14 attests only
        the blank line before `END_FUNCTION_BLOCK` and ACTION-before-PROPERTY; 4.1 compares against a live fetch.
      Numbers: Engine 2197 pass / 1 skip, Cli 260, Connector 115, Twincat 428, Codesys 297, Contracts 39, Repo.Gates 108
      (all 0 fail); typecheck clean; `bun run check` 18/18; volt-cli `test/unit` 24/24.

## 2. Test red

- [x] 2.1 (2026-10-04: `test/Volt.Engine.Tests/sync/PushReturnsSourcesTests.cs` — 9 red on the value (`newSources` null),
      3 green guards (corrected at gate 2; first recorded as 4): flag absent/false → no `newSources` (on the wire too), rejected push → none. Red: W1 FB, a GVL + struct
      + enum DUT, an update, only changed items, rename+edit under the new name, a delete has no entry, a partial push
      answers only landed ops, an item the receipt cannot read has no entry (and none in `newItems`), keys ⊆ `newItems`;
      every expected text is a FETCH on the same fake. Contract fields landed (`PushRequest.ReturnSources`,
      `PushResponse.NewSources`, both `JsonIgnore` when null) and docs regenerated now — design.md says why. Engine 2200
      pass / 9 fail (the red) / 1 skip, Contracts 39, Cli 260; `bun run check` 18/18.) For the chosen route: the push answer's text (A), or the fetched text (B), equals the canonical text a fetch
      gives, for an FB with members and for a GVL/DUT.
- [x] 2.2 (gate 2, 2026-10-04) Review findings on step 2 — all four taken; every new test is red ON THE VALUE
      (`newSources` null), its premises asserted green before it:
      - no rename-only / move-only op (no `SourceText`), no TwinCAT rename shape — ADDED: a rename-only op is answered
        under the new name with the rewritten header (CODESYS shape, premise: the fetch reads `FUNCTION_BLOCK FB_New`);
        the same under `RewritesOwnReferencesOnRename` (TwinCAT, DIALECT C2o: the fetch reads `F_New := TRUE;`); a
        move-only op is answered. A build that fills `newSources` only for ops carrying text fails all three.
      - "an op in `conflicts` has no entry" unpinned (the partial-push case's refused create rolled back, so it was
        absent from `newItems` anyway) — ADDED: a refused UPDATE that stays in `newItems`, both shapes: declaration
        written before the member refusal (`partiallyApplied: true`) and nothing written. A build keying on `newItems`
        ∩ set-op names fails both.
      - no `unwalkedFolders` case — ADDED: a create into `Types`, which the receipt walk cannot enumerate after the
        write (`OnWalkItems` → `UnwalkableFolders`): `Types` in `unwalkedFolders`, the item absent from `newItems` and
        `newSources`, the sibling GVL answered.
      - tasks.md "4 green guards" — CORRECTED to 3 in 2.1.
      Numbers: PushReturnsSourcesTests 15 red (all `Assert.NotNull() Failure: Value is null`) / 3 green / 18;
      Engine 2200 pass / 15 fail (the red, 9 → 15) / 1 skip (2216); Cli 260, Connector 115, Twincat 428, Codesys 297,
      Contracts 39, Repo.Gates 108 (all 0 fail); typecheck clean; `bun run check` 18/18. No LSP/fixture/transpiler
      change, so no fixture-map regeneration.

## 3. Build

- [x] 3.1 (2026-10-04: route A as design.md step 2 — `ProjectSnapshot.Walk(keepTextOf:)` keeps `Texts` (full name →
      the walk's own materialized text) for the names asked and no others; `PushService` asks, only when
      `returnSources == true`, for each LANDED `set` op's `toName ?? name` (case-insensitive, keyed by the IDE's
      spelling) and answers them as `newSources` on the accepted and the partial result. Zero extra IDE reads; text and
      `newItems` version from one materialization; engine-only, so both vendors identical. Docs: no field doc changed,
      `DocDataTests` green without regeneration (the contract docs landed in step 2). Numbers: PushReturnsSourcesTests
      18/18 (15 red → green), PushThenFetchShapeTests 3/3; Engine 2215 pass / 0 fail / 1 skip (2216), Cli 260,
      Contracts 39, Twincat 428, Codesys 297; `bun run check` 18/18.) The chosen route; regenerated docs.
- [x] 3.2 (gate 3, 2026-10-04) Review findings on step 3 — both taken, each red first:
      - `newSources` covered only landed `set` names, so the callers a native rename rewrote (new `newItems` version, no
        op names them) had no entry — a client re-reading only pushed names would adopt the caller's new version over
        its pre-rename text and push the old name back. FIXED in the spec's words ("each item the push changed"): the
        receipt walk also keeps every item whose version differs from the pre-apply walk's (`ProjectSnapshot.Walk`
        takes a `keepText(name, version)` predicate), except an item a conflict names (`name`, `renamedTo`) — re-read;
        the pre-apply walk now materializes under `--force` when `returnSources` is set (only a pre-apply version says
        what changed). Tests (2 red on the value — "newSources has no entry for 'PLC_PRG.pou'" — premises green):
        a rename answers the caller it rewrote (and nothing else); a refused rename+edit that stays renamed, on the
        partial path, answers the rewritten caller and not `Y.pou`/`X.pou`. design.md "Gate 3" + `NewSources`/
        `ReturnSources` docs say "every item the push changed".
      - the IDE-spelling key was untested/undocumented — `NewSources` doc now states it (an op named in another case is
        answered under the IDE's case, the `newItems` key); pinned by a test (`fb_motor.pou` → `FB_Motor.pou`, green
        on the step-3 build — the behaviour was right, only unpinned).
      Numbers: PushReturnsSourcesTests 21/21 (18 → 21); Engine 2218 pass / 0 fail / 1 skip (2219), Cli 260, Connector
      115, Twincat 428, Codesys 297, Contracts 39, Repo.Gates 108 (all 0 fail); volt-cli `test/unit` 24/24; typecheck
      clean; `bun run check` 18/18. `DocDataTests` green, `VOLT_WRITE_DOCS=1` produced no diff (field summaries are not
      in the generated docs). No LSP/fixture/transpiler change, so no fixture-map regeneration.

## 4. Verify

- [x] 4.1 (2026-10-04: `test/e2e/endpoints/push-return-sources.test.ts`, live CODESYS SP21 Patch 4 on an `ide.ps1
      -Instance st-roundtrip-fixed-point` fixture copy, 9/9 green, 72 expects. One rule check runs on EVERY entry of every
      answer: its text equals a LIVE fetch's `sourceText` byte for byte, its key is in `newItems`, its `newItems` version
      is the live refs version. Cases, rule by rule through the `NewSources` doc: W1 created (answer != pushed; holds
      `xRunning := xEnable;` + blank line + `END_FUNCTION_BLOCK`, ACTION before PROPERTY; only the FB answered); GVL +
      struct + enum
      DUT in one push; update (no flag and `false` → no `newSources`); rename+edit (new name, old absent); rename-only
      (rewritten header `FUNCTION_BLOCK <new>`); move-only; a rename answers EXACTLY the items whose refs version moved —
      measured: CODESYS does not rewrite a caller's `inst : FB_A` on rename, so only the renamed item changed and only it
      is answered; a delete has no entry and an op named in lower case is answered under the IDE's spelling; an op
      refused at apply (`Vlt__Log`) has no entry while the op that landed before it does. No disagreement with the
      IDE found, so no fixture pinned and no known divergence. TwinCAT not run live: engine-only, parity is the wire.)
      Live on CODESYS: create, then fetch; the text equals what the push answer held (A) or what was pushed (B).
      Compare against the LIVE fetch, never against `PushThenFetchShapeTests.Canonical` (StWriter + fake; R14 attests
      only the END-line blank line and the member order).
- [x] 4.2 (2026-10-04) Full C# suites and `bun run check` green. Engine 2218 pass / 0 fail / 1 skip (2219), Cli 260,
      Connector 115, Twincat 428, Codesys 297, Contracts 39, Repo.Gates 108 (all 0 fail); `bun run check` 18/18; volt-cli
      `test/unit` 24/24; typecheck clean. No LSP/fixture/transpiler change, so no fixture-map regeneration.
- [x] 4.3 (gate 4, 2026-10-04) Review findings on step 4 — all three taken; the live test was red first on each vendor
      (`no measured value for vendor` — the caller-rewrite case refuses an unmeasured vendor by name, never a guess):
      - the caller-rewrite fact went only to `console.log`, unrecorded, and contradicted the docs — MEASURED on BOTH
        vendors and recorded as DIALECT **C2p**: one rename-only push of an FB and a FUNCTION, with a PROGRAM declaring
        `inst : FB_A;` and calling `ok := F_A(a := 1);` — TwinCAT rewrites both (the caller's version moves, it is in
        `newSources`, and its text equals the live fetch: gate 3's "a rewritten caller is answered" is now exercised
        live), CODESYS rewrites neither (caller version unchanged, only the renamed items answered). The test asserts the
        per-vendor table (`C2P_CALLER_REWRITE`) and that the caller is answered exactly when its version moved, so a
        vendor change in either direction fails it. Corrected every place that said "both vendors" / "the IDE rewrites
        the call sites": `FakeIde.RewritesReferencesOnRename` (now the TwinCAT shape; unset = CODESYS), `PushService`
        (receipt walk, task rename, `ApplySetItem`, the rename guard, `OpOutcome.Renamed`), `PushModels` (`SetItemOp`,
        `NewSources`), `ProjectSnapshot`, `Commands` (baseline), `ARCHITECTURE.md`, and the offline tests' docs. The
        offline caller tests (`PushReturnsSourcesTests` gate-3 pair) now run the full TwinCAT shape
        (`RewritesOwnReferencesOnRename` too); `RenameBeforeWriteTests`' CODESYS-shape test no longer sets the caller
        flag; `PartialPushCommandTests` R3 says its caller rewrite is TwinCAT's.
      - TwinCAT never run live — RUN (Project13 copy, `-Fixture 13 -Instance st-roundtrip-fixed-point`): 10/10 green. Added
        a rename-only FUNCTION case whose own return assignment the IDE rewrites (C2o): the answer equals the live fetch
        and reads `F_B := a > 0;` on TwinCAT, `F_A := a > 0;` on CODESYS (asserted per vendor).
      - move-only never asserted the move landed — ADDED: `newFolders[name]` and the live `refs.folders[name]` equal the
        destination.
      Numbers: push-return-sources.test.ts live CODESYS SP21 Patch 4 10/10 (87 expects), live TwinCAT 10/10 (91 expects);
      Engine 2218 pass / 0 fail / 1 skip (2219), Cli 260, Connector 115, Twincat 428, Codesys 297, Contracts 39,
      Repo.Gates 108 (all 0 fail); volt-cli `test/unit` 24/24; typecheck clean; `bun run check` 18/18. No
      LSP/fixture/transpiler change, so no fixture-map regeneration and no LSP suite run.
