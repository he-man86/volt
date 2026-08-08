## Why

A POU is **read** through one PLCopen document — declaration, body, methods, actions, properties, accessors, all
from a single export, on both vendors. It is **written** through a different mechanism entirely: `ide.WriteText`
for the root, then a `CreateChild` + `WriteText` per child, then an orphan-removal walk. PLCopen is used on the
write side only for graphical bodies.

That asymmetry is not cosmetic. Every data-loss bug this bridge has had lived at exactly that seam:

- a read-only graphical CHILD flattened, because the read said "graphical" and the write path decided from text
- a body spliced into the wrong element, because the read scoped by name and the write scoped by document order
- a property accessor created as a FUNCTION BLOCK named "Get", because accessors are a COM concept the write path
  had to model separately

Reading and writing the same item through the same representation removes the class, not just the instances.

**The blocker that stopped this before turned out not to exist.** The write path deliberately does not write
declarations, on the stated grounds that CODESYS "regenerates the interface from that typed block on import,
ignoring the plaintext copy". Measured live on 3.5.21.40, with the delete verified at each step:

| step | result |
|---|---|
| object actually removed before import | verified gone |
| declaration change landed | **yes** |
| **plaintext alone**, typed block left stale | **yes** |

CODESYS reads the declaration from `<InterfaceAsPlainText>` — plain ST, which is exactly what Volt already holds.
No ST→typed-XML generation is required. (Earlier probes said the opposite; they deleted the object but never
checked the delete took effect, so the import merged into a surviving object and preserved its declaration. A
body-landing control did not catch it, because a merge writes bodies too.)

## What Changes

`PushService` builds ONE PLCopen document for a POU and imports it, instead of writing the root and each child
separately. The document is produced by SPLICING the item's current export — not generated from scratch — so
everything Volt does not model (attributes, pragmas, object ids, vendor addData) survives untouched.

- Declaration → the item's `<InterfaceAsPlainText>`.
- Body → the item's `<body>`, textual or graphical (the graphical path already does this).
- Methods / actions / properties / accessors → the same elements the reader already parses.
- Child add / remove / rename becomes element add / remove / rename in the document, applied atomically by the
  single import, rather than N separate COM mutations that can half-apply.

**CODESYS first, TwinCAT second.** Not a permanent split — the document shape is common and the splice lives in
Core. CODESYS goes first because every piece already has live evidence there (plaintext declaration write, body
write, children surviving re-import with 4 methods / 8 properties / 3 actions element-counted, in-memory
transport). TwinCAT's import needs its own verification: its transport is a temp file, and it already answers
`E_FAIL` for DUT/GVL exports, so its POU import is not assumed to behave like its export.

**Not in scope:** DUT/GVL (TwinCAT cannot export them — measured, `E_FAIL`), non-source kinds (their export is a
valid but EMPTY envelope — 529 of 3000 objects on the corpus), and rename/move/delete of the ITEM itself, which
stay on the scripting API: PLCopen carries no rename, and while CODESYS's export CAN describe folder membership
(`bExportFolderStructure` emits a `projectstructure` block), it is emitted `handleUnknown="discard"` and the
import discards it — measured. Placement is therefore a scripting-API concern on both ends.

## Capabilities

### New Capabilities

- `pou-write-transport`: a POU is written through the same PLCopen document it is read through, and a write that
  cannot be expressed in that document fails rather than falling back to a second mechanism.

## Impact

- **Code:** `Volt.Engine/Sync/PushService`, `Volt.Engine/Graphical/PlcOpenDocument` (splice surface),
  `Volt.Engine/Workspace/Materializer` (shared child model), both drivers' `WriteXml`.
- **Risk: high, and it is the write path to a live PLC.** Every textual push becomes delete-then-reimport, a
  path today exercised only by the rare graphical push. Two failure modes are already known and must be tested
  first, not discovered: an import **relocates the POU to the project root** when the parent is not passed
  (observed live), and an import **flattens the POU's internal child folders** — the document can describe them
  but the import discards them, so placement is restored afterwards via the scripting API's `move`.
- **Gate:** offline suites, then live e2e on CODESYS, then live e2e on TwinCAT — plus a folder-preservation case
  that does not exist today.
