## 1. Lock the gap in a failing test FIRST (regression-first) — DONE

- [x] 1.1 Ground truth captured: the real Execute-box PlcOpen XML from Bakon `Recipes.prg` is committed as
  `execute-box.reference.xml` in this change dir; the C# test uses a minimal faithful in-XML Execute box
  (`<block typeName="EXECUTE">` + `fbdcalltype=execute` + `<STCode>`) built from that shape.
- [x] 1.2 Two **failing** C# tests added to `GraphicalCodeTests.cs` (`Fbd_body_with_an_execute_box_reads_as_
  read_only_not_a_phantom_call`, `Write_refuses_a_body_that_currently_holds_an_execute_box`). Red before the
  fix (Failed 2 / Passed 12), green after (193 pass) — the durable guard.

## 2. Full round-trip via a first-class VG `EXECUTE` construct — DONE

Read-only-first was implemented then SUPERSEDED (an FBD body is readable; the Execute box is a standard
feature that must round-trip, not be hidden). The `EXECUTE … END_EXECUTE` construct (EN via the ordinary
wire+IF) was built end-to-end:

- [x] 2.1 `GraphModel.Block.StCode` + `PlcOpenReader` reads the `stcode` addData onto the model.
- [x] 2.2 `VgWriter`: render an Execute box as `IF en THEN EXECUTE <verbatim ST> END_EXECUTE END_IF` (bare
  `EXECUTE … END_EXECUTE` when unwired) — EN reuses the existing EnEno wire+IF, ST emitted byte-for-byte.
- [x] 2.3 `VgParser` (bridge): capture the multi-line `EXECUTE … END_EXECUTE` (+ its `IF en THEN`/`END_IF`)
  as a `Block(TypeName=EXECUTE, CallType=execute, StCode=…, EN)`.
- [x] 2.4 `PlcOpenWriter`: emit the `stcode` addData for an execute `Block` → reconstructs `<block
  typeName="EXECUTE">`. **Live-verified** on CodesysTestProject: push `IF en THEN EXECUTE <st> END_EXECUTE
  END_IF` → real CODESYS Execute box → fetch back → ST + comments + EN preserved.
- [x] 2.5 `GraphicalCode`: guard removed — Execute-box bodies are editable (create + update), gated by the
  existing strict Validate round-trip.
- [x] 2.6 LSP `src/vg/parser.ts`: recognize + consume the `EXECUTE` construct so its complex ST isn't fed to
  the simplified VG grammar (no `VG_PARSE`). Missing `END_EXECUTE`/`END_IF` now emits `VG_PARSE` (matches the
  bridge) rather than swallowing the body.
- [x] 2.7 **Full ST-analysis DONE** — the `EXECUTE` block's ST is now analyzed as real ST: `parser.ts` captures
  the ST token slice onto `VgNetwork.executes` (`ast.ts` `VgExecuteBody`), and `body.ts` scans each with the
  ST identifier scanner and merges the refs into the VG body model. So the box's code is checked
  (unresolved-identifier) and navigable (references/highlight/completion), not opaque. bakon's ST globals
  resolve → ratchet stays 275; an undeclared ref inside a box now flags (regression test in `vg-body-model.test.ts`).

## 3. Push still works after the fetch changes (user caution) — VERIFIED

- [x] 3.1 Confirmed on CodesysTestProject that basic ST push (`F_RoundTrip`) and graphical FBD push (`FB_Fbd`)
  both create + read back correctly — the many added fetch paths/descriptors didn't break the write path.

## 4. Re-harvest + re-baseline the corpus — DONE

- [x] 4.1 Re-harvested `test-corpus/bakon-nano` off the rebuilt bridge. `Recipes.prg` now shows the real
  recipe ST inside `EXECUTE … END_EXECUTE`; zero lossy `EXECUTE()` calls.
- [x] 4.2 `real-corpus.test.ts` bakon-nano `totalDiags` back to **275** (VG_PARSE 8→0, vg-undeclared 2→0; all
  remaining are library-blind `unresolved-identifier`). Changelog updated.

## 5. Land it — DONE

- [x] 5.1 `dotnet test Volt.Bridge.Tests` green (194 pass, incl. the round-trip + write-reconstruct tests).
  `packages/volt-lsp-iec` `bun test` (5693) + `bun typecheck` green.
- [x] 5.2 `openspec validate graphical-execute-box` clean; spec delta reflects the round-trip.

## Note — general bridge-gap policy (user directive, 2026-07-03)

EVERY gap found in the bridge gets a committed regression test that fails before the fix and passes after,
so materialization/round-trip fidelity can't silently regress. This change is the first application; the
same rule applies to any future bridge coverage gap (materialization drops, round-trip loss, kind
mis-classification).
