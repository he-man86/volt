# The XML write path — every generator, and every duplicate

Companion to `body-census.md`, which censuses what the graphical **body** loses. This one censuses **where XML is
written at all**, because the graphical body turned out not to be a special case so much as the last surviving
instance of a pattern. Paths are relative to `packages/volt-cli/`.

Line counts are `wc -l`. "R" = regenerates the element from a model. "S" = edits the stored element in place.

---

## 1. Every production file that constructs, edits or serializes XML

Measured by `grep -rn "using System.Xml" src` — **14 hits, and they are all below**. No string-concatenated XML
exists anywhere in `src` (searched for `"<?xml`, `Append("<`, `+ "<`: zero code hits, every match is doc-comment
prose).

### `src/Volt.Engine/Document/` — namespace `Volt.Engine.Document`, `netstandard2.0`

| File | LOC | Writes | How | R/S | Production callers |
|---|---|---|---|---|---|
| `PouSplice.cs` | 494 | root declaration; root body; child member elements; accessor elements; child removal | `XDocument.Parse` then in-place `ReplaceNodes`/`Remove`/`AddBeforeSelf`; `new XElement` for member creation (`:203-218`, `:246-303`, `:341`) | **both** — S for decl/body/child-update, **R for `AddChild`** and for a new accessor | `PouDocument.cs:55,90,107,108,113,114,117,118` — sole caller |
| `BodyCodec.cs` | 219 | the one body-language element (`<ST>`, `<FBD>`, `<LD>`) | ST patches `<xhtml>` in place (`:148-157`); FBD/LD builds via `GraphWriter.WriteBody` then `existing.ReplaceWith` (`:194`) | ST = **S**, FBD/LD = **R** | `PouSplice` x7, `PouReader.cs:145`, `Materializer.cs:147`, `BodyFormatGuard.cs:30` |
| `ProjectStructure.cs` | 126 | the `<ProjectStructure>` object list; mints and stamps `ObjectId` | `entry.ReplaceNodes(wanted)` (`:78`); `SetAttributeValue` (`:103`) | R for children, S for ids | `PouDocument.cs:125` — sole caller |
| `GraphSplice.cs` | 157 | an `<FBD>`/`<LD>` element into a `<body>` | `existing.ReplaceWith(newBody)` (`:51`) | S | **`SpliceFbdLdBody` has ZERO production callers** — §3.1 |
| `PlcOpenDocument.cs` | 151 | nothing; owns `Serialize` (`:46-47`) and the write-side scoping helpers | LINQ-to-XML | n/a | `PouSplice` x8, `ProjectStructure`, `GraphSplice`, `PouReader.cs:80` |
| `PouDocument.cs` | 139 | **nothing — string in, string out.** No `using System.Xml.Linq` | orchestrates 7 `PouSplice` calls, each re-parsing | n/a | `PushService.cs:350,363` |
| `BodyElement.cs` | 49 | read-only; the ONE shared body-element scan | LINQ | n/a | `BodyCodec.cs:46`, `PouReader.cs:191` |

### `src/Volt.Engine/Graph/` — namespace `Volt.Engine.Graph`

| File | LOC | Writes | R/S | Callers |
|---|---|---|---|---|
| `GraphWriter.cs` | 506 | the complete `<FBD>`/`<LD>` body | **R** — total regeneration; only `OpaqueNode` survives, re-parsed from a stored string (`:107`) | `BodyCodec.cs:187` |
| `GraphReader.cs` | 381 | read-only, but **serializes** at `:284` — captures unmodelled elements as a string | n/a | `NetworkCode.cs:23` |
| `NetworkTextWriter.cs` / `NetworkTextReader.cs` | 317 / 579 | **no XML** — graph to text only | n/a | — |

### Vendor drivers

| File | TFM | Writes | Note |
|---|---|---|---|
| `src/Volt.Cli.Ide.Twincat/Ide/TcItemArchive.cs` | net8.0-windows | vendor `.TcPOU` XML inside a zip: `FolderPath` attribute (`:180`), `<Folder Name= Id={guid}>` chains (`:198-200`), and zip ENTRY names (`:112-129`) | S. **Re-serializes by hand at `:183` — a byte-identical open-coded copy of `PlcOpenDocument.Serialize`** (§3.5) |
| `src/Volt.Cli.Ide.Codesys/Ide/CodesysObjectModel.PlcOpen.cs` | net48 | **no XML API** — reflection transport only | strips the BOM at `:87` |

### Assemblies with zero XML code

`Volt.Cli`, `Volt.Contracts`, `Volt.Wire`, `Volt.Engine.Host`, `Volt.Cli.Connector*`. Verified.

---

## 2. Does read live with write?

| Construct | Read | Write | Together? |
|---|---|---|---|
| Body element per language | `BodyCodec.Decode` | `BodyCodec.Encode` | **YES — one class, one type per language.** The best-factored pair in the layer, and the model the rest should follow. |
| Body element LOCATION | `BodyElement.Of` | same | **YES, deliberately.** `BodyElement.cs:10-16` records that splitting this scan caused silent diagram loss. |
| Whole POU document | `PouReader.cs` (239) | `PouSplice.cs` (494) | same folder, different classes |
| FBD/LD graph to XML | `GraphReader.cs` | `GraphWriter.cs` | same folder, separate files, held apart deliberately |
| **Declaration** | **three readers** | **four writers** | **NO — apart, and they disagree.** §3.2 |

---

## 3. The duplicates

### 3.1 A dead parallel graphical pipeline — `GraphSplice.SpliceFbdLdBody`

Verified by exhaustive grep: **16 references, 15 of them tests plus its own definition.** `GraphSpliceTests.cs`
(12 call sites) and `TestPlcOpen.cs:33`. Nothing in `src` calls it.

It does the same job as the live path by the same means:

| `GraphSplice` | `BodyCodec.NetworkCodec` |
|---|---|
| `:51` `existing.ReplaceWith(newBody)` | `:194` `existing.ReplaceWith(replacement)` |
| `:128-129` `pouBody.RemoveNodes(); pouBody.Add(newBody);` | `:191` `body.RemoveNodes(); body.Add(replacement);` |
| `:155` `.Elements().FirstOrDefault(Languages.IsNetwork)` — direct children only | `:178-179` `Locate(body) ?? ...FirstOrDefault(Languages.IsNetwork)` — **`BodyElement`-aware, nested-wins** |

Of its 157 lines, only `RequireReplaceable` (`:67`) into `ValidateExisting` (`:69-118`) plus `SafeToDrop` (`:140`)
and `HasPinMod` (`:146`) — about 60 lines — is production-live, reached from `BodyCodec.cs:192`. The remaining ~97
lines are the silo. **Keep `BodyCodec`'s**: it is the one on the production path and the one whose element scan is
`BodyElement`-aware — and `BodyElement.cs:10-16` documents that a non-shared scan is exactly how a diagram gets
destroyed.

The file's own doc-comment (`GraphSplice.cs:12-15`) still says it *"belongs with the graph, not with the document"*.
It is in `src/Volt.Engine/Document/`, namespace `Volt.Engine.Document`. The comment is false (convention 8).

### 3.2 Declaration writing — four paths, three containment rules, and they diverge

**There is no graphical fork in any of them.** The declaration path is already language-blind. It is fragmented by
**member position** instead.

| # | Path | Cite | Element selection | Copies written | Absent block |
|---|---|---|---|---|---|
| W1 | root POU / ITF / DUT / GVL | `PouSplice.cs:38-62` | `OwnDescendants(owner, "InterfaceAsPlainText")` | **ALL** (`:50`) | **THROWS** (`:44-46`) |
| W2 | child update | `PouSplice.cs:450-463` | same | **ALL** (`:458`) | **THROWS** (`:455-457`) |
| W3 | child create | `PouSplice.cs:269` | constructs | ONE | n/a |
| W4 | **property accessor** | `PouSplice.cs:402-415` | `acc.Elements().FirstOrDefault(...)` — **direct children, FIRST only** | **ONE** | **CREATES** |

W1 and W2 have byte-identical bodies. W4 diverges on all three axes, and the first-only rule is the exact shape
`PlcOpenDocument.cs:53-58` documents as a silent no-op:

> once a POU declares any variable, CODESYS exports its declaration TWICE... Taking the FIRST wrote to the nested
> copy while the IDE kept reading the other.

Confirmed for CODESYS by `DIALECT.md:63` (row **A7**) with two fixtures. **Whether an accessor with a declared VAR
gets two copies is UNMEASURED** — checked every recorded fixture carrying an accessor (`codesys-pou/BoxFB`,
`codesys-itf/IModuleManager`, `codesys-itf/ITF_FolderedMember`, `tc-pou/FB_TcMembers`,
`tc-pou/FB_TcFolderedMember`): every accessor carries exactly ONE `<InterfaceAsPlainText>` and **none declares a
variable**. The case A7 describes has never been exercised on an accessor. See **U21**.

**And read and write answer the same question from two different lists:**

| | predicate | comparison | excludes |
|---|---|---|---|
| write | `PlcOpenDocument.OwnDescendants` (`:63-64`) | **case-sensitive** alternation | `pou`, `Method`, `method`, `Action`, `action`, `Property`, `property`, `GetAccessor`, `SetAccessor` |
| read | `PouReader.ChildDeclContainers` (`:223-225`) | **`OrdinalIgnoreCase`** | the same, **plus `get` and `set`** |

Whether any vendor emits `<get>`/`<set>` is UNMEASURED (no fixture has them). See **U22**.

A **third** read rule exists: `PlcOpenDocument.DeclFromExport` (`:135`) takes the first `InterfaceAsPlainText` in
the whole subtree with **no child filter at all**. `MaterializerChildDeclTests.cs:12,23` names it as a known trap.
It is production-dead — its only non-test caller is `NetworkCodeIo.cs:62`, itself a documented test seam
(`NetworkCodeIo.cs:27-34`).

### 3.3 Body writing — one dispatch, four call sites, three different guards

The language branch is **one mechanism**, `BodyCodec.For`, and `PouSplice.cs:469-476` records that unifying it was
deliberate: *"The SAME dispatch the ROOT body uses — not a second, stricter rule. A child was held to 'ST or
refuse' long after the root learned to encode editable graphical bodies."* But the **guards around it** were not
unified:

| Site | Cite | Guard |
|---|---|---|
| B1 root body | `SetBody:87` | `:92-146` — 5 checks: unsupported-present, marker-over-writable, unmodelled-language, language-mismatch, `establishing` exemption |
| B2 **child create** | `AddChild:216` | **none at all** |
| B3 accessor | `SetAccessor:376` | `:377-399` — 2 checks. No unmodelled-language check, no `establishing` |
| B4 child update | `SetChildText:477` | `:478-488` — 2 checks. No unmodelled-language check, **and throws unconditionally on a marker** |

B1/B3/B4 share a literal prologue (`:92-93`, `:377-378`, `:478-479`) and then diverge. **B1 and B4 give different
answers for the same input**: a restated CFC marker is a no-op at the root (`SetBody:107`) and a throw for a child
(`SetChildText:480-483`) — while `SetBody:103-106` documents the asymmetry in the *other* direction as a fixed bug
and says *"Nothing justified the asymmetry"*.

**Keep B1's.** It is the only one with all five checks and the only one whose marker handling is defended by a test
over a live CFC POU.

### 3.4 "Is this graphical?" — decided at twelve-plus sites

`PushService.cs:263,299,314,319`; `BodyFormatGuard.cs:25,30,76,90,93,97`; `PouReader.cs:191,214-215`;
`BodyCodec.cs:109,179`; `GraphSplice.cs:155`; `GraphWriter.cs:29`.

`Vocabulary/Languages.cs:6-10` already records the diagnosis — *"These predicates were spelled out at six sites
across three namespaces"* — and centralized the **predicates**. The **decision sites** were never centralized.

### 3.5 Smaller duplicates

| Duplicate | Sites | Keep |
|---|---|---|
| `Serialize` (declaration-preserving `ToString`) | `PlcOpenDocument.cs:46-47` vs `TcItemArchive.cs:183` | `PlcOpenDocument`'s — it carries the documented reason (`:37-45`: `ToString()` drops the XML declaration, found by the no-op identity test). Shareable: the TwinCAT driver already references `Volt.Engine`. |
| "find the existing FBD/LD element" | `BodyCodec.cs:178-179` vs `GraphSplice.cs:155` | `BodyCodec`'s — the `BodyElement`-aware one |
| vendor metadata parsing | `BeckhoffDriver.Code.cs:84-103` (`XDocument`) vs `:105-110` (**regex over XML**) | the `XDocument` one. `TcItemArchive.cs:133-134` states the rule: *"Parsed as XML rather than patched as text: ... a regex over that works until a body happens to contain the pattern."* |
| xhtml namespace literal | `PouSplice.cs:204`, `:335`, `BodyCodec.cs:136`, `GraphWriter.cs:20` | one constant |
| 3S namespace root | `PouSplice.cs:168`, `ProjectStructure.cs:41`, `GraphWriter.cs:208`, `:334` | one constant |

---

## 4. Superseded code still standing

The write path has been unified three times. **Each unification left its predecessor in place.**

| Superseded by | Remnant | Evidence it is dead |
|---|---|---|
| `BodyCodec.NetworkCodec.Encode` | `GraphSplice.SpliceFbdLdBody` plus `InlineInsert`, `FindFbdLd`, `FindFbdLdBody` — ~97 lines | zero production callers (§3.1) |
| the document splice (`PouSplice.RemoveChild`, reached from `PouDocument.cs:55,90`) | `PushService.RemoveOrphanChildren`, `:407-425` | only its own recursion at `:417` and a doc-comment at `TreeNav.cs:69`. `DIALECT.md:131` still describes it as reachable |
| `PouReader.DeclFromElement` | `PlcOpenDocument.DeclFromExport` | production-dead; only caller is a documented test seam |
| the single-document write | the `WritesPouAsOneDocument` fork | **the member does not exist.** Only a comment at `PushService.cs:218` and a stale test-double property at `NetworkCodeTests.cs:252`. `DIALECT.md`'s headline (`:31-37`) still describes the two-arm write, and rows **D4e**/**D4h** are written against the removed branch |

Also dead: `PushService.cs:295` (`bodyImpl`) is assigned and never read.

**Graphical regeneration is the fourth instance of this pattern — and the only one still load-bearing.** That is
why it is the only one that destroys data rather than merely occupying space.

---

## 5. An unrecorded second rename

`openspec/changes/restructure-plcopen-layer/` is closed — every task box `[x]`, close-out in its `tasks.md` §7. A
**second rename landed after it and was never recorded**, so that change's own documents now describe a layout that
does not exist:

| That proposal says | Actual |
|---|---|
| `Volt.Engine.Graphical` | `Volt.Engine.Graph` |
| `Volt.Engine.PlcOpen` | `Volt.Engine.Document` |
| `Workspace/` | split into `Vocabulary/`, `Model/`, `Text/` |
| `Graphical/GraphicalBodySplice.cs` | `Document/GraphSplice.cs` — **moved INTO `Document/`, the opposite of that proposal's §2** |
| `Sync/PouDocument.cs` ("stays in Sync... what keeps `ItemKind` out of `PlcOpen/`") | `Document/PouDocument.cs` — **so `ItemKind` is inside the document namespace after all** |

Ten stale symbol references survive: `CodesysObjectModel.PlcOpen.cs:50`, `CodesysTypeMap.cs:39`, `RefsFetch.cs:66`,
`BodyCodec.cs:22`, `GraphSplice.cs:12`, `PlcOpenDocument.cs:24`, `PouSplice.cs:10`, `ItemContent.cs:17`,
`ItemKind.cs:232`, `DIALECT.md:188` — plus `ARCHITECTURE.md:64` and `:215`.

Two wrong-direction edges the earlier proposal recorded are **resolved, but differently than it planned**:
`GraphConstants.NetworkStride` moved to `Model/` (Level 0) rather than `ValidateExisting` moving out; and the
`ItemKind` leak was closed by the `PouMember` enum (`PouSplice.cs:14`) rather than by file placement.

---

## 6. Hard constraints on layout

| Constraint | Evidence | Consequence |
|---|---|---|
| `Volt.Engine` is `netstandard2.0` | `Volt.Engine.csproj` | loads in CODESYS's net48 IronPython host AND net8. No `Span`-based XML APIs, no source generators. **No new assemblies** (`restructure-plcopen-layer/tasks.md:18`) |
| `TcItemArchive` needs `System.IO.Compression` | it is `net8.0-windows` | the zip-rewrite code **cannot simply move up** into `Volt.Engine` |
| `WireVocabularyGuardTests` keys on **bare filenames** | `:90-91` guards `ItemKind.cs`, `PlcOpenDocument.cs`, `PouReader.cs`, `PouSplice.cs`, `ProjectStructure.cs`, `NetworkTextReader.cs` | **`AllowKey` (`:140-146`) strips the partial suffix, so `PouSplice.Declaration.cs` is exempt automatically. SPLITTING IS FREE; RENAMING BREAKS THE BUILD.** Merging one of these files' content into a non-exempt file (`BodyCodec.cs`, `GraphSplice.cs`, `PouDocument.cs`) also fails |
| `VendorParityGuardTests` keys on the **directory** `src/Volt.Engine` | `:63-71` | any file moved IN inherits the no-vendor-literal rule; any moved OUT loses it |
| `scripts/check-wiring.ts:263` **hardcodes** `src/Volt.Engine/Document/DIALECT.md` | measured | **moving or renaming `Document/` breaks `bun run check`** |
| `check-wiring.ts:146,155` finds `ItemKind.cs` **by name, recursively** | comment at `:143-145` | deliberately path-independent after the last move |
| no `.csproj` names a source file | `grep "Compile \|EnableDefaultCompileItems"` returns zero hits | file moves and splits are free at the MSBuild level |

---

## 7. UNMEASURED added by this census

| # | question | how to close |
|---|---|---|
| U21 | Does an accessor whose declaration declares a variable get TWO `<InterfaceAsPlainText>` blocks, as A7 says a POU does? | declare a VAR in a property accessor in CODESYS, export, record the fixture |
| U22 | Does any vendor emit `<get>`/`<set>` elements, which the reader excludes and the writer does not? | grep a wider export corpus; if neither emits them, delete the asymmetry rather than reconcile it |
| U23 | Whether the five `dist/` copies of `Volt.Engine` claimed by `restructure-plcopen-layer/tasks.md:18` actually exist — `grep "Volt.Engine" scripts/*.ps1` returns **zero hits**; `build-cli.ps1` publishes by project and lets the SDK carry dependencies | read the built `dist/` tree after `bun run build:installer` |
