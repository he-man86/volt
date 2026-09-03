# Close-out — superseded: PLCopen is not the write transport, on either vendor

Closed 2026-09-03, unfinished (21 of 28), because **its premise no longer describes the code.**

## What it assumed

The `## Why` opens on an asymmetry: a POU is READ through one PLCopen document, and WRITTEN through a different
mechanism — `WriteText` for the root, `CreateChild` + `WriteText` per child, then an orphan-removal walk. The
change proposed to close that gap by making the write side a PLCopen splice too, so read and write share one
document model.

The asymmetry was real and the diagnosis was right: every data-loss bug the bridge had did live at that seam.

## Why it is closed rather than finished

**Both halves of the premise are gone.** The read is no longer a PLCopen document either — `ICodeStore` speaks
`ItemContent`, and each driver reaches its own vendor's native form BELOW the seam (`pou-transport-per-vendor`,
archived alongside this). There is no `Volt.Engine/PlcOpen` layer to splice through. Unifying read and write
*on PLCopen* is now unifying them on a format neither side uses.

The seam it was worried about got fixed a different way, and the fix is stronger than the one proposed: the
document format stopped being a shared decision at all, so there is no longer a shared document for the two
paths to disagree about.

## Its open tasks, and where they went

All seven are TwinCAT verification steps for a splice that no longer exists (5.1b-orig "verify TwinCAT has a
move equivalent", 5.2 "children survive its round trip", 5.3 "the declaration lands, and by which
representation"). Every one of those questions has since been answered by live measurement on the path that
actually shipped, and recorded where it belongs — in `DIALECT.md`:

- the move primitive → **D4f** (both vendors implement `IProjectTree.Move`), and CODESYS's `ScriptObject.move`
- the child round trip → **D32**, measured directly: `ExportChild` does not see tree-node writes, which is why
  the TwinCAT member write orders the archive FIRST and the tree writes second
- the declaration's representation → the `InterfaceAsPlainText` findings, including that CODESYS exports a
  declaration TWICE and writing only the first is a silent no-op

Nothing in this folder is owed. The questions were better answered against the real path than they would have
been against the proposed one.
