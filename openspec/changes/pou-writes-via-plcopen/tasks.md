## 0. Evidence already in hand (do not re-derive)

Measured live on CODESYS 3.5.21.40 against the corpus project, delete verified at each step:

- a PLCopen import **writes a POU's declaration**, and **`<InterfaceAsPlainText>` alone drives it** — the typed
  `<interface>` block was left stale and the plaintext still won. No ST→typed-XML generation needed.
- a POU survives export → delete → import with children intact: 4 methods / 8 properties / 3 actions, counted as
  elements in the document before and after.
- `export_xml` recursive == the old manual child-collection walk, byte-identical, and 4.6x faster.
- the CODESYS transport is in-memory (path `""`, XML returned); TwinCAT's is a temp file.

Known failure modes, to be tested BEFORE relying on them:

- an import **relocates the POU to the project root** when the parent is not passed — observed live.
- PLCopen carries **no folder membership**, so nothing in the document protects placement.

## 1. Folder preservation first — the known failure, pinned before anything depends on it

- [x] 1.1 **DONE** — `test/e2e/lifecycle/folder-preservation.test.ts`: a POU created one, two and THREE folders
      deep is edited IN PLACE (no `toFolder`) and must still be in the same folder, with the edit applied. Depth
      is the point: one level can be preserved by accident if the import's default parent happens to be right.
- [x] 1.2 **DONE** — a fourth case carries `METHOD + ACTION + PROPERTY` and asserts the children survive the
      in-place edit as well; a write that loses placement is just as likely to lose members, and both are silent.
- [x] 1.3 Gate met. Baselines MOVED, and later tasks must hold the NEW numbers, not the old ones:
      **CODESYS 96 pass / 8 skip / 0 fail** (was 92), **TwinCAT 94 pass / 11 skip / 0 fail** (was 90).

      > These pass TODAY under `WriteText` — nothing is deleted, so nothing can be relocated. That is exactly
      > why they were written first: they pin the behaviour BEFORE the mechanism changes, so a regression is a
      > red test rather than an engineer's POU quietly reappearing at the top of their project tree.

## 2. The splice surface (offline, fixture-driven)

- [x] 2.1 **DONE** — `PlcOpenDocument.SetDeclaration(xml, itemName, declaration)`. Scoped by name via `OwnerOf`,
      and the plaintext block it targets must be the item's OWN (`OwnDescendant`) — a method and an accessor each
      carry their own `InterfaceAsPlainText`, so an unscoped write would put a POU's declaration on its getter.
      Absent item, or absent plaintext block, THROWS: a declaration write that silently hit nothing is the exact
      failure this change exists to remove.
- [x] 2.2 **DONE** — `PlcOpenDocument.SetTextualBody(xml, itemName, bodyText)`. REFUSES a graphical body rather
      than flattening it, mirroring the live body-format guard so the splice cannot become a second way to cause
      the CFC-child bug.
- [~] 2.3 **REPLACE + REMOVE done; ADD still open.** `SetChildText(xml, item, child, decl, body)` and
      `RemoveChild(xml, item, child)`. A null decl/body means "leave it" — distinct from `""`, which clears, so a
      body-only edit cannot blank a declaration. Removal takes the `<data>` WRAPPER, not just the member: both
      vendors nest a method/property in its own `<addData>/<data name="…/method|property">`, and dropping only
      the member leaves an empty `<data>` the IDE has no meaning for. An ACTION is the other container
      (`<actions>`), covered by the TwinCAT fixture.
      **ADD is deliberately not folded in here**: it must build a whole member element to the vendor's shape, and
      creating one silently inside an "update" call would hide the difference between update and create at
      exactly the layer that must not guess. It lands with §3, where the push knows which it meant.
- [x] 2.4 **DONE** — `PlcOpenSpliceTests`, 18 cases, every one against a RECORDED vendor export.
      Needed a new fixture: nothing in `fixtures/` had a POU WITH PROPERTIES. Captured `codesys-pou/BoxFB` (18 KB,
      5 methods + 3 properties with BOTH accessors) from the Pro corpus.
      > The survey that looked for one first reported "every POU has 8 properties" — those were the contentHeader's
      > PROJECT INFORMATION (`<property name="Author">` …), which is in every export and is not a POU child.
      > `<GetAccessor>` is the signal that distinguishes a real one; POU properties are capital `<Property>`.
      Includes the scoping case that matters: writing the enclosing POU's body must leave its ACTION's graphical
      body byte-identical — the shape of three previous data-loss bugs.
- [x] 2.5 **DONE, and it earned its keep immediately.** The no-op identity test failed on first run: the fixture's
      empty body is `<xhtml />` and the splice re-serialized it to `<xhtml></xhtml>`. Semantically identical, but
      it moved bytes it was not asked to move — so the SPLICE was fixed, not the test. Both setters now return the
      ORIGINAL string when the content already matches. That is the property that makes splicing safer than
      regenerating; without it the guarantee is only "probably equivalent".

## 3. Route the push through it — CODESYS

### 3.1 BLOCKED — a POU import FLATTENS the POU's internal child folders

**Measured, delete verified, on `CassetteFB` (the corpus POU that uses them):**

| | children | of which folders |
|---|---|---|
| before | 54 | 2 (`/Private`, `/Properties`) |
| after export → delete → import | 52 | **0** |

Every child survived; their ORGANISATION did not. `/Properties/ActualPositionX1` came back as
`/ActualPositionX1` — 46 children flattened out of 2 folders.

`export_xml`'s **`bExportFolderStructure`** flag (passed `false` everywhere in the driver) was the obvious
suspect and is not the answer: with it TRUE the export grows 68,606 → 72,882 bytes, so folder data IS added,
and the import still returns 0 folders.

**Why this blocks §3.1 rather than being a detail.** The import deletes and recreates the POU, so child
handles are stale afterwards — there is no "write the children separately". Everything must travel in the one
document, and the document cannot carry the folders. Today's per-child path PRESERVES them (it resolves each
child's folder and creates there), so routing writes through PLCopen would be a REGRESSION on user structure,
silently, on every push of a POU that organises its members.

**CORRECTION — it IS fixable, and calling it a second mechanism was my error.** Volt already carries child
folders in its OWN representation: `PouToStText` writes a `%FOLDER <path>` directive into the child's body,
`StSplitter` peels it back into `ChildData.Folder`, and `PushService.ResolveFolder` → `FindOrCreateFolder`
places the child on push (segments percent-encoded, so a real folder named `Interfaces / Data` survives).
So the folder information never depended on the vendor document at all.

§3.4 already states the rule this falls under: **structure — create, rename, move, folders — stays on the
scripting API**, because PLCopen has neither rename nor folder membership. Re-placing children after the
import IS that mechanism doing its job; it is not a second CONTENT transport. I conflated "one content
transport" with "one API", which the change never claimed.

So the flattening is a step the write must UNDO, not a blocker:
  import the document (content)  →  re-place each child into its `%FOLDER` (structure).

- [x] 3.1 **DONE on CODESYS — one import, no delete, then `move` for placement.** Live e2e back at the
      post-§3.1b baseline: **98 pass / 8 skip / 0 fail**.

      What landed:
      - `PushService` writes an existing POU as ONE `WriteXml`. The per-child `CreateChild`+`WriteText` loop, the
        accessor writes and `RemoveOrphanChildren` no longer run for it — child add/update/remove all travel in
        the document.
      - `PouDocument.Splice` builds that document from the item's own export via the §2 splice surface.
      - `CodesysDriver.WriteXml` MERGES (`ConflictResolve.Replace`, no delete). `PlcOpenTransport`'s
        capture/restore is unreachable from it: nothing is deleted, so a refused import leaves the POU intact.
      - `IProjectTree.Move` is new; `PushService.RestoreChildFolders` re-places each child that carries a
        `%FOLDER` after the import flattened it. TwinCAT's `Move` THROWS pending §5.1b.
      - `ICodeStore.WritesPouAsOneDocument` gates it to the measured vendor. **Delete it when §5 lands.**

      **Three bugs the live gate caught that no offline fixture could — all in the splice surface, all silent:**

      1. **A declaration write hit the WRONG element.** Once a POU declares any variable, CODESYS exports its
         declaration TWICE — inside the typed `<interface>`'s addData AND in the item's own trailing addData.
         `SetDeclaration` took the FIRST (the nested one) while the IDE kept reading the other, so every
         declaration change was accepted and did nothing. It surfaced as 31 red e2e tests: `restorePlcPrg` could
         not remove a deleted FB's instance, so the project stopped compiling and every later test cascaded.
         Every offline fixture had an EMPTY `<interface>` and therefore ONE copy — which is exactly why it hid.
         Fixed by writing EVERY copy the item owns (`OwnDescendants`), with a recorded two-copy fixture
         (`FB_TwoDeclCopies.plcopen.xml`) pinning it.
      2. **Every splice was dropping the `<?xml ?>` declaration** — `XDocument.ToString()` omits it. Caught by the
         no-op identity test on `PouDocument.Splice`, the same way §2.5's caught the `<xhtml />` re-serialization.
         `SetChildText`/`SetAccessor` also lacked §2.5's return-the-original rule; they have it now.
      3. **`move` was "missing" twice over.** It is not on `ScriptObject`'s own method table (it comes from an
         interface) and its signature is `move(IExtendedObject<IScriptObject>, int)` — the index is NOT optional.
         Both arity-exact `InvokeMethod` and `InvokeWithOptionals` reported "no such method" for a method the
         scripting console calls happily. **This is also how §3.1 got stopped in the first place**: a probe that
         enumerates only `GetType().GetMethods()` concludes the vendor has no move. Enumerate `GetInterfaces()`.

      The plan was: import the document (content), then re-place children into their `%FOLDER` via the existing
      structural API. Checked what that API can actually do:

      - `IProjectTree` exposes `CreateChild` / `Delete` / `Rename`. **There is no move.** Confirmed in
        `CodesysObjectModel` and `TcObjectModel` too — neither has one.
      - `PushService.MoveItem`, for a TOP-LEVEL item, is implemented as a full-fidelity RECREATE: read the
        source, delete, create in the new folder, write the content back.
      - `ResolveFolder` only finds-or-creates the folder NODE. Placement happens at `CreateChild` time; it
        cannot relocate an existing child.

      So re-placing a flattened child means delete + `CreateChild` in the folder + `WriteText` — **exactly the
      per-child COM path this task exists to remove**, now with an extra whole-POU import in front of it. For a
      POU that uses child folders the single-document write eliminates nothing and adds an import. For one that
      does not, it works — but branching on "does this POU use folders" is MORE code paths, not fewer, which is
      the opposite of the goal.

      This is the change's own stop condition: do not invent a second write mechanism to work around a vendor
      limit (§5.5).

      **REOPENED — the delete was the driver's choice, not a requirement.** `WriteXml` deletes first and then
      imports, which is what flattens the folders. Importing WITHOUT a delete, into the parent container so the
      name collision engages `ConflictResolve`, measured on CODESYS:

      | mode (no delete) | declaration | body | child tree |
      |---|---|---|---|
      | **Replace** | ✗ | **lands** | **preserved** |
      | Copy | ✗ | ✗ | preserved |
      | Skip | ✗ | ✗ | preserved |

      (The driver already picks `Replace`, then renders it moot by deleting first — its own comment says the
      mode is "effectively moot", so no mode had ever actually been exercised.)

      So no move primitive is needed after all: nothing flattens because nothing is deleted. What does NOT
      land on a merge is the DECLARATION, which `ide.WriteText(pou, decl, null)` already writes today.

      **UNBLOCKED — both unknowns measured, and the declaration row above is WRONG.** Measured live on CODESYS
      3.5.21.40 against a purpose-built fixture (`test/Untitled1.project`: `FB_GraphicalChild`, an ST function
      block with a **CFC method child** — the exact shape of the first data-loss bug, and one no test could
      provision itself because CFC is read-only and Volt never creates one). Every step is a merge into the
      POU's PARENT with `ConflictResolve.Replace` and **no delete**:

      | question | measured |
      |---|---|
      | **UNKNOWN 1** — does a merge ADD a child only in the document? | **yes** — `VltProbeAdd` appeared |
      | **UNKNOWN 2** — does it leave a child not in the document? | **no** — it was REMOVED |
      | declaration lands? | **yes** — and CODESYS regenerated `<interface><localVars>` from the plaintext |
      | textual body lands? | yes |
      | CFC child survives? | yes, and unchanged by writes to the enclosing POU |

      So the whole child lifecycle — add, update, remove — plus the declaration and the body travel in the ONE
      import. The earlier `✗` for the declaration was an artifact of a probe that exported without
      `declarations_as_plaintext`, so the document carried no `InterfaceAsPlainText` for the POU and there was
      nothing for the import to read. The driver's own `ExportNodes` already passes that flag true, so the
      shape under test IS the shape the driver produces.

      That kills the honest-cost caveat and the separate orphan walk with it:
      - declaration + body + children + accessors + graphical bodies → ONE import, `Replace`, no delete
      - child add / update / **remove** → all expressed in that document; no `ide.Delete` per orphan
      - child folders → preserved for free (nothing is deleted, so nothing is re-placed)

      **The folder question, settled — and BOTH of this file's earlier claims about it were wrong.**
      Measured on `FB_FolderChild` (hand-authored: an ACTION inside a `testfolder`):

      | claim, as previously written here | measured |
      |---|---|
      | "PLCopen carries no folder membership" | **false** — `export_xml`'s 4th arg (`bExportFolderStructure`) emits `<data name=".../projectstructure"><ProjectStructure><Object …><Folder Name="testfolder">` |
      | "a merge preserves the child tree" | **false** — the merge FLATTENS it: `testfolder` is pruned and `ACT` lands at the POU root |
      | "there is no move primitive" | **false** — that was read off Volt's own `IProjectTree`, not off the vendor. A CODESYS `ScriptObject` has **`move`**, and it works |

      The folder data is exported with `handleUnknown="discard"`, which is precisely what the import does with
      it: sending a document that CONTAINS `<Folder Name="…">` still flattens. So the document describes
      placement and the import ignores it — content transport only, exactly as §3.4 says.

      **So §3.1's mechanism is settled, and it is two calls, not a per-child loop:**

          import the document (content: decl + body + children + accessors + adds + removes)
          then, for each child whose %FOLDER is non-empty:  create_folder if pruned, then child.move(folder)

      Verified end to end on `FB_FolderChild`: the action body landed, the folder was pruned, `create_folder` +
      `move` restored `testfolder/ACT` exactly, and the merged body survived the move. `FB_GraphicalChild`'s CFC
      child was untouched throughout — the write has no blast radius onto a sibling POU.

      `move` is the one primitive Volt must ADD (`IProjectTree.Move`), and §5.1 must establish whether TwinCAT
      has an equivalent before §5 can rely on it.

      **One measured caveat, and it is a diff, not data loss.** The first merge RENUMBERS the CFC child's
      `localId`s (the graph is equivalent; ids and element order are normalized). It converges immediately —
      a second merge of the re-exported document leaves the CFC block byte-identical. So a POU with a graphical
      child shows one-time churn on its first push through this path, then is stable. Must be stated in §4.3's
      manual check rather than discovered by a user reading a surprise diff.

      Probe: three headless CODESYS runs driving `export_xml`/`import_xml` directly (no bridge, no pipe) against
      a COPY of the fixture, never saved.

      **Superseded avenue** (kept because it is still untested and might matter for child placement): `import_xml` takes an
      `into` target (`ImportXmlString(data, into)`), so a CHILD document might be importable directly into a
      folder node under the POU — which would place it without delete+recreate. Unknown whether a method or
      property has a standalone importable document at all; TwinCAT already answers `E_FAIL` for non-POU
      EXPORTS, so its import is not assumed either. Measure before designing on it.
- [x] 3.1b **DONE** — `test/e2e/lifecycle/child-folder-preservation.test.ts`. A POU with children at two folder
      depths (`Helpers`, `Helpers/Inner`), one child at the POU root and a property, is edited IN PLACE; the
      `%FOLDER` directive set must come back identical. The test asserts the CREATE placed them first, so a
      flattening cannot pass as "nothing was there anyway".
      Baselines move again: **CODESYS 98 pass / 8 skip / 0 fail**, **TwinCAT 96 pass / 11 skip / 0 fail**.
      Passes trivially today — the per-child path never flattens — which is why it is written BEFORE §3.1.
- [x] 3.2 **DONE — the splice vocabulary is complete.**
      `AddChild(xml, item, child, kind, decl, body)` builds the member to the vendors' shape and REFUSES to
      overwrite an existing child — add and update are different intents and this layer must not guess which the
      push meant. An ACTION is body-only (its `ACTION name` line is synthesized on read, never persisted), so a
      declaration on one is refused rather than written where nothing will read it back; its container
      (`<actions>`) is created when the POU has none.
      Deliberately MINIMAL — only the elements the reader parses. Vendor extras (access modifiers, object ids)
      are the IDE's to add on import; inventing them would be guessing at a shape with no ground truth.
      Property ADD and the accessor writer are now in too: `AddChild(..., Property, ...)` creates BOTH accessor
      slots (a property with neither is not a property) and `SetAccessor(xml, item, prop, getter, code, decl)`
      writes one — with `code: null` REMOVING it, which is how a push drops a getter and why the reader keeps
      absent (null) distinct from present-but-bodiless (`""`).

      > **One shape is NOT proven and must be settled by the live gate.** The vendors' own properties carry
      > `<interface><returnType>`; `AddChild` does not emit it, because deriving the typed element from
      > `PROPERTY X : INT` needs an elementary-vs-derived type table — the generation this change exists to
      > avoid. The offline tests only prove the WRITER matches the READER; whether the IDE accepts a property
      > without `<returnType>` is §4's question. If it does not, the answer is to carry the vendor's existing
      > `<interface>` through on an UPDATE and refuse a from-scratch property ADD, not to start generating types.

      **RENAME needs no element operation — closed by reading the existing behaviour.** Two different renames
      were being conflated:
      - the ITEM's own rename already uses `ide.Rename`, a NATIVE rename that makes the IDE rewrite call-sites
        across the project. PLCopen cannot express that, which is why §3.4 keeps it on the scripting API. Moving
        it into the document would silently stop references being updated.
      - a CHILD's rename is not a rename today at all: the children loop matches by name and
        `RemoveOrphanChildren` deletes whatever is not in the pushed set, so a renamed method is already
        delete-then-create. `RemoveChild` + `AddChild` express exactly that, with no reference rewriting lost
        because there was none to lose.
- [x] 3.3 **DONE — and the stated reason was only half true.** "A POU that does not exist yet has no export to
      splice" holds BEFORE the create, and the create path is what decides when that is. So create is now
      `CreateChild` (structure, per §3.4) and then the SAME single-document write: the just-created POU has an
      export, and the splice edits it.
      Measured on 3.5.21.40 before relying on it: a freshly created POU exports with both an
      `<InterfaceAsPlainText>` and a `<body>` — the two elements the splice needs. (A DUT/GVL exports the
      plaintext but NO body.)
      This was the last place the per-child seam survived: creating an FB with 5 methods used to cost ~12 COM
      writes plus an orphan walk; it is now one `CreateChild` and one import.
- [x] 3.4 **DONE — structure stays on the scripting API, and MOVE became a real one.** Rename still uses
      `ide.Rename` (the IDE rewrites call-sites; PLCopen cannot express that) and delete still uses `ide.Delete`.
      **Move no longer recreates.** It was read + delete + re-create + write-content-back, which is why a
      GRAPHICAL move had to be refused outright ("reorganize it in the IDE, then pull") — a graphical body cannot
      be rebuilt from text. With `IProjectTree.Move` the IDE relocates the object whole: no read, no delete, no
      window in which the item does not exist, and a graphical POU moves fine. That refusal is now lifted, with an
      e2e that creates an FBD program, moves it two folders deep and asserts the body comes back byte-identical.
      Gated on the same capability as the single-document write, because it is the same measurement — the merge
      flattens child folders, so that path already depends on `Move` existing.
- [ ] 3.5 The read-only/body-format guards run BEFORE the splice, unchanged. They are what stops a textual push
      overwriting a live CFC/SFC body, and they read live IDE state, not the document.

## 4. Gate — CODESYS

- [x] 4.1 **DONE** — Release build clean; Engine **390**, Cli **124**, Connector **80**, 0 failures.
- [x] 4.2 **DONE** — live CODESYS e2e **98 pass / 8 skip / 0 fail**, folder + child-folder cases included.
- [ ] 4.3 Explicit manual check: a POU with vendor attributes/pragmas is pushed and those survive — the splice's
      whole justification over regeneration. **Also state the CFC `localId` renumbering**: the first push of a POU
      with a graphical child produces a one-time diff (equivalent graph, normalized ids) that converges on the
      next push. It must be documented, not discovered by a user reading a surprise diff.
- [x] 4.4 **Moot — there is no failure window left to check.** It existed because `WriteXml` deleted before
      importing; it no longer deletes, so a rejected import leaves the original POU exactly as it was.

## 5. TwinCAT — only after CODESYS is green

- [x] 5.1 **DONE, and the blocking premise was wrong: TwinCAT's import CAN replace in place.** Measured live
      (TcXaeShell, XAE pid 2036, fixture `TwinCAT Project13`, POU `PLC_PRG`) — see DIALECT **D4c**.

      `TcPlcOpen` hardcoded `PLCIMPORTOPTIONS_NONE = 0`, the only value Volt had ever passed, and every earlier
      TwinCAT measurement (D1-D4, D4b) went through it. Sweeping the options argument:

      | options | result |
      |---|---|
      | `0` (NONE, what Volt used) | **FAILS** — "Creation of object 'PLC_PRG' failed. Reason: Import conflict!" |
      | **`1` (REPLACE)** | **replaces IN PLACE** — item count unchanged (7→7, re-measured 10→10), no delete, no duplicate |
      | `2`, `4`, `8` | each ADDS a copy (+1 every time) |

      **And it is not a silent SKIP** — the trap CODESYS's `ConflictResolve.Skip` set, where the tree is preserved
      and nothing lands. A marker comment spliced into the body via `PouSplice.SetBody` was present in the
      re-export afterwards (`CONTENT LANDED = True`).

      What that changes, beyond this task:
      - `BeckhoffDriver.WriteXml` no longer deletes. It is now one merge import, the same shape as CODESYS.
      - **The foldered-item REFUSAL is gone.** A graphical push to a POU in any folder used to be rejected
        outright ("move it to the PLC-project root or edit it in the IDE") because delete-then-import relocated
        it. Nothing is deleted now, so nothing is relocated. D4b's "placement is unrecoverable on TwinCAT" was a
        property of the DELETE, not of `PlcOpenImport`.
      - `PlcOpenTransport.ReplaceByReimport` was TwinCAT's last caller. With the delete gone it is dead on BOTH
        vendors, so it and its test are deleted — which also closes the audit finding that its restore-on-failure
        swallowed the primary exception and could leave the POU deleted. `TcObjectModel.IsPlcProjectRoot` went
        with it.
      - Live TwinCAT e2e after the change: **96 pass / 12 skip / 0 fail** (unchanged).

      Probe method: a temporary `--probe-import` flag on the worker exe, reverted immediately afterwards; the
      fixture was never saved and was restored to pristine (`git status` clean) after the run.
- [x] 5.1b **DONE — NO usable move (DIALECT D4/D4e).** `ExportChild`/`ImportChild` exist on every tree item but carry the item's SOURCE PATH, so importing into another folder recreates the hierarchy underneath it rather than moving. Confirmed by consequence in the §5.4 run: a foldered POU pushed through the one-document path comes back at the PLC-project root and nothing can put it back. Original text follows.
- [ ] 5.1b-orig Verify TwinCAT has a **move** equivalent for a POU child. CODESYS's `ScriptObject.move` is what makes
      §3.1 work; `TcObjectModel` has no move today and TwinCAT's COM surface is a different API entirely. If it
      has none, that is a §5.5 vendor limit — record it, do NOT reintroduce delete+CreateChild+WriteText on the
      TwinCAT side to fake one.
- [ ] 5.2 Verify children survive its round trip (element counts before/after, as done for CODESYS).
- [ ] 5.3 Verify the declaration lands on TwinCAT, and by WHICH representation — do not assume it is the plaintext
      copy just because CODESYS reads that one.
- [ ] 5.4 Live TwinCAT e2e at the POST-§3.1b baseline (**96 pass / 11 skip / 0 fail**), folder + child-folder
      cases included. Earlier numbers (90, then 94) are superseded.
- [x] 5.5 **INVOKED. This is the outcome.** 5.2 and 5.3 fail, so per this rule the answer is recorded and NOT worked around.

      Measured by enabling `WritesPouAsOneDocument` on `BeckhoffDriver` and running the full live suite:
      **36 fail / 60 pass / 12 skip**, against **96 pass / 0 fail** on the per-child arm. Three modes:

      | mode | evidence |
      |---|---|
      | placement lost | a POU in `POUs/Sub` returns with folder `""` — the import lands it at the PLC-project root (D4b) and `Move` throws `Unsupported` (D4) |
      | handles die mid-push | *"Item 'VltE2E_p_upd' is deleted or invalidated by an ealier operation!"* on a 3-op push (D4d) |
      | language not established on create | every LD create lands as FBD — *"has a FBD body in the IDE but the push carries LD"* |

      **Consequence, and it is the important part: §5 does not end with TwinCAT joining the one-document path.**
      It ends with the measurement that it cannot, so `WritesPouAsOneDocument` and the per-child arm are
      PERMANENT until Beckhoff ships a reparent verb. They should be named and pinned as a supported path
      rather than carried as legacy awaiting removal. The A5 transport-matrix rows now pin that arm.

      Recorded as DIALECT **D4e**; `ICodeStore.WritesPouAsOneDocument`'s "delete when §5 lands" instruction is
      corrected in place.

- [ ] 5.5-orig If any of 5.1-5.3 fails, STOP and record it as a vendor limit like the DUT/GVL one — do not add a
      per-vendor write mechanism to work around it, which would recreate the seam this change exists to remove.

## 5b. Zero-fallback audit of the splice surface (done)

Prompted by the reminder that this repo has a NO-FALLBACK policy. Audited my own additions rather than
assuming they complied — two real violations, both of the exact class this programme has been removing:

- [x] 5b.1 `DeclFromExport` read `(owner ?? doc.Root)`. A name that is NOT in the document therefore returned
      the FIRST plaintext block anywhere in it — some other item's declaration, confidently. The same
      document-scoping mistake that once spliced a body over a sibling method, reintroduced by me while adding
      the item-name parameter. Now: not found ⇒ null. Pinned by a test that also asserts a CHILD name is not an
      item name.
- [x] 5b.2 `SetTextualBody` and `SetChildText` guarded only the GRAPHICAL languages (FBD/LD/CFC/SFC). **IL is
      textual and slipped through**, then got silently replaced by the ST rewrite — a body-language change
      nobody asked for. Both now refuse any non-ST body. Theory test over IL/FBD/CFC.

Two more looked like fallbacks and are deliberate; documented in place so they are not "fixed" into bugs:

- `AddChild`'s null body means "no body yet" (a member being CREATED has nothing to preserve), whereas
  `SetChildText`'s null means "leave it". Create and update genuinely differ.
- `SetAccessor(code: null)` on an already-absent accessor is a no-op because it is DECLARATIVE ("this property
  has no getter") — the requested end state is the current one. `RemoveChild` is imperative and throws.

## 6. Close out

- [~] 6.1 **PARTIAL — everything dead on BOTH vendors is deleted; the per-child path and orphan walk are NOT
      dead and must not be touched until §5.** A multi-lens line-by-line audit of the CODESYS package plus the
      shared PLCopen/Sync layer settled the classification this task had been assuming rather than checking.

      **The task's own premise was wrong.** "The per-child write path, orphan walk" are not unreachable:
      `WritesPouAsOneDocument` is false on `DriverBase` and `BeckhoffDriver` never overrides it, so TwinCAT runs
      every one of them today. Reachability is in fact "TwinCAT **and** `FakeIde(OneDocumentWrite=false)`" —
      `PouMergeWriteTests.Without_the_capability_the_per_child_path_still_runs` plus 13 default-FakeIde pushes in
      `PushServiceTests` make deleting any of it a compile-green/test-RED change, which is the strongest available
      proof it is live. Blocked until §5: `PushService` 344-358, 371-400, 415-416, 434-491, 493-510, `EnsureAccessor`,
      `RemoveOrphanChildren`, `RemoveChildIfPresent`, `FindFolder`, `ChildKindToCode`,
      `RequireChildFormatWritable`'s else arm, `CodesysObjectModel.SetAspectText`/`WriteSourceText`, and
      `PlcOpenTransport` (whose one remaining caller is TwinCAT's delete-before-import `WriteXml`).

      **A REAL defect the audit found first, and it is why this is more than a deletion pass.** The root body
      learned the `BodyCodec` dispatch; `SetChildText` was left on a blanket `NonStBodyLanguage` predicate that
      refused *any* non-ST body. So on the single-document path an **editable FBD/LD METHOD or ACTION could not be
      pushed at all** — restating one unchanged aborted the whole push. The live suite cannot see it: the graphical
      e2e only ever creates top-level FBD/LD **programs**, never a graphical child. Fixed by giving the child path
      the same dispatch as the root — read-only (CFC/SFC) and language-change are still refusals. Pinned offline by
      three cases in `PouSpliceTests` against `codesys-pou/POU_SfcRoot_StFbdMethods.plcopen.xml` (a recorded export
      with an ST method *and* an FBD method) — a fixture that was committed but referenced by no test.

      Deleted, compiler-verified dead on both vendors:
      - `PouSplice.NonStBodyLanguage` — its only caller was the predicate replaced above.
      - `BodyCodec.Present(XElement)` — zero callers; `PresentWith` is what everything uses.
      - `PushService.IsPou` + `OneDocument` — a tautology. `itemType` comes from `PouKindToCode`, whose entire
        range IS the six kinds the disjunction tested, so `OneDocument` was identically `ide.WritesPouAsOneDocument`.
        Three call sites now read the flag directly; its measured six-kind evidence moved onto the flag itself, so
        evidence and flag die together at §5.
      - `CodesysObjectModel.ExportInterfaceXml` + the `KindCodeOf == PlcItf` fork in `CodesysDriver.ReadXml` —
        byte-for-byte the same call as `ExportXmlWithChildren`, so one POU-like kind took a separate route to an
        identical result and paid an extra object-model checkout per read to decide it. **Interfaces now have no
        special read path at all.** Both measured facts folded into the surviving doc-comment.
      - Stale/contradicted comments: the "Only for a textual root POU" paragraph in `PushService` (refuted by the
        paragraph directly under it), a doc-comment attached to the wrong member in `PlcOpenDocument`, and three
        `PlcOpenPouParser` references to a type that no longer exists (renamed to `PouReader`).

      Three no-fallback violations fixed in the same pass (repo policy: fail loud, never guess past a bug):
      - `CodesysObjectModel.Vars` typed an unreadable library variable **`BOOL`** and shipped it to the LSP as
        ground truth — a wrong type is worse than a missing library, because it resolves and then lies. Now throws
        naming the variable, the pin group and the owning signature. (`LibSignatureRenderer.cs:98` has the same
        `?? "BOOL"` for a FUNCTION return type — still open, see below.)
      - `GetLibraryRefs` had three bare/comment-only catches, so a library could vanish from the manifest set with
        no trace. Kept best-effort (one unreadable property must not fail the whole `refs`/`fetch` walk) but every
        skip is now logged, including that the identity failure abandons the whole dependency SUBTREE.
      - `DeleteChild` returned silently when no child matched, **and** matched case-SENSITIVELY while the
        `itemCache` that resolved the name matches case-INSENSITIVELY. A case-divergent name therefore reported
        success on CODESYS while the object stayed in the project — and raised a raw COM error on TwinCAT, which is
        the actual parity break. Fixed in shared Core (`PushService` now passes `ide.Name(del)`, the resolved
        handle's real name, not the wire name) plus a loud throw on a miss. Delete-idempotency is untouched: it
        lives in `ApplyOp`, which answers "no-op" for an absent item and never calls the driver.

      Gates after the pass: Engine **537** (was 534, +3 new), Cli **124**, live CODESYS e2e **99 pass / 8 skip /
      0 fail** — all unchanged except the additions. Release build clean.

      **Still open on §6.1, and it is one measurement, not a decision:** §5.1 — does TwinCAT's `PlcOpenImport`
      accept a parent? DIALECT.md D4b records it always landing the item at the PLC-project root and taking no
      parent argument. That single answer unblocks the entire blocked list above and decides whether
      `WritesPouAsOneDocument`'s "delete this when §5 lands" instruction is achievable or becomes a §5.5 vendor limit.
- [x] 6.2 **DONE — and the task's premise was wrong: ARCHITECTURE.md already stated the rule, twice.** The
      `PlcOpen/` layer row says a POU's whole content is "read and written through ONE PLCopen XML document", and
      the invariants list carries "Content travels as ONE PLCopen document; STRUCTURE travels on the scripting
      API" as its own axis. Writing it a third time would have been the only thing this task produced.

      What was genuinely missing, and is now written:
      - `ARCHITECTURE.md`'s `Body/` row said read-only means "CFC/SFC". It is **CFC, SFC and IL** — Volt
        round-trips ST and FBD/LD and nothing else, and IL is in the model only because TC6 defines it and the
        READER must recognise one. Recognising is not supporting, and the row now says so.
      - `DIALECT.md`'s headline cited the capability gate by FILE AND LINE in three places, two of which had
        drifted onto unrelated code, and pointed at the wrong `PushService` arm. Now cited by SYMBOL — these
        citations have gone stale twice, and a stale line number is worse than none.
      - `ICodeStore.WritesPouAsOneDocument` carried the instruction "**delete this property when §5 lands**".
        Premature rather than wrong: §5.1 is answered (D4c — TwinCAT's import CAN replace in place), but the flag
        also stands for "this driver has a real `Move`", and TwinCAT still has none (D4). The doc now says to
        delete it when THAT is answered, not merely when the import is.
