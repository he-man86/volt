## Why

`Volt.Engine` is 58 files and ~7,850 lines across eight folders, and the folders record how the code was built
rather than what it is. Three growth rings, each measurable:

**1. Two folders are named after a dependency LEVEL, not a subject.** `Vocabulary/` and `Model/` both mean "level
0, depends on nothing". So `Model/GraphModel.cs` sits away from `Graph/`, which is the only thing that uses it —
the graph's data and the graph's behaviour are in different folders for a reason that has nothing to do with
graphs. `Vocabulary/ItemKind.cs` is 281 lines of real domain concept filed under its dependency order.

**2. `Text/`, `Graph/` and `Document/` are siblings, and two of them are children.** A body has a language; a
language has a codec — that is `BodyCodec`'s organising idea, and the layout contradicts it by re-splitting by
language *after* the code unified by language.

The proof is already in the tree. `Document` and `Graph` needed a cycle-breaker, and the file said so in its own
words: *"the pure half is reached from `Document.BodyCodec`, while this half needs `ICodeStore` and the PLCopen
document — so together they made `Graph` and `Document` depend on each other, invisibly, inside one assembly."*
A cycle-breaker between two peers means one of them is not a peer.

**3. `Sync/` mixes verbs with machinery.** `PushService` / `FetchService` / `RefsService` / `BuildService` are the
operations; `Hasher` / `Versioning` / `OpGuard` / `PushConflicts` / `ProjectSnapshot` are parts they are built
from. One folder, two kinds of thing.

### And a name that outlived its reason: VG

The FBD/LD textual form is called **network text** almost everywhere that matters — `NetworkText`,
`NetworkTextReader`, `NetworkTextWriter`, `NetworkCode`, `docs/network-text.md`. `volt-lsp-iec` agrees: 213
mentions of "network text" / "networkText" against 31 of "VG".

"VG" survives as an alias in test method names, fixture prefixes (`vg_*`), one e2e constant, prose — and, it
turned out, **three production identifiers**: `GraphRoundTrip.ToVg`, and the locals `childVg` / `pouVg`. (An
earlier draft of this document said there were none; that was measured with a `vg` grep that cannot see a
camelCase compound.) It is a second name for a thing that already has one, and a reader has to learn both to be
sure they are the same thing.

### The two questions that settles, and one it does not

**Should FBD and LD be separated?** No, and the code already argues it: `GraphReader.LowerLadder` lowers LD's
contacts and coils into **the same boolean node graph an FBD network uses**. One model, one text format, two
surface renderings. They diverge at exactly two places — one arm in the reader, one in the writer, both keyed on
`body.Language`. Separating them would duplicate the model and the text format in order to isolate two functions.

**What should the folder be called?** Not `Diagram/`. That word is *taken and means the opposite*:
`Languages.IsDiagram` is CFC and SFC — the bodies Volt **cannot** express as text — while `Languages.IsNetwork` is
FBD and LD. The distinction is load-bearing and documented at length. The name is `Network/`.

> **Folders are named for their subject; a body language's implementation lives under the body.**

## What Changes

```
Volt.Engine/
├─ Ide/          the contract with a live IDE + shared driver machinery      ~520
├─ Item/         what an item IS and where it sits in the tree               ~700
├─ Source/       an item's CONTENT — read and write, one owner per construct ~1300
│   └─ Body/     a body has a language; a language has a codec                ~635
│       ├─ St/       StReader / StWriter / Descriptor / CodeHelper            ~925
│       └─ Network/  FBD+LD: PLCopen XML ⇄ node graph ⇄ network text         ~2170
├─ Library/      library signatures (unchanged — already the right shape)     ~372
└─ Ops/          push / fetch / refs / build / materialize, + their machinery ~1250
```

`Vocabulary/` and `Model/` **dissolve into their subjects**: `ItemKind` and `FolderPath` to `Item/`, `Languages`
and `BodyMarker` to `Body/`, `Namespaces` to `Source/`, `GraphModel` next to the code that uses it, `LibSignature`
to `Library/`, `CodeHelper` to `Body/St/` (it parses an ST header line).

Dependency direction is a property of the code, not of a folder name. The layer ORDER is unchanged and still
enforced; only the labels move. `Library/` is untouched: it is the one folder already organised by subject rather
than by layer, and it is the one that reads cleanly — the pattern, not the exception.

### What this does NOT change

- **No behaviour, no test count.** A move that changes a test result is a bug in the move.
- **No assembly split.** `Volt.Engine` stays one `netstandard2.0` assembly (CODESYS's net48 host and net8 both
  load it).
- **No file renames in `WireVocabularyGuardTests`' exemption set.** It keys on bare FILENAMES, so moving is free
  and renaming breaks the build. Nothing here needs renaming.
- **No public API change** beyond namespaces.

## Impact

- 58 files move; every `namespace` and `using` line follows. Mechanical, and the compiler finds every miss.
- **`scripts/check-wiring.ts:263` hardcodes `src/Volt.Engine/Document/DIALECT.md`** — one line, and `bun run
  check` fails loudly if missed. It is the only path any tool hardcodes.
- `VendorParityGuardTests` keys on the directory `src/Volt.Engine`; everything stays inside it.
- No `.csproj` names a source file (verified: zero `Compile`/`EnableDefaultCompileItems` entries), so moves are
  free at the MSBuild level.

## Why now, before the splice

`splice-graphical-body` §3 lands squarely in `BodyCodec` and the graph pipeline — the two areas that move most.
Moving first means the splice is written in its final home; moving after means relocating code written the same
week, and rebasing a feature across a 58-file move.

The value is **legibility, not correctness**. No bug closes here and no edge case disappears; the dependency edges
are already enforced by guard tests. It is worth doing precisely because it is cheap and mechanical *now* and gets
more expensive with every feature landed on top.
