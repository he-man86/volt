# Review — this plan is NOT ready to execute, and several of its claims are wrong

Three independent reviews, 2026-08-28, plus verification of every finding below against the repo. Recorded in full
rather than silently patched: some of these are corrections to claims the plan makes about itself, and a reader
who saw only the corrected text would not know which parts had been over-read.

**Headline: the deciding cell (R3) is NOT closed, the stated motivation is stale, and the promised payoff is not
achievable as written.** The direction — native for TwinCAT — survives, but on a much thinner case.

---

## 1. R3 is NOT closed. The verdict line must be withdrawn.

The plan says: *"All four deciding cells are closed, and `DocumentXml` passed every one, including R3, which
could have sunk it."* **That does not stand.**

The measurement was: import a recorded PLCopen LD fixture, read the same POU back natively, grep the native for
`contact`/`coil`/`PowerRail` → **0/0/0**. I read that as *"a ladder is a view; the store is already lowered, so
nothing can be lost."*

**The equally consistent reading is the opposite**, and nothing in the experiment distinguishes them:

> the native document does not carry which nodes the engineer drew as contacts/coils, the rail topology, or
> pin-level negation — **and PLCopen does**.

Verified in the source fixture (`tc-ld/ld_ton_rung_two_networks.plcopen.xml`), which is a **recorded live
TwinCAT PLCopen export**:

```
<contact ×3   <coil ×2   leftPowerRail ×2   rightPowerRail ×2   negated ×5
```

I then checked the one place the distinction could hide — and I had **stripped it unread** in the write-up
("one rung, with the `Flags` noise stripped"). `Flags` turns out to be `Flags=0 / Fixed / Extensible`, not pin
semantics. So I looked at the native document's **complete** property vocabulary, all 26 names:

```
Address, Boolean, BoxType, BranchCounter, CallType, Comment, ContainsExtensibleInputs, DefaultViewMode,
Extensible, FBDValid, Fixed, Flags, ILActive, ILValid, Id, IsInstance, LValue, Label, NetworkListComment,
Operand, OutCommented, ProvidesSTSnippet, SymbolComment, Title, Type, ValidIds
```

**No negation. No edge. No set/reset. No contact/coil distinction.**

The saving nuance, and the reason this is *open* rather than *failed*: every `negated` in the body I measured is
`negated="false"`, so its absence from the native form proves nothing either way. But across the recorded
fixtures there are **2 × `negated="true"`** and **1 × `edge="rising"`** — real constructs, in real exports, with
no field in the native vocabulary to hold them.

**Status: R3 → `?`.** The falsifying experiment is small and specific:

1. Read natively a POU containing `negated="true"` and one containing `edge="rising"`.
2. Do it on an **IDE-AUTHORED** ladder, not one produced by importing Volt's own PLCopen fixture — every LD body
   measured so far was created by a PLCopen import, which is a second way the sample may be unrepresentative.

Until both are done, *"the LD contact demotion cannot occur in this transport"* is unsupported, and it is the
single largest claimed win.

## 2. The motivation is stale — four of the "seven failures" are already fixed

The plan argues from *"TwinCAT's PLCopen export fails seven requirements outright (R1, R6, R10, W1, W6, W8, W11,
W14)"*. Two problems.

**That list has eight entries and is labelled seven.** In both `checklist.md` and `proposal.md`.

**And four are already closed by `declaration-from-the-aspect`, which is SHIPPED** — its live gate took TwinCAT
from "could not run" to 141/11/0. The checklist's own W1 and W6 cells say *"now solved off-transport, via the
aspect"* and the summary then counts them as failures anyway. R1/R6 are the read halves of the same fix. W11 is
mitigated (Volt moves the item back). W14's declaration-reformat is mitigated by the shipped ordering fix.

**The genuinely open residue is three rows:** R10 (disabled network omitted), W14's `LineIds`/re-indent churn,
and W8 (accessor declarations) — which has **never fired**, because accessor declarations are blank in every
fixture and live project measured.

Two of the six "crisis" rows in the Why table describe **already-fixed bugs**. The remaining wins (R10, W14, W11,
W8, R9, cost) may still carry the proposal, but it must be argued on those, not on a fire already put out by
cheaper means.

## 3. The payoff is not achievable as written

**`DocumentXml` is POU-only; TwinCAT's PLCopen path cannot be deleted.** `BeckhoffDriver.ReadXml` is
`ExportPouXml` for **every** item, and the write has no kind split at all — `PushService` calls `WriteXml` for
every writable kind, which `TransportMatrixTests` pins as *"ONE WriteXml — for every writable kind"*. DUTs, GVLs
and interfaces go through PLCopen today. The checklist is titled *"What a **POU** transport must do"* and scores
only POUs; `DocumentXml` returns **0 chars** on a POU's ACTION child, and DUT/GVL/interface are unmeasured. In
the CODESYS corpus, non-POU objects are the **majority** (96 DUTs, 19 accessors, 7 actions vs 249 POUs).

**So task 5b.3 ("the TwinCAT PLCopen path is deleted") is not evidenced**, and §3.1 (move PLCopen into the
CODESYS package) would strand TwinCAT needing it from there — a driver-to-driver reference across
**net48 → net8.0-windows**, which cannot compile.

**And nothing else can be deleted either.** `LowerLadder`, `InstanceTypes` and `RestoreChildFolders` are
**shared engine code** on paths with no vendor fork, and **CODESYS keeps PLCopen** — CODESYS LD still arrives as
contacts on power rails. The network pipeline is 2,348 lines and none of it goes.

**Therefore task 5b.7 ("line count goes DOWN") is a prediction against the evidence.** The change is
*net-additive*: a new NWL reader and writer, plus a model field, plus per-vendor branching that 5b.1 forbids in
the engine and so must be duplicated in the driver. "Smaller than the one in use" compares new code to old code;
the decision-relevant quantity is **total** code, and it rises.

## 4. The contract in §2 is insufficient — three blockers

- **`ItemContent` has no body LANGUAGE.** `BodyFormatGuard` decides the CFC/SFC/IL overwrite refusal from a
  per-member language; `PouReader.ParsedChild` carries exactly the two fields `ItemContent` drops
  (`BodyLanguage`, `BodyElement`). Under `ReadContent → ItemContent` the engine loses the input to its own
  data-loss guard. `Language` must be added, or the guard duplicates into both drivers — the duplication
  `BodyFormatGuard` records already being paid for once.
- **No `establishing` (create vs update).** Marker semantics INVERT on it: on update a null body means "leave the
  diagram alone"; on create, "cannot build one from a marker". `WriteContent(ItemRef, ItemContent)` has nowhere
  to put write intent.
- **One document read becomes two.** `PushService` reads the export ONCE and reuses it for the root guard, every
  child guard and the splice basis — a fix whose own comment records the predecessor paying *"22 exports to write
  one POU"*. Read-then-write reads twice, a straight regression on CODESYS at ~20 ms/export.

## 5. `GraphModel` is NOT neutral — and the metric that said so is unsound

`tasks.md` §2.3/§3.2 call `GraphModel` "Volt's neutral graphical model". Its own doc-comment:

> *"A faithful, position-free projection of a **PLCopenXML** FBD/LD body. **Every node maps 1:1 to a PLCopenXML
> element**; wiring is by `localId` / `refLocalId` / `formalParameter` taken **verbatim from the XML**."*

The coupling reaches the **user**: `NetworkStride = 10_000_000_000` is a PLCopen localId convention, and
`NETWORK <index>` in an engineer's `.fb` file is `localId / NetworkStride`. TwinCAT's native has GUID `Id`s and
**no localIds**, so its converter must *invent a PLCopen numbering* to satisfy a model called neutral.

**`layout.md`'s "objective" split — counting `XElement` references — is retracted.** It finds the SYNTAX, not the
COUPLING: `GraphModel` scores 0 and is entirely PLCopen-shaped. **Task 3.3 proposed enforcing that very metric as
a build guard**, which would pass a fully PLCopen-shaped engine while reporting the layering clean.

## 6. Task 4.3's premise is factually false

It claims *"the model currently has nowhere to put it"*. `GraphNetwork` already carries `Label`, `Comment` and
`Disabled`; `NetworkTextWriter` emits them and `NetworkTextReader` parses `DISABLED`. The real gaps are narrower:
**`Title`** has no field, and the PLCopen read never populates `Disabled`.

## 7. Gate 6.3 and task 4.3 contradict each other

6.3: both vendors serve byte-identical responses. 4.3: take network metadata TwinCAT can carry and CODESYS
cannot. `test/e2e/vendor-parity.test.ts` compares `sourceText` **exactly**, to catch *"a phantom `volt status`
diff on every pull after switching vendors"*. Network text IS `sourceText`, so the proposal's non-goal "changing
the wire" is also in conflict. **Must be decided:** take the metadata and document a wire asymmetry, or don't and
accept R10 as a read-side win that never surfaces.

## 8. The size argument was applied asymmetrically — and is retracted

The plan compares TwinCAT's native (14,849) against CODESYS's (90,434) — **two different programs**: a
two-network test fixture versus an FB from a real customer project. Measured like-for-like, same body, same
vendor, both transports:

| body | TwinCAT PLCopen | TwinCAT native |
|---|---|---|
| `ld_ton_rung_two_networks` | 7,649 B | **15,180 B (2.0×)** |
| `fbd_en_eno` | 10,279 B | **21,694 B (2.1×)** |

TwinCAT's native is **twice its own PLCopen** for the same body. Verbosity was used as an argument against
CODESYS's native and never applied to TwinCAT's. **Drop size as a criterion** — it is not evidence about fidelity
in either direction.

## 9. Version durability was asked of one vendor only

CODESYS's native was rejected partly for needing a GUID map *"tracked across CODESYS versions"*. That durability
question was **never asked of TwinCAT's NWL**, which is equally an undocumented internal serializer
(`XmlArchive`, `o`/`l2`/`v`/`n=`/`t=`) with no schema, no namespace version and no compatibility commitment —
while PLCopen TC6 has a published XSD. There is precedent for Beckhoff moving internals under Volt: the repo
already records *"Beckhoff renumbered 622/624/625 into the 650s"*. **Add a row: "survives a vendor version
upgrade"** — TC PLCopen ✓, TC native **?**, CS PLCopen ✓, CS native ✗.

## 10. Table integrity — cells graded without measurement

- The document states *"Where a cell is not measured it says so"*, then grades **eight** cells in the
  `CS export_native` column (R2, R4, R5, R6, R7, R8, R9, R11) that §CS says were never run. → all `?`.
- **R12 "CS PLCopen ~20 ms" is TwinCAT's number.** No CODESYS export was ever timed.
- **R11 and W14 contradict each other**: R11 scores native ✓ for identity via `Id`; W14 measures that every write
  **zeroes that `Id`** and dismisses it as unread. Both cannot stand.
- **§CS prose says "R3 disqualifies it" while the table grades that cell `~`.** And what was measured was size,
  vocabulary and canvas geometry — **not a failed round-trip**. `export_native` was never shown to LOSE anything.
  Either grade it `✗` with a loss measurement, or state the rejection honestly as *"on GUID-typing and
  implementation cost, unmeasured on fidelity"*.
- **W5/W6/W8/W9/R5/R7 are ✓ "proved" from ONE splice on ONE bare FB**, while the verdict itself says member-level
  native writes are *"not yet enough to implement against"*. → `~`.
- **W12 tested only XML well-formedness.** The one structurally-valid-but-wrong document was **accepted and
  mutated the POU**. The half-apply risk W12 exists to exclude — valid XML, invalid model — was never tried.

## 11. Smaller over-statements

- **"~10× cheaper"**: measured 0.3–5 ms vs ~20 ms is a **4×–66×** range, sample size unstated. And the operations
  differ: `DocumentXml` is one POU, while `PlcOpenExport2(…, bSubTree)` returns a subtree in one call — per-item
  native reads may be *more* total calls on a fetch.
- **"close to 1:1 with `GraphModel`"**: asserted from **one rung** with `Flags` stripped. §FBD then found a node
  kind (`BoxTreeDemux`) the LD body lacked — one new shape per new fixture, over two fixtures. Untried: jumps,
  labels, returns, comment boxes, negated pins, SET/RESET coils, edge detection.
- **"one graphical POU in 1,314 objects"** is from **one CODESYS project**. It cannot size the **TwinCAT**
  graphical converter — and TwinCAT's install base (Beckhoff machine builders) is where LD is most common. Zero
  TwinCAT projects were censused.
- **Same-name items** (`PLC_PRG` three times in one project) is filed as a probe trap. It is also a **product**
  hazard specific to per-item native reads, against a protocol whose invariant is that the name IS the identity.

## 12. Unaddressed work

- **`BodySpliceGuard` / `BodyCodec` / `BodyElement` have no home.** `layout.md` files them "split, needs
  deciding" and never decides. For `BodySpliceGuard` the policy IS the element inspection (~170 lines keyed on
  `inOutVariables`, `connectionPointIn`, `leftPowerRail`, `executionOrderId`, with a gap rule on
  `localId / NetworkStride`); the neutral residue is a message string. **This is the bulk of the real work.**
- **Driver-side refusals have no wire vocabulary.** `PushService` downcasts to `NetworkTextException` for
  `PushConflict.Code`/`.Line`. Under `WriteContent` those refusals are raised inside a driver.
- **`bun run check` breaks.** `scripts/check-wiring.ts:263` hardcodes
  `packages/volt-cli/src/Volt.Engine/Source/DIALECT.md` and parses one row-id namespace; §2.4 splits and moves it.
  Shared engine code also cites TwinCAT rows (D4d, D4j, C6, C2a) from a path that would vanish.
- **No migration story.** Post-switch, TwinCAT network text is re-derived from a different source — different
  network indices, inline types instead of a text-parse guess, no ladder lowering. **Every graphical `.fb` in
  every existing TwinCAT workspace changes on upgrade.** Gate 6.2 tests self-consistency AFTER the switch;
  nothing bounds the diff ACROSS it.
- **Who owns the declaration** under the new contract is undecided. If the engine keeps overriding the driver's
  declaration with the aspect's, TwinCAT's R1/R6 win is never used; if it doesn't, CODESYS loses the aspect path.
- **`proposal.md` is stale and self-contradictory.** Its Impact says *"`Volt.Engine` — unchanged in contract"*,
  which `tasks.md` §2 and `ICodeStore.cs` both contradict. It still says *"do NOT decide this yet — four
  experiments first"* when all four are marked closed.

---

# What must happen before any code is written

1. **Withdraw the verdict line.** R3 is `?`, not PASS. Run the two experiments in §1.
2. **Rewrite the Why** against the post-`declaration-from-the-aspect` state: three open rows, one of them latent.
3. **Measure the non-POU kinds** (DUT, GVL, interface, action) on `DocumentXml`, or scope the change to POUs and
   say so — which means PLCopen stays in the TwinCAT driver and 5b.3/5b.7 are rewritten.
4. **Decide gate 6.3 vs task 4.3.**
5. **Fix the contract**: add `Language`, add write intent, and resolve the two-reads regression.
6. **Neutralise `GraphModel`** or stop calling it neutral — and do not ship the `XElement`-count guard.
7. **Fix the table**: ungrade the unmeasured cells, remove the size row, resolve R11-vs-W14.

The direction is not refuted. The evidence for it is thinner than the document claims, and three of the promised
benefits (delete PLCopen from TwinCAT, delete the ladder/instance-type/folder machinery, reduce line count) are
**not available** as described.

---

# Round 3 — executability. Two hard blockers, one of which reverses a decision I made twice.

## B1. The target package cannot host the tests — and I pre-rejected the fix

```
src/Volt.Cli.Ide.Codesys.csproj      <TargetFramework>net48</TargetFramework>
test/Volt.Engine.Tests.csproj        <TargetFramework>net8.0</TargetFramework>
```

**A net8.0 test project cannot reference a net48 library** (NU1201). So the moment PLCopen lands in
`Volt.Cli.Ide.Codesys`, every test that drives it becomes unreferenceable — `PouSpliceTests` (33 Facts, 6
Theories), `PouReaderTests`, `PouDocumentTests`, `BodySpliceGuardTests` (19), `PlcOpenWriterTests`,
`ProjectStructureTests`, `UnmodelledLanguageTests`, `DeclarationRuleTests`, `TestPlcOpen`…

And **there is no CODESYS test project.** The four test projects are `Volt.Cli.Tests`, `Volt.Engine.Tests`,
`Volt.Cli.Connector.Tests`, `Volt.Cli.Ide.Twincat.Tests`. TwinCAT has one; CODESYS has none. §5b.6 says "recorded
PLCopen fixtures stay as CODESYS fixtures" — **there is nowhere to put them.**

**This reverses my own decision.** I rejected a shared `Volt.Format.PlcOpen` package **twice**, as "over-engineering
for a temporary overlap" and "fewer packages, not more". That reasoning was made **without the TFM in view**. The
need is not overlap-driven, it is **testability-driven**: a `netstandard2.0` PLCopen assembly is referenceable
from net48 *and* from a net8.0 test project. The three exits are (a) multi-target the CODESYS package, (b) add a
net48 test project, or (c) the shared assembly I dismissed. **(c) now looks correct, and my stated reason for
rejecting it was uninformed rather than wrong-in-principle.**

## B2. `FakeIde` has no plan, and it is load-bearing

`test/shared/FakeIde.cs` is **631 lines**, ~180 of which hand-synthesize three PLCopen shapes (POU /
decl-only for DUT+GVL / interface), each mirroring a named recorded export. It also models measured vendor
behaviour: `OmitsPlaintextDeclaration`, `SeedsBodyLanguage`, `InvalidatesHandlesOnWrite`, `RegisterMembersFrom`.

If `ICodeStore` stops speaking XML, `FakeIde` becomes either a **mini-driver** (embedding `PouReader`/`PouSplice`
— which then live in a net48 package, see B1) or an **`ItemContent` model**, in which case **14 `WrittenXml`
assertion sites lose their oracle**. `TransportMatrixTests` asserts *"an UPDATE is ONE WriteXml and nothing
else"* — a call-shape assertion with no `ItemContent` equivalent. **The plan never mentions `FakeIde`.**

## The blast radius I measured was the wrong number

I reported "four production call sites" and treated the change as small. By NAME that is right. By COUPLING it is
not:

| surface | files |
|---|---|
| `PouReader` | **25** (13 src, 12 test) |
| `PouSplice` | **17** |
| `PlcOpenDocument` | **15** |
| `XElement`/`XDocument` | **21 src — 18 inside `Volt.Engine`** + 25 test |
| **`Volt.Engine.Tests` touching PLCopen/XML** | **43 of 84 files — 244 of 428 test attributes (57%)** |

Clean moves ≈ **2,095 lines**. Files that must be **split, not moved** ≈ **1,353 more**. The plan renders that as
one checkbox.

## Step 1 "nothing moves yet" is false

`Materializer.BuildPouFromXml` interleaves **three** sources: the document, the **declaration aspect** (root and
every member), and a **COM tree walk** for folders — PLCopen carries no folder membership. To return
`ItemContent`, a driver must do all three, so step 1 moves `BuildPouFromXml` into **both** drivers before the
TwinCAT converter exists. That is exactly the code motion step 1 promises not to do.

And `BodyFormatGuard.RequireChildFormatWritable` **takes `PouReader.ParsedPou?` as a parameter** — a PLCopen type
in a signature the plan says stays neutral. Without the document it falls back to `ide.BodyLanguage` per child:
the *"22 exports to write one POU"* regression its own comment records.

## More self-contradictions found

- **§5b.4 contradicts §5b.1.** `RestoreChildFolders` is shared engine code called for both vendors. "Deleted for
  TwinCAT" needs either an `if (vendor …)` — banned by 5b.1 — or a move into the CODESYS driver, which the plan
  never says.
- **And the `FolderPath` capability I credited to `DocumentXml` (R9) is ALREADY SHIPPED by another route.**
  `TcItemArchive.cs:50,173,180` already reads and writes `FolderPath="Helpers\Inner\"` in the `.TcPOU` archive.
  R9 is not a new win.
- **Retiring the 10 TwinCAT PLCopen fixtures removes the repo's ONLY LD and EN/ENO coverage** — both LD fixtures
  are TwinCAT, there are **zero CODESYS LD fixtures** — for a `LowerLadder` path that **survives** on CODESYS.
  Recording CODESYS LD/EN-ENO fixtures is mandatory unlisted work.
- **Four tests scan the fixture directory** (`StoredVsPushedTests`, `NetworkSpliceTests`,
  `MaterializedIsPushableTests`, `UnchangedBodyIsNotRewrittenTests`). Deleting fixtures shrinks their input
  **without any test failing**, and `KnownLoss` entries keyed by deleted filenames vacate silently — which reads
  as progress.
- **`DIALECT.md` does not split by vendor.** Its 316 lines are classified by NATURE: **19 A-rows are about
  reconciling BOTH dialects**. Plus 30 citations across 16 src files and a hardcoded path in `check-wiring.ts`.
- **`lossless-push/proposal.md` contradicts its own header** — I added a banner saying TwinCAT moves to a native
  transport, and left the Non-goals section reading *"Adopting a native transport. Measured and rejected twice."*
- **`ARCHITECTURE.md:121,152` and `CLAUDE.md:107`** still state *"content travels as ONE PLCopen document"* as a
  top-level architectural rule. Under this change it is false for half the product.
- **`pou-writes-via-plcopen` has 7 open tasks**, including *"TwinCAT single-document write — ATTEMPTED, NOT
  SHIPPED"*. The change whose premise this reverses is still open.

## One genuinely useful simplification the reviewer found

§3.3's guard, as I wrote it ("fails if the engine references a vendor format"), is hard and vague. The
**achievable** form is much simpler and fully checkable: after the move, `Volt.Engine` has **zero legitimate
`System.Xml.Linq` users** — `NetworkText*`, `GraphModel`, `StReader/Writer` are all 0-XML. **So ban the
namespace, not "vendor XML".** That is a one-line check with no judgement in it.

Also worth noting: `VendorParityGuardTests` already scans the engine for `"twincat"`/`"codesys"`/`"beckhoff"`
literals — but string-only, so 5b.1's "strategy interface with one live arm" passes it clean.
