## Why

Three independent surveys plus five live probes say the same thing: **there is no "graphical code path". There is
one item pipeline with two data-driven axes, and the code currently spells them as forks.**

The strongest evidence is already in the tree. **The READ path is already unified** — `Materializer.VgBodyOf` is
one entry point with a three-arm switch on *language*, no boolean. The WRITE path does the same job with `pouVg`,
a boolean forking **nine** separate decisions across `PushService`. That asymmetry is residue, not design.

### What is actually irreducible

Not "graphical vs textual". Two things, both **data**:

1. **Document shape — per KIND.** Where members live in the XML: a POU's in `addData/data`, an interface's in
   `Methods`/`Properties`, a DUT/GVL has none.
2. **Body codec — per LANGUAGE.** `locate(body)`, `decode(element)→text`, `encode(text)→element`, `validate`,
   `canReplace`, `readOnly`. ST is the *identity* codec (four one-liners — both halves already exist as one-liners
   today); FBD/LD is the existing `VgParser`/`VgWriter` + `PlcOpenReader`/`PlcOpenWriter` pivoting on `GraphBody`;
   CFC/SFC is `{read: marker, write: none}` — which is what "read-only" *means*.

   **`locate` is load-bearing and was measured, after being inferred wrongly once.** PLCopen TC6 defines ST, IL,
   FBD, LD and **SFC** as body languages, so each is a direct `<body>` child whose element NAME is the language.
   **CFC alone is a CODESYS extension** and lives in `<body>/<addData>/<data name="…/cfc">` — with an empty `<ST>`
   sibling the schema still wants, which is exactly the decoy that made a direct-children scan report a CFC body
   as textual. So a codec owns its element's LOCATION, not just its name. Interfaces, DUTs and GVLs emit no
   `<body>` at all. Full table in `PlcOpen/DIALECT.md`.

`GraphicalCode.Validate`'s gates are not "checks ST lacks" — they are the codec laws `write(read(x)) == x` and
`decode(encode(g))` reaching a fixed point, which ST satisfies **by construction** because it is stored verbatim.
Only the leaf-fan-out guard is genuinely codec-specific (a TwinCAT importer precondition).

### Measured, not assumed

- **Every writable kind can travel in the document on CODESYS.** DUT, enum-DUT (pragmas preserved), GVL and
  INTERFACE all export with an `<InterfaceAsPlainText>`, and a merge lands a declaration change on each. An
  interface member ADDED to the document is created. The `WriteText` path for DUT/GVL/ITF is our limit, not the
  format's. (TwinCAT `E_FAIL`s on DUT/GVL export — that one *is* a vendor limit and stays gated.)
- **A declaration change lands on an FBD-bodied POU**, body intact, typed `<interface>` regenerated from the
  plaintext. So "graphical POUs own their declaration" is false, and today's silent discard is a bug.
- **An interface member in a folder IS exported** (the archived "ExportInterfaceXml skips folders" note is wrong)
  — but the folder is not, and the merge flattens it, exactly like POU child folders. Same `%FOLDER` + `Move` rule.

### The tangle, counted

One concept, many spellings — this is what "everything is still tangled" means concretely:

| concept | spellings |
|---|---|
| a POU with its children | **4** (`ParsedPou` → `PouData` → ST text → `StSplitResult`) |
| a POU member | **4 + an enum + int codes** — *property* is a child in two, a separate list in the third |
| body language | **5 encodings, 4 reconciling shims** |
| placement | **9 representations, 3 resolvers, 2 opposite transports** (top-level out-of-band, child in-band) |
| item kind | **3 authorities that can disagree** — the read path silently prefers ST text over the IDE's `KindCode` |
| "which kinds have a body" | **4 predicates** |
| "is this body writable?" | **2 full implementations + a third copy** |
| the canonical ST format | **4 owners** (emitter, parser, the LSP's own, and VG for the embedded sub-language) |

## What Changes

**One assembly still** (`netstandard2.0`, five `dist/` targets). Folders and namespaces.

```
src/Volt.Engine/
  Ide/          the vendor contract — unchanged in shape, THINNER (see below)
  Item/         ONE model both directions: ItemContent { Declaration, Body, Members }, Member, Accessor
  PlcOpen/      the document: PlcOpenDocument, PouReader, PouSplice, DocumentShape (NEW), DIALECT.md
  Body/         the codecs: IBodyCodec, StCodec, VgCodec, ReadOnlyCodec, Graph/, Vg/
  Text/         canonical ST: StWriter + StReader (the inverse pair, ONE owner)
  Sync/         services — PushService loses ~200 lines
  Workspace/    Materializer, ItemKind, FolderPath
```

- **`Item/`** kills the 4-way duplication. `ItemContent` replaces `PouData` + `StSplitResult` + (as the mapped
  form of) `ParsedPou`; `Member` replaces `ChildData` + `StChild` + `ParsedChild` + `ParsedProperty` — including
  folding *property* back in as a member, which removes the union `PouDocument.Splice` has to do today.
- **`Body/`** is `Graphical/` renamed to what it is, plus the codec interface. `pouVg` and all nine forks lose
  their referent; `GraphicalCode.Write` shrinks to the codec's `encode` + `canReplace`; `PouDocument.Splice`
  becomes THE splice, one line of which dispatches on language.
- **`DocumentShape`** makes "where do members live" a per-kind table, which is what lets DUT/GVL/ITF join.
- **`Text/`** gives the canonical ST format one owner instead of an emitter and a parser that are not quite
  inverse (five verified asymmetries).

### The drivers: THINNED, not rewritten

**I am recommending against the rewrite, on evidence.** The survey found: **zero C# tests execute a single line of
either driver package**; CODESYS reaches the IDE entirely through reflected *string literals*, so a rename has no
compiler check; and the only oracle is a live e2e run that is explicitly **not CI**. That is the worst possible
place to rewrite. What the drivers need is *less code*, not different code:

Move UP into Engine (where it becomes testable): the six descriptor renderers and `Unitize` (~135 lines of
**hashed wire bytes** with zero fixtures), diagnostic severity/line/column parsing, the build-success criterion,
the warn-once idiom (three copies), and the `Lookup`/`dirty` semantics that currently **differ per vendor**
(push name resolution is case-insensitive on one and case-sensitive on the other — untested either way).

Leave alone: `Reflection.FindType`, the dispatchers, `Unwrap`, the `GetObjectToRead`/`SetObject` transaction,
`AsExtended`, `Move`'s interface walk, `RotInstances`, `ComMessageFilter`, `TcPouReader`, and the TwinCAT
attach/recovery state machine — irreducible, hard-won, and the most dangerous thing in the repo to touch blind.

## Capabilities

### New Capabilities

- `one-item-pipeline`: an item's content is read and written through one model, one document layer and one
  language-keyed body codec, with no branch anywhere on "is this graphical".

## Impact

- **Risk: MEDIUM in Engine, and it is bounded by tests** (Engine 433 offline + a live e2e baseline of 99).
  **HIGH if the drivers were rewritten — which is why they are not.**
- **Defects this closes by construction** (each verified, each currently silent):
  1. A declaration edit on a graphical POU is **discarded**; the push reports "updated".
  2. Deleting a method from a graphical POU is **accepted and does nothing** — the orphan walk is skipped, on two
     stated reasons that are both false (`WriteXml` is a merge with no delete; the splitter *does* parse children
     regardless of body language).
  3. A POU with any CFC/SFC child **cannot be pushed at all**, even for an unrelated edit to its root body.
  4. A bare `GET` accessor is swallowed into the property declaration → the getter is **removed** on push.
  5. An IL body is refused by accident, in the wrong layer, with the wrong message.
- **Sequencing:** defects first (each with a red-before-green test), then `Item/`, then `Body/` + the codec, then
  the kinds, then the driver thinning. Every step holds Engine 433+ and live e2e 99/8/0.
- **NOT in scope:** TwinCAT's import (D1–D4 in `DIALECT.md`) — still unmeasured, still gates
  `WritesPouAsOneDocument`; and `%LANG`, which is referenced in test comments but **implemented nowhere** — it
  gets deleted from the docs, not implemented.
