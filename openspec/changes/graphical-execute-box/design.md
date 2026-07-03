# Design — FBD/CFC Execute-box support in the graphical round-trip

## The bug, precisely (confirmed live 2026-07-03, Bakon Nano `Recipes.prg`)

A CODESYS **Execute box** is an FBD/CFC network element that runs inline ST. In PlcOpen it is a `<block>`:

```xml
<block localId="…" typeName="EXECUTE">
  <inputVariables><variable formalParameter="EN">…</variable></inputVariables>
  <outputVariables><variable formalParameter="ENO">…</variable></outputVariables>
  <addData>
    <data name="…/fbdcalltype"><CallType>execute</CallType></data>
    <data name="…/stcode"><STCode>IF g_HMI_MachCommand.CMD.bNewRecipe THEN
        g_HMI_RCP_Parameters_Visu.nProductType := 0; … END_IF</STCode></data>
  </addData>
</block>
```

`PlcOpenReader.ReadCallType` reads `fbdcalltype` (→ `Block.CallType = "execute"`) but nothing reads the
sibling `stcode` addData. So the `Block` reaches `VgWriter` with `TypeName="EXECUTE"` and no body, and is
written as a call: `IF en1 THEN LET g1 := EXECUTE(); END_IF`. The real ST — often the meat of the network —
is gone. `Recipes.prg` lost its entire recipe/machine-parameter command dispatch this way (two Execute
boxes, ~60 lines of ST each).

## What "cover it" means

1. **Read** (`PlcOpenReader`): when `CallType == "execute"`, capture the `<STCode>` text onto the model
   (extend `Block` with an optional `StCode` string, or a dedicated `ExecuteBox` model node). Keep the EN
   input / ENO output wiring so the guard is reconstructable.
2. **Model** (`GraphModel.cs`): carry the ST text (+ EN source) through to the VG writer.
3. **Write to VG** (`VgWriter`): emit the box as its inline ST, EN-guarded when an EN input is wired:
   `IF <en> THEN <stcode> END_IF` (or the raw `<stcode>` when EN is the constant TRUE / unwired). The
   statements are the box's own — no phantom `EXECUTE()`.

## The round-trip decision (pick one in tasks)

VG is a **round-trip** language (edit → `push` → PlcOpen). Two options:

- **(A) Full round-trip.** `VgParser` recognizes the inline-ST-in-a-network form and `PlcOpenWriter`
  reconstructs the `<block typeName="EXECUTE">` with the `stcode`/`fbdcalltype` addData. Strongest, but the
  VG grammar must unambiguously distinguish "an Execute box's ST" from ordinary VG `LET`/statement wires.
- **(B) Read-only-first (recommended interim).** Materialize the ST (so nothing is lost / the LSP analyzes
  it) but mark any body containing an Execute box **read-only** — the same treatment CFC/SFC already get —
  so `push` refuses it rather than writing back a lossy reconstruction. Ship (B), then upgrade to (A) if
  editable Execute-box bodies are needed. **Never** the current third state: writable + lossy.

Recommendation: **(B)** — it stops the data loss immediately and is low-risk, aligning with the existing
read-only-graphical gate. Full round-trip (A) is a follow-up only if the product needs to edit these bodies.

## Corpus impact

`bakon-nano/Recipes.prg` currently holds the corrupted output (2 `EXECUTE()` phantoms, dropped ST). After
the fix, re-harvest: the ST returns, the 2 `vg-undeclared-identifier` clear, and the recovered code may
surface *honest* new diagnostics (real references in the recipe dispatch) — re-baseline the ratchet then.
Until fixed, the corpus documents the bug (a useful regression witness).

## Sweep result (2026-07-03 — bakon-nano, raw bridge vs materialized corpus)

Swept the whole project for OTHER bridge gaps before fixing, via a live raw-vs-materialized diff (`/debug`
tree + `/debug?xml=1` all POU bodies, against the harvested corpus). Findings — the Execute box is the **only**
gap:
- **Classification: correct.** The 9 items the coarse `/debug` `ide.KindCode` calls `function_block` are
  materialized by `/fetch` per their real declaration keyword (`FUNCTION`→`.fun`, `PROGRAM`→`.prg`) — the
  fetch path refines by declaration; no mis-classification in the corpus.
- **No dropped items.** 76 raw POU bodies = 76 corpus POU files (37 prg + 21 fun + 18 fb). The 7 harvest
  "skips" are all legit non-source (2 visualizations + 1 visualization manager + 4 unclassifiable/hidden).
- **Graphical surface is tiny.** 75 of 76 bodies are ST (lossless ST→ST); **Recipes.fbd is the only graphical
  body**, and its 2 Execute boxes are the entire gap. `CallType` values seen project-wide: execute×2,
  functionblock×3, function×3, operator×1 — all in Recipes, all other block types materialize fine.
- **No whole-network drop.** All 9 Recipes blocks materialize as networks; the "missing NETWORK 9" is a
  CODESYS label gap (non-contiguous network numbering preserved faithfully), not a bridge drop.
- **No methods/actions to drop.** The project has 0 (its 27 FBs are method-less) — corpus and live tree agree.

So this change closes the complete set of bakon bridge gaps. (A reusable raw-vs-materialized fidelity sweep
would guard future gaps, but it needs a live bridge — a diagnostic script, not a hermetic CI test.)

## Round-trip verification (2026-07-03 — live, against the Bakon project)

Confirmed the read-only-first behavior end-to-end through the real bridge (bakon copy, headless), not just
the offline unit tests:
- **Pull:** `Recipes.prg` materializes as the `(* @volt-graphical: FBD *)` marker — no phantom `EXECUTE()`.
- **Push (fetch version):** refused. Note it is refused by a *version conflict*, because a graphical body's
  version differs between the fetch path (`c002…`) and the push-side `WalkItems` recompute (`b025…`) — a
  pre-existing graphical read/checkout non-determinism (a normal ST item pushes cleanly with a matching
  version). Harmless here: for a read-only body, push-always-refused is the desired outcome.
- **Push (matching version):** reaches `GraphicalCode.Write` and my explicit guard fires with the clear
  message *"this body contains an Execute box (inline ST) and is read-only — edit it in the IDE, not via
  push."* So the guard is a real, live-exercised backstop, not just unit-tested.

**Separate observation (out of scope, worth a look):** the graphical fetch-vs-push version discrepancy
violates the Versioning "all three agree on a version" invariant *for graphical bodies* (ST is fine). It's
harmless for read-only bodies, but would break legitimate pushes of an EDITABLE FBD/LD body — a candidate
for its own investigation + regression test (per the bridge-gap-tests policy). Not caused by this change
(the non-determinism is in the CODESYS graphical read, which predates it).

**On a committed live fixture:** `CodesysTestProject` (the headless fixture) has no Execute box and one
can't be added via push (VG cannot express it), so an Execute-box *round-trip* e2e test would need an
IDE-authored fixture project. The offline `GraphicalCodeTests` (red→green) are the durable guard for now.

## Non-goals

- Not touching the CFC/SFC read-only bodies (already correct).
- Not unifying vendor graphical handling — the reader lives in shared `Core`, so parity is automatic.
