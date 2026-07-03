## 1. Lock the gap in a failing test FIRST (regression-first) — DONE

- [x] 1.1 Ground truth captured: the real Execute-box PlcOpen XML from Bakon `Recipes.prg` is committed as
  `execute-box.reference.xml` in this change dir; the C# test uses a minimal faithful in-XML Execute box
  (`<block typeName="EXECUTE">` + `fbdcalltype=execute` + `<STCode>`) built from that shape.
- [x] 1.2 Two **failing** C# tests added to `GraphicalCodeTests.cs` (`Fbd_body_with_an_execute_box_reads_as_
  read_only_not_a_phantom_call`, `Write_refuses_a_body_that_currently_holds_an_execute_box`). Red before the
  fix (Failed 2 / Passed 12), green after (193 pass) — the durable guard.

## 2. Read-only-first (B) — chosen + implemented (DONE)

- [x] 2.1 `GraphicalCode.Read`: detect the Execute box via the already-read `Block.CallType == "execute"`
  (`HasExecuteBox`); when present, return a read-only body (empty + `@volt-graphical` marker), like CFC/SFC —
  no `PlcOpenReader`/`GraphModel` change needed for this cut (no STCode extraction).
- [x] 2.2 `GraphicalCode.Write`: refuse writing over a body whose current export holds an Execute box
  (`BridgeException 400 UNSUPPORTED`) — so a client that edits the marker into VG can't overwrite the box.
- [ ] 2.3 (follow-up) Materialize the Execute box's ST INLINE so the LSP analyzes it: `PlcOpenReader` reads
  the `stcode` addData onto the model, `VgWriter` renders `IF <en> THEN <stcode> END_IF`, and the VG
  language/parser (`docs/vg-language.md`, `VgParser`) represent inline-ST-in-a-network for round-trip. Not
  required to stop the data loss; deferred.

## 4. Re-harvest + re-baseline the corpus — DONE

- [x] 4.1 Re-harvested `test-corpus/bakon-nano` off the rebuilt bridge (via a project copy — the IDE held the
  lock). `Recipes.prg` now materializes as the read-only `(* @volt-graphical: FBD *)` marker; zero phantom
  `EXECUTE()` remain in the corpus.
- [x] 4.2 Re-baselined `real-corpus.test.ts` bakon-nano `totalDiags` 277→**275** (vg-undeclared 2→0; all
  remaining are library-blind `unresolved-identifier`). Changelog updated.

## 5. Land it — DONE

- [x] 5.1 `dotnet test Volt.Bridge.Tests` green (193 pass, incl. the 2 new Execute-box tests). `packages/volt-lsp-iec`
  `bun test` + `bun typecheck` green.
- [x] 5.2 `openspec validate graphical-execute-box` clean; spec delta reflects read-only-first. (Sync + archive
  after the branch merges.)

## Note — general bridge-gap policy (user directive, 2026-07-03)

EVERY gap found in the bridge gets a committed regression test that fails before the fix and passes after,
so materialization/round-trip fidelity can't silently regress. This change is the first application; the
same rule applies to any future bridge coverage gap (materialization drops, round-trip loss, kind
mis-classification).
