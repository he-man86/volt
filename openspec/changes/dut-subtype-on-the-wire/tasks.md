Order: measure → tests red → engine → CLI deletion → docs → live. Starts only after
`network-text-literal-nwl` has landed (both touch `Volt.Engine/Sync` and `Volt.Cli/Sync`).

## How this change is worked (the loop — every section, in order)

1. **Implement** the section's tasks, test-first. Never start a later section's work.
2. **Review** with three independent read-only lenses. Every finding needs a concrete repro (a model, a text, a
   failing assertion or a command); speculation is not a finding.
   - **data**: try to lose or corrupt a DUT, including subtype changes in both git shapes, stale versions,
     folders, a DUT beside a same-named item, library vs project DUTs, an old workspace, and TwinCAT codes
     605/606/607/623.
   - **spec**: requirement by requirement against the spec, proposal and this file. A ticked task that isn't
     done is a finding.
   - **layering**: no item-kind logic in `Volt.Cli` or the TS clients, no second classifier, no fallbacks, no
     dead code, no stale "one wire kind `dut`" comments.
3. **Fix** every confirmed finding: failing test first, then the product fix, then keep the test. A finding shown
   wrong is skipped with the reason.
4. **Repeat** 2–3 until a round finds nothing new, at most 3 rounds. If the cap is hit, say so; don't call it
   clean.
5. **Commit** once everything is green. Tick only what is done and tested, and mark BLOCKED tasks with the exact
   reason. Stage explicit paths only (never `git add -A`). Don't push.

Live-IDE tasks use `ide.ps1` fixtures on both vendors. If an IDE truly cannot come up, the task stays unticked as
BLOCKED; it is never faked.

## 1. Measure (live, both vendors — `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat`)

- [x] 1.1 Today's behaviour, recorded before any change: rewrite a fixture STRUCT as an ENUM in the workspace; push
      (a) with git detecting a rename, (b) as delete + add (`git rm` + new file, similarity < 50%). Record ops sent
      and the IDE result. Expected today: (a) works through `.dut`, (b) delete-then-create — record whether the
      DUT's folder, and on CODESYS its object GUID, survive.
      **Measured 2026-09-27, `volt push` from a workspace over live fixtures (CODESYS `CodesysTestProject`, TwinCAT
      `Project14`), DUTs created by push into a `VltMeasure` folder, identity read off the IDE between pushes
      (CODESYS object `guid`: `probe-dut-subtype-push.py` → `dut-subtype-push.log`, session 2; TwinCAT `.TcDUT`
      `Id`: `probe-tc-dut-codes.ps1` → `tc-dut-codes.log`). Identical on both vendors.**
      (a) rename (git `R069`/`R071`): ONE op `set X.dut ifVersion v` (both paths map to `X.dut`, so no `toName`)
      with the enum text → accepted as `updated: X.dut`, folder kept, refs still `X.dut`, the same object — CODESYS
      `guid` `fb111d3e-…` before and after, TwinCAT `Id` unchanged — and it compiles as the enum (CODESYS: a user
      of `VltM_A.Blue` builds with 0 errors; the negative control `vA.alpha` is `'vA' is no structured variable`).
      Struct→union and struct→alias on TwinCAT: same result.
      (b) delete + add is **NOT delete-then-create — it never works**, and what happens depends on git's PATH
      ORDER. Both rows map to the same `X.dut`, so the CLI sends TWO ops on one name: `set X.dut ifVersion v` (an
      UPDATE, since the sidecar has `X.dut`) and `delete X.dut ifVersion v`.
      - new extension sorts first (`X.enum` < `X.struct`, `.alias` < `.struct`): `[set, delete]` passes the
        pre-flight, the set LANDS (content now the enum, in place, folder kept), then the delete is refused —
        `BAD_REQUEST 'X' changed in the IDE while this push was being applied — refusing to delete it … 1 of 2
        item(s) were already written`. A partial write reported as a rejection. Recovery MEASURED (CODESYS):
        `volt status` shows `~ X.dut` incoming and `+`/`- X.dut` outgoing; `volt pull` merges cleanly (a merge
        commit, no conflict), the workspace keeps `X.enum` only, then `in sync` and `nothing to push`.
      - old extension sorts first (`X.enum`→`X.struct`, `X.struct`→`X.union`): `[delete, set]` is refused in the
        pre-flight, nothing written — `ITEM_MISSING expected item to exist but it doesn't` (the set's `ifVersion`
        names an item the delete removes). MEASURED stuck (CODESYS): `volt pull` says already up to date, status
        still shows the pair, a second push refuses the same way — for as long as the push is not forced (below).
      WITHOUT `--force` nothing is ever deleted, so folder and GUID/Id survive in both orders (CODESYS `guid` read
      after each). `volt status` shows the pair as `+ X.dut` / `- X.dut`.
      **`volt push --force` — the obvious way out of the stuck order — LOSES THE DUT in both orders.** Not measured
      live. The ENGINE half was reproduced against `FakeIde` in an UNCOMMITTED scratch xunit project that calls only
      `PushService.Handle(…, Force = true)` then `RefsService.Handle` (2026-09-27) — evidence for the engine ops and
      nothing wider; 2.2 commits it. Force nulls every `ifVersion`, which skips both `PushConflicts` and
      `RequireUnchangedBeforeDelete` (`PushService.ApplyOp`), and `itemCache` is not updated after a delete:
      - `[set X.dut, delete X.dut]` forced: `writecontent:X | delete:X`, ACCEPTED, and `refs` afterwards has no
        `X.dut` (reproduced). The CLI consequence is INFERRED FROM THE CODE, NOT RUN: the receipt has no `X.dut`,
        so the CLI would drop it from the sidecar (`Commands.cs` receipt adoption) and set `volt/ide` to HEAD,
        which still holds `X.enum` — `volt status` would say in sync while the IDE has no DUT `X`. 2.4 (ii) pins
        it black-box.
      - `[delete X.dut, set X.dut]` forced: `delete:X`, then the set writes through the deleted object's cached
        handle and fails `INTERNAL_ERROR Sequence contains no matching element — 1 of 2 item(s) were already
        written`. Object, GUID/Id and folder are gone.
      So the coalesce rule (3.2) must accept BOTH orders AND coalesce under `force` too (the delete's `ifVersion`
      is its guard when present; force removes the guard, never the coalescing), and today's (b) is a bug this
      change fixes, not a behaviour it preserves.
- [x] 1.2 TwinCAT: the tree code after writing an enum body into a 606 (struct) DUT in place — does it become 605?
      Does `refs` still see it (the 605/606/607 → dut mapping)? Same for struct → union (607) and → alias.
      **No — not in the live session.** 606 given an enum/union/alias body, and 623/607 given a struct body, are
      all ACCEPTED in place and keep their OLD code (a 606 holding an enum; a 623 holding a struct), `.TcDUT` Id
      unchanged; the compiler already treats each as its NEW shape (`'zeta' is no component of 'VLTM_D'` on the
      623-coded struct, `'Purple' is no component of 'VLTM_B'` on the 606-coded enum). After save + solution
      close/reopen the code RE-DERIVES from the declaration (605 / 607 / 623 / 606), Ids unchanged. `refs` sees
      the item under every code, before and after the reload, with an unchanged version (`volt status`: in sync).
      The same holds OUT of 605 (second session): the fixture's IDE-authored enums `E_PackML_Mode`/`_State` (605)
      pushed as a struct and a union stay 605, Id unchanged, and compile as the new shape (`'ePRODUCTION' is no
      component of 'E_PACKML_MODE'`). And a DUT CREATED by today's push reads **606 whatever its body** in the
      live session — enum, union and alias included — which corrects DIALECT C2b and the
      `TcObjectModel.CreateChild` comment (both said a create "becomes 605/607/623"; that was the deleted PLCopen
      import path); each still compiles as declared. Whether a CREATED DUT's code re-derives on reload is NOT
      measured (session 2 has no reload; the re-derive above is for DUTs created as structs, then changed in place)
      — and nothing depends on it.
      So the subtype must come from the declaration, never the tree code. (A reload invalidates the worker's COM
      handles — `Unexpected HRESULT` — until it is restarted; the existing worker lifecycle, not new.)
      Evidence: `packages/volt-cli/scripts/probe-tc-dut-codes.ps1` + `tc-dut-codes.log` (two sessions); DIALECT C2e.
- [x] 1.3 CODESYS: writing an enum body into an `IDUTObject` created as a structure — accepted in place, or does it
      need `create_dut` again? (Decides whether "update" is possible at all; if not on a vendor, that vendor's
      update is delete + create below the seam, still ONE op on the wire — record it in DIALECT.md.)
      **Accepted in place — no `create_dut` again.** A DUT created `create_dut(DutType.Structure)` takes an enum,
      union, alias (`STRING(80)`) or struct declaration; the object `guid` is the SAME after each, it stays in its
      folder, and a build that uses each as its new shape (called from `PLC_PRG`) has 0 new errors while the
      negative control is refused (`'Purple' is no component of 'VltSub_enum'`, `'v_enum' is no structured
      variable`). That run wrote through scripting. Through the BRIDGE (`volt push`, 1.1) an `IDUTObject` was
      measured going struct→enum only (VltM_A by rename, VltM_B set-first; the struct→union push of VltM_C was
      refused `ITEM_MISSING` and reverted); struct/union/alias through the bridge were measured on the text-list
      enum below, a different object type. `IDUTObject` → union / alias through the bridge is unmeasured. A real text-list enum (`ITextListEnumerationObject` — Pro2193's `IQSlices`, which `CodesysTypeMap`
      maps to the DUT kind) was pushed a struct, then a union, then an alias: it HAS an `Interface` aspect with a
      `TextDocument` (so `SetAspectText` writes it, not its missing-aspect `return`), each write lands, the `guid`
      and folder are kept, it stays `ITextListEnumerationObject`, and its users then fail as against a struct
      (`'DI_10' is no component of 'IQSlices'`). "Update" is possible on BOTH vendors for every shape measured, so
      neither needs delete + create below the seam.
      Evidence: `probe-dut-subtype-in-place.py` + `dut-subtype-in-place.log` (scripting), `probe-dut-subtype-push.py`
      + `dut-subtype-push.log` (bridge, session 1 = text-list enum), all in `packages/volt-cli/scripts/`; DIALECT C2e.
- [x] 1.4 Grep every wire consumer for `.dut` (C#, TS e2e client, volt-control, the LSP's data model) and list them
      in this file; each is a task in group 3 or 4.
      **Census** (`git grep` for `.dut`, `"dut"`, `Kinds.Dut`, `WireExtFor`, `IsDutFileExtension`,
      `DutFileExtensions`, `DutSubtype` over `packages/` and `scripts/`; 2026-09-27):
      - Engine — `Item/ItemKind.cs` (`SourceKindExtensions` `(Dut,"dut")`, `DutFileExtensions`,
        `IsDutFileExtension`, `WireExtFor`, `FileExtensions`, comments :34, :49, :301-306, :398) → 3.3;
        `Sync/Materializer.cs` `FullWireName` mints `.dut` via `ExtFor(resolvedKind)` → 3.1;
        `Library/LibSignatureRenderer.cs` `Render` returns `.alias/.enum/.union/.struct` from signature flags — a
        second classifier → 3.4; `Sync/PushService.cs` (`KindForWireName` on create — `X.struct` is `null` today;
        `WillCreate`; `Bare()`; kind code :1260) → 3.2; `Sync/PushedText.cs` `SameExceptLayout` and
        `Format/St/StReader.cs` read the kind off the wire name via `KindForWireName` (`null` for `.struct` today)
        → 3.6; `Format/St/CodeHelper.cs` doc → 3.3. `StReader`/`StWriter`/`ImplementationMarker` use `Kinds.Dut`
        as the INTERNAL kind — stays.
      - Drivers — `Volt.Ide.Codesys` (`CodesysTypeMap` IDUTObject/ITextListEnumerationObject → `PlcDut`;
        `create_dut(DutType.Structure)`), `Volt.Ide.Twincat` (`ClassifiedKind` = raw tree code; create as 606;
        `BeckhoffDriver.Content.cs:600` internal kind) — none reads a wire extension → 3.5 (confirm).
      - Contracts — `Volt.Contracts/Wire/RefsFetch.cs:37` (`"MyDut.dut"` example) → 5.1.
      - CLI — `Sync/Materialize.cs:29-42` → 4.1; `Sync/Extensions.cs:51-56` → 4.2; `Sync/IdeTree.cs:66-80` → 4.3;
        `Sync/IdeTree.cs` `removedNames` sweep — compared the fetch's removed WIRE names (`X.dut`) with FILE
        names (`X.struct`), so a DUT deleted in the IDE survived every pull, the sidecar dropped it, status read
        in sync, and the next edit pushed a CREATE that resurrected it. A bug today, found reviewing section 1:
        FIXED here (the sweep resolves each file through `Extensions.FullNameFromPath`, the seam the
        `replacedNames` side already used), pinned by `IdeTreeTests.A_removed_item_is_dropped_by_its_wire_name_not_its_file_name`
        and `DutSubtypeFileTests.A_dut_deleted_in_the_ide_is_removed_by_the_next_pull`; both stay valid after
        4.2 (the seam becomes identity; the tests state the wire fact) → 2.4 keeps them;
        `Sync/StatusModel.cs:94-99` — `pathByName` for an INCOMING-only item is minted `{folder}/{wireName}`, so an
        IDE-side DUT edit maps to `DUTs/X.dut`, a file that does not exist: volt-vscode `decorations.ts` `absMap`
        and volt-control `view/workspace.ts` `driftItems` never colour the real `X.struct`, and the diff pane's
        `volt show BRIDGE DUTs/X.dut` fails `unrecognized path` (`Commands.Show` → `FullNameFromPath` → null);
        volt-control caches `pathByName` across refreshes keyed by wire name (`state/status.ts:216`). Fixed by
        construction once file name == wire name (4.1/4.2) — no interim CLI mapping (that would be DUT logic 4.x
        deletes) → 2.4 (i) pins it;
        `Sync/Commands.cs:443` refusal text and `:476` comment (`:425`, the unrecognized-extension guard's comment,
        named `.struct` as an extension that "cannot sync" — false today, `.struct` is tracked
        (`DutSubtypeFileTests`); corrected in section 1, it no longer names a DUT extension) (library `HANDLE.alias` → `HANDLE.dut`) → 4.4;
        `Sync/Scaffold.cs:55-62` (the README's hand-kept kind→extension table, `| DUT | .struct .enum .union
        .alias |`) and `Sync/Commands.cs:443-445` (the refusal's hand-kept list) — two copies of
        `ItemKind.SourceKindExtensions`, spelt `DUT` in upper case, so 4.6's grep as first written could not see
        them → 4.4 + 4.6; the sidecar's `.dut` keys (`.git/volt/ide-refs.json`) → 4.5, AND the
        PENDING baseline `.git/volt/pending-ide-refs.json` (`Sidecar.cs` `SavePendingIdeRefs`/`LoadPendingIdeRefs`),
        the same `IdeRefs` keyed by wire name, stashed by a conflicted pull and promoted straight into the live
        sidecar by `volt merge --continue` (`Commands.cs` `LoadPendingIdeRefs` → `SaveIdeRefs`, "IDE baseline
        synced") with no load-time check on that path → 4.5.
        `Sync/Commands.cs:862-865` (`V1Note`) is a KIND CLASSIFIER in the CLI — `ItemKind.KindForWireName` +
        `IsSourceKind` + `ImplementationMarker.AppliesTo` on a disk file name, to decide which files can hold
        network text. It never spells `dut` (4.6's grep cannot see it), and widening `KindForWireName` does not
        change its answer for a DUT (`AppliesTo(Dut)` is false either way). → 4.9: one engine predicate keyed by
        wire name; the CLI asks it and holds no kind logic.
      - C# tests — `ItemKindTests`, `DutSubtypeFileTests`, `DutSubtypeCodeTests`, `PushServiceTests`,
        `TransportMatrixTests`, `WireVocabularyGuardTests`, `CodeHelperTests`, `PushDeclarationTransportTests`,
        `StFixedPointTests`, `KindFromExtensionTests`, `StFormatRoundTripTests`, `ModelRoundTripOracleTests`,
        `test/shared/FakeIde.cs:62` → group 2.
      - TS e2e client — `test/e2e/lib/workspace.ts:21` (`fid` doc: "every DUT is the one wire kind `dut`"),
        `fixtures.ts:59-63` (`kind: "dut"` for the four DUT rows), `items/crud-cycle.test.ts:17-20` (the
        "every DUT→dut" / "That is the WIRE name" comments and `EXT_BY_KIND`'s `dut: "dut"`),
        `items/name-clash.test.ts:44,52`, `kinds/top-level.test.ts:23`, `vendor-parity.test.ts:131-132`, and
        `whole-project.test.ts:32` — `WRITABLE = /\.(prg|fb|fun|dut|gvl|itf)$/i` is a KIND CLASSIFIER on the wire
        name that picks what the fixed-point sweep pushes; after 3.1 it matches no DUT, and every DUT drops out of
        the sweep silently while the test stays green → 4.7.
      - Scripts driving the wire — `volt-cli/scripts/probe-tc-name-collision.ts:60` (pushes `${n}.dut`),
        `volt-cli/scripts/corpus-migration.ts:496` (strips extensions BECAUSE `.struct` ≠ `.dut`),
        `volt-lsp-iec/scripts/record-language.ts:55,222` (the orphan sweep keys DUTs as `.dut` — it would stop
        matching once refs says `.struct`; :78-81 ALREADY pushes `X.struct`/`.enum`, which today's
        `KindForWireName` reads as no kind) — and `:46-50` `unitExt` is a THIRD subtype classifier, independent
        of `CodeHelper.DutSubtype` and `LibSignatureRenderer`: it mints the pushed extension from the LSP parse's
        body kind, defaulting anything unrecognised to `alias` (and non-DUT units to `fb`) → 4.8; repo
        `scripts/check-wiring.ts:159-167` parses
        `ItemKind.DutFileExtensions` → 3.3.
      - volt-control — `src/state/files.ts:5` comment, `src/state/files.test.ts:19-20` ("`.dut` is the WIRE
        kind") → 5.2. LSP — `src/source-extensions.ts:20` comment → 5.2. Generated docs —
        `volt-cli/docs/assets/data.js` (4 rows `ext: "dut"`) → 5.1. HAND-WRITTEN prose in
        `volt-cli/docs/items.html` (NOT regenerated by `VOLT_WRITE_DOCS=1`, which writes only `assets/data.js`):
        :67 "A DUT is one wire kind", :74 "the wire identity keeps `.dut`", :140 "It remains the wire kind" → 5.1.
        `volt-web/app/docs/agents.mdx:45` lists `.dut` among the LSP's extensions, which is already false → 5.1.
      - Stale "one wire kind `dut`" comments (`git grep -niE "one wire kind|wire identity keeps"`) outside the files
        above: `Volt.Ide.Codesys/Ide/CodesysTypeMap.cs:59,134` and `Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs:341`
        → 3.5; `Library/LibSignatureRenderer.cs:139` → 3.4; `Item/ItemKind.cs:49,301,306,398` → 3.3;
        `scripts/corpus-migration.ts:494` → 4.8; the C# tests' comments (`DutSubtypeFileTests:11`,
        `CodeHelperTests:53`, `KindFromExtensionTests:46`, `StFixedPointTests:206`, `DutSubtypeCodeTests:8,20`,
        `PushServiceTests:249`) → group 2; `test/e2e/fixtures.ts:57` and `items/crud-cycle.test.ts:17-18` → 4.7.
      - False TwinCAT tree-code FACTS (not wire wording) beside the ones corrected in `TcObjectModel.cs` and
        DIALECT C2b/C2e: `BeckhoffDriver.Tree.cs:336-344` ("623 is what CreateChild accepts"; the subtype "is
        derived from the declaration on push-create only") and `ItemKind.cs:35-36,48` ("BOTH the IDE's create and
        its read derive it"; "623 is the generic code `CreateChild` accepts") — CORRECTED in section 1 to C2b/C2e
        (623 is PLCDUTALIAS; a create seeds 606 whatever the body; the live code lags an in-place change). Their
        "one wire kind" wording still goes in 3.3/3.5.
      - NOT wire consumers (the internal kind, stays): the LSP data model's `kind: "dut"`
        (`docs/data-model.md:368`, `test/conformance/types.ts`, `support/fixture-units.ts`,
        `analysis/checks/oop/inheritance.ts`), the conformance tests' in-memory `file:///conformance/X.dut` URIs
        (`fixtures.test.ts:1237`, `support/evidence.ts:146`), and the CODESYS-scripting recorders
        (`record-exec.py:83`, `probe-fixture-run.py:52`).

- [ ] 1.5 OPEN, found during 1.1/1.3, not a DUT-subtype fact: on the Pro2193 fixture copy the bridge's `refs`
      failed in 2 of 3 sessions with `INTERNAL_ERROR Object of type 'System.Guid' cannot be converted to type
      'System.Int32'`, so that project could not be pulled. Both failing sessions had first run
      `probe-dut-subtype-push.py`'s scripting read over three DUTs whose wrapper reported handle 0
      (`SER_OperationModeType`, `enumRecipeCommandResult`, `PlcDataType` — the probe's own `GetObjectToRead` failed
      on them with the same text; those READ FAILED lines were not kept verbatim); the session that called `refs`
      before any probe read worked. Unexplained — the probe may be the cause, or the bridge's own
      `CodesysObjectModel` `GetObjectToRead(HandleOf, GuidOf)` may hit the same objects. Repro to record: open a copy
      of Pro2193 with `probe-dut-subtype-push.py`, write `x|SER_OperationModeType` to
      `%LOCALAPPDATA%\volt-bridge\dut-probe.req`, then call `refs` over the pipe; then the same WITHOUT the probe
      read. Does not block this change (1.3's conclusion rests on the session that worked); it must not be lost
      when section 1 closes — a `refs` failure on a customer-shaped project is a bridge bug until shown otherwise.

## 2. Tests red first

- [x] 2.1 Engine: `Materializer` names each of the four DUT shapes by subtype (struct, enum, union, alias,
      text-list enum on CODESYS) — replace the `.dut` expectations in `DutSubtypeCodeTests` / `ItemKindTests`.
      **Written 2026-09-27, red today.** `test/Volt.Engine.Tests/item/DutSubtypeCodeTests.cs` (materializer,
      `refs`/`fetch`, the name from the declaration under every TwinCAT code 605/606/607/623, a subtype change fetches
      as the old name removed + the new one changed; the text-list enum carries its generated-file comment header);
      `ItemKindTests` (the four subtypes are ordinary `SourceKindExtensions` entries of `Kinds.Dut`, `KindForWireName`
      reads them as DUT and `X.dut` as no kind, `ExtFor(Kinds.Dut)` refuses; the `WireExtFor` test is gone with its
      premise). `KindFromExtensionTests` asserts the kind itself (it passed before with the check silently off);
      `PushServiceTests`/`PushDeclarationTransportTests` push DUTs under `.struct`/`.enum`/… and assert `refs`.
      `StFixedPointTests` no longer calls `WireExtFor`: source-ness from `FileExtensions`' own flag (same set both
      before and after).
- [x] 2.2 Engine: `PushService` against `FakeIde` — rename op struct→enum is one content update (folder kept,
      version gate honoured); delete + create pair coalesces in BOTH op orders; stale `ifVersion` on the delete
      refuses; two sets on one bare DUT refuse `BAD_REQUEST`; a delete of `X.struct` with NO paired set still
      deletes; and the same pair with `Force = true`, both orders, is still ONE content update — the DUT exists
      after, in its folder, and the receipt names it (1.1's force cases: today one order is accepted with the DUT
      deleted, the other deletes then fails `INTERNAL_ERROR`).
      **Written, red today:** `test/Volt.Engine.Tests/sync/DutSubtypeChangePushTests.cs` — plus a same-subtype
      delete + create refused `BAD_REQUEST` (the "anything else" arm) and an ordinary update under the current name.
      **Review round 1 added** (red today unless noted): two deletes on one DUT, and a subtype rename plus a second
      op, refused naming both; the rule's BOUNDARY — `set X.fb` + `set X.struct` is never refused as a pair (green
      today; it catches a naive "two ops on one bare name" rule, which is the forbidden duplicate-name guard); a
      DUT op whose NAME disagrees with its declaration — update, subtype rename, delete + create pair, create — is
      refused `BAD_REQUEST` naming the op's name and the declared one, nothing written (without it, `set X.struct`
      with an enum body is accepted, the receipt says `X.enum`, the sidecar keeps neither name, and the stale
      `X.struct` file later deletes the live DUT); and `delete X.struct` against an IDE whose `X` is an enum never
      deletes `X`, with and without force.
      **Review round 2 added** (red today unless noted): a subtype change that also MOVES the DUT — the rename and
      both pair orders, forced and not, each carrying `ToFolder = "Types"` as the CLI sends a create — is one update
      that keeps the move (`refs` and the receipt say `Types`; a coalesce that drops the create's folder passed every
      earlier test); a DUT rename ACROSS bare names (`X.struct → Y.struct`, `X.struct → Y.enum`) renames the object,
      never taken as a content update of `X`; and the boundary test now asserts NO `BAD_REQUEST` at all (green
      today) — a forbidden "two ops on one bare name" rule whose reason quotes only the bare name passed the old
      "names both" check.
      **Review round 3:** the boundary test was green for the wrong reason — its FB text was invalid ST, so the
      pre-flight refused `INVALID_ST` before any pairing rule could run. Valid FB text now, and it asserts the push
      reached the IDE (`create:X`). Acceptance of the pair is NOT asserted: the push resolves an existing item by
      bare name (the struct lands on the new FB, `UNSUPPORTED` re-type after the FB was written — a pre-existing
      bare-name lookup, not a subtype fact), FakeIde cannot hold two items of one bare name, and whether a vendor
      can hold an FB and a DUT of one name is unmeasured.
- [x] 2.3 Engine: `TransportMatrixTests` / `WireVocabularyGuardTests` — no `.dut` on any wire message.
      **Written, red today:** `TransportMatrixTests` (the DUT row is `K.struct`;
      `No_wire_message_carries_a_dut_name` over `refs`, `fetch`, a push of an update + a create, and the receipt);
      `WireVocabularyGuardTests.Nothing_mints_or_spells_the_dut_wire_name` (no `ExtFor(Kinds.Dut)`, no `.dut` string
      literal outside `Sidecar.cs`; red on `Materialize.cs:41` and `ItemKind.cs:329`; self-checks both arms).
      **Review round 1:** the guard missed every real source of the old name, so it now also flags a bare `"dut"`
      literal outside the `Kinds.Dut` constant (the table entry `(Kinds.Dut, "dut")`) and ANY mention of
      `WireExtFor`/`IsDutFileExtension`/`DutFileExtensions` (the CLI translator) — red on 10 lines today. A generic
      `ExtFor(kind)` cannot be seen in source; `ItemKindTests.ExtFor_refuses_the_dut_kind…` makes it throw. The
      build response is a wire message too: `BuildDiagnosticNameTests.A_dut_diagnostic_carries_the_duts_subtype_name`
      (red: `Boiler.dut`).
- [x] 2.4 CLI: `DutSubtypeFileTests` rewritten as "file name == wire name" (no declaration read on pull);
      the IdeTree stale-subtype case (pull after the IDE changed struct→enum) removes `X.struct` and writes
      `X.enum` through the ordinary sweep. KEEP the section-1 IDE-delete cases (a DUT deleted in the IDE is gone
      from the workspace after the next pull). ADD: (i) an IDE-side edit of a DUT → `volt status --json`
      `pathByName` names the real `DUTs/X.struct`, and `volt show BRIDGE DUTs/X.struct` returns the IDE's text;
      (ii) the 1.1 force case black-box: `git rm X.struct` + add `X.enum`, `volt push --force` in both path
      orders, then `refs` holds `X.enum` in its folder and `volt status` is in sync.
      **Written, red today:** `test/Volt.Cli.Tests/plumbing/DutSubtypeFileTests.cs` (rewritten; (i) and (ii) at
      the Commands layer, (ii) also WITHOUT force, both orders); `IdeTreeTests` (the ordinary sweep retires
      `X.struct`; and a file is carried unless the wire names it removed — red while the stale-subtype guard
      exists); `BlackBoxTests.Status_json_and_show_BRIDGE_name_a_duts_real_file` and
      `Push_force_of_a_dut_subtype_rewrite_keeps_the_dut` (the real binary). Offline these reproduce every 1.1
      measurement: set-first partial write + `BAD_REQUEST`, delete-first `ITEM_MISSING`, forced enum accepted with
      the DUT deleted, forced union `INTERNAL_ERROR Sequence contains no matching element`. `Changing_a_subtype_
      changes_the_FILE_but_never_the_wire_name` is deleted: its premise is what this change reverses.
      **Review round 2:** the same rewrite INTO ANOTHER FOLDER (`DUTs/X.struct` deleted, `Types/X.{enum,union}`
      added, forced and not) moves the DUT and reads in sync —
      `DutSubtypeFileTests.A_subtype_rewrite_into_another_folder_moves_the_dut` (red today).
      **Review round 3** (red until 3.1): a DUT whose text states no subtype is written under NO name
      (`A_dut_whose_text_states_no_subtype_is_not_written_under_a_guessed_subtype` — today `X.alias`), and a HELD
      `DUTs/X.struct` whose IDE text turns subtype-less keeps its file and content, with and without a baseline
      (`A_held_dut_whose_text_loses_its_subtype_keeps_its_file`); engine side
      `DutSubtypeCodeTests.A_known_dut_whose_declaration_loses_its_subtype_is_unreadable_and_not_removed`.
- [x] 2.5 CLI: sidecar with a `.dut` key → refused, names `volt pull`, sends nothing. And a PENDING baseline
      (`pending-ide-refs.json`) with a `.dut` key is never promoted by `volt merge --continue`: the merge completes
      without "IDE baseline synced", `ide-refs.json` holds no `.dut` key, and the output names `volt pull`.
      **Written, red today:** `test/Volt.Cli.Tests/commands/DutBaselineMigrationTests.cs` — push refused with an
      `InvalidOperationException` naming the key and `volt pull`, nothing recorded; `volt pull` then rebuilds the
      baseline (no `.dut` key) and the push lands; the merge door as specified.
      **Review round 1 — the contract settled:** "`volt pull` rebuilds it" contradicted 4.5 (the refusal lives in
      `LoadIdeRefs`, which `Pull` calls before its fetch, so the fix it named was a dead end). The refusal is now the
      malformed sidecar's: it names the key, `.git/volt/ide-refs.json` to delete, and `volt pull`; a PULL over the
      old baseline is refused the same way, `volt/ide` unmoved; deleting the file and pulling rebuilds it and the
      push lands. And the rebuild must not resurrect: a baseline-less pull had nothing to report removals against,
      so an item the IDE deleted since the last pull kept its file (red for a DUT and for a plain `.fb` — a bug
      today on the malformed-sidecar path) — FIXED now in `Commands.Pull`, and a baseline-less pull after an IDE
      subtype change leaves one DUT file (green today through the `IdeTree` guard; it holds the line when 4.3
      deletes it).
      **Review round 2:** the round-1 fix (`GoneWithoutABaseline`) was a SECOND COPY of the engine's removal rule
      in the CLI (complete walk, unreadable exemption, its own bare-name derivation). The root was the pull's
      `KnownItems = sidecar?.Items ?? {}`: with no sidecar it told the bridge the client knew nothing, though the
      previous `volt/ide` tree names every item it carried. It now sends those wire names at `""` (the push
      re-fetch's shape; library signatures excluded — path-identified, never wire items), every item comes back
      changed, and the ENGINE's one removal pass decides what is gone; `GoneWithoutABaseline` is deleted. Pinned
      too: a baseline-less pull keeps the file of an unreadable item and of an item under an unwalked folder, and
      library signature files (`DutBaselineMigrationTests`). And the engine's unreadable exemption was keyed by
      BARE name, so an unreadable `CM_Carrier` FB shielded a DELETED `CM_Carrier.visualization` (its file kept, its
      next edit a create) on every pull, with or without a baseline — FIXED in `FetchService` (bare name AND the
      walked kind; round 3 removed the "no kind" arm, below), pinned by
      `UnreadableIsNotRemovedTests.An_unreadable_item_does_not_shield_…` and
      `DutBaselineMigrationTests.An_unreadable_item_does_not_keep_a_deleted_item_of_another_kind`.
      **Review round 3:** the round-2 known-names rebuild dropped each library's `.library` STUB with its
      signatures (the stub sits inside its own library root), so a baseline-less pull never retired a library the
      IDE stopped referencing — FIXED (`IdeTree.IsLibrarySignature`: under a root and not the stub),
      `DutBaselineMigrationTests.A_library_the_ide_no_longer_references_is_retired_with_or_without_a_baseline`
      (red before, without a baseline). The exemption's "no kind on the name" arm is DELETED, not kept: it shielded
      a known `X.struct`/`X.foo` behind an unreadable FB `X`, and the bare identity it claimed to serve never
      reaches a baseline (an unreadable item is in `unreadable`, never in `Items`) —
      `UnreadableIsNotRemovedTests.An_unreadable_item_does_not_shield_a_known_name_the_engine_cannot_place` (red
      before) and `…is_published_under_no_name_so_no_baseline_holds_a_bare_one`. The pull refusal pins "sends
      nothing" by `WalkCalls` (red with the rest of that test until 4.5).
- [x] 2.6 Library: a library enum and a project enum carry the same extension, from the same `DutSubtype`.
      **Written, red today:** `test/Volt.Engine.Tests/library/LibraryDutExtensionParityTests.cs` — for the enum,
      struct, union and alias the renderer produces, its extension == the project materializer's for the same
      text == `"." + CodeHelper.DutSubtype(text)`.
      **Review round 1:** that test cannot see the renderer's own flag-based classifier (flag and text agree for
      every signature it renders, so 3.1 alone turns it green). The structural half:
      `WireVocabularyGuardTests.A_dut_subtype_is_named_in_one_place` — no lower-case subtype-name literal outside
      `CodeHelper`/`ItemKind` (red on `LibSignatureRenderer.cs:74,131,142`). And the reader itself no longer
      guesses: `CodeHelper.DutSubtype` answered `alias` for a declaration that states no subtype — a guessed wire
      identity once 3.1 lands. `DutSubtype_refuses_…` and
      `A_dut_whose_declaration_states_no_subtype_is_unreadable_not_a_guessed_alias` pin it, both red until 3.1.
      **Review round 2:** round 1 made `DutSubtype` throw NOW — a section-3 change whose only caller was still the
      CLI's `Materialize.FileNameFor`, with no per-item refusal path: one DUT typed `TYPE X :` in the IDE aborted
      the whole `volt pull` (nothing pulled) and left `volt init` half-made (scaffold committed, no `volt/ide`, no
      baseline, a re-init refused). REVERTED; the throw lands with 3.1, where the name is minted per item and the
      item can surface as unreadable. Pinned: `DutSubtypeFileTests.A_dut_whose_text_states_no_subtype_never_aborts_a_pull`
      / `…_an_init` (red with the throw, green now, and must stay green through 3.1). And the reader misread a
      TRAILING comment or pragma after the colon (`TYPE ST_X : // note` → `alias`, `: (* note *)` → `enum`,
      `: {attribute 'strict'} (A, B)` → `alias`) — FIXED (the first CODE token after the colon; a colon inside a
      comment is not the type's), `DutSubtypeCodeTests.DutSubtype_reads_the_first_code_token_after_the_colon`.

      **Review round 3:** `DutSubtype` carried its own trivia scanner, disagreeing with `CodeOn` (THE one) about a
      pragma line (`{attribute 'strict'} (A, B);`: `CodeOn` called the whole line trivia). FIXED at the root:
      `CodeOn` ends a pragma at its `}` like a closed `(* *)`, and `DutSubtype` is built on it —
      `CodeHelperTests.CodeOn_ends_a_pragma_at_its_closing_brace` (red before), `…agree_about_a_pragma_line`.
**Section 2 closed (2026-09-27), three review rounds — the cap; round 3's findings were all fixed or pinned, so it
is not called clean by a fourth round.** Final offline run: `Volt.Engine.Tests` 1366 passed / 81 failed,
`Volt.Cli.Tests` 207 / 27, and every failure is a section-2 red test (classes `DutSubtypeChangePushTests`,
`DutSubtypeCodeTests`, `ItemKindTests`, `KindFromExtensionTests`, `LibraryDutExtensionParityTests`,
`BuildDiagnosticNameTests`, `PushServiceTests`, `PushDeclarationTransportTests`, `TransportMatrixTests`,
`WireVocabularyGuardTests`; `DutSubtypeFileTests`, `DutBaselineMigrationTests`, `BlackBoxTests`, `IdeTreeTests`)
— red by design until sections 3-4. No other test is red: Codesys 160, Twincat 231, Contracts 19, Connector 110,
Repo.Gates 20, `bun test test/unit` 4, `bun run check` 14 all pass. No live IDE was used in section 2.

## 3. Engine

- [x] 3.1 `Materializer.FullWireName`: DUT → `CodeHelper.DutSubtype(text)` extension. The only minting site.
      **Done:** `FullWireName(bare, kind, declaration)` names a DUT from its declaration; `DutSubtype` now THROWS
      `FormatException` for a declaration that states no subtype, and `Versioning.SafeVersion` turns that into an
      unreadable item (per item — the rest of the fetch goes on). Green: `DutSubtypeCodeTests` (all),
      `BuildDiagnosticNameTests`, `TransportMatrixTests.No_wire_message_carries_a_dut_name`,
      `DutSubtypeFileTests.A_dut_whose_text_states_no_subtype_never_aborts_a_pull`/`…_an_init` still green.
- [x] 3.2 `PushService`: the subtype-change rule (spec requirement 2), placed with the other op normalisation,
      before `InFolderDepthOrder`. Resolve every DUT op to its bare name once; kind check accepts all four.
      The coalescing does not depend on `Force`: force drops the version gate, never the pairing (1.1).
      The pairing rule keys on DUT ops only (a same-named `.fb` is not a pair). Every DUT `set` checks its name
      (the `toName` for a rename) against `DutSubtype` of its body and refuses a mismatch `BAD_REQUEST` naming
      both; a `delete` resolves its FULL wire name, so `delete X.struct` never reaches an `X` that is an enum.
      **Done:** `Sync/DutSubtypeChanges.Normalize`, run in `PushService.Handle` after the walk and BEFORE the
      version gate (so the pair's guard is the delete's `ifVersion`); every later pass sees the normalized ops.
      A delete of a DUT name is checked against the object's minted wire name (`PushService.NamesThisDut`) and is
      a no-op when it names another subtype; a subtype-less DUT refuses the delete `BAD_REQUEST`. Green: all of
      `DutSubtypeChangePushTests`. **One test premise corrected:** `A_subtype_change_into_another_folder_…`
      (engine) and `DutSubtypeFileTests.A_subtype_rewrite_into_another_folder_moves_the_dut` (CLI) forbade ANY
      `create:` — but `Types` does not exist in the fixture, so every correct move into it creates the FOLDER
      (`create:Types`, `TreeNav.ResolveTopLevelFolder`, predating this change). The tests' own stated intent is
      "the object is never deleted or created"; both now forbid `delete:X`/`create:X` (and a rename), no weaker.
- [x] 3.3 `ItemKind`: delete `WireExtFor`, `IsDutFileExtension`; `SourceKindExtensions` lists
      struct/enum/union/alias as ordinary source extensions mapping to `Kinds.Dut`; `ExtFor(Kinds.Dut)` is no
      longer a wire extension (delete or make it throw — nothing may mint `.dut`). Rewrite the long comments at
      `ItemKind.cs:34`, `:49`, `:301-306` and `:398` to the new fact.
      **Done:** `DutFileExtensions`/`IsDutFileExtension`/`WireExtFor` deleted; the four subtypes are
      `(Kinds.Dut, …)` rows; `FileExtensions` is the table entry for entry; `ExtFor(Kinds.Dut)` throws. Green:
      `ItemKindTests`, `KindFromExtensionTests`, `WireVocabularyGuardTests` (all three). Carried with it, because
      each broke the build or a gate on its own: `scripts/check-wiring.ts` reads the one table (no DUT split;
      `bun run check` 14/14); `DocDataTests`' generator lists each kind's extensions (`exts`, an array — the DUT
      has four) and `docs/assets/doc.js` renders it, `data.js` regenerated (`VOLT_WRITE_DOCS=1`) — the TABLE half of
      5.1 only, the hand-written prose is still 5.1's; and the CLI's two callers of the deleted helpers
      (`Materialize.FileNameFor`, `Extensions.FullNameFromPath`'s DUT branch) reduced to identity so `Volt.Cli`
      compiles — the code half of 4.1/4.2, left UNTICKED for section 4 (its comments, 4.6 grep, review).
      **Test premise corrected:** `ItemKindTests.The_extension_table_is_one_to_one` asserted no kind appears twice,
      which the spec (and the section-2 test beside it) now contradicts for the DUT kind; it keeps "no extension
      names two kinds" whole and "no kind twice" for every other kind.
- [x] 3.4 `LibSignatureRenderer`: use `DutSubtype`-equivalent naming from one helper (no second classifier);
      rewrite the `:139` "One wire kind still" comment.
      **Done:** every DUT return goes through `Dut(text)` = `"." + CodeHelper.DutSubtype(text)`; the vendor flag
      only picks the keywords. Green: `LibraryDutExtensionParityTests`, `WireVocabularyGuardTests.A_dut_subtype_is_named_in_one_place`.
- [x] 3.5 Drivers: confirm neither bridge parses a wire extension to decide DUT-ness beyond `Bare()`; fix any that do.
      Rewrite the "one wire kind `dut`" comments at `CodesysTypeMap.cs:59,134` and `BeckhoffDriver.Tree.cs:341`.
      **Confirmed (read, both vendors):** neither driver reads a wire extension — CODESYS classifies by object-model
      interface (`CodesysTypeMap`), TwinCAT by raw tree code (`ClassifiedKind`); `BeckhoffDriver.ValidateSource`
      ignores its `wireName`; `TcObjectModel.Build`'s `LastIndexOf('.')` strips a `.TcDUT`/`.TcPOU` FILE path from
      a compiler message, not a wire name. Comments rewritten. Offline suites green: Codesys 160, Twincat 231. No
      live IDE used (section 6 is the live check).
- [x] 3.6 Every ENGINE `KindForWireName` reader (`PushedText.SameExceptLayout`, `StReader` via `PushService`) gets
      `Kinds.Dut` for all four subtype names (1.4 census) — today a `.struct` wire name reads as NO kind. The CLI's
      `Commands.cs:863` is not one of them: it is 4.9.
      **Done by 3.3's table** (`ItemKindTests.A_dut_subtype_wire_name_is_the_dut_kind`,
      `KindFromExtensionTests.A_DUT_agrees_…`) — the table half. **The `StReader`-via-`PushService` half was NOT
      done by it (section 3 review, round 1), fixed now:** `WriteItemFromSource` read `KindForWireName` off the
      BARE name, so the apply-time read got no kind for EVERY item. It now takes the FULL name the op lands under
      (`toName ?? name`): a create is read by the wire kind outright; an update is read by its header first so the
      re-type guard still names what the live object is (`ItemKindIsNotRewritableTests` unchanged), then the wire
      kind is checked against the text by the reader's own refusal (`StReader.RequireKind`, the one message).
      `DutSubtypeChangePushTests.A_dut_name_over_a_function_blocks_text_is_refused_by_the_kind_its_name_carries`
      (red before: a function block's text pushed as `X.struct` over the FB `X` was written, forced and not).

**Section 3 (2026-09-27), offline.** Final run: `Volt.Engine.Tests` 1445 passed / 2 failed; `Volt.Cli.Tests`
231 / 3; Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4, `bun run check`
14 — all green. Every group-2 ENGINE test is green. The 3 CLI reds are 4.5's (`DutBaselineMigrationTests`: the
`.dut`-keyed baseline refusal). **The 2 engine reds are NEW and are not group-2:**
`ModelRoundTripOracleTests.Corpus_network_tally` (150/150 + 7 refused) and `Corpus_tally` (31/109 + 3 refused), all
"an FB instance the declarations do not name", all qualified instance calls through a `.struct` DUT in lenze-mid
(`Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives(…)`, the path running through `cUDTs/…/cUDT_MachAuxData_Timers.struct`).
Cause: `CorpusProject` admits `Kinds.Dut` files, but `.struct` read as NO kind until 3.3, so no DUT declaration was
ever in the corpus scope and the pinned tally was taken without them. With them, the real scope
(`NetworkScope.FromDeclarations`, which "answers the hops of a qualified instance path") reads these heads as FB
instances, and the oracle's synthetic write scope (`NetworkModelOracle.Instances`, identifiers only — "a path is
declared by no name, so the push reads its head as a function") cannot declare them. No product change: the pull and
push both use the real scope. Left red at the time; fixed in review round 1 (below). No review rounds were run in
this section; no live IDE; DIALECT.md unchanged (no new measurement).

**Section 3 review, round 1 (2026-09-27)** — seven findings, all fixed test-first (each test red before its fix):
- A DUT CREATE over the IDE's DUT of ANOTHER subtype (`set X.struct` new, the IDE holding `X.enum`) passed the
  gate and was written over it by bare name — a regression from 3.1 (under `.dut` it was `ITEM_EXISTS`).
  `PushConflicts` now looks a DUT create up under its sibling subtype names too (DUT names only — `X.fb` stays
  another item): `A_create_over_a_dut_of_another_subtype_is_refused_as_item_exists`.
- A delete of a DUT whose IDE declaration states no subtype threw `BAD_REQUEST` from inside the APPLY loop (earlier
  ops already written). Decided in the pre-flight now: unforced → refused whole as `UNREADABLE`, nothing written;
  forced → deleted (force is the documented way past an unreadable item, as a forced `delete X.dut` was):
  `A_delete_of_a_dut_whose_declaration_states_no_subtype_is_decided_before_any_write`.
- 3.6's apply-time kind (above).
- The 2 `ModelRoundTripOracleTests` reds: the oracle's `Instances` premise ("a path is declared by no name, so the
  push reads its head as a function") is false wherever declarations exist — the push reads a body against the same
  `NetworkScope.FromDeclarations` the pull wrote it with, and that scope resolves a qualified path. The corpus now
  checks each body against the scope it was READ with (`NetworkModelOracle.Check(…, declared)`: a path is an
  instance exactly when that scope says so; sources with no declarations — archives, test models — unchanged). The
  pinned tallies are NOT re-pinned: both are back to 34/157 and 157/157 with no refusal.
- `CodeHelper.DutSubtype` answered `alias` for `TYPE X : ;` — punctuation names no type; refused now (two
  `InlineData` rows, and the refs/fetch case: unreadable, no `X.alias`).
- `DutSubtypeChanges.StartsWithType` was a second "is this a DUT declaration" classifier disagreeing with
  `CodeHelper.ParseCodeHeader`; it asks `ParseCodeHeader` now, so a bare `TYPE` line gets the reader's
  `INVALID_CODE_HEADER` under any subtype name instead of "rename it to X.enum":
  `A_type_keyword_alone_on_its_line_is_refused_by_the_st_reader_under_any_subtype_name`.
- `Materialize.cs` kept dead `Volt.Engine.Format.St`/`Volt.Engine.Item` imports; deleted, and
  `WireVocabularyGuardTests.The_cli_imports_no_st_format` gates the import (the one qualified use left in
  `Commands.cs` is 4.9's).
Run after: `Volt.Engine.Tests` 1459 passed / 0 failed (1 skipped, pre-existing); `Volt.Cli.Tests` 231 / 3 (4.5's
reds, unchanged); Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4,
`bun run check` 14 — all green.

**Section 3 review, round 2 (2026-09-27)** — three product findings (plus a duplicate), all fixed test-first:
- `PushService.NamesThisDut` caught only `FormatException`, while the refs/fetch walk (`Versioning.SafeVersion`)
  publishes ANY materialize failure as unreadable. A COM/driver fault on a DUT a push deletes escaped `Handle` as a
  raw exception (unforced), or threw from the apply after earlier ops landed (forced) — a DUT no push could delete.
  Every failure now counts, its reason carried into the `UNREADABLE` refusal; the pre-flight check sits in the
  reject path: `A_delete_of_a_dut_the_ide_cannot_read_is_decided_like_the_walk_decided_it`.
- `CodeHelper.DutSubtype` matched `STRUCT`/`UNION` as PREFIXES, so `TYPE T : Struct_Alarm;` was published
  `T.struct` (and a library alias of `STRUCT_HANDLE` rendered `.struct`), and the correctly named `T.alias` refused.
  Whole token now (`FirstToken`): five `InlineData` rows, a library-parity row, and
  `An_alias_of_a_type_whose_name_begins_with_struct_is_published_and_pushed_as_an_alias`.
- A subtype-change pair whose delete quotes NO `ifVersion` coalesced into a version-less set, i.e. a CREATE, and was
  refused `ITEM_EXISTS` naming an op the client never sent. The pair is an update guarded by the delete's version
  (spec requirement 2), so unforced it is refused `BAD_REQUEST` naming both ops and the missing `ifVersion`; forced
  it is the one update: `A_pair_whose_delete_quotes_no_version_is_refused_by_name_unless_forced` (both orders).
  `volt push` always sends a delete's version, so only another wire client could reach it.
Run after: `Volt.Engine.Tests` 1471 passed / 0 failed (1 skipped, pre-existing); `Volt.Cli.Tests` 231 / 3 (4.5's
reds, unchanged); Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4,
`bun run check` 14 — all green. No live IDE; DIALECT.md unchanged.

**Section 3 review, round 3 (2026-09-27)** — two product findings (each reported twice), fixed test-first:
- A push op under a name that is NO wire name — `X.dut` (what the previous CLI and `probe-tc-name-collision.ts`
  still send), a bare `X`, `X.foo` — slipped every full-name check (the gate passed a set as a create; the kind
  check had no kind) and was applied by BARE name: `set X.dut` overwrote the live DUT with no version check (forced,
  it also moved it), and `delete X.dut` — its quoted version equals `X.struct`'s — destroyed it. `PushService.
  RequireWireNames` now refuses any op whose `name` or `toName` has no kind, `BAD_REQUEST` naming it, before a read,
  forced or not. And a delete reaches an object only under that object's own wire name for EVERY kind
  (`NamesThisItem`: kinds agree, and a DUT's minted name matches), not only for DUT subtype names — `delete X.fb`
  destroyed a DUT `X`, `delete X.prg` an FB `X`. Pinned: `A_set_under_a_name_that_is_no_wire_name_…`,
  `A_rename_to_a_name_that_is_no_wire_name_…`, `A_delete_under_a_name_that_is_not_the_duts_wire_name_…`,
  `A_delete_under_another_kinds_name_…` (all red before). **Test premise corrected:** `RenameBeforeWriteTests`
  sent a BARE `toName` (`FB_New`) while asserting the receipt names `FB_New.prg` — the wire carries full names on
  every push op (the item-name invariant); both renames now say `.prg`, so the malformed-body case is still refused
  by its body and not by its name.
- `DutSubtypeChanges.Pair` took an UPDATE (`set X.enum ifVersion w`) as the create half of a subtype change and
  dropped `w` unchecked. Only a create pairs now; the rest is refused naming both:
  `A_delete_paired_with_an_update_is_refused_naming_both` (both orders, forced and not; red before).
Run after: `Volt.Engine.Tests` 1494 passed / 0 failed (1 skipped, pre-existing); `Volt.Cli.Tests` 231 / 3 (4.5's
reds, unchanged); Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4,
`bun run check` 14 — all green. No live IDE; DIALECT.md unchanged (no driver touched).

## 4. CLI — delete, don't move

- [x] 4.1 `Materialize.FileNameFor` → gone; pull writes `item.Name`.
      Cut to the pass-through in section 3 (to keep `Volt.Cli` compiling); nothing left to delete.
      `DutSubtypeFileTests.The_file_name_comes_from_the_wire_never_from_the_declaration`,
      `A_dut_is_written_under_its_wire_name`; the import is gated by `WireVocabularyGuardTests.The_cli_imports_no_st_format`.
- [x] 4.2 `Extensions.FullNameFromPath` → the DUT branch gone.
      Also cut in section 3; `DutSubtypeFileTests.And_a_dut_file_reads_back_as_that_same_wire_name`,
      `No_path_produces_or_recognizes_a_dut_FILE`. Its now-unused `Volt.Engine.Format.Body` import deleted (and
      `Scaffold.cs`'s).
- [x] 4.3 `IdeTree.cs:66-80` stale-subtype guard deleted (the library exclusion beside it stays).
      **The DUT premise is deleted; the rule is NOT, because deleting it was measured to lose data.** With
      `FullNameFromPath` the identity since 3.x, what was left of the guard is "a changed item supersedes the parent
      file carrying its NAME at another path" — and that is also the only thing retiring the old file of an item
      the engineer MOVED to another folder in the IDE (changed — its folder is in its version — and not removed).
      Test first: `IdeTreeTests.An_item_the_ide_moved_to_another_folder_leaves_one_file` and
      `PullCommandTests.Pull_after_an_IDE_side_move_leaves_one_file_in_the_new_folder` — green with the rule, RED
      with it deleted (both: the old `POUs/FB_Axis.fb` survived beside `Motion/FB_Axis.fb`). So the code stays and
      its comment now states the move rule (name identity, no kind); every DUT/`.dut`/`FileNameFor` sentence is
      gone from it. `A_subtype_change_removes_the_old_file_through_the_ordinary_sweep` and
      `A_file_is_carried_forward_unless_the_wire_names_it_removed` (two NAMES, not a move) green either way.
- [x] 4.4 `Commands.cs` refusal text and `Scaffold.cs` doc: "the extension names what it is" — no "maps to .dut".
      Neither keeps a hand-written kind→extension list: both render from the one extension table, as
      `VscodeSettings()` already does.
      `Extensions.PushableExtensions` / `ReadOnlyExtensions` (from `ItemKind.FileExtensions`); the refusal lists
      the pushable ones, the README both. Test first: `ExtensionListTextTests` (red before: the refusal named
      `.struct`/`.fb`/… by hand and missed `.task`; the README named `.cfc`/`.sfc`, which no Volt writes, and
      none of the read-only extensions). The library-guard comment's `HANDLE.alias` → "HANDLE.dut" example
      rewritten (a push op is keyed by its full name now).
- [x] 4.5 `Sidecar` load: refuse a `.dut` key (2.5) — in `LoadIdeRefs` AND `LoadPendingIdeRefs`, so the
      `merge --continue` promotion cannot write one into the live sidecar. The refusal is the malformed one's:
      name the key, `.git/volt/ide-refs.json` to delete, and `volt pull` (pull loads the same baseline, so it is
      refused too — 2.5).
      `Sidecar.RefuseUnknownNames`, called by both loads: a key (items or folders) with no extension in the one
      table is refused naming the key, `.git/volt/ide-refs.json` and `volt pull`. Keyed on "no wire name Volt
      knows" rather than the `.dut` spelling, so the CLI lists no retired spelling (a `.dut` key is one such).
      `volt merge --continue` catches the pending refusal AFTER the git merge concluded: the merge stands, the
      stash is dropped unpromoted, and the one-line result says the baseline was NOT synced and names `volt pull`
      — and it exits 1 (review round 1, below), so no client reads the unsynced baseline as `done`.
      `DutBaselineMigrationTests` (the three 2.5 reds) green; the other nine unchanged.
- [x] 4.6 grep `Volt.Cli` CASE-INSENSITIVELY for `dut` and for the subtype spellings `struct|enum|union|alias` —
      zero hits outside the sidecar refusal (the uppercase `DUT` in `Scaffold.cs`/`Commands.cs` is what a
      case-sensitive grep missed) — AND for `ItemKind.KindFor`,
      `IsSourceKind`, `ImplementationMarker` — zero hits: a kind decision that never spells `dut` is still one.
      **Not closed — it closes with 4.9.** `grep -rniE "\bdut|\.(struct|enum|union|alias)\b|\bDUTs?\b"
      src/Volt.Cli` leaves the sidecar refusal's doc (`Sidecar.cs`) and the `V1Note` comment in `Commands.cs`
      — and the `KindForWireName`/`IsSourceKind`/`ImplementationMarker` grep leaves only `V1Note`'s three lines
      below that comment: all 4.9's. (Named by method, not line: every edit to `Commands.cs` moved the numbers,
      and the record went stale twice.) The IdeTree/Commands library comments no longer spell `.struct`/`.alias`
      examples. A bare case-insensitive `dut|struct|enum|union|alias` also hits English words
      (`enumerate`, `structural`, `structured-text`) and the C# keyword `enum` (`Extensions.Access`, a `Types.cs`
      doc) — none a kind decision.
      **Closed in the section 6 review (2026-09-27), and no longer a manual grep.** The record above went stale a
      third time — section 5's rounds 4-5 put `X.struct`/`X.enum`/"a DUT mid-retype" into three new comments
      (`Commands.Pull`'s overlay, `Commands.Push`'s receipt, `Program.WarnIfPartial`) — so the grep is now a test:
      `Volt.Repo.Gates/CliHoldsNoItemKindLogicTests` runs both greps over `src/Volt.Cli` with ONE allow-listed file,
      `Sidecar.cs` (the refusal's doc names the retired `X.dut` key), and zero allowed hits for the kind-decision
      grep. Red at the section-5 HEAD (the three comments and `V1Note`), green after the comments were rewritten
      kind-neutral and 4.9 landed.
      **Widened in section 6 review round 2** — the gate matched a subtype only as an extension and a lookup only as
      `ItemKind.KindFor…`, so a subtype list of quoted literals, an unqualified `KindForWireName` after `using
      static`, and a hard-coded kind extension all passed — and the CLI really held one (`IdeTree.IsLibraryStub`,
      `rel.EndsWith(".library")`). It now also refuses quoted subtype words, `KindFor`/`KindForWireName`
      unqualified, `Kinds.X`, `using static …ItemKind`, and any kind extension as a string literal in code (the list
      read from `ItemKind.cs`'s one table); each shape is a pinned case. `@volt/control`'s `src` is scanned too,
      its extension table (`state/files.ts`) the one allowed file.
- [x] 4.7 (naming half done in 6.2; the `WRITABLE` half in the section 6 review)
      TS e2e client (1.4 census): `lib/workspace.ts` `fid` doc, `fixtures.ts` DUT rows carry their subtype
      extension, `crud-cycle`, `name-clash`, `kinds/top-level`, `vendor-parity` name DUTs `X.struct`/`.enum`/…; and
      `whole-project.test.ts`'s `WRITABLE` kind regex goes — the writable set comes from what the wire says, and
      the test asserts the sweep includes the project's DUTs (so a DUT falling out is red).
      **Done (section 6 review).** The wire carries no writable flag, so the sweep asks the ONE writable-source table
      the clients share — `@volt/control`'s `isPouFile`, cross-checked against the engine's by `bun run check` —
      and the hand regex (which still named `.dut`) is deleted. Neither committed fixture holds a DUT (CODESYS
      `refs`: 36 items, none a DUT), so the suite seeds one `VltE2E_` DUT of each subtype and asserts all four are
      swept: red with the old regex (all four left out), green after, on both vendors.
- [ ] 4.8 Wire-driving scripts (1.4 census): `probe-tc-name-collision.ts` pushes `X.struct`;
      `corpus-migration.ts` compares names WITH extensions again (delete the `.struct`≠`.dut` stem workaround);
      `record-language.ts` sweeps DUT orphans by their subtype name (`extForKind` loses `dut: "dut"`) and its
      `unitExt` stops deciding a subtype: the fixture STATES it (`kind: "struct"|"enum"|…`, as a workspace file's
      name does), with no `alias`/`fb` default — an unstated kind fails loud; the
      `corpus-migration.ts:494` comment goes with the workaround.
- [x] 4.9 `Commands.cs` `V1Note` (1.4 census): the "which files can hold network text" decision moves behind ONE
      engine predicate keyed by the wire name (the rule `ImplementationMarker.AppliesTo` already owns); the CLI
      calls it and imports no `ItemKind`. Test first: the CLI's answer for `X.fb`, `X.gvl`, `X.struct`, `X.enum`
      equals the engine predicate's.
      **Done (section 6 review).** `NetworkText.CanHold(wireName)` is the predicate (a source kind with an
      implementation — `ImplementationMarker.AppliesTo`), and `NetworkText.FileHoldsV1(wireName, text)` the v1
      question keyed by the same name; `SourceHoldsV1(text, kind)` is private now (the NoTestOnlyCodeInSrc gate
      caught it as test-only). `V1Note` calls the two by the file name and resolves no kind. The test is the
      predicate's own table (`NetworkTextV1DetectionTests.Whether_a_file_can_hold_network_text_is_asked_by_its_name`
      — fb/prg/fun yes; gvl, all four DUT subtypes, itf, task, no extension, `X.Enum` no), red before (no API),
      plus the layering gate (4.6) that fails on any `ItemKind.KindFor`/`IsSourceKind`/`ImplementationMarker` in
      `Volt.Cli`. The "CLI answer equals the engine's" test as worded would need a CLI wrapper existing only for
      the test — the CLI's answer IS the engine call, which the gate enforces.
      **Corrected in section 6 review round 2:** that last sentence was wrong — `PullCommandTests` already drives
      `V1Note` end to end, and every such test used `PLC_PRG.prg`, so a CLI that swapped the engine call for
      `EndsWith(".prg")` passed them all. The test as worded now exists:
      `PullCommandTests.A_clean_merge_that_leaves_v1_text_names_the_file_for_every_kind_with_a_body` (`.fb`, `.fun`
      — red under that mutation) and `A_pull_judges_no_v1_in_a_kind_without_a_body` (`.gvl`, `.struct`: no note).
      **Corrected in round 3:** the no-case test lacked the `.enum` the task names (added, `E_Io.enum`), and it pins
      only that the CLI adds no judgement of its own — red under a CLI kind list plus text scan that forgot `.enum`.
      It cannot see the `CanHold` skip removed, and need not: `FileHoldsV1` asks `CanHold` itself, so the skip saves
      a read and changes no answer. `Commands.cs` also kept a dead `using Volt.Engine.Item;` after `V1Note` moved —
      deleted, and gated (below).

**Section 4.1–4.6 (2026-09-27), offline.** `Volt.Engine.Tests` 1494 passed / 0 failed (1 skipped, pre-existing);
`Volt.Cli.Tests` 238 / 0 (every group-2 test green, the 4.5 reds included); Codesys 160, Twincat 231, Contracts
19, Connector 110, Repo.Gates 20, `bun test test/unit` 4, `bun run check` 14 — all green. No live IDE; no driver
touched; DIALECT.md unchanged. 4.6 stays open on 4.9's `V1Note`; 4.7–4.9 not started.
**This run committed with NO review round** (the loop's step 2 was skipped); round 1 below is the first.

**Section 4.1–4.6 review, round 1 (2026-09-27)** — one product finding, one CLI-contract finding, three record
findings; fixed test-first:
- A kind extension in another CASE (`E_Mode.Enum`, `FB_New.FB`) was a kind to both readers — the engine's
  `ItemKind.KindForWireName` and the CLI's `Extensions` lookup were `OrdinalIgnoreCase` — while every name-keyed
  comparison after them is Ordinal. Pushed, the file's spelling reached the IDE and the baseline held the minted
  `E_Mode.enum`: a later edit was refused `ITEM_EXISTS` as a create beside itself, and a DUT deleted in the IDE
  kept its file (the removal sweep never matched it) so the next push recreated it. On the engine side, `delete
  X.Struct` destroyed the struct `X`. The one spelling per kind is now the only one: both lookups are Ordinal, so
  the engine refuses the op `BAD_REQUEST` by name (`RequireWireNames`) and the CLI refuses the file before
  committing as an unrecognized extension, naming the path. No case folding. Pinned (red before):
  `DutSubtypeChangePushTests.A_set_under_a_name_that_is_no_wire_name_…` (`X.Struct`, `X.STRUCT`, forced or not),
  `A_delete_under_a_name_that_is_not_the_duts_wire_name_…` (`X.Struct`),
  `PushCommandTests.Push_rejects_a_kind_extension_spelt_in_another_case` (`DUTs/E_Mode.Enum`, `POUs/FB_New.FB`).
  The case gap predates this change for non-DUT kinds (`.FB` was never folded); it became reachable for DUTs when
  `FullNameFromPath` stopped rewriting them to `.dut`.
- `volt merge --continue` exited 0 when it refused the pending baseline, which volt-control reads as `done`. It
  exits 1 now; the message is unchanged (the merge concluded, the baseline was NOT synced, `volt pull`).
  `DutBaselineMigrationTests.A_dut_keyed_pending_baseline_is_never_promoted_by_merge_continue` asserts the code
  (red before).
- 4.5 was done and tested but left unticked — ticked. The `IdeTree` library comment lost its sentence end with the
  deleted example list — restored. The missing review record — this block.
Run after: `Volt.Engine.Tests` 1499 passed / 0 failed (1 skipped, pre-existing); `Volt.Cli.Tests` 240 / 0;
Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4, `bun run check`
14 — all green. No live IDE; no driver touched; DIALECT.md unchanged.

**Section 4.1–4.6 review, round 2 (2026-09-27)** — one product finding, one TS-classifier finding, one gate
finding (reported twice); fixed test-first:
- A pull over a PARTIAL walk dropped a name absent from a folder it DID read from the baseline, while the bridge's
  `removed` (empty for any partial walk) left its file in `volt/ide` and the workspace. No later pull could report
  it removed — a fetch is asked only about names the baseline still holds — so the file stayed for good, status
  read in sync, its edit was refused `ITEM_EXISTS`, and `volt push --force` wrote it over the live item. 4.3 routed
  the DUT subtype change into that hole (the old `X.struct` beside the new `X.enum`); the hole itself was any item
  deleted in the IDE during a partial pull. `Commands.Retired` is now the ONE list the baseline overlay drops and
  the `volt/ide` tree removes (complete walk: the bridge's `removed`; partial: absent from a read folder), so the
  two cannot disagree. A name whose BARE name the walk found unreadable stays known, undecided — the bridge has
  the walked kind, the CLI does not — and the next complete walk decides it. Pinned (the first two red before):
  `PullCommandTests.A_pull_over_an_unreadable_folder_retires_an_item_deleted_from_a_folder_it_read`,
  `…_retires_the_old_name_of_a_dut_whose_subtype_changed`, `…_keeps_an_item_it_found_and_could_not_read`.
- Round 1 made the CLI's extension lookup Ordinal; the TS copies still case-folded (`volt-control` `isPouFile`,
  the `volt-lsp-iec` workspace scan), so `E_Mode.Enum` was a source file to the LSP and the extension while
  `volt push` refused it. Both match exactly now (the LSP's whole workspace scan, one rule in the file). Test
  first: `workspace-refs.test.ts` "takes a source file only under its exact extension" (red before). **Test premise
  corrected:** `files.test.ts` "is case-insensitive (Windows paths arrive mixed-case)" — an extension's case is the
  file's own on disk (preserved by every filesystem Volt runs on), and the spec makes a file name its wire name,
  which the CLI refuses in another case; it now pins the exact match.
- Round 1's `Extensions.ByExt` comment spelt `E_Mode.Enum`/"a DUT deleted" into the CLI, regressing the 4.6 grep;
  rewritten with a non-DUT example (`FB_New.FB`, "an item deleted"). The 4.6 record names `V1Note` by method, not
  by line.
Run after: `Volt.Cli.Tests` 243 / 0; Repo.Gates 20, `bun test test/unit` 4; `volt-control` 115, `volt-lsp-iec`
5616 / 0 fail, `volt-vscode` 31; `bun run check` 14, typecheck, lint — all green. No engine or driver code touched
(Engine/Codesys/Twincat suites unaffected, not re-run); no live IDE; DIALECT.md unchanged. Round 3 not yet run.

**Section 4.1–4.6 review, round 3 (2026-09-27)** — four findings, all fixed test-first (each red before):
- Round 2's `Commands.Retired` was a SECOND removal rule in the CLI, weaker than the engine's: it exempted a known
  name by BARE name against the wire's `unreadable` list, so an unreadable program `X` shielded a DUT `X.struct`
  the IDE deleted on every partial pull (`PullCommandTests.A_partial_pull_retires_a_deleted_dut_beside_an_
  unreadable_item_of_its_name`); and `volt status` (refs) still derived no removal from a partial walk while `volt
  pull` deleted the file (`PullCommandTests.Status_over_a_partial_walk_reports_the_removal_pull_makes`). Fixed at
  the root: removal is decided ONCE, in the engine (`Sync/Removal`, kind-aware unreadable exemption; on a partial
  walk a known name is gone iff absent and its known folder was read), for BOTH read ops — `FetchRequest.
  knownFolders`, `RefsRequest.knownItems`/`knownFolders`, `ReadResponse.removed` (moved up from `FetchResponse`).
  The CLI sends its baseline and folders and takes `removed` as given: `Retired` and `UnderAny` deleted,
  `StatusModel.ComputeIncoming` takes the bridge's list (its `complete` absence rule deleted). Engine:
  `PartialWalkTests` (four new). **Test premise corrected:** `StatusPartialViewTests` and
  `StatusModelTests.ComputeIncoming_classifies_…` pinned the CLI deriving removal from absence — the rule this
  finding moves to the engine; the three partial-view facts are now pinned end to end through `volt status` over
  the pipe, the unit test passes the bridge's `removed`. `volt-bridge.openrpc.json`/`data.js` regenerated;
  `logs.html` Warn text and the fetch error-doc line updated to the new rule.
- A baseline-less pull (the 4.5 migration) over a partial walk wrote the partial map as the whole baseline, so a
  DUT under the unread folder that the IDE later deleted kept its file and was re-CREATED by the next push. The
  overlay now starts from the `volt/ide` tree when there is no sidecar (names at `""`, folders from the file
  paths — `KnownFromIdeTree`), which also gives the engine the folders it judges a partial walk by:
  `DutBaselineMigrationTests.A_baseline_less_pull_over_an_unreadable_folder_still_retires_what_the_ide_deletes_later`.
- A push receipt from a partial walk restored every baseline name it lacked, including the one the push itself
  retired (a delete, or a rename's old name — a subtype change is either), so `X.struct` stayed beside `X.enum` and
  the rewrite back was refused. The restore now skips them:
  `DutSubtypeFileTests.A_subtype_rewrite_over_a_partial_receipt_retires_the_old_name_from_the_baseline`.
Noted, not fixed (pre-existing, not a finding): a `--force` push adopts a COMPLETE receipt filtered to known
names, so an item the IDE deleted concurrently leaves the baseline while its file stays in `volt/ide`.
Run after: `Volt.Engine.Tests` 1503 passed / 0 failed (1 skipped, pre-existing); `Volt.Cli.Tests` 247 / 0;
Codesys 160, Twincat 231, Contracts 19, Connector 110, Repo.Gates 20, `bun test test/unit` 4, `bun run check` 14 —
all green. No live IDE; no driver touched; DIALECT.md unchanged. Three review rounds run — the cap; not called clean.

## 5. Docs and gates

- [x] 5.1 `docs/items.html`: tables regenerated (`VOLT_WRITE_DOCS=1` — it writes only `assets/data.js`) AND the
      hand-written prose rewritten (`:67`, `:74`, `:140` — "one wire kind", "the wire identity keeps `.dut`",
      "remains the wire kind"); `wire.html`, `RefsFetch.cs` example, DIALECT.md.
      Test first: `DocDataTests.No_doc_names_a_dut_by_the_retired_wire_name` (seven pages/comments: no `.dut`, no
      "one wire kind"/"remains the wire kind" outside the upgrade note, and the note must exist and name the fix)
      and `The_wire_page_states_the_dut_subtype_rule` — six red before (items.html, `RefsFetch.cs`, `files.ts`,
      `source-extensions.ts`, `agents.mdx`, wire.html's missing section). `VOLT_WRITE_DOCS=1` regenerated
      `data.js` with NO diff (3.3 had already brought the tables current). `items.html#dut` now says the engine kind
      is `dut` and the wire/file name is the subtype, minted once, never from the tree code (623 is the alias code,
      DIALECT C2b — the old "generic code" wording was also stale), and links the push rule; the extensions lede
      no longer says `.dut` is "the wire kind"; the kinds table's column is "kind", not "wire kind" (`doc.js`).
      `wire.html#dut-subtype`: the two git shapes, the delete's `ifVersion` guard, create-only pairing, refusals by
      name, `X.fb` never pairs, a delete names one wire item, a kind-less name is `BAD_REQUEST`; the `BAD_REQUEST`
      row links it. `RefsFetch.cs`: the `MyDut.dut` example → the subtype names, minted by `FullWireName`.
      DIALECT C2e: a "how Volt relies on it" sentence (offline-pinned; the live re-run is 6.1) — no new
      measurement. **Found beyond the list:** `volt-web/app/docs/agents.mdx` told Claude Code users the plugin
      registers `.dut` — the plugin (`plugins/volt-lsp/.claude-plugin/plugin.json`) registers the four subtypes;
      the page now says so. (`check-wiring.ts` does not cover that plugin manifest — noted, not in this section.)
- [x] 5.2 `volt-control/src/state/files.ts`, `volt-lsp-iec/src/source-extensions.ts` comments; `bun run check`
      (extension parity) green.
      Both rewritten (the file name IS the wire name; one subtype reader) — gated by 5.1's test; `files.ts`'s
      comment also lost a dangling "— every" fragment. `files.test.ts`'s comment ("`.dut` is the WIRE kind")
      rewritten, its assertion unchanged. `bun run check` 14/14 (all six extension-parity rows).
- [x] 5.3 Release note: after upgrading, delete `.git/volt/ide-refs.json` and run `volt pull` once (the old
      baseline is refused by name, `volt pull` included — it cannot rebuild a baseline it first has to load).
      (As first written this task also promised the files on disk would not move — FALSE, found in review: the tightened
      subtype reader renames a DUT the previous one misread, and leaves one stating no subtype unreadable.)
      The repo has no changelog and the release workflows write no release body, so the note lives where
      MATERIALIZATION 3's did (`network-text.html#migration`): `docs/items.html#dut-migration`, gated by 5.1's test
      to exist and to name `.git/volt/ide-refs.json` and `volt pull`. It also says nothing is sent, there is no
      translation, and a pending merge over an old baseline is not promoted (`merge --continue` exits 1).
      It now also lists every shape the previous reader misread and the rename each causes (prefix, a comment or
      pragma after the colon — enum↔struct/alias included — a colon inside a comment), and the no-subtype shapes
      that come back unreadable; gated per shape by `The_dut_migration_note_names_every_shape_the_old_reader_misread`.

**Section 5 (2026-09-27), offline, docs only.** `Volt.Engine.Tests` 1511 passed / 0 failed (1 skipped,
pre-existing; +8 = the two new doc gates); `Volt.Cli.Tests` 247; Codesys 160, Twincat 231, Contracts 19, Connector
110, Repo.Gates 20, `bun test test/unit` 4, `volt-control` 115, `bun run check` 14, typecheck, lint (exit 0) — all
green. No product code, no driver, no live IDE. Review (data / spec / layering, one round): one finding — wire.html's
`BAD_REQUEST` row did not list the new push refusals; the row now does and links the rule. Round 2 found nothing new.

**Section 5 review round 4 (2026-09-27).** HIGH: a DUT held as `X.struct` that went subtype-less in the IDE (the
ordinary mid-retype state) left the baseline — pull wrote `fetched.Items`, which omits an unreadable item, and the
push adopted `resp.NewItems`, likewise — so when it was finished as `X.enum` no fetch was asked about `X.struct` and
both files lived on for one object. Fixed generically in `Commands.Pull` / `Commands.Push`: the baseline is always an
overlay, forgetting a name only when the bridge reports it `Removed` (pull) or this push deleted/renamed it (push).
No kind logic in the CLI; the removal decision stays the engine's. Tests (red first):
`DutSubtypeFileTests.A_held_dut_retyped_through_a_subtype_less_state_leaves_one_file` (with and without a baseline),
`A_push_while_a_held_dut_is_subtype_less_keeps_it_known`. LOW ×3: the proposal and 5.3 promised unchanged files
(corrected; gated by `DocDataTests.The_dut_subtype_change_does_not_promise_unchanged_files`), and
`items.html#dut-migration` listed only two of the old reader's misreads (now a table of every shape, enum renames
included; gated per shape).

**Section 5 review round 5 (2026-09-27).** Four findings, all fixed, each test red first. (1+3) the migration note
missed a pragma that STARTS the TYPE line — the old reader (0e9f9523e0) dropped any line starting `{`, header and
colon with it, so such a DUT read as alias; `items.html#dut-migration` now says so and lists `P.alias → P.struct`
and `E.alias → E.enum` (gated by three new shapes in `The_dut_migration_note_names_every_shape_the_old_reader_misread`;
`DutSubtypeCodeTests` pins the current reader on three pragma-led TYPE lines — green on arrival, the reader was
already right). (2) the note said every push of an unreadable DUT is refused — false under `--force` (the
pre-flight runs only unforced; `DeleteReaches` is true under force); the note now says "unless forced" and what a
forced delete does (gated in `No_doc_names_a_dut_by_the_retired_wire_name`). (4) the unreadable warning said "NO
file here" — false for an item a pull already wrote; `Program.WarnIfPartial` and volt-control's tooltip now say the
file, if any, is the last one read (`BlackBoxTests.Status_warning_does_not_deny_a_held_unreadable_items_file`,
`display.test.ts`); the same claim fixed in `StatusModel.cs`, `Types.cs`, `Shared.cs`, `types.ts` doc comments.
Run after: `Volt.Engine.Tests` 1532 / 0 (1 skipped, pre-existing); `Volt.Cli.Tests` 251; Codesys 160, Twincat 231,
Contracts 19, Connector 110, Repo.Gates 20; `bun test test/unit` 4; `volt-control` 115 + typecheck;
`volt-lsp-iec` typecheck; lint; `bun run check` exit 0 — all green. No driver touched, no live IDE, DIALECT.md
unchanged (no new vendor measurement).

## 6. Live

- [x] 6.1 Re-run 1.1 on both vendors with the new build: both git shapes land as one update; folder kept.
      **Measured 2026-09-27**, `volt push` (Debug build of HEAD) from a fresh `volt init` workspace, fixtures served
      by `ide.ps1 up` (CODESYS `CodesysTestProject`; TwinCAT `Project14`, one worker). Three structs created in
      `VltMeasure`, then (a) git `R069` A.struct→A.enum, (b1) `D`+`A` B.struct→B.enum (new extension sorts first),
      (b2) `D`+`A` C.struct→C.union (old extension first — the order 1.1 found stuck). Identical on both vendors:
      each push is `push 1 ops — accepted [updated: X.struct]` in the bridge log (the delete+add pair coalesced;
      nothing deleted or created), `volt status` in sync after each, `refs` and the sidecar hold `VltM_A.enum`,
      `VltM_B.enum`, `VltM_C.union` and no `.struct`, the workspace holds exactly those files, and `fetch` puts all
      three in `VltMeasure`. TwinCAT `.TcDUT` Ids unchanged (tree code stays 606, as 1.2 measured); CODESYS GUIDs
      not read this session (plain production host — the in-place write keeping the object is 1.1/1.3's). Both
      compile each as its new shape: a user called from the main program builds clean, and the negatives are
      refused (`'vA' is no structured variable`, `'Purple' is no component of 'VltM_B'`).
      Evidence: `scripts/dut-subtype-push.log` and `scripts/tc-dut-codes.log`, session 3 of each. The same rule is
      now an e2e suite, `items/dut-subtype-change.test.ts` (7 cases: rename, delete+add in both orders — folder
      kept, only the new name in `refs` — stale delete guard, two sets on one DUT, a body of another subtype, a stale
      subtype delete) — green on both vendors.
- [x] 6.2 e2e: `vendor-parity`, `name-clash`, `crud-cycle`, `kinds/top-level` green on both vendors.
      Needed 4.7's naming half first (done here, see 4.7): the suites still named DUTs `.dut`, which the bridge now
      refuses. `fixtures.ts` `LIFECYCLE_KINDS` rows carry their wire extension (`ext: "struct"`…, `kind` gone),
      `crud-cycle`'s `EXT_BY_KIND` deleted, `name-clash` `X.struct`, `kinds/top-level` `X.alias`, `vendor-parity`
      `struct`/`enum`, `lib/workspace.ts` `fid` doc. **Test premise corrected:** `vendor-parity`'s `refs` shape
      lacked `removed`, which `refs` carries since review round 3 moved removal into the engine for both read ops
      (`ReadResponse.Removed`) — the shape now includes it, asserted on BOTH vendors (it checked one), and both
      report `removed: []` when asked about no names. Runs: CODESYS `crud-cycle`+`name-clash`+`kinds/top-level`+
      `dut-subtype-change` 21/0; TwinCAT the same 21/0; `vendor-parity` (both bridges) 11/0.
- [ ] 6.3 Full C# suites + `bun test test/unit` green; archive, delete the recreated `openspec/specs/`.
      Suites **green** (2026-09-27, after 6.1/6.2): Engine 1532/0 (1 skipped, pre-existing), Cli 251, Contracts 19,
      Codesys 160, Twincat 231, Connector 110, Repo.Gates 20, `bun test test/unit` 4; `bun run check`, lint and the
      volt-cli `tsc` exit 0. **Archive BLOCKED on 1.5 and 4.8 only** — 1.5 (the Pro2193 `refs`
      `System.Guid`->`Int32` failure, an unexplained bridge fault needing a live Pro2193 session) and 4.8 (the three
      wire-driving scripts). 4.6, 4.7 and 4.9 were open at the first run of this task and are closed since the
      section 6 review (`V1Note` asks `NetworkText.CanHold` and resolves no kind). The change is not archived and
      `openspec/specs/` is not recreated until those two close (or an explicit close-out decision).
      **Re-run at `fe8cf4c504` (2026-09-27, clean tree):** Engine 1547/0 (1 skipped, pre-existing), Cli 258,
      Repo.Gates 36, Contracts 19, Connector 110, Codesys 160, Twincat 231, `bun test test/unit` 4; `bun run check`
      and lint exit 0. Still BLOCKED on 1.5 (needs a live Pro2193 session) and 4.8 (three scripts not yet updated).
      Found live, fixed: the subtype-mismatch refusal read "named for a enum" — now "names the subtype X but its
      declaration's subtype is Y" (pinned since the section 6 review). The e2e `unionDut` fixture's member `r` (the
      IL reset operator, `C0009 Unexpected token 'r'` on CODESYS) — fixed in the section 6 review.

**Section 6 review (2026-09-27)** — seven findings; five fixed test-first (each red before), and the two
acknowledged-open ones (4.7's `WRITABLE` half, 4.9) closed:
- (medium, product) A pull whose PARTIAL walk left the DUT's OLD folder unread kept the old subtype name beside the
  new: `Removal.Removed` judged `X.struct` only by its folder, though the walk HAD published the one object as
  `X.enum`. Two files and two baseline keys for one IDE object — a regression from `.dut`, where both were one name.
  Fixed in the engine: a known name is removed when the walk published the same bare name AND kind under another
  wire name (`Removal.SeenUnderAnotherName`), whatever its folder; a same-named item of another kind proves nothing.
  `PartialWalkTests.A_partial_walk_removes_the_old_subtype_name_of_a_dut_it_found_retyped` (red),
  `…_does_not_retire_a_name_because_another_kind_shares_its_bare_name`,
  `PullCommandTests.A_pull_retires_the_old_subtype_name_even_when_its_own_folder_went_unread` (red).
- (low, test) `dut-subtype-change.test.ts` asserted weaker than the scenarios it cites: the stale delete guard now
  asserts `STALE_ITEM_VERSION` on the op, "two sets" asserts `X.enum` is absent after, and "a body of another
  subtype" asserts both names. Green on both vendors (the product already met them).
- (low) The subtype-mismatch sentence is pinned:
  `DutSubtypeChangePushTests.An_op_whose_subtype_name_disagrees_with_its_declaration_is_refused_by_name` asserts it
  for all four shapes (red against the old "is named for a enum" wording, green on the current).
- (low, fixture) `unionDut`'s `r` member -> `rv` (the fixture and the `LIFECYCLE_KINDS` union edit). The live
  suite's delete+add cases now also BUILD the union on the IDE (`ensureCompiles`): red on CODESYS with `r` (C0009,
  5 errors), green with `rv`, and green on TwinCAT.
- (low, gate) 4.6 — closed as a test (`CliHoldsNoItemKindLogicTests`), see 4.6.
- (info) 4.9 `V1Note` — closed, see 4.9. (info) `whole-project.test.ts` `WRITABLE` — closed, see 4.7.
Run after: `Volt.Engine.Tests` 1547 / 0 (1 skipped, pre-existing); `Volt.Cli.Tests` 252; Contracts 19, Codesys 160,
Twincat 231, Connector 110, Repo.Gates 21; `bun test test/unit` 4; `bun run check`, lint and the volt-cli `tsc` exit
0. Live, fixtures via `ide.ps1` (CODESYS `CodesysTestProject`; TwinCAT `Project14`, ONE worker): `crud-cycle`,
`name-clash`, `kinds/top-level`, `dut-subtype-change`, `whole-project` 23/0 on each vendor; `vendor-parity` 11/0.
DIALECT.md unchanged (no new vendor measurement). One review round.

**Section 6 review, round 2 (2026-09-27)** — five findings, all fixed; each red first:
- (low, test) 4.9's "CLI answer equals the engine's" test was skipped on a false premise (see 4.9). Written:
  `PullCommandTests.A_clean_merge_that_leaves_v1_text_names_the_file_for_every_kind_with_a_body` (`.fb`, `.fun`) —
  red with `V1Note`'s engine call swapped for `EndsWith(".prg")`, green on the product — and
  `A_pull_judges_no_v1_in_a_kind_without_a_body` (`.gvl`, `.struct`).
- (low, record) 6.3 listed 4.6/4.7/4.9 as archive blockers and said `V1Note` still decides a kind, three lines
  above saying they were closed; the paragraph now names the two real blockers, 1.5 and 4.8.
- (low, gate) `CliHoldsNoItemKindLogicTests` widened (see 4.6), with the escaping shapes pinned as cases
  (`The_gate_catches_a_kind_decision_in_any_spelling`, and `The_gate_passes_what_decides_no_kind` so it stays
  precise). Red on `IdeTree.cs`'s `".library"` before the next fix.
- (low, product) `IdeTree.IsLibraryStub` spelt `.library` — a second copy of the engine's kind table in the CLI.
  It asks `ItemKind.IsLibraryWireName(fileName)` now (the file name IS the wire name; the `IsTaskWireName` shape).
- (info) `@volt/control` `view/types.ts` still said "a DUT caught mid-retype" — now "an item caught mid-edit";
  gated by `Volt_control_spells_no_dut_subtype_outside_its_extension_table` (red on that line before).
Run after: `Volt.Engine.Tests` 1547 / 0 (1 skipped, pre-existing); `Volt.Cli.Tests` 256; Codesys 160, Twincat 231,
Connector 110, Contracts 19, Repo.Gates 33; `bun test test/unit` 4; `volt-control` 115 + typecheck; `bun run
check`, lint exit 0. No driver touched, no live IDE (no bridge behaviour changed), DIALECT.md unchanged.
Archive still BLOCKED on 1.5 and 4.8.

**Section 6 review, round 3 (2026-09-27)** — four findings (all low), all fixed; each red first:
- (layering) `Commands.cs` still imported `Volt.Engine.Item` though nothing in it used the namespace any more, so an
  unqualified `ItemKind.X` could return with no new import to review. The import is deleted. It is gated by
  `CliHoldsNoItemKindLogicTests.Volt_Cli_imports_the_kind_namespace_only_where_it_reads_the_extension_table` (only
  `Extensions.cs` and `Scaffold.cs`, which read `ItemKind.FileExtensions` as a table; red on `Commands.cs`).
- (test) 4.9's no-case test gained `.enum`. The record now says what that test does and does not pin (see 4.9).
- (gate) `KindExtensionLiteral` matched case-sensitively, so `rel.EndsWith(".LIBRARY", OrdinalIgnoreCase)` and
  `".Fb"` passed. It is `IgnoreCase` now, and both lines are cases of `The_gate_catches_a_kind_decision_in_any_spelling`
  (red without the flag). The flag adds no false positive over `Volt.Cli`.
- (layering, message) `Materialize.MaterializeItem` refused an unknown extension with "add it to Extensions.cs".
  That file holds no list, so the message sent the fix into the CLI. It now names `ItemKind.FileExtensions
  (Volt.Engine)`. Pinned by `DutSubtypeFileTests.An_unfileable_wire_name_is_refused_naming_the_engines_kind_table` (red).
Run after: `Volt.Engine.Tests` 1547 / 0 (1 skipped, pre-existing); `Volt.Cli.Tests` 258; Codesys 160, Twincat 231,
Connector 110, Contracts 19, Repo.Gates 36; `bun test test/unit` 4; `bun run check`, lint exit 0. No engine or driver
code touched, no live IDE (no bridge behaviour changed), DIALECT.md unchanged. Three review rounds of section 6: the
cap. This is not a claim that the section is clean. Archive still BLOCKED on 1.5 and 4.8.
