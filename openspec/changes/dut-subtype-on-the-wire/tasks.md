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

- [ ] 2.1 Engine: `Materializer` names each of the four DUT shapes by subtype (struct, enum, union, alias,
      text-list enum on CODESYS) — replace the `.dut` expectations in `DutSubtypeCodeTests` / `ItemKindTests`.
- [ ] 2.2 Engine: `PushService` against `FakeIde` — rename op struct→enum is one content update (folder kept,
      version gate honoured); delete + create pair coalesces in BOTH op orders; stale `ifVersion` on the delete
      refuses; two sets on one bare DUT refuse `BAD_REQUEST`; a delete of `X.struct` with NO paired set still
      deletes; and the same pair with `Force = true`, both orders, is still ONE content update — the DUT exists
      after, in its folder, and the receipt names it (1.1's force cases: today one order is accepted with the DUT
      deleted, the other deletes then fails `INTERNAL_ERROR`).
- [ ] 2.3 Engine: `TransportMatrixTests` / `WireVocabularyGuardTests` — no `.dut` on any wire message.
- [ ] 2.4 CLI: `DutSubtypeFileTests` rewritten as "file name == wire name" (no declaration read on pull);
      the IdeTree stale-subtype case (pull after the IDE changed struct→enum) removes `X.struct` and writes
      `X.enum` through the ordinary sweep. KEEP the section-1 IDE-delete cases (a DUT deleted in the IDE is gone
      from the workspace after the next pull). ADD: (i) an IDE-side edit of a DUT → `volt status --json`
      `pathByName` names the real `DUTs/X.struct`, and `volt show BRIDGE DUTs/X.struct` returns the IDE's text;
      (ii) the 1.1 force case black-box: `git rm X.struct` + add `X.enum`, `volt push --force` in both path
      orders, then `refs` holds `X.enum` in its folder and `volt status` is in sync.
- [ ] 2.5 CLI: sidecar with a `.dut` key → refused, names `volt pull`, sends nothing. And a PENDING baseline
      (`pending-ide-refs.json`) with a `.dut` key is never promoted by `volt merge --continue`: the merge completes
      without "IDE baseline synced", `ide-refs.json` holds no `.dut` key, and the output names `volt pull`.
- [ ] 2.6 Library: a library enum and a project enum carry the same extension, from the same `DutSubtype`.

## 3. Engine

- [ ] 3.1 `Materializer.FullWireName`: DUT → `CodeHelper.DutSubtype(text)` extension. The only minting site.
- [ ] 3.2 `PushService`: the subtype-change rule (spec requirement 2), placed with the other op normalisation,
      before `InFolderDepthOrder`. Resolve every DUT op to its bare name once; kind check accepts all four.
      The coalescing does not depend on `Force`: force drops the version gate, never the pairing (1.1).
- [ ] 3.3 `ItemKind`: delete `WireExtFor`, `IsDutFileExtension`; `SourceKindExtensions` lists
      struct/enum/union/alias as ordinary source extensions mapping to `Kinds.Dut`; `ExtFor(Kinds.Dut)` is no
      longer a wire extension (delete or make it throw — nothing may mint `.dut`). Rewrite the long comments at
      `ItemKind.cs:34`, `:49`, `:301-306` and `:398` to the new fact.
- [ ] 3.4 `LibSignatureRenderer`: use `DutSubtype`-equivalent naming from one helper (no second classifier);
      rewrite the `:139` "One wire kind still" comment.
- [ ] 3.5 Drivers: confirm neither bridge parses a wire extension to decide DUT-ness beyond `Bare()`; fix any that do.
      Rewrite the "one wire kind `dut`" comments at `CodesysTypeMap.cs:59,134` and `BeckhoffDriver.Tree.cs:341`.
- [ ] 3.6 Every ENGINE `KindForWireName` reader (`PushedText.SameExceptLayout`, `StReader` via `PushService`) gets
      `Kinds.Dut` for all four subtype names (1.4 census) — today a `.struct` wire name reads as NO kind. The CLI's
      `Commands.cs:863` is not one of them: it is 4.9.

## 4. CLI — delete, don't move

- [ ] 4.1 `Materialize.FileNameFor` → gone; pull writes `item.Name`.
- [ ] 4.2 `Extensions.FullNameFromPath` → the DUT branch gone.
- [ ] 4.3 `IdeTree.cs:66-80` stale-subtype guard deleted (the library exclusion beside it stays).
- [ ] 4.4 `Commands.cs` refusal text and `Scaffold.cs` doc: "the extension names what it is" — no "maps to .dut".
      Neither keeps a hand-written kind→extension list: both render from the one extension table, as
      `VscodeSettings()` already does.
- [ ] 4.5 `Sidecar` load: refuse a `.dut` key (2.5) — in `LoadIdeRefs` AND `LoadPendingIdeRefs`, so the
      `merge --continue` promotion cannot write one into the live sidecar.
- [ ] 4.6 grep `Volt.Cli` CASE-INSENSITIVELY for `dut` and for the subtype spellings `struct|enum|union|alias` —
      zero hits outside the sidecar refusal (the uppercase `DUT` in `Scaffold.cs`/`Commands.cs` is what a
      case-sensitive grep missed) — AND for `ItemKind.KindFor`,
      `IsSourceKind`, `ImplementationMarker` — zero hits: a kind decision that never spells `dut` is still one.
- [ ] 4.7 TS e2e client (1.4 census): `lib/workspace.ts` `fid` doc, `fixtures.ts` DUT rows carry their subtype
      extension, `crud-cycle`, `name-clash`, `kinds/top-level`, `vendor-parity` name DUTs `X.struct`/`.enum`/…; and
      `whole-project.test.ts`'s `WRITABLE` kind regex goes — the writable set comes from what the wire says, and
      the test asserts the sweep includes the project's DUTs (so a DUT falling out is red).
- [ ] 4.8 Wire-driving scripts (1.4 census): `probe-tc-name-collision.ts` pushes `X.struct`;
      `corpus-migration.ts` compares names WITH extensions again (delete the `.struct`≠`.dut` stem workaround);
      `record-language.ts` sweeps DUT orphans by their subtype name (`extForKind` loses `dut: "dut"`) and its
      `unitExt` stops deciding a subtype: the fixture STATES it (`kind: "struct"|"enum"|…`, as a workspace file's
      name does), with no `alias`/`fb` default — an unstated kind fails loud; the
      `corpus-migration.ts:494` comment goes with the workaround.
- [ ] 4.9 `Commands.cs` `V1Note` (1.4 census): the "which files can hold network text" decision moves behind ONE
      engine predicate keyed by the wire name (the rule `ImplementationMarker.AppliesTo` already owns); the CLI
      calls it and imports no `ItemKind`. Test first: the CLI's answer for `X.fb`, `X.gvl`, `X.struct`, `X.enum`
      equals the engine predicate's.

## 5. Docs and gates

- [ ] 5.1 `docs/items.html`: tables regenerated (`VOLT_WRITE_DOCS=1` — it writes only `assets/data.js`) AND the
      hand-written prose rewritten (`:67`, `:74`, `:140` — "one wire kind", "the wire identity keeps `.dut`",
      "remains the wire kind"); `wire.html`, `RefsFetch.cs` example, DIALECT.md.
- [ ] 5.2 `volt-control/src/state/files.ts`, `volt-lsp-iec/src/source-extensions.ts` comments; `bun run check`
      (extension parity) green.
- [ ] 5.3 Release note: run `volt pull` once after upgrading (sidecar rebuild); files on disk unchanged.

## 6. Live

- [ ] 6.1 Re-run 1.1 on both vendors with the new build: both git shapes land as one update; folder kept.
- [ ] 6.2 e2e: `vendor-parity`, `name-clash`, `crud-cycle`, `kinds/top-level` green on both vendors.
- [ ] 6.3 Full C# suites + `bun test test/unit` green; archive, delete the recreated `openspec/specs/`.
