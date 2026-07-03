# Design — Execute-box round-trip (ST-in-FBD/LD) via a first-class VG `EXECUTE` construct

## The bug, precisely (confirmed live 2026-07-03, Bakon Nano `Recipes.prg`)

A CODESYS **Execute box** is a STANDARD FBD/LD network element that runs inline ST. In PlcOpen it is a
`<block>` whose `fbdcalltype` addData is `execute`, carrying its statements in a sibling `stcode` addData:

```xml
<block typeName="EXECUTE">
  <inputVariables><variable formalParameter="EN">…</variable></inputVariables>
  <outputVariables><variable formalParameter="ENO">…</variable></outputVariables>
  <addData>
    <data name="…/fbdcalltype"><CallType>execute</CallType></data>
    <data name="…/stcode"><STCode>IF g_HMI_MachCommand.CMD.bNewRecipe THEN
        g_HMI_RCP_Parameters_Visu.nProductType := 0; … END_IF</STCode></data>
  </addData>
</block>
```

`PlcOpenReader.ReadCallType` read `fbdcalltype` (→ `Block.CallType = "execute"`) but nothing read the sibling
`stcode`. So the `Block` reached `VgWriter` with `TypeName="EXECUTE"` and no body, written as a lossy call
`IF en1 THEN LET g1 := EXECUTE(); END_IF`. The real ST — often the meat of the network — was gone.
`Recipes.prg` lost its entire recipe/machine-parameter command dispatch this way (two Execute boxes, ~60
lines of ST each). It is NOT library-blindness (the first misdiagnosis) — it is bridge data loss.

## The design: a first-class VG `EXECUTE` block (EN not special)

An Execute box is an EN/ENO block whose "call" is raw ST, so its enable reuses the EXISTING VG EN machinery —
a normal wire + `IF en THEN … END_IF`, identical to every other EnEno block — and the ONLY new token pair is
`EXECUTE … END_EXECUTE` around the VERBATIM ST:

```
NETWORK 1 FBD
  LET en1 := TRUE;              -- enable: a normal VG wire, same as any other block's EN
  IF en1 THEN
  EXECUTE                       -- the only new marker
  IF g_HMI_MachCommand.CMD.bNewRecipe THEN
    g_HMI_RCP_Parameters_Visu.nProductType := 0;   (* … *)
  END_IF
  END_EXECUTE
  END_IF
END_NETWORK
```

(A box with no EN gets a bare `EXECUTE … END_EXECUTE`.) The explicit `END_EXECUTE` delimiter — not "until
END_IF" — disambiguates the ST's own nested `END_IF`s. The ST is emitted/captured byte-for-byte so it
round-trips exactly.

Three layers:
1. **Bridge read** — `GraphModel.Block.StCode`; `PlcOpenReader.ReadStCode` reads the `stcode` addData;
   `VgWriter` renders the `EXECUTE` block (EN via the ordinary EnEno wire+IF).
2. **Bridge round-trip (push)** — `VgParser` captures the multi-line `EXECUTE`/`IF en THEN` construct into a
   `Block(TypeName=EXECUTE, CallType=execute, StCode, EN)`; `PlcOpenWriter` re-emits the `stcode` addData →
   reconstructs `<block typeName="EXECUTE">`. Gated by the existing strict `Validate` round-trip (VG→graph→VG
   fixed point + graph→PLCopen convergence). No push guard — Execute-box bodies are editable.
3. **LSP** — `src/vg/parser.ts` recognizes + CONSUMES the `EXECUTE` block so its complex ST (nested `IF`,
   comments, multi-statement) isn't fed to the simplified VG statement grammar (which VG_PARSEs on it). The ST
   reads as-is and produces no spurious VG diagnostics.

## Round-trip verification (2026-07-03 — live, through real CODESYS)

Verified end-to-end on the CodesysTestProject copy (headless), not just the offline unit tests:
- Push `IF en1 THEN EXECUTE IF bRun THEN iResult := 40 + 2; (* the answer *) END_IF END_EXECUTE END_IF` →
  CODESYS **creates a real Execute box** (accepted) → fetch back → the ST, its comment, and the EN wire are
  all preserved. A stable round-trip through a real IDE import/export.
- Push still works after all the recent fetch additions (user caution): basic ST (`F_RoundTrip`) and
  graphical FBD (`FB_Fbd`) both create + read back cleanly.
- Offline C# round-trip test (`GraphicalCodeTests`): PLCopen XML → VG → graph → PLCopen XML preserves the
  STCode and rebuilds `typeName="EXECUTE"`; a write-path test reconstructs the box from canonical VG.

## Corpus impact (delivered)

`bakon-nano/Recipes.prg` now shows the real recipe/machine-parameter ST inside `EXECUTE … END_EXECUTE`
(comments and nested `IF`s intact) instead of the lossy `EXECUTE()`. LSP diagnostics: `VG_PARSE` 8→0,
`vg-undeclared` 2→0; `real-corpus.test.ts` bakon-nano back to **275** (all library-blind
`unresolved-identifier`).

## Sweep result (2026-07-03 — bakon-nano, raw bridge vs materialized corpus)

Swept the whole project for OTHER bridge gaps before fixing, via a live raw-vs-materialized diff (`/debug`
tree + `/debug?xml=1` all POU bodies, against the harvested corpus). The Execute box is the **only** gap:
- **Classification correct** — the 9 items the coarse `/debug` `ide.KindCode` calls `function_block` are
  materialized by `/fetch` per their real declaration keyword (`FUNCTION`→`.fun`, `PROGRAM`→`.prg`); no
  mis-classification in the corpus.
- **No dropped items** — 76 raw POU bodies = 76 corpus POU files. The 7 harvest "skips" are legit non-source
  (2 visualizations + 1 visualization manager + 4 unclassifiable/hidden).
- **Tiny graphical surface** — 75 of 76 bodies are ST (lossless ST→ST); Recipes.fbd is the only graphical
  body, its 2 Execute boxes the entire gap. Project-wide `CallType`: execute×2, functionblock×3, function×3,
  operator×1 — all in Recipes; every other block type materializes fine.
- **No whole-network drop** — all 9 Recipes blocks materialize as networks; the "missing NETWORK 9" is a
  CODESYS label gap (non-contiguous numbering preserved), not a drop.
- **No methods/actions to drop** — the project has 0 (its 27 FBs are method-less).

## Separate observation (out of scope) — graphical fetch-vs-push version non-determinism

While verifying push, a graphical body's version differed between the fetch path (`c002…`) and the push-side
`WalkItems` recompute (`b025…`) — a pre-existing CODESYS graphical read/checkout non-determinism (a normal ST
item pushes cleanly with a matching version). It's harmless for a stable round-trip that re-fetches, but
would surface as a spurious conflict on an editable FBD/LD push. Not caused by this change — a candidate for
its own investigation + regression test (per the bridge-gap-tests policy).

## Non-goals / follow-up

- **Follow-up:** full ST-ANALYSIS inside the `EXECUTE` block in the LSP (go-to-definition, references,
  diagnostics on the box's ST). Today the block reads cleanly but its body isn't navigated/checked.
- Not touching CFC/SFC read-only bodies (already correct).
- Not unifying vendor graphical handling — the reader/writer live in shared `Core`, so parity is automatic.
