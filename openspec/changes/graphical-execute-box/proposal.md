## Why

The bridge silently **loses program logic** when materializing FBD/CFC bodies that contain a CODESYS
**"Execute" box** — the graphical element that embeds inline ST code inside a network (PlcOpen
`CallType=execute`, carrying its statements in an `<STCode>` addData element).

`PlcOpenReader` reads the box as an ordinary `Block` (typeName `EXECUTE`, CallType `execute`) but never
reads its `<STCode>`, so `VgWriter` renders it as a phantom call `LET g1 := EXECUTE()` and the entire ST
body is dropped. Found live in the Bakon Nano corpus: `Recipes.prg`'s Execute boxes hold the whole
recipe-command dispatch (`IF g_HMI_MachCommand.CMD.bNewRecipe THEN g_HMI_RCP_Parameters_Visu.nProductType
:= 0; …`) — **none of it survives materialization**. The LSP then correctly-but-uselessly flags `EXECUTE`
as undeclared (a symptom, not the disease).

This is a data-loss bug (bridge corrupts the round-trip), which the fork prioritizes over LSP false
positives: an AI or engineer reading the materialized `.prg` sees `EXECUTE()` where real logic should be,
and a `push` would write that phantom back, destroying the box.

## What Changes

- **Read the Execute box's ST.** `PlcOpenReader` extracts the `<STCode>` (and its EN/ENO wiring) from a
  `CallType=execute` block into the graph model.
- **Materialize it as real ST in VG.** `VgWriter` emits the box's statements inline (EN-guarded when it has
  an EN input) instead of a bogus `EXECUTE()` call — so the materialized body carries the actual logic the
  LSP analyzes and the AI reads.
- **Preserve round-trip fidelity.** Either (a) round-trip the Execute box through VG (parse the inline ST
  back into an Execute block on push), or (b) if full round-trip is deferred, mark a body containing an
  Execute box **read-only** (like CFC/SFC) so an edit can't silently drop the box — never leave it writable
  with lossy content. Decide in design.md.
- **Re-harvest the affected corpora** once fixed (bakon-nano `Recipes.prg` recovers its real ST; the
  `EXECUTE` vg-undeclared phantoms disappear and are replaced by genuinely-analyzed ST).
- **Parity note:** the Execute box is a CODESYS/TwinCAT-shared PlcOpen construct; the same reader change is
  vendor-neutral (it lives in `Volt.Bridge.Core`), so both bridges benefit.

## Capabilities

### Modified Capabilities
- `bridge-protocol`: the graphical FBD/LD round-trip SHALL preserve the ST content of Execute boxes rather
  than dropping it; a body it cannot yet round-trip losslessly SHALL be read-only, not lossy-writable.

## Impact

- **`packages/volt-bridge`** — `Graphical/PlcOpenReader.cs` (read `<STCode>`), `Graphical/GraphModel.cs`
  (carry it), `Graphical/Vg/VgWriter` (render inline ST), and on the write path `VgParser`/`PlcOpenWriter`
  (reconstruct the box) OR the read-only gate; C# round-trip tests in `test/Volt.Bridge.Tests`.
- **VG language** — `docs/vg-language.md` gains the Execute-box form; `vg-diagnostics.md` if applicable.
- **`packages/volt-lsp-iec`** — no code change; re-harvest `test-corpus/bakon-nano` and re-baseline the
  `real-corpus.test.ts` ratchet (the 2 `EXECUTE` vg-undeclared clear, real ST may surface new honest diags).
- No upstream seams (all fork-owned).
