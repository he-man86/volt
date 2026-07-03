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

## Non-goals

- Not touching the CFC/SFC read-only bodies (already correct).
- Not unifying vendor graphical handling — the reader lives in shared `Core`, so parity is automatic.
