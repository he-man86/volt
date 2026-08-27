## 0. Evidence already in hand (do not re-derive)

Six surveys of the graphical write path plus a full census of XML generation across the whole toolchain, all
adversarially re-derived. The numbers below are measured; the full tables are in `body-census.md` (what the body
loses) and `write-path-census.md` (where XML is written at all). Paths are relative to `packages/volt-cli`.

- **The loss is real and it is a fixed point.** Running the production path over every recorded vendor export:
  `originalXml == regeneratedXml` is **False 9/9**, `regenerated == regenerated-again` is **True 9/9**. Every
  existing oracle — `GraphRoundTrip.Once` (reader over writer), both `NetworkCode.Validate` text gates — is
  structurally blind to it. `DIALECT.md:155` (D17) records this exact blindness having already shipped once.
- **There is no splice today.** `GraphSplice.SpliceFbdLdBody` (`Document/GraphSplice.cs:40-58`) has **zero
  production callers**; production runs `GraphSplice.RequireReplaceable` (`BodyCodec.cs:192`), a refusal gate, and
  then `existing.ReplaceWith(replacement)` (`BodyCodec.cs:194`). The only stored data that survives is the
  `instanceName → typeName` map (`BodyCodec.cs:185`).
- **What is destroyed** (ranked, `body-census.md` §2): an LD contact demoted to a floating box with its rail wire
  gone (measured, `tc-ld/ld_ton_rung_two_networks.plcopen.xml:119`); `executionOrderId` silently zeroed; all 6
  recorded comment boxes deleted; network `Label`/`Disabled` dropped in both directions; the
  `fbd/implementationattributes` vendorElement deleted from all 7 recorded FBD bodies; param-type payloads emptied;
  localId identity shuffled.
- **There is NO layout to lose.** All 90 `<position>` elements in all 9 recorded exports on both vendors are
  `x="0" y="0"`. `GraphWriter.cs:202` *synthesizes* `y = row*40`. A splice removes churn; it restores no diagram.
- **The regeneration is the LAST of four, not a special case.** The write path has been unified three times and
  each unification left its predecessor standing: `GraphSplice.SpliceFbdLdBody` (~97 lines, zero production
  callers), `PushService.RemoveOrphanChildren` (`:407-425`, no caller), `PlcOpenDocument.DeclFromExport`
  (production-dead), and the `WritesPouAsOneDocument` fork — **whose member does not exist**, while `DIALECT.md`'s
  headline and rows D4e/D4h still describe it. Graphical regeneration is the fourth and the only one still
  load-bearing, which is why it is the only one that destroys data rather than merely occupying space.
- **The real fragmentation is by MEMBER POSITION, not by language.** The declaration path has no graphical fork at
  all — it has four writers (root / child-update / child-create / accessor) and three readers, and `SetAccessor`
  diverges from the rest on all three axes: first-copy-only where they take all, silent-create where they throw.
  First-only is the exact silent no-op `PlcOpenDocument.cs:53-58` documents and DIALECT **A7** confirms. Read and
  write also answer "is this declaration the item's own?" from two different lists (`OwnDescendants`
  case-sensitive over 9 names; `ChildDeclContainers` case-insensitive, plus `<get>`/`<set>`).
- **The body-language branch is already ONE mechanism** (`BodyCodec.For`) and `PouSplice.cs:469-476` records that
  unifying it was deliberate. What was never unified is the guards around it — five checks at `SetBody`, two each
  at `SetAccessor` and `SetChildText`, **none at `AddChild`** — and B1/B4 give opposite answers for a restated
  marker.
- **Node-level matching cannot be made reliable** (`body-census.md` §5): 15/99 localIds agree at **zero** edits
  (0 for all LD fixtures); `(kind, text)` is 1:1 on 55/73 real-vendor nodes; **57% of nodes have no statement of
  their own** and **8% have no stored XML element at all**. The network index is the only stable key.

Hard constraints, all verified:

- `Volt.Engine` is `netstandard2.0` (loads in CODESYS's net48 IronPython host AND net8) and is copied to five
  `dist/` targets. **No new assemblies.**
- `WireVocabularyGuardTests.cs` keys its exemption set on **bare filenames** and allowlists `NetworkTextReader.cs`.
  Renaming that file breaks the build; `NetworkTextReader.X.cs` partials are safe (`AllowKey` strips the suffix).
- `VendorParityGuardTests.cs:20-59` fails the build on any `twincat|codesys|beckhoff` literal in `src/Volt.Engine`
  **code**. Every asymmetry is discriminated structurally.
- Two source-scanning guards enforce minimum scanned-file floors: `WireVocabularyGuardTests.cs:110-113` (≥60),
  `VendorParityGuardTests.cs:52-54` (≥20). Moving files silently no-ops them.
- Neither vendor has a partial-body import (`Ide/ICodeStore.cs:31-35`). A splice is a byte-level edit of the
  exported document, re-imported whole.

**The offline baseline must be re-established, not assumed.** `restructure-plcopen-layer/tasks.md:1.4` records
Engine 392 / Cli 124 / Connector 80, but `Volt.Engine.Tests` now carries 404 `[Fact]`/`[Theory]` attributes, so
that number is stale by at least 12. `[UNMEASURED: the current offline and live-e2e pass counts.]` Close it as
task 1.0 — a gate you cannot state is not a gate.

---

## 1. The oracle first — nothing below can be red without it

Every defect in §2 is invisible to a round-trip test. The oracle is not scaffolding for this change; it is the
thing that makes the change checkable at all, and it lands first.

- [x] 1.0 **BASELINE, measured 2026-08-27** — offline `Volt.Engine.Tests` **646** / `Volt.Cli.Tests` **142** /
      `Volt.Cli.Connector.Tests` **80** / `Volt.Cli.Ide.Twincat.Tests` **3**; live CODESYS e2e **129 pass, 20
      skip, 0 fail** across 26 files. (The prior change's recorded Engine 392 was stale by 250+.) Every gate
      below compares to this. Closes the `[UNMEASURED: the current offline and live-e2e pass counts.]` marker.
- [x] 1.1 **`test/Volt.Engine.Tests/StoredVsPushedTests.cs` — the stored-vs-pushed differ.** For each of the 9
      RECORDED vendor exports (the 2 `roundtrip/*` files are hand-authored and are excluded — `body-census.md` §1),
      run the real production path and diff an element+attribute census of the stored `<FBD>`/`<LD>` against the
      pushed one. Not a round trip: it compares the vendor's artifact to ours.
      **Today this is RED on 9 of 9**, which is the point — the test is committed red-then-green, defect by defect,
      and its allowed-delta list is an explicit enumeration with a cited justification per entry, never a wildcard.
      > A round-trip test is a fixed-point test. `GraphRoundTrip.Once` cannot see a loss both legs agree to drop.
      > No new assertion may be added to `FbdCorpusRoundTripTests` or `LadderRoundTripTests` in place of this.
- [x] 1.2 **No fallback in the differ.** A census entry the differ cannot classify FAILS. It does not default to
      "equivalent", it does not normalize whitespace into agreement, and it does not skip a fixture it cannot
      parse. Repo policy: fail loud.
- [ ] 1.3 **`test/e2e/graphical/oracle.test.ts` stays the live counterpart.** It is the suite's only push-vs-fetch
      (non-fixed-point) oracle. Extend `expectNoOperandsLost` (`test/e2e/harness.ts:457`) with a
      stored-vs-pushed assertion, and update the normalization doc-comment at `harness.ts:435-455` — it describes
      what the *regenerate* loop produces (LET inlining, full parenthesisation, LD coil→network split,
      `NETWORK 0`→`NETWORK 1` renumbering), and a splice changes which of those still happen.

## 2. Defects — behaviour before structure

> **MEASURED 2026-08-27, and it changes this section's premise.** §2.1 and §2.2 were written as writer bugs,
> fixable before and independently of the splice. They are not. Both facts are destroyed at **READ** time, before
> `GraphWriter` ever runs, and the VG text has no spelling to carry them:
>
> - **2.1** — `GraphReader.LowerLadder` lowers a `<contact>` to an `InVar`, and `InVar` is
>   `(LocalId, ExecOrder, Expression, Mods)`. Nothing records "this leaf was a contact". The writer's choice is
>   structural — reached via the power spine ⇒ contact, via a data pin ⇒ box — so a contact feeding a DATA pin
>   cannot be reconstructed without type knowledge Volt does not have.
> - **2.2** — the reader folds comment boxes into one `GraphNetwork.Comment` string and drops empty ones, so
>   "there was a box here" is gone. All 6 recorded boxes are empty, one per network — they are the vendors'
>   per-network placeholders, not engineer content, which lowers the stakes but not the fidelity loss.
>
> Neither is fixable at this layer without a VG format change. **They are splice-dependent** (§3), which
> strengthens the case for §3 rather than weakening it: the splice is not an optimisation layered on top of fixed
> defects, it is the only available fix for most of them. Do NOT attempt 2.1/2.2 as writer changes — that was
> tried and the model was measured to be lossy first.
>
> **2.3 was fixable and is DONE** — not by carrying the attribute (which needs the splice) but by refusing to
> destroy it: `BodySpliceGuard` now rejects a stored body carrying `executionOrderId`, with U1 recorded in place.


Each lands with its own test, RED before the fix, and each lands BEFORE any splice code. A splice commit must not
carry a behaviour fix, or the fix reads as splice fallout.

- [ ] 2.1 **An LD contact feeding a data pin is demoted to a floating variable box and its power-rail wire is
      destroyed.** `GraphReader.cs:138-145` lowers a contact to an `InVar`; `GraphWriter.cs:443-450` (`EmitData`)
      re-emits a data-pin leaf as a box; `GraphWriter.cs:342` already admits the collapse. Measured on
      `tc-ld/ld_ton_rung_two_networks.plcopen.xml:119` (`contact` 3→2, `connection` 7→6).
      **Test: `LadderContactPreservationTests.Contact_from_the_left_rail_into_a_data_pin_stays_a_contact`** over
      that recorded fixture, asserting the `<contact>` count, the `refLocalId="0"` rail connection, and that the
      pushed body reads back identically. RED today.
      This is independent of the splice on purpose: an EDITED rung must regenerate correctly too, and a splice
      only protects rungs nobody touched.
      > `[UNMEASURED: U10 — whether the demotion is functionally harmless on a live PLC or changes the rung's
      > behaviour.]` Close by building and running the rung before and after on each vendor. Fix regardless: a
      > shape change we cannot justify is a defect whether or not it is also a runtime bug.
- [ ] 2.2 **Every recorded comment box is deleted because its text is empty.** `GraphReader.cs:42` filters
      zero-length text; `GraphWriter.cs:58,258` emits only when non-empty. All 6 recorded boxes
      (`ld_four_networks_shared_rails.plcopen.xml:33,66,99,132`; `ld_ton_rung_two_networks.plcopen.xml:61,102`)
      vanish. A box the engineer placed is content.
      **Test: `CommentBoxPreservationTests.An_empty_comment_box_survives_a_push`** over both recorded LD fixtures,
      asserting count, ORDER relative to the `networktitle` marker, and that a second push is idempotent. RED today.
      > `[UNMEASURED: U5 — no recorded export on EITHER vendor contains a comment with text; the only non-empty
      > comment in the tree is hand-authored (DIALECT D15).]` Close by typing a comment into a network in each IDE
      > and exporting. Until then the N-boxes-per-network merge at `GraphReader.cs:41` also stays `[UNMEASURED: U9]`
      > — no fixture has two comments in one network, so the merge is a code fact, not a measured loss.
- [x] 2.3 **`executionOrderId` is dropped SILENTLY.** Read at `GraphReader.cs:275`, written at `GraphWriter.cs:187`,
      but all 15 node constructions in `NetworkTextReader` pass `null`, the text has no spelling for it, and
      `ValidateExisting` never inspects it. It is NOT CFC-only: `docs/tc6_xml_v201.xsd:1220,1250,1279,1309,1333,1352,1370`
      declares it on the shared FBD/LD elements, and
      `packages/volt-lsp-iec/docs/codesys-reference/15-ld-elements.md:121` makes it coil-ordering semantics.
      **The interim behaviour is the repo's own rule: fail loud.** Add `executionOrderId` to the refusal in
      `ValidateExisting`, so regenerating a network that carries one is REFUSED with a message naming it, instead
      of silently zeroing execution order. §3 then makes carried networks keep it and the refusal narrows to
      changed networks only (§4.2).
      **Test: `ExecutionOrderRefusalTests.A_body_carrying_an_execution_order_is_refused_not_zeroed`.** RED today
      (today it silently succeeds). Measured cost of the refusal: **zero recorded exports carry one**.
      > `[UNMEASURED: U1 — whether either vendor emits it on an FBD or LD element at all.]` Close by building an
      > FBD network with an explicit execution order, and an LD rung with two coils on one variable, in EACH IDE,
      > then exporting. This is the single highest-stakes unknown in the change: it is the only measured loss that
      > is execution SEMANTICS rather than presentation or identity.
- [ ] 2.4 **A network's `Label` and `Disabled` are hardcoded away.** `GraphReader.cs:62` constructs every network
      as `new GraphNetwork(index, null, comment, false, nodes)` while `NetworkTextWriter.cs:44-46` renders both and
      `NetworkTextReader` parses both. `GraphWriter.NetworkTitle` (`:329-336`) regenerates an EMPTY
      `<alternativeText>`, so an IDE-set title is blanked.
      **Test: `NetworkLabelDisabledTests`** — one case pinning that the `networktitle` `<alternativeText>` survives
      a push byte-identical (RED today), and one `Skip`ped case for `Disabled` naming U3 as its blocker. Do not
      invent an XML carrier for `Disabled`.
      > `[UNMEASURED: U3 — what XML carries a DISABLED network, and whether `<alternativeText>` is in fact the
      > title carrier. All 6 recorded `networktitle` captures have it EMPTY, so the title half is unconfirmed
      > too.]` Close by disabling one network and titling another in each IDE, then exporting. The existing
      > `[UNMEASURED:]` marker at `NetworkTextWriter.cs:47-54` stays until the fixture lands — it is the correct
      > shape and `bun run check` enumerates it.
- [ ] 2.5 **Three false or orphaned comments** (convention 8: a false comment is a defect).
      - `NetworkTextWriter.cs:230-235` claims `GraphWriter`'s `case OpaqueNode` "serves only the reader→writer
        path, NOT push". **False for LD**: `NetworkCode.Validate`'s convergence gate (`NetworkCode.cs:76-78`) runs
        writer→reader→writer, and the writer's own per-network `networktitle` vendorElement returns from
        `GraphReader` as an `OpaqueNode` and is re-emitted verbatim at `GraphWriter.cs:106` — measured
        (`OPAQUE-LD kind=vendorElement`; FBD yields none). The safety property survives for a *different* reason:
        the IDE-bound write starts from `NetworkTextReader.Parse`, which cannot mint an `OpaqueNode`. Rewrite it to
        say that. The same comment's list of dropped kinds is also stale — contacts, coils and rails are lowered to
        real nodes and comments are folded into `GraphNetwork.Comment`, so what actually reaches `OpaqueNode` is
        `connector`, `continuation`, `vendorElement` and other unmodelled elements.
      - `GraphWriter.cs:243`: "The IDE re-numbers localIds on import, so strided ids are fine." No fixture, no
        `[UNMEASURED:]` marker, no DIALECT row — and it decides whether a carried-forward id survives a push/pull
        cycle. Mark it `[UNMEASURED: U2]` in place, with the probe that closes it.
      - `NetworkCode.cs:97-106`: a `<summary>` for a `NetworkCode.Write` method that does not exist, orphaned above
        the private `Canon` helper; the class summary at `:11` still claims the class owns `RenderBody`, `Validate`
        **and `Write`**. Delete/correct both.
      **Test:** none — these are comments. `bun run check`'s DIALECT gates (`scripts/check-wiring.ts:302-332`)
      cover the marker half.
- [ ] 2.6 **Gate:** all four offline suites at the 1.0 baseline plus the new tests, and `bun run check` green.
      A defect fix that changes an unrelated test count means something moved that shouldn't have.

## 3. The splice — network granularity, keyed by the index the engineer controls

- [x] 3.1 **Add the baseline leg to `NetworkCodec.Encode`** (`Document/BodyCodec.cs:173-196`). It already holds the
      stored body at `:178-181`. Render the stored body's network text (`NetworkCode.RenderBody`), split both
      baseline and pushed text by network, and for each index in the pushed text:
      - baseline text for that index is **byte-identical** → carry the stored network's XML elements across
        VERBATIM (ids, positions, `addData`, `vendorElement`, comments, pin modifiers, `executionOrderId`);
      - **different, new, or absent from the baseline** → regenerate that network exactly as today.
      Carrying requires equality, so a reordered or renumbered network simply regenerates. **Wrong-carry is
      impossible by construction** — there is no partial match, no nearest match and no fallback.
      **Test: `NetworkSpliceTests.An_untouched_network_survives_byte_identical`** over all 9 recorded exports, and
      `…Only_the_edited_network_is_rewritten` asserting that editing network *n* leaves every other network's XML
      byte-identical. Both drive `StoredVsPushedTests`' differ.
- [x] 3.2 **The wrapper element is still replaced when the LANGUAGE changes.** TwinCAT's `CreateChild` cannot
      create `"LD"` and seeds `<FBD/>` (DIALECT C6/B4), so `existing` can be `<FBD>` while the replacement is
      `<LD>`; keeping the old wrapper puts ladder contacts inside `<FBD>`, which the schema rejects — the reason
      `GraphSplice.cs:47-51` replaces the whole element. **A language change carries nothing forward.**
      Keep the `existing is null` first-write arm (`BodyCodec.cs:191`) unchanged: a first write has nothing to
      splice into, so "never constructs a body from nothing" is NOT the invariant. The achievable one is **never
      reconstructs over an existing populated network**.
      **Test:** extend `AccessorBodyLanguageTests` with an FBD→LD transition asserting nothing is carried.
- [x] 3.3 **LD rails are body-scoped, and carried with the body.** Both recorded LD exports bracket the whole body
      with one `leftPowerRail localId="0"` and one `rightPowerRail localId="2147483646"`
      (`ld_four_networks_shared_rails.plcopen.xml:29,165`), and `GraphWriter.cs:235,244-248,322-323` emits exactly
      that pair. A carried LD network references rail id `0`, so the pair must survive with it.
      **Test: `NetworkSpliceTests.A_carried_ladder_network_still_reaches_the_shared_rail`** over both `tc-ld/*`.
- [x] 3.4 **Regenerated ids must not collide with carried ones.** `LdCtx` mints contact ids above every model id
      (`GraphWriter.cs:367,389`); with stored ids now surviving, the floor becomes the max id in the whole spliced
      body. Also handle the index-drift case measured in `body-census.md` §1: when a network EMPTIES, `GraphReader.cs:65`
      renumbers it (`NETWORK 1` → `NETWORK 0`), so an index-keyed carry must not misfire on an emptied network.
      **Test: `NetworkSpliceTests.Ids_minted_for_a_regenerated_network_never_collide_with_carried_ids`** and
      `…An_emptied_network_carries_nothing`.
- [x] 3.5 **Re-validate the WHOLE spliced body before it is written.** The leaf fan-out refusal
      (`NetworkCode.cs:41-57`, DIALECT C4) exists because TwinCAT's importer *crashes*; it is a global rule and
      applies to carried halves as much as regenerated ones. So does the `NOT x` text-encoding of `inVariable`
      negation (DIALECT C3): a carried `negated="true"` on an `<inVariable>` would be dropped by TwinCAT's importer
      on the next push, so the splice must apply the same rule the writer does.
      **Test: `NetworkSpliceTests.A_spliced_body_is_revalidated_end_to_end`**, plus a case asserting a carried
      `inVariable/@negated` is re-encoded rather than passed through.
      > `[UNMEASURED: U11 — `<inVariable negated="true">` is exercised by no fixture on either vendor (DIALECT
      > D14).]` Close by negating an input variable in each IDE and exporting.
- [x] 3.6 **Nothing branches on a vendor.** Discriminate structurally — the presence of a `networktitle` marker,
      the presence of rails, the body element's own name — as `GraphReader.SplitNetworks` (`:76-98`) already does.
      `VendorParityGuardTests` fails the build otherwise. Do not rename `NetworkTextReader.cs`; partials named
      `NetworkTextReader.X.cs` are safe.
      **Test:** the two existing guards; assert their scanned-file floors still pass.
- [~] 3.7 **Live gate — HALF MEASURED, half still open, and the open half is recorded in the code.**
      **Measured, live CODESYS** (`test/e2e/graphical/splice.test.ts`): a part-vendor, part-Volt document
      imports cleanly, COMPILES, and is a fixed point on re-push. That was the main risk — a hand-assembled body
      mixing stored and regenerated elements being rejected outright — and it is closed.
      **Still open:** whether the importer NORMALIZES what was carried. The wire serves network TEXT, not XML, so
      a normalization that preserved the text while rewriting ids or dropping vendor `addData` looks identical
      from e2e — the same blind spot this change exists to close, one layer out. Needs the exported document (a
      bridge-side XML dump, or an IDE export after a spliced push). **TwinCAT is entirely unmeasured.** Carried
      forward as an `[UNMEASURED: U6]` marker on `NetworkSplice` itself, per §9.3.
      Original text:
      > `[UNMEASURED: U6 — whether a spliced, id- and attribute-preserving body imports cleanly on either vendor,
      > or whether the importer normalizes it. Every live verification to date (`GraphWriter.cs:229-243`,
      > `test/e2e/graphical/*`) exercised the REGENERATED body; the splice path has never met a live importer.]`
      Close it HERE, not later: push a spliced body to live CODESYS and live TwinCAT, re-export, diff. If the
      importer normalizes what we carried, the splice's value is bounded by that normalization and the census in
      `body-census.md` §2 must be re-scored against it. **Do not ship §3 without this measurement.**
      Watch DIALECT D4d on the TwinCAT side: its import INVALIDATES every handle to the replaced item, so any work
      continuing through the same handle after a body write fails on one vendor only.

## 4. The refusal gate, re-scoped — narrower in SCOPE, not softer in what it refuses

- [ ] 4.1 **Move `ValidateExisting` (`GraphSplice.cs:67-118`) from the whole body onto the set of networks being
      REGENERATED.** A carried network loses nothing, so refusing on its account is no longer justified.
      Corrections to carry into the code's own doc-comments while doing it: the gate inspects the **stored** body,
      not the pushed one (network text cannot express any of the five refused kinds); it is **replace-only**
      (`BodyCodec.cs:191` returns before it on a first write, and a rename is remove+add); and the exception does
      not escape — `Sync/PushService.cs:69-78` converts it to a `PushResponse.RejectedResult`.
- [ ] 4.2 **The trap: this must not become a silent regression.** An element outside `SafeToDrop`, an in-out pin,
      an output-pin modifier, a multi-source FBD pin or a stateless multi-output function inside a network the
      engineer **edited** is still a loss and must still be refused, with the same message.
      **Test: `GraphSpliceTests` gains a matrix pair per refusal** — the construct in an UNTOUCHED network (push
      succeeds, construct survives byte-identical) and the same construct in an EDITED network (push refused, the
      message still names it). The existing refusal assertions (`GraphSpliceTests.cs:61-77`, `:155-215`) stay.
- [ ] 4.3 **Re-derive `SafeToDrop` per justification class.** Its 12 entries conflate three: represented in network
      text (`inVariable`, `outVariable`, `block`, `label`, `jump`, `return`); regenerated by the writer
      (`leftPowerRail`, `rightPowerRail`, `contact`, `coil`, `comment`); asserted cosmetic and NOT put back
      (`vendorElement` alone). And `vendorElement` is double-duty: on LD it is the `networktitle` delimiter that
      `GraphWriter.NetworkTitle` (`:329-336`) regenerates EMPTY, on FBD it is `implementationattributes` that
      nothing regenerates. One name, two fates, one set entry. Split it, and say per entry which class it is in.
      > `[UNMEASURED: U4 — what `BoxInputFlagsSupported="true"` controls in either IDE, and whether destroying it
      > changes anything the engineer sees. It is the highest-frequency measured loss (7 of 9 exports) with
      > entirely unknown consequence.]` Close by pushing a body with it removed to each live IDE and observing.
      > The splice preserves it on carried networks either way; this bounds how much a REGENERATED network costs.
- [ ] 4.4 **The gapped-numbering refusal (`GraphSplice.cs:81-92`) stops firing on untouched networks.** It
      currently refuses a real recorded Beckhoff body: the action `ACT_FBD` inside
      `tc-fbd/PLC_PRG_jump_sr.plcopen.xml`, indices `{1,2,4,5,6}`. (Its parent POU `PLC_PRG` has an `<ST>` body and
      is unaffected — the export is not un-pushable, one child item of it is.) Note also that the gate is
      structurally INERT on LD: every LD localId divides to bucket 0, so `indices.Count > 1` never fires on a
      four-network ladder.
      **Test: `GraphSpliceTests.A_gapped_body_is_pushable_when_the_gapped_networks_are_untouched`** over that
      recorded fixture — RED today.
      > `[UNMEASURED: the gate's own stated reason — that a gap MEANS a disabled or hidden network — is an
      > inference; no fixture contains a gapped body with a known-disabled network.]` Same probe as U3.

## 5. The identity decision — scheduled, not assumed

Statement granularity is the natural next stage. It is **not** in this change, and the reason is measured, not a
preference.

- [ ] 5.1 Record in `src/Volt.Engine/Document/DIALECT.md` (or a `Graph/` note beside the code) the measured verdict
      from `body-census.md` §5: node-level matching is not viable (57% of nodes have no statement, 8% have no
      element, literals collide 57.1% BY DESIGN because of the fan-out guard), and a neighbourhood fingerprint is
      *worse* than a content key because it reads a lossy projection. Write it down so it is not re-litigated.
- [ ] 5.2 **State the two prerequisites for statement granularity plainly, and do not build them here:**
      (a) `NetworkTextWriter` must emit a side-channel mapping each rendered statement to the model localIds it
      consumed — it knows this as it renders and discards it today; (b) `GraphReader.LowerLadder` must record which
      stored `contact`/`coil`/`block` each lowered node came from — today its ids are synthetic
      (`GraphReader.cs:51`).
      > `[UNMEASURED: U17 — whether each lowered LD node can be traced to exactly ONE stored element. The two
      > synthesized `AND` blocks (`GraphReader.cs:242-249`) suggest some are many-to-one or zero-to-one.]` Close by
      > attempting the mapping over both `tc-ld/*` fixtures. If it is not 1:1, statement granularity is FBD-only
      > and that must be said rather than discovered.
      > `[UNMEASURED: U16 — how the §5 collision rates scale. The largest network in the corpus has 10
      > node-elements, the median 4; literal collisions grow superlinearly with network size, so 57.1% is a FLOOR.]`
      > Close by exporting networks from the 4-project corpus and re-running the collision script.
- [ ] 5.3 **A text-format change is REFUSED for now, and the refusal is recorded with its cost.** A per-statement
      `// @<n>` anchor is viable — the writer mints it, the reader carries it on `GraphNode`,
      `NETWORK_NOT_CANONICAL` (`NetworkCode.cs:59-67`) is made anchor-preserving, and a duplicate-anchor refusal
      joins the existing `NETWORK_DUPLICATE_NAME` (`NetworkTextReader.cs:411-418`). It buys nothing the baseline
      render does not already give, and it costs readability. A per-NODE anchor
      (`((FALSE@1 AND TRUE@2)@3 AND FALSE@4)@5`) is refused outright — it destroys the readability that is VG's
      whole justification.
      **The decision point:** revisit ONLY if the stored XML turns out not to be reliably in hand at push time. It
      is today (`BodyCodec.cs:178-181`). Name the condition; do not build against it.
      > `[UNMEASURED: U18 — whether `NETWORK_NOT_CANONICAL` can be made anchor-preserving without weakening it.
      > Not attempted.]` Only worth closing if 5.3's condition ever fires.

## 6. Docs, DIALECT and the vendor record

- [ ] 6.1 `packages/volt-cli/ARCHITECTURE.md` — the graphical row currently describes wholesale regeneration.
      State the new rule plainly, next to the existing content-vs-structure invariant: **a push rewrites only the
      networks whose text changed.**
- [ ] 6.2 `src/Volt.Engine/Document/DIALECT.md` hygiene — `bun run check` gates on this
      (`scripts/check-wiring.ts:302-319`):
      - **B6 is overturned and unretracted.** It still reads "TwinCAT ADDS and FAILS on a name collision, so it
        must delete first", citing `TcPlcOpen.cs:38-51`; that code now passes `PLCIMPORTOPTIONS_REPLACE`
        (`TcPlcOpen.cs:34,63`) and D4c overturns it. Add the `[RETRACTED -> D4c]` token. It is also still labelled
        "the deepest genuine divergence in the path", which is no longer true.
      - **D11 and D12 citations have drifted.** D11 cites `GraphWriter.cs:219` for a live-CODESYS-verification
        claim; that line is now inside `JoinTypes` and the claim moved to `GraphWriter.cs:229-234`. D12 cites
        `NetworkTextReader.cs:228-232`; the EN/ENO convention doc is now at `:234-237`.
      - **Part 9 entries #2 and #4 are stale** — both were fixed in source (`GraphReader.cs:365-371` now carries
        the LD qualifier and cites `tc-ld/ld_ton_rung_two_networks.plcopen.xml`; the `language` override parameter
        was deleted). Retire them.
      - Add a row for each loss this change closes, each citing the fixture that proves it.
- [ ] 6.3 `docs/network-text.md` and `docs/network-text-diagnostics.md` — the format is unchanged by this work
      (5.3), so the only edit is anywhere the docs describe the push as regenerating the body.
- [ ] 6.4 Leave `openspec/changes/archive/` untouched. Rewriting a frozen record falsifies it.

## 7. One write path — collapse the duplicates, delete the superseded

Evidence: `write-path-census.md` §3–§4. **The folder and file shape these collapse into is decided up front in
`target-layout.md`** — a duplicate is collapsed *by* giving it one owner, so the move and the collapse are the
same edit, and §7 is interleaved with that layout's §5 sequencing rather than followed by a separate rename
commit. `target-layout.md` §4 also adds one source-scanning guard per collapsed rule, so a second path fails the
build instead of becoming a production incident.

Every item here is a DUPLICATE or a DEAD path, not a behaviour change — so
each lands with the offline suites green and no test rewritten to accommodate it. Where a duplicate pair
*disagrees*, the divergence is a defect and belongs in §2, not here; the two such cases are called out below.

Order matters: delete dead code first (it cannot break anything), then collapse live duplicates.

- [x] 7.1 **Delete the ~97 dead lines of `GraphSplice`** — `SpliceFbdLdBody` (`:40-58`), `InlineInsert`
      (`:120-135`), `FindFbdLd` (`:150-156`), `FindFbdLdBody`. Verified zero production callers: 16 references, 15
      in `GraphSpliceTests.cs` + `TestPlcOpen.cs:33`, plus its own definition.
      **The 15 test call sites are retargeted, not deleted** — they exercise `ValidateExisting`, a real production
      contract reached from `BodyCodec.cs:192`; they are merely driving it through the wrong entry. Point them at
      `RequireReplaceable`. Coverage before and after must be identical: record the count both ways.
      What survives (`RequireReplaceable`, `ValidateExisting`, `SafeToDrop`, `HasPinMod` — ~60 lines) moves next to
      the gate §4 re-scopes, and the file's doc-comment (`:12-15`, which claims it *"belongs with the graph, not
      with the document"* while sitting in `Document/`) is corrected — convention 8.
- [x] 7.2 **Delete `PushService.RemoveOrphanChildren`** (`:407-425`) and the `TreeNav.cs:69` doc-comment pointing
      at it. Member removal moved into the document (`PouSplice.RemoveChild`, reached from `PouDocument.cs:55,90`).
      For the record: the audit's orphan-walk fix landed *inside* this method, so that fix was inert — the
      behaviour is correct anyway, because the document splice never had the bug. `DIALECT.md:131` still describes
      it as reachable; corrected in 6.2.
- [x] 7.3 **Delete `PlcOpenDocument.DeclFromExport`** (`:119-142`) — its no-filter rule is the trap
      `MaterializerChildDeclTests.cs:12,23` names, and it is a THIRD answer to the ownership question §7.6
      collapses.
      Its only caller is `Sync/NetworkCodeIo.cs:62`, and **`NetworkCodeIo` itself has zero production callers** —
      re-measured: the only reference from `src` is a `<see cref>` doc-comment at `BodyCodec.cs:72`. It is 66
      lines of test-only code living in `src/`. So this is not "re-point the seam at another reader": **move
      `NetworkCodeIo.cs` into the test project and delete `DeclFromExport` outright.** Its 12 test call sites move
      with it unchanged.
      (This supersedes the earlier plan to give the seam `PouReader.DeclFromElement`, which was written before the
      seam was measured to be test-only. Third instance of the same pattern as 7.1 and 7.2 — shipped code nothing
      calls. `target-layout.md` §4 G5 is the guard that catches the class.)
- [x] 7.4 **Delete the `WritesPouAsOneDocument` remnants** — the stale test-double property at
      `NetworkCodeTests.cs:252` and the dead `bodyImpl` assignment at `PushService.cs:295`; rewrite the comment at
      `PushService.cs:218` to describe what exists. `DIALECT.md`'s headline (`:31-37`) and rows **D4e**/**D4h** are
      written against this removed fork and are corrected in 6.2 — they currently gate the "single-document write
      is CODESYS-only" conclusion on a branch that no longer exists.
- [x] 7.5 **Collapse the four declaration writers onto W1's rule** — `OwnDescendants`, ALL copies, THROW on absent.
      `SetChildText`'s arm (`:450-463`) is already byte-identical to `SetDeclaration` (`:38-62`); extract the
      shared body. `AddChild` (`:269`) constructs and is fine.
      **`SetAccessor` (`:402-415`) is the defect** — first-only where the others take all, and silently *creates*
      where the others throw. Writing only the first is the exact silent no-op `PlcOpenDocument.cs:53-58` documents
      and DIALECT **A7** confirms. Its fix carries a test that is RED first, driven from a recorded fixture.
      Blocked on **U21** for the two-copy case specifically: no recorded accessor declares a variable, so the A7
      shape has never been exercised on one. If U21 cannot be measured before this lands, apply W1's rule anyway —
      writing all copies is correct whether there are one or two — and carry U21 forward still open.
- [x] 7.6 **One containment predicate for read and write.** `PlcOpenDocument.OwnDescendants` (`:63-64`) is
      case-sensitive over 9 element names; `PouReader.ChildDeclContainers` (`:223-225`) is `OrdinalIgnoreCase` and
      additionally excludes `<get>`/`<set>`. Two lists answering one question.
      Resolve on measurement (**U22**): if neither vendor emits `<get>`/`<set>`, **delete** the asymmetry rather
      than propagate it. Case-insensitivity is the safe direction and costs nothing — take the reader's.
      Test: one fixture-driven assertion that reader and writer agree on ownership for every element in every
      recorded export.
- [x] 7.7 **Collapse the three body-guard blocks onto B1's** (`SetBody:92-146` — five checks, `establishing`
      exemption, marker no-op). `SetAccessor:377-399` and `SetChildText:478-488` carry two of the five each;
      `AddChild:216` has **no guard at all**.
      **The B1/B4 marker disagreement is a defect** — a restated CFC marker is a no-op at the root (`SetBody:107`)
      and a throw for a child (`SetChildText:480-483`), while `SetBody:103-106` calls the same asymmetry in the
      other direction unjustified. It goes in §2 with a red-first test, not here.
- [x] 7.8 **One constant each.** xhtml namespace: 4 declarations (`PouSplice.cs:204`, `:335`, `BodyCodec.cs:136`,
      `GraphWriter.cs:20`). 3S namespace root: 4 spellings (`PouSplice.cs:168`, `ProjectStructure.cs:41`,
      `GraphWriter.cs:208`, `:334`). Both go to `Vocabulary/` — Level 0, and already the home for exactly this
      (`Languages.cs:6-10`).
- [x] 7.9 **One `Serialize`.** `TcItemArchive.cs:183` is a byte-identical open-coded copy of
      `PlcOpenDocument.Serialize` (`:46-47`), whose documented reason (`:37-45`: `ToString()` drops the XML
      declaration, found by the no-op identity test) applies equally to a `.TcPOU`. The TwinCAT driver already
      references `Volt.Engine`, so this is a call, not a move. **`TcItemArchive` itself does NOT move up** — it
      needs `System.IO.Compression`, and `Volt.Engine` is `netstandard2.0`.
- [x] 7.10 **Replace the regex-over-XML** at `BeckhoffDriver.Code.cs:105-110` (`ExtractTag`) with the `XDocument`
      parse already present at `:84-103` **in the same file**. `TcItemArchive.cs:133-134` states the repo's rule
      for precisely this: *"a regex over that works until a body happens to contain the pattern."*
      Test: a fixture whose body text contains the tag pattern — red before, green after.
- [x] 7.11 **Retire the ten stale symbol references** left by the unrecorded second rename
      (`write-path-census.md` §5): `CodesysObjectModel.PlcOpen.cs:50`, `CodesysTypeMap.cs:39`, `RefsFetch.cs:66`,
      `BodyCodec.cs:22`, `GraphSplice.cs:12`, `PlcOpenDocument.cs:24`, `PouSplice.cs:10`, `ItemContent.cs:17`,
      `ItemKind.cs:232`, `DIALECT.md:188`, plus `ARCHITECTURE.md:64` and `:215`. Comment-only; no behaviour.
      Also add a close-out note to `openspec/changes/restructure-plcopen-layer/` recording that a second rename
      landed after it — **do not rewrite that change's body**, which is a frozen record (9.3's rule).

### What §7 deliberately does NOT do

- **It does not centralize the twelve-plus "is this graphical?" decision sites** (`write-path-census.md` §3.4).
  They sit across guard, push and read concerns that legitimately ask different questions of the same fact, and
  merging them is a separate change with its own blast radius. The *predicates* are already centralized in
  `Vocabulary/Languages.cs` — that was the part actually duplicated.
- **It moves and renames nothing in the guarded sets.** `WireVocabularyGuardTests` keys on bare filenames and
  strips partial-class suffixes, so splitting `PouSplice.cs` into `PouSplice.Declaration.cs` is free — but renaming
  any of `ItemKind.cs`, `PlcOpenDocument.cs`, `PouReader.cs`, `PouSplice.cs`, `ProjectStructure.cs`,
  `NetworkTextReader.cs` breaks the build, and merging their content into a non-exempt file does too.
  `scripts/check-wiring.ts:263` additionally hardcodes `src/Volt.Engine/Document/DIALECT.md`, so `Document/` cannot
  move. Any layout change beyond splitting is a separate, explicitly-scoped change.
- **It creates no new assembly.** `Volt.Engine` is `netstandard2.0` because it loads in CODESYS's net48 IronPython
  host as well as net8.

## 8. Explicitly NOT in this change

- **Statement and node granularity** — §5, scheduled with its prerequisites and its blocking measurements.
- **A text-format anchor** — §5.3, refused with its condition named.
- **Restoring diagram layout** — there is none in the transport to restore. Where it lives is `[UNMEASURED: U14 —
  TwinCAT's native `.TcPOU` NWL archive carries `DefaultViewMode`, `NetworkListComment` and per-network
  `Comment`/`Title`/`Label`/`OutCommented`/`Id` that PLCopen does not, but no populated NWL capture with real boxes
  exists in the repo and CODESYS's equivalent store was never examined.]` Close by moving a box in each IDE,
  saving, and diffing the native project store. It may also answer U3.
- **CFC / SFC / IL** — marker-only, refused on push, and a different mechanism entirely (a read-only diagram
  preserved verbatim is not this splice).
- **Closing the vendor-coverage gaps that are recording tasks, not code tasks** — U7 (no CODESYS LD capture exists
  ANYWHERE; DIALECT D11), no recorded CODESYS multi-network FBD, no `jump`/`label`, EN/ENO box, embedded output or
  `<comment>` on the CODESYS side (D12, D13, D15), U12 (no `stcode`/Execute-box fixture on either vendor), U15
  (whether `connector`/`continuation`/`actionBlock`/`inOutVariable` occur in real field projects), U20 (a
  body-level `<addData>` sibling alongside an FBD/LD body). Each is one export away and none blocks §3, but U7 in
  particular bounds how much of the LD path is verified at all.

## 9. Close-out

- [ ] 9.1 Final gate: Release build clean; all four offline suites at or above the 1.0 baseline;
      `StoredVsPushedTests` GREEN on all 9 recorded exports with an explicitly enumerated, individually justified
      delta list; live CODESYS **and** live TwinCAT e2e green including 3.7's spliced-import measurement;
      `bun run check` green with every new DIALECT row cited and every `[UNMEASURED:]` marker enumerable. Plus §7's own
      gate: **zero production references to any deleted symbol**, and `GraphSplice`'s 15 retargeted tests at an
      identical assertion count — a duplicate collapsed by dropping coverage is not a collapse.
- [ ] 9.2 Record what shipped against what was proposed, and **record every prediction that turned out wrong** —
      the last change's most useful artifact was §3.3's stated expectation being wrong and saying so.
- [ ] 9.3 Carry every still-open `[UNMEASURED:]` item forward as a marker in the code it bears on, not as a note in
      this folder. A change folder gets archived; two vendors do not stop existing.
