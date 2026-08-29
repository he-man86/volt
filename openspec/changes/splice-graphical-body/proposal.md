## Why

A push does not edit a graphical body. It **throws the whole `<FBD>`/`<LD>` element away and builds a new one from
network text**: `existing.ReplaceWith(replacement)` at `src/Volt.Engine/Document/BodyCodec.cs:194`, where
`replacement` came from `GraphWriter.WriteBody` (`:187`) over a graph that `NetworkTextReader` minted from scratch.
Exactly one thing survives the swap — the `instanceName → typeName` map harvested at `BodyCodec.cs:185` — and that
one carry-forward is the whole of today's "splice".

`GraphSplice` does not change this. Its `SpliceFbdLdBody` (`src/Volt.Engine/Document/GraphSplice.cs:40-58`) has
**zero production callers**; what production actually uses is `RequireReplaceable` (`GraphSplice.cs:67`, called at
`BodyCodec.cs:192`), which is a refusal gate, not a matcher. The file named after the splice contains no splice.

### The loss is measured, and it is a fixed point

Running the real production path — `NetworkCode.RenderBody` → `NetworkTextReader.Parse` → `GraphWriter.WriteBody` —
over every recorded vendor export in the fixture tree, twice per body (see `body-census.md` §1):

| | result |
|---|---|
| `originalXml == regeneratedXml` | **False on 9 of 9 recorded exports** |
| `regeneratedXml == regeneratedAgainXml` | **True on 9 of 9** |

The write destroys, and **the destruction is idempotent**. That is the shape that makes this class of bug invisible:
`GraphRoundTrip.Once` (`src/Volt.Engine/Graph/GraphRoundTrip.cs:18`) is `GraphReader.ReadBody(GraphWriter.WriteBody(…))`
— reader over writer — so whatever the writer omits the reader never sees, and every round-trip converges anyway.
`NetworkCode.Validate`'s three gates all compare text to text. `DIALECT.md:155` (D17) records the same failure mode
already having shipped once: the live e2e graphical suite passed **7/7 on each vendor over a body it was destroying**.

> **A round-trip test is a fixed-point test. It cannot see a loss that both sides of the round trip agree to drop.**
> The only oracle that can is a comparison of the **stored** vendor artifact to the **pushed** one.

### What regeneration actually destroys

Full table with counts and citations in `body-census.md` §2. Ranked by what an engineer would notice:

1. **An LD contact is demoted to a floating data box and its power-rail wire is destroyed.** Measured on a real
   Beckhoff export: `test/Volt.Engine.Tests/fixtures/tc-ld/ld_ton_rung_two_networks.plcopen.xml:119`
   `<contact localId="9">enable</contact>`, wired from the left rail (`refLocalId="0"`) into `TON.IN`, comes back as
   `<inVariable>enable</inVariable>` with the rail connection gone (`contact` 3→2, `connection` 7→6). The reader
   lowers a contact to an `InVar` (`GraphReader.cs:138-145`); the writer re-emits a data-pin leaf as a box
   (`GraphWriter.cs:443-450`) and admits the collapse in its own doc-comment (`GraphWriter.cs:342`). This is the one
   loss that changes the shape of the rung a ladder engineer reads.
2. **`executionOrderId` is silently zeroed on every push.** `GraphReader` reads it (`GraphReader.cs:275`) and
   `GraphWriter` writes it (`GraphWriter.cs:187`), but all 15 node constructions in `NetworkTextReader` pass `null`,
   and the text format has no spelling for it — so it can never survive. It is not a CFC-only attribute: the TC6
   schema declares it on the shared `block`/`inVariable`/`outVariable`/`inOutVariable`/`label`/`jump`/`return`
   elements FBD and LD bodies are built from (`docs/tc6_xml_v201.xsd:1220,1250,1279,1309,1333,1352,1370`), and the
   CODESYS reference calls it **execution semantics**: two coils on the same variable are last-write-wins and
   "the order is determined by `executionOrderId` of the coils, not by their visual position"
   (`packages/volt-lsp-iec/docs/codesys-reference/15-ld-elements.md:121`; also `14-fbd-elements.md:66,77`). Zero
   recorded fixtures carry one, so today's silence is untested rather than safe.
3. **Every recorded comment box is deleted.** `GraphReader.cs:42` keeps only comment text of non-zero length and
   `GraphWriter.cs:58,258` emit a comment only when the text is non-empty — so all six recorded boxes
   (`tc-ld/ld_four_networks_shared_rails.plcopen.xml:33,66,99,132`;
   `tc-ld/ld_ton_rung_two_networks.plcopen.xml:61,102`) vanish, because every one of them is an empty
   `<xhtml … />`. A box the engineer placed is content.
4. **A network's TITLE is blanked and its DISABLED state is dropped in both directions.** `GraphReader.cs:62`
   constructs every network as `new GraphNetwork(index, null, comment, false, nodes)` — `Label` hardcoded `null`,
   `Disabled` hardcoded `false` — while `NetworkTextWriter.cs:44-46` can already render both. The only
   `[UNMEASURED:]` marker on the graphical path (`NetworkTextWriter.cs:47-54`) says exactly this.
5. **The `fbd/implementationattributes` vendorElement is deleted from every FBD body on both vendors.** Present in
   all 7 recorded FBD exports — 3 CODESYS (`corpus/POU.plcopen.xml:66`, `codesys-pou/VltFbd_FbdRoot.plcopen.xml:60`,
   `codesys-pou/POU_SfcRoot_StFbdMethods.plcopen.xml`) and 4 TwinCAT
   (`tc-fbd/PLC_PRG.plcopen.xml:55`, `PLC_PRG_jump_sr`, `fbd_en_eno.plcopen.xml:53`, `fbd_ton_embedded_output`) —
   absent from both recorded LD exports. Read as an `OpaqueNode` (`GraphReader.cs:284`), then deliberately
   unspellable in network text (`NetworkTextWriter.cs:230-236`), so a push deletes it. It is in `SafeToDrop`
   (`GraphSplice.cs:140-142`), so nothing is even raised.
6. **`InputParamTypes`/`OutputParamTypes` payloads are emptied on every block** (`BOOL` → `<OutputParamTypes/>` at
   `corpus/POU.plcopen.xml:111,148,182`), and on TwinCAT LD the writer *adds* two addData blocks the vendor never
   emits (DIALECT A16).
7. **localId identity shuffles.** `NetworkTextReader.cs:72` re-mints every id as `order*10^10 + 1` upward, so the
   AND block in `corpus/POU` moves `10000000003 → 10000000002` and `out2` moves `10000000006 → 10000000007`.

### The intuition to discard: there is no layout to lose

The obvious argument for splicing — "regeneration rearranges the engineer's diagram" — **is false, and the census
refutes it**. All 90 `<position>` elements across all 9 recorded exports on **both** vendors are `x="0" y="0"`.
PLCopen FBD/LD export carries no diagram coordinates at all. `GraphReader` never reads a position
(`GraphReader.cs:12`, "Positions are discarded") and `GraphWriter.Pos` *synthesizes* `y = row*40`
(`GraphWriter.cs:202`) — coordinates no vendor ever emitted. A splice does not restore a diagram; it stops
inventing one. Where the real layout lives is `[UNMEASURED]` (see §Impact).

### The regeneration is not a special case — it is the last one standing

A census of **every** place in `volt-cli` that constructs, edits or serializes XML (`write-path-census.md`) found
that the write path has been unified three times, and **each unification left its predecessor in place**:

| Superseded by | Remnant still in the tree | Proof it is dead |
|---|---|---|
| `BodyCodec.NetworkCodec.Encode` | `GraphSplice.SpliceFbdLdBody` + `InlineInsert` + `FindFbdLd` + `FindFbdLdBody`, ~97 lines | 16 references, 15 of them tests plus its own definition |
| the document splice (`PouSplice.RemoveChild`) | `PushService.RemoveOrphanChildren` (`:407-425`) | only its own recursion at `:417`; `DIALECT.md:131` still calls it reachable |
| `PouReader.DeclFromElement` | `PlcOpenDocument.DeclFromExport` | only non-test caller is a documented test seam |
| the single-document write | the `WritesPouAsOneDocument` fork | **the member does not exist** — a comment at `PushService.cs:218` and a stale test-double property at `NetworkCodeTests.cs:252`. `DIALECT.md`'s headline still describes the two-arm write it gated |

**Graphical regeneration is the fourth instance of the same pattern, and the only one still load-bearing.** That is
why it is the only one that destroys data rather than merely occupying space. Stated that way the change is not
"add a splice to the graphical body" but **"finish the unification that was started three times"** — and the
regeneration is not a special case to fix, it is a duplicate to delete.

### There must be ONE write path, and the graphical body is a leaf of it

The graphical body must not sit in an architectural silo of its own. The census shows it largely already doesn't,
and that the real fragmentation is on a different axis than expected:

- **The declaration path is already language-blind.** There is no graphical fork anywhere in it. It is fragmented
  by **member position** instead — four writers (root / child-update / child-create / accessor) and three readers.
- **The body-language branch is already ONE mechanism** (`BodyCodec.For`), and `PouSplice.cs:469-476` records that
  unifying it was deliberate. What was never unified is the **guards around it**: `SetBody` has five checks,
  `SetAccessor` and `SetChildText` two each, and `AddChild` **none at all**.
- What is genuinely siloed is the ~97 dead lines of `GraphSplice`, whose own doc-comment still claims it *"belongs
  with the graph, not with the document"* while sitting in `Document/`.

The divergences are not stylistic. `SetAccessor` writes the **first** `InterfaceAsPlainText` where root and child
write **all** of them, and silently **creates** one where they **throw**. Writing only the first is precisely the
silent no-op `PlcOpenDocument.cs:53-58` documents and DIALECT **A7** confirms: CODESYS exports a declaration twice
once a POU declares any variable, and the IDE reads the other copy. Whether an accessor with a declared VAR gets
two copies has never been measured — no recorded fixture has one (**U21**).

And read and write answer *"is this declaration the item's own?"* from **two different lists**: the writer's
`OwnDescendants` is case-sensitive over 9 names; the reader's `ChildDeclContainers` is case-insensitive and
additionally excludes `<get>`/`<set>` (**U22**).

> **One document writer, one declaration path, language dispatch only at the body leaf.** Any two code paths
> writing the same construct by different means is a defect this change names and collapses, not a shape it
> preserves.

### The identity problem, stated honestly

Matching a parsed network-text node back to the stored XML element that represents it **cannot be made reliable**,
and not merely because ids drift under edit. Measured (`body-census.md` §5):

- At **zero edits**, only **15 of 99** model nodes land under a localId denoting the same node on both sides
  (15.2%); for all four LD fixtures the overlap is **0**, because `GraphReader.cs:51` re-mints LD ids at *read* time.
- Content keys `(kind, identifying text)` are 1:1 on **68 of 86** nodes (79.1%; **55 of 73** = 75.3% counting only
  real vendor exports). The failures concentrate in the two classes the design *forces* to collide: `inVariable`
  literals (12 of 21 collide) — because `NetworkCode.Validate`'s leaf fan-out guard (`Graph/NetworkCode.cs:41-57`)
  requires every read of a value to have its own leaf, to stop TwinCAT's importer crashing (DIALECT C4) — and
  anonymous operator blocks (2 of 12).
- A richer neighbourhood fingerprint is **worse** (54 of 86 = 62.8%), because network text legitimately drops a
  neighbour's `typeName` — a structural key built on a lossy projection is less robust, not more.
- **57% of model nodes (49 of 86) have no statement of their own.** They are tokens inside one fully-parenthesised
  expression, exactly as `docs/network-text.md:187-192` intends. No per-line anchor can address them.
- **8% (7 of 86) have no stored XML element at all** — embedded outputs (`GraphReader.cs:106-113`) and the `AND`
  blocks LD lowering synthesizes (`GraphReader.cs:242-249`). These must be regenerated whatever scheme is chosen.

A per-node text anchor would mean annotating tokens inside expressions
(`((FALSE@1 AND TRUE@2)@3 AND FALSE@4)@5`), which destroys the readability that is VG's entire justification. A
per-**statement** anchor is viable but buys nothing the design below already gives, and costs readability. So:

> **The identity channel is the BASELINE RENDER, not the text.** At push time `BodyCodec.Encode` already holds the
> stored body (`BodyCodec.cs:178-181`). `NetworkCode.RenderBody(existing)` reproduces the exact network text the
> engineer started from. Diff that against what they pushed, and **whatever did not change keeps its stored XML
> verbatim**. Zero repo-format change; no matching key needed at all.

### And the granularity that decision lands on

Applying the baseline diff at *statement* granularity needs two things the code does not have: a side-channel from
`NetworkTextWriter` recording which localIds it emitted into each statement, and provenance in `LowerLadder`, whose
LD ids are synthetic. Applying it at *network* granularity needs neither, and the network index is the **only key
measured to be stable**: `NetworkTextReader.cs:66-72` preserves `NETWORK <n>` verbatim from the engineer's text, and
an insert at the top of one network was measured to shift every following node **in that network only** — other
networks were untouched.

## What Changes

### 1. Splice at NETWORK granularity, keyed by the index the engineer controls

`NetworkCodec.Encode` (`BodyCodec.cs:173-196`) gains a baseline leg. For each network index present in the pushed
text:

- render the **stored** network's text from `existing`, and compare it byte-for-byte with the pushed network's text;
- **identical → carry the stored network's XML elements across verbatim**, ids, positions, `addData`,
  `vendorElement`, comments, pin modifiers, `executionOrderId` and all;
- **different, new, or absent from the baseline → regenerate that network** exactly as today.

That preserves everything in §Why 2–7 on every network the engineer did not touch, with **no node matching, no id
matching and no text-format change**. A reordered or renumbered network simply fails the byte comparison and is
regenerated — wrong-carry is impossible by construction, because carrying requires equality.

Five constraints the design must satisfy, each measured:

- **The wrapper element is still replaced when the language changes.** TwinCAT's `CreateChild` cannot create `"LD"`
  and seeds `<FBD/>` (DIALECT C6), so `existing` can be `<FBD>` while the replacement is `<LD>`; keeping the old
  wrapper puts ladder contacts inside `<FBD>`, which the schema rejects — the reason `GraphSplice.cs:47-51` replaces
  the whole element. A language change carries nothing forward.
- **LD networks are not independent of the body.** Both recorded LD exports bracket the *whole* body with one
  `leftPowerRail localId="0"` and one `rightPowerRail localId="2147483646"`
  (`ld_four_networks_shared_rails.plcopen.xml:29,165`), and `GraphWriter.cs:235,244-248,322-323` emits exactly that
  pair. A carried-forward LD network references rail id `0`, so the rails are body-scoped and preserved with it.
- **Regenerated ids must not collide with carried ones.** `LdCtx` mints contact ids above every model id
  (`GraphWriter.cs:367,389`); with stored ids now surviving, the floor becomes the max id in the whole spliced body.
- **Nothing may branch on a vendor.** `test/Volt.Engine.Tests/VendorParityGuardTests.cs:20-59` fails the build on
  any `twincat|codesys|beckhoff` literal in `src/Volt.Engine` code. Every asymmetry the splice meets is discriminated
  **structurally** — the presence of a `networktitle` marker, the presence of rails, the body element's own name —
  exactly as `GraphReader.SplitNetworks` (`GraphReader.cs:76-98`) already does.
- **The whole spliced body is re-validated before it is written.** The leaf fan-out refusal (DIALECT C4,
  `NetworkCode.cs:41-57`) is a global rule that exists because TwinCAT's importer *crashes*; it applies to the
  carried halves as much as the regenerated ones.

### 2. The refusal gate re-scoped from the body to the changed networks

`ValidateExisting` (`GraphSplice.cs:67-118`) today inspects the **direct children of the whole stored body** and
refuses the push if any element name is outside `SafeToDrop` — `error`, `connector`, `continuation`, `actionBlock`,
`inOutVariable` — or if the network numbering has a gap, or if the body carries an in-out pin, an output-pin
modifier, a multi-source FBD pin, or a stateless multi-output function.

Under a splice, a network that is carried verbatim **loses nothing**, so refusing on its account is no longer
justified. The gate moves onto the set of networks being regenerated. Two consequences, and one trap:

- The gapped-numbering refusal (`GraphSplice.cs:81-92`) stops firing on untouched networks. It currently refuses a
  **real recorded Beckhoff export**: the body of the action `ACT_FBD` inside
  `tc-fbd/PLC_PRG_jump_sr.plcopen.xml`, whose network indices are `{1,2,4,5,6}`. (Its parent POU `PLC_PRG` has an
  `<ST>` body and is unaffected — the export is not un-pushable, one child item of it is.) Note the refusal's stated
  reason — that a gap *means* a disabled or hidden network — is itself `[UNMEASURED]`.
- **The trap: this must not become a silent regression.** An element outside `SafeToDrop` sitting in a network the
  engineer *did* edit is still a loss and must still be refused, with the same message. The gate narrows its scope;
  it does not soften.
- `SafeToDrop`'s twelve entries currently conflate three different justifications (represented in text /
  regenerated by the writer / asserted cosmetic). Only `vendorElement` is in the third class, and even it is
  double-duty: on LD it is the `networktitle` delimiter that `GraphWriter.NetworkTitle` (`:329-336`) regenerates
  **empty**, on FBD it is `implementationattributes` that nothing regenerates. The set is re-derived per class.

### 3. One write path — the duplicates collapsed, the dead paths deleted

Sequenced in `tasks.md` §7. Evidence and the keep/drop judgement for each pair in `write-path-census.md` §3–§4.

- **Delete the ~97 dead lines of `GraphSplice`** (`SpliceFbdLdBody`, `InlineInsert`, `FindFbdLd`,
  `FindFbdLdBody`). Its 18 tests move onto `BodyCodec.NetworkCodec` — they are testing a real contract against the
  wrong implementation, so they are **retargeted, not deleted**. What survives is `RequireReplaceable` →
  `ValidateExisting` + `SafeToDrop` + `HasPinMod`, which §2 re-scopes anyway; it moves next to the gate it guards
  and the file goes with it.
- **Collapse the four declaration writers onto W1's rule** — `OwnDescendants`, all copies, throw on absent. That is
  the rule carrying the A7 fix and the one the layer's own doc-comment defends. `SetAccessor`'s first-only/create
  behaviour is deleted, not reconciled.
- **Reconcile the read and write containment predicates to one shared list.** If U22 measures that neither vendor
  emits `<get>`/`<set>`, delete the asymmetry rather than propagate it.
- **Collapse the three body-guard blocks onto B1's**, and give `AddChild` a guard at all. B1 is the only one with
  all five checks and the only one whose marker handling is defended by a test over a live CFC POU.
- **Delete the three superseded remnants** — `RemoveOrphanChildren`, `DeclFromExport`, and the dead `bodyImpl`
  assignment at `PushService.cs:295` — and the stale `WritesPouAsOneDocument` test-double property.
- **One constant each** for the xhtml namespace (4 declarations today) and the 3S namespace root (4 spellings), and
  one `Serialize` — `TcItemArchive.cs:183` is a byte-identical open-coded copy of `PlcOpenDocument.Serialize:46-47`
  and the TwinCAT driver already references `Volt.Engine`.
- **Replace the regex-over-XML** at `BeckhoffDriver.Code.cs:105-110` with the `XDocument` parse already present at
  `:84-103` in the same file. `TcItemArchive.cs:133-134` states the repo's rule for exactly this.

The folder and file shape these collapse into is decided **before** the featureset is built, in
`target-layout.md`: one owner per construct (`Declaration.cs`, `BodyCodec.cs`, `Members.cs`), `Graph/` kept
deliberately flat so the graphical projection is not put in a location of its own, and **one source-scanning guard
per collapsed rule** so a second path fails the build rather than surfacing in production. The most valuable of
those guards is the general form of this whole finding: *every public type under `src/Volt.Engine` has a non-test
caller.* Three separate instances of shipped-but-uncalled code — `GraphSplice.SpliceFbdLdBody`,
`RemoveOrphanChildren`, and `NetworkCodeIo` + `DeclFromExport` — went undetected because nothing checks that.

Two things this section deliberately does **not** do. It does not centralize the twelve-plus "is this graphical?"
decision sites — they are spread across guard, push and read concerns that legitimately ask different questions,
and merging them is a separate change with its own risk. And it does not move `Document/` or rename any file in the
`WireVocabularyGuardTests` exemption set: splitting those files is free (the guard strips partial-class suffixes)
but renaming one breaks the build, and `scripts/check-wiring.ts:263` hardcodes the path to `Document/DIALECT.md`.

### 4. Defects land before the splice

Listed at the end of this document and ordered in `tasks.md` §1. Each is a behaviour bug with its own test, red
before its fix, and each lands **before** any splice code — a splice commit must not carry a behaviour fix, or the
fix looks like splice fallout.

### 5. Deliberately NOT built

- **Statement granularity, and node granularity.** Statement granularity is the natural next stage and is scheduled
  as a *decision*, not assumed: it requires a `NetworkTextWriter` side-channel and LD provenance in `LowerLadder`
  (`tasks.md` §5). Node granularity is refused on measurement — 57% of nodes have no addressable location and 8%
  have no element to match to.
- **A text-format anchor.** A per-statement `// @<n>` would need the writer to mint it, the reader to carry it,
  `NETWORK_NOT_CANONICAL` (`NetworkCode.cs:59-67`) to be made anchor-preserving, and a duplicate-anchor refusal —
  and it buys nothing the baseline render does not already give. It is only worth revisiting if the stored XML turns
  out not to be reliably in hand at push time, which it is (`BodyCodec.cs:178-181`). Recorded, unbuilt.
- **Restoring diagram layout.** There is none in the transport to restore (§Why). Where it lives is `[UNMEASURED]`.
- **Any fallback.** Where the splice cannot preserve something, it regenerates that network or refuses the push.
  It never guesses a value, and it never "best-effort" carries a partial match.

## Capabilities

### New Capabilities

- `graphical-body-splice`: a push to a graphical body rewrites only the networks whose text the engineer changed;
  every other network's stored vendor XML survives byte-identical, and the loss that regeneration causes is
  measured by comparing the pushed artifact to the stored one rather than by round-tripping.

## Impact

- **Code:** confined to one assembly. All five files of the regenerate loop live in `src/Volt.Engine`
  (`Graph/NetworkTextReader.cs` 579, `Graph/GraphWriter.cs` 506, `Graph/GraphReader.cs` 381,
  `Graph/NetworkTextWriter.cs` 317, `Document/GraphSplice.cs` 157 = 1940 lines), plus `Document/BodyCodec.cs` (219)
  which holds the one production write site. The only reference outside the assembly is a doc-comment at
  `src/Volt.Ide.Twincat/Ide/TcPlcOpen.cs:12`. Zero cross-package impact — `volt-lsp-iec` and `volt-vscode`
  couple to the VG **text format**, never to a C# type.
- **Tests:** 25 offline C# files in `test/Volt.Engine.Tests` (3708 lines, 168 of that project's 404
  `[Fact]`/`[Theory]`), and 5 files in the live-bridge TS e2e suite (`test/e2e/graphical/` ×3, `harness.ts`,
  `oracle.test.ts`). `harness.ts:435-455` documents the normalization the *current* regenerate loop produces; a
  splice changes which of those still happen, so that doc-comment is part of the change, not collateral.
- **Hard constraints, all verified:** `Volt.Engine` is `netstandard2.0` and copied to five `dist/` targets — **no
  new assemblies**. `WireVocabularyGuardTests.cs` keys its exemption set on **bare filenames** and allowlists
  `NetworkTextReader.cs`: renaming it breaks the build, `NetworkTextReader.X.cs` partials are safe. Two
  source-scanning guards enforce minimum scanned-file floors (`WireVocabularyGuardTests.cs:110-113` ≥60,
  `VendorParityGuardTests.cs:52-54` ≥20).
- **Risk concentrated in three places:** the carried/regenerated boundary inside a body that must still import on
  both vendors; LD, where the reader is a *lowering* rather than a projection (`GraphReader.cs:120-255` synthesizes
  `AND`/`OR` blocks present in no stored element) and where **no CODESYS ground truth exists anywhere in the repo**
  (DIALECT D11, re-verified); and `SafeToDrop`, where narrowing the gate's scope must not narrow what it refuses.
- **Two vendor facts stay below the seam.** Neither IDE has a partial-body import: `ICodeStore.cs:31-35` is whole
  document in, whole document out. A "splice" is a byte-level edit of the export followed by a whole-document
  re-import — which is precisely why splicing is *safer* than regenerating on both vendors: CODESYS's merge
  **removes** children absent from the document (`CodesysDriver.Code.cs:35-48`), and TwinCAT resolves POU members
  only from the `<ProjectStructure>` block (DIALECT D4h). A document left otherwise untouched is correct for free.

## Defects found while surveying — sequenced BEFORE the splice, not bundled into it

These are behaviour bugs. Each gets its own test, red before the fix.

1. **An LD contact wired from the power rail into a data pin is demoted to a floating variable box, and the rail
   wire is destroyed.** Measured on `tc-ld/ld_ton_rung_two_networks.plcopen.xml:119`. `GraphWriter.cs:443-450`
   (`EmitData`) re-emits a data-pin leaf as a box; `GraphWriter.cs:342` already admits "the contact-vs-box choice
   the reader collapsed". Independent of the splice — an *edited* rung must regenerate correctly too.
2. **Every recorded comment box is deleted because it is empty.** `GraphReader.cs:42` filters zero-length text;
   `GraphWriter.cs:58,258` emits only non-empty. Six of six recorded boxes destroyed.
3. **`executionOrderId` is dropped silently rather than refused.** It is XSD-legal on FBD/LD elements and is
   execution semantics (`15-ld-elements.md:121`). Until the splice preserves it, the minimum honest behaviour is
   the one this repo already uses everywhere else: **fail loud** — refuse to regenerate a network carrying one.
4. **A network's `Label` and `Disabled` are hardcoded away at `GraphReader.cs:62`** even though
   `NetworkTextWriter.cs:44-46` renders both and `NetworkTextReader` parses both. The XML carrier for `Disabled` is
   `[UNMEASURED]`; for `Label` the `networktitle` `<alternativeText>` is the candidate and is empty in all six
   recorded captures.
5. **Two false comments and one unmarked load-bearing assertion** (convention 8: a false comment is a defect):
   - `NetworkTextWriter.cs:230-235` states `GraphWriter`'s `case OpaqueNode` "serves only the reader→writer path,
     NOT push". False for LD: `NetworkCode.Validate`'s convergence gate (`NetworkCode.cs:76-78`) runs
     writer→reader→writer, and the writer's own per-network `networktitle` vendorElement comes back from
     `GraphReader` as an `OpaqueNode` and is re-emitted verbatim at `GraphWriter.cs:106`. Measured: LD yields
     `OPAQUE-LD kind=vendorElement`, FBD yields none. The *safety* property still holds — the IDE-bound write starts
     from the parser, which cannot mint an `OpaqueNode` — but it holds for a different reason than stated.
   - `GraphWriter.cs:243`: "The IDE re-numbers localIds on import, so strided ids are fine." No fixture, no
     `[UNMEASURED:]` marker, no DIALECT row — and it is load-bearing for this entire change, because it decides
     whether a carried-forward id survives a push/pull cycle.
   - `NetworkCode.cs:97-106`: a `<summary>` describing a `NetworkCode.Write` method that does not exist, orphaned
     above the private `Canon` helper; the class summary at `:11` still claims the class owns it.
6. **DIALECT hygiene the splice depends on.** `DIALECT.md` B6 ("TwinCAT ADDS and FAILS on a name collision, so it
   must delete first") is overturned by D4c — `TcPlcOpen.cs:34,63` now passes `PLCIMPORTOPTIONS_REPLACE` — and
   carries **no `[RETRACTED -> …]` token**, which is the exact failure the convention at `DIALECT.md:93-97` exists
   to catch. D11's and D12's citations have drifted off their lines. `bun run check` gates on cited rows existing
   and on no code citing a retracted row.
