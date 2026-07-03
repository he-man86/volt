## 1. Lock the gap in a failing test FIRST (regression-first)

- [ ] 1.1 Capture the ground truth: commit the real Execute-box PlcOpen XML from Bakon `Recipes.prg` as a
  C# test fixture under `packages/volt-bridge/test/Volt.Bridge.Tests/fixtures/` (an FBD network with a
  `<block typeName="EXECUTE">` carrying `fbdcalltype=execute` + an `<STCode>` body). Reference XML is saved
  in this change dir (`execute-box.reference.xml`).
- [ ] 1.2 Write a **failing** C# test: feed that XML through `PlcOpenReader` → `VgWriter` and assert the
  materialized VG CONTAINS the box's ST statements and does NOT contain a bare `EXECUTE()` call. This test
  is red until §2 lands and stays green forever after (the guard the user asked for).

## 2. Read + materialize the Execute box's ST

- [ ] 2.1 `PlcOpenReader`: when `CallType == "execute"`, read the sibling `stcode` addData; capture the ST
  text + the EN-input source onto the model (`Block.StCode` or an `ExecuteBox` node in `GraphModel.cs`).
- [ ] 2.2 `VgWriter`: render the box as its inline ST, EN-guarded (`IF <en> THEN <stcode> END_IF`) when EN is
  wired, else the raw statements — never `EXECUTE()`. §1.2 goes green.
- [ ] 2.3 `docs/vg-language.md`: document the Execute-box materialized form.

## 3. Round-trip decision (design.md) — no writable+lossy state

- [ ] 3.1 Choose (A) full round-trip or (B) read-only-first (recommended). Record the choice in design.md.
- [ ] 3.2 **If (B):** mark any body containing an Execute box read-only (reuse the CFC/SFC gate); add a C#
  test asserting a `push` of such a body is refused (never a lossy write-back).
- [ ] 3.3 **If (A):** `VgParser` + `PlcOpenWriter` reconstruct the `<block typeName="EXECUTE">` with the
  `stcode`/`fbdcalltype` addData; add a C# **round-trip** test (XML → VG → XML) asserting the STCode +
  wiring survive byte-for-byte-equivalent.

## 4. Re-harvest + re-baseline the corpus

- [ ] 4.1 Re-harvest `test-corpus/bakon-nano` (needs the fixed bridge + the project openable). `Recipes.prg`
  recovers its ST; the 2 `EXECUTE` `vg-undeclared-identifier` clear.
- [ ] 4.2 Re-baseline `real-corpus.test.ts` bakon-nano `totalDiags` (recovered ST may surface honest new
  refs) — tighten, document the delta in the changelog comment.

## 5. Land it

- [ ] 5.1 `packages/volt-bridge`: `bun run build:all` + `dotnet test test/Volt.Bridge.Tests/` green (incl. the
  new Execute-box tests). `packages/volt-lsp-iec`: `bun test` + `bun typecheck` green.
- [ ] 5.2 `openspec validate graphical-execute-box`; sync the `bridge-protocol` delta + archive when done.

## Note — general bridge-gap policy (user directive, 2026-07-03)

EVERY gap found in the bridge gets a committed regression test that fails before the fix and passes after,
so materialization/round-trip fidelity can't silently regress. This change is the first application; the
same rule applies to any future bridge coverage gap (materialization drops, round-trip loss, kind
mis-classification).
