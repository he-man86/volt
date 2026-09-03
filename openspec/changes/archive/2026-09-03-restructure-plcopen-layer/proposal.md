## Why

PLCopen XML used to be **one of several ways** to move code in and out of the IDE, and the one used only for
graphical bodies. That is why every PLCopen type lives in a namespace called `Volt.Engine.Graphical`.

It is no longer true. A POU's entire content — declaration, body, methods, actions, properties, accessors — is
**read** through one PLCopen document and, since `pou-writes-via-plcopen` §3.1, **written** through one too.
Graphical bodies are now a *consumer* of that document, not its reason for existing.

The layout still encodes the old model, and it costs:

- `Sync/PouDocument.cs` and `Workspace/Materializer.cs` must write `using Volt.Engine.Graphical;` to do plain ST
  declaration and method work. `PlcOpenPouParser` has **zero dependencies on anything** and is graphical-free.
- `ICodeStore` still labels its PLCopen section *"Transport 2: PLCopen XML (graphical FBD/LD/CFC/SFC)"*. It is the
  primary read transport for every POU kind, textual included.
- `PlcOpenDocument.cs` is four unrelated tenants in one 616-line file: whole-POU read helpers, the whole-POU write
  splice, the FBD/LD body splice (which carries VG *editor-capability* policy), and `InstanceTypes` — a regex over
  ST declaration text that never parses XML at all. The write splice and the body splice share exactly one
  primitive and have no other contact.
- Two dependencies point the wrong way out of that file: document code reaches **down** into the graph model
  (`GraphConstants.NetworkStride`) and **up** into Workspace policy (`ItemKind.Kinds.Method/Action/Property`).
  `WireVocabularyGuardTests` already noticed the second and allowlisted it rather than fixing it.

### The organising principle the code has grown into

The read path and the write path independently arrived at the same shape, and it is not "graphical vs textual":

> **Content travels as ONE PLCopen document. Structure — placement, folders, rename — travels on the scripting API.**

On read, `Materializer` gets a POU's content from one export but needs a separate COM walk (`BuildFolderMap`) for
child folders, because PLCopen carries no folder membership. On write, `PushService` imports one document and then
needs `RestoreChildFolders` for exactly the same reason. That symmetry is the axis the code should be filed on.

### And the two dialects

A four-way census of every CODESYS↔TwinCAT difference in this path (see `dialect-census.md`) reaches a conclusion
that decides the design:

- **The read path is genuinely a union** — 16 of the divergences are absorbed by one tolerant reader, and the two
  real read defects (§6 CFC placement, §5.4 LD-as-FBD) are **missing tolerance, not missing vendor branches**.
- **The write path is not a union, and already says so.** Its one deep divergence is the import mode — CODESYS
  merges in place (`ConflictResolve.Replace`, no delete), TwinCAT's `PlcOpenImport` *adds* and fails on a name
  collision, so it must delete first. That difference already lives in the right place: two `WriteXml`
  implementations below the vendor seam. Nothing in Core branches on a vendor, and nothing should start.

So the structure copes with two dialects by **evidence, not indirection**. The census's largest finding is that
**16 facts have never been measured on the other vendor at all** — including TwinCAT's entire POU member shape:
`<Method>`, `<Property>`, `<GetAccessor>` and `<SetAccessor>` appear **zero times** in all six recorded TwinCAT
fixtures. `AddChild` and `SetAccessor` build to the CODESYS shape and have never met a TwinCAT import. A dialect
class hierarchy would not have caught that; a two-vendor fixture matrix does.

## What Changes

**One assembly, folders and namespaces only.** `Volt.Engine` targets `netstandard2.0` so it loads in both CODESYS's
net48 IronPython host and net8, and it is copied to five `dist/` targets. A new project must match both — so
splitting assemblies is explicitly out of scope.

### 1. A `Volt.Engine.PlcOpen` namespace, holding only document concerns

| New | From | Contents |
|---|---|---|
| `PlcOpen/PlcOpenDocument.cs` | the shared privates of today's file | `OwnerOf`, `ItemBody`, `OwnDescendants`, `Serialize` — the document primitives, now `internal` to the namespace |
| `PlcOpen/PouReader.cs` | `Graphical/PlcOpenPouParser.cs` | the whole-POU read (already dependency-free) |
| `PlcOpen/PouSplice.cs` | `PlcOpenDocument` group B | `SetDeclaration`, `SetTextualBody`, `AddChild`, `RemoveChild`, `SetChildText`, `SetAccessor` |

`Sync/PouDocument.cs` stays in `Sync`: it composes the splice from a pushed `StSplitResult` and is policy, not
document. That placement is what keeps `ItemKind` out of `PlcOpen/`.

### 2. `Graphical/` keeps the graph, and gains the body splice that was always its own

`GraphModel`, `Vg/VgParser`, `Vg/VgWriter`, `FbdOperators`, `VgBody`, `PlcOpenReader`, `PlcOpenWriter`,
`GraphicalCode`, `GraphicalRoundTrip` stay. `SpliceFbdLdBody` and its private support (`ValidateExisting`,
`SafeToDrop`, `HasPinMod`, `FindFbdLd`) move **in** to `Graphical/GraphicalBodySplice.cs` — they encode VG editor
capability, they have one caller (`GraphicalCode`), and moving them makes the `GraphConstants` edge point the right
way by construction.

**The graph converters are NOT split.** Six test suites assert `PlcOpenReader` + `PlcOpenWriter` + `VgParser` +
`VgWriter` in a single round-trip expression; separating them behind visibility boundaries forces those into
per-leg assertions, which is exactly how "round-trips losslessly **or is refused**" gets quietly weakened.

### 3. Both wrong-direction dependencies deleted

- `AddChild` takes a PlcOpen-native member kind, not `ItemKind.Kinds.*`; `Sync/PouDocument` does the mapping. This
  removes `PlcOpenDocument.cs` from the `WireVocabularyGuardTests` exemption set rather than re-adding it under new
  filenames.
- `GraphConstants.NetworkStride` is reached only from `ValidateExisting`, which moves to `Graphical/`.

### 4. `InstanceTypes` → `Workspace/SourceText`

It is a regex over ST declaration text. It belongs where ST text parsing lives, next to `StSplitter`.

### 5. Dead surfaces deleted

`ICodeStore.ReadImplementation` (zero production call sites — deletable independently of any of this),
`PlcOpenDocument.OwnDescendant` (singular; no callers since the two-copy fix).

### 6. The dialect made checkable instead of prose

- `PlcOpen/DIALECT.md` — the census's A/B/C/D table, as the one place vendor facts live, replacing ~20 scattered
  doc-comments. Each entry cites the fixture that proves it, or is marked **UNMEASURED**.
- **A two-vendor fixture matrix.** `PlcOpenSpliceTests` runs 29 tests against 1 CODESYS + 1 TwinCAT fixture, and
  `AddChild`/`SetAccessor`/property-add are CODESYS-only *because no TwinCAT fixture in the repo contains a method,
  a property or an accessor*. Recording one TwinCAT FB with a method + property + both accessors is the single
  highest-value item in this change, and it is a recording task, not a code task.
- **The pre-agreed extension point, deliberately NOT built:** if §5 measurement shows TwinCAT needs a different
  *written* shape, the seam is one dialect parameter consumed by `AddChild` and `SetAccessor` — the only two
  members that CREATE vendor-shaped elements. Everything else is read-tolerant or vendor-neutral. Naming it now
  costs nothing; building it before the measurement would be the fourth time this programme designed against an
  unmeasured vendor.

### 7. Six false comments corrected

Convention 8 says a false comment is a defect. The census found six, including `ARCHITECTURE.md:135-136` citing
`PlcOpenDocument.InterfacePropertyAccessors` — **a member that does not exist**.

## Capabilities

### New Capabilities

- `plcopen-document-layer`: PLCopen is a first-class content transport with its own namespace, depending on
  neither the graph model nor Workspace policy; graphical bodies consume it rather than owning it.

## Impact

- **Code:** 49 files, ~86% mechanical. Zero build-tooling coupling (all `.csproj` use default globbing). Zero files
  outside `packages/volt-cli` — `volt-lsp-iec` and `volt-vscode` couple only to the VG **text format** and their own
  TypeScript `VgBody`, never to a C# type name.
- **Docs:** `ARCHITECTURE.md` (the `Graphical/` layer row is the real design statement, plus `:180` still says
  `Core.Graphical` — a previous rename already missed it), `docs/vg-language.md` §13 (five literal paths),
  `docs/vg-diagnostics.md`, root `CLAUDE.md`. `openspec/changes/archive/` is left alone — rewriting it would
  falsify the record.
- **Risk: low for the move, and it is deliberately separated from the two behaviour changes below.** The rename is
  compiler-verified and covered by 150+ existing tests. The judgement is concentrated in three places:
  splitting `PlcOpenDocument.cs` (76 test references), the `WireVocabularyGuardTests` filename list, and the
  `VgBody.Is` negative contract that three files describe only in prose.
- **NOT in scope, and each needs its own change:** extending the single-document write to *create* and *move*
  (today they still issue a COM call per child); §5 TwinCAT measurement; the three defects below.

## Defects found while surveying — sequenced BEFORE the move, not bundled into it

These are behaviour bugs. A rename commit must not hide a behaviour fix.

1. **A CODESYS CFC body classifies as TEXTUAL.** *Verified by reading the code against a recorded export.*
   `PouReader.LangIn` and `GraphicalBodyLang` scan only **direct children** of `<body>`, but CODESYS nests a CFC
   body as `<body><ST/><addData><data name=".../cfc"><CFC>`. So `LangIn` finds the `<ST>` first and answers `"ST"`,
   `GraphicalBodyLang` answers `null`, and the read-only-CFC refusal cannot fire from that signal. The existing
   `PouDocumentTests` CFC case passes **only because** the guard does not throw. Consequence: a CFC child
   materializes as an empty ST body instead of the graphical marker, so the workspace and the IDE silently
   disagree. Fix is added tolerance plus a regression test over the recorded `FB_GraphicalChild` fixture.
2. **The LD-as-FBD read override is dead code.** `PlcOpenReader.ReadBody`'s `language` override exists so a TwinCAT
   empty-LD body (exported inside `<FBD>`) reads as LD, but the production path passes the element's own name;
   only the test-only `GraphicalCode.Read` passes the COM language. Either thread it through `Materializer` or
   delete it — today it is documented as handling a case it does not reach.
3. **An LD network `<comment>` is silently deleted on push.** The reader folds it in, `SafeToDrop` lets the splice
   remove it, and `WriteLadderBody` never re-emits it (unlike `WriteFbdBody`).
