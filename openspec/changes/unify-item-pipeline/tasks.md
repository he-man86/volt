# Tasks

Every step holds Engine **533** offline (433 when this was written), CLI 124, connector 80, and live CODESYS
e2e **99 pass / 8 skip / 0 fail**. The live run is the gate, and it earned that four separate times below —
every entry under "what the live gate caught" passed the entire offline suite first.

## Done

- [x] **The body codec.** `Body/BodyCodec.cs` — one registry keyed by LANGUAGE: `Locate` / `Decode` / `Encode` /
      `ReadOnly` / `IsUncommitted`. ST is the identity codec, FBD/LD pivot on the graph, CFC/SFC read as a marker
      and refuse to write. `PouSplice.SetTextualBody` → `SetBody`, which dispatches. `pouVg` and its nine forks in
      `PushService` are gone: the create arm collapsed, the update arm is document-first, and the orphan walk runs
      for every language.
- [x] **The root body guard is scoped to the per-transport path.** Where there is a document, `SetBody` IS the
      guard and is strictly better — it decides from the element PRESENT rather than from a vendor language
      string, so it also catches IL and the addData-nested CFC.
- [x] **Every writable kind takes the single-document write** — interface, DUT and GVL joined the POUs. The
      transport matrix is now ONE row for six kinds, and the "no per-child interaction survives a write"
      assertion no longer exempts three of them.
- [x] **`Graphical/` → `Body/`**, with `Graph/` holding the FBD/LD machinery. `GraphicalCode` → `NetworkCode`;
      `PlcOpenReader`/`PlcOpenWriter` → `GraphReader`/`GraphWriter` (they convert graph ⇄ body XML and had no
      business reading as siblings of `PlcOpen/PouReader`); `GraphicalBodySplice` → `GraphSplice`.
- [x] **VG is gone as a name.** The LSP's four wire codes (`vg-*` → `network-*`), the `vg_body` AST kind, the
      `Vg*` types, the `vg*` service entry points, `src/graphical/` → `src/network/`, and the prose in both
      packages. The English word "graphical" stays where it describes an actual diagram.
- [x] **`Item/`** — `ItemContent` / `Member` / `Accessor`, one model both directions. It replaced `PouData` +
      `ChildData` (read) and `StSplitResult` + `StChild` + `StAccessor` (write), which differed only in field
      names and in how they spelled an accessor. A property is a `Member` now, not a separate list, so
      `PouDocument.Splice` no longer unions two collections before it can ask what an item has.
      - **Accessor presence is the OBJECT**, and this was the one hazard the merge created. The read path spelled
        "has a getter" as "code OR declaration is non-null"; the write path spells a null body as "REMOVE this
        accessor". Merged naively, a bodiless getter would be DELETED on the next push — the old two-field bug
        arriving from the other direction. `Accessor.Code` closes it: never null, because the accessor exists.
- [x] **`Text/`** — `StWriter` + `StReader` + `CodeHelper` + `InstanceTypes` in one folder. With both halves on
      `ItemContent`, "inverse pair" became a law that can be TYPED, and `StFormatRoundTripTests` asserts it:
      `write(read(write(x))) == write(x)` over 19 shapes, including the ones that look like structure (a pragma
      above the header, a comment containing `END_FUNCTION_BLOCK`, a string containing `METHOD`, accessors with
      their own declarations).
      - It holds for all of them. **The "five verified asymmetries" this was scoped against did not reproduce** —
        there is exactly ONE, and it is now pinned: a member body whose first line is literally `%FOLDER x` reads
        back as a folder. Deliberately unescaped, because `%` cannot begin an IEC statement, so no source a
        compiler accepts can hit it; an escape would mean carrying the rule forever against input that cannot
        exist. The test is where that decision changes.

### Defects closed (each was silent, each now has a test)

1. [x] A declaration edit on a graphical POU was **discarded** while the push reported "updated".
2. [x] Deleting a method from a graphical POU was **accepted and did nothing** — the orphan-walk skip is gone.
3. [x] A POU with any CFC/SFC child **could not be pushed at all**; the marker is now skipped, not refused.
4. [x] A bare `GET` accessor was swallowed into the property declaration → the getter was removed on push.
5. [x] An IL body was refused by accident, in the wrong layer, with the wrong message.
6. [x] **A spliced interface property was silently dropped** — see below.
7. [x] **Interface accessor code was silently discarded** (`EnsureAccessor` deliberately wrote nothing for an
       interface). It is now refused with a message naming the accessor.

### What the live gate caught that the offline suite could not

Recorded because the pattern repeated, and the lesson is the same each time: **a fake that models the document
differently from the vendor tests only our own tolerance.**

- A fresh POU is created with an EMPTY `<ST>` body whatever language it will hold, so "the IDE says ST, the push
  says FBD" is the normal create — not a mismatch. Hence `IsUncommitted`, and hence its asymmetry: an empty
  `<FBD/>` does NOT qualify, because someone made that POU graphical on purpose.
- CODESYS exports a POU's declaration **twice** once it declares any variable. Writing the first copy only meant
  a declaration change did nothing. (`OwnDescendants`, plural.)
- **A union DUT is `<union>`, not `<dataType>`.** A struct, an enum and an alias are all a `baseType` and so are
  all `<dataType>`; a union has no TC6 equivalent and gets its own vendor addData block. "It is a DUT so it is a
  dataType" was inferred, and a union push failed to parse at all.
- **`<Property>` pluralises to `<Properties>`, not `<Propertys>`.** The importer does not reject an unrecognised
  container — it silently DROPS the member inside it. The push reported success; the property never existed.

`FakeIde` now answers the three real document shapes (pou / Interface / dataType+globalVars) instead of one
`<pou>` for every kind, so the last two of those are catchable offline now.


- [x] **Driver thinning.** Not a rewrite — the reasoning against one held, and is worth keeping: zero C# tests
      executed a line of either driver, CODESYS reaches the IDE through reflected string literals so a rename has
      no compiler check, and the only oracle is a live run that is not CI. What moved up is what was pure,
      duplicated, or both, and every piece has tests it never had.
      - **`Ide/ItemLookup`** — and this one was a BUG, not tidying. Two walks, two answers: CODESYS matched
        case-SENSITIVELY (so on a cache miss, pushing `fb_motor` at an IDE holding `FB_Motor` created a second
        object) and matched ANY node at any depth (so a METHOD could answer for a POU of the same name), while
        TwinCAT did neither. `IProjectTree` loses the member entirely: finding an item by name is a walk over
        four members it already has.
      - **`Workspace/Descriptor`** — the format half of six renderers producing hashed wire bytes with zero
        fixtures. The three padding rules (fixed 14, fixed 11, widest-declared-label + 2) are preserved EXACTLY;
        unifying them would re-flow files in every user's repo. The vendor half stays in the driver.
      - **`Wire/Severity`** — one mapping to the wire's error/warning/info, which `BuildService` counts on.
        Build SUCCESS is deliberately not unified: CODESYS derives it from the diagnostics, TwinCAT reads
        `SolutionBuild.LastBuildInfo` — two vendor signals, not two copies of one rule.
      - **`Ide/BridgeLog`** — the both-sinks write (five hand-written copies, three repeating the same paragraph
        about why one sink is not enough) and the warn-ONCE-per-key idiom (two).
      - **`FakeIde` models a real TREE now** (root → folders → items) instead of a flat list with a dictionary
        lookup. Without it, moving a walk into Engine buys testability that does not exist.
      - **The counts in the original scope did not all reproduce**: the "warn-once idiom, three copies" was two,
        and `dirty` turned out to be one property read per driver with nothing shared to lift.

## Not done

- [x] **TwinCAT D1-D4 measured** (live, TcXaeShell 15.0). `WritesPouAsOneDocument` STAYS FALSE - but now for a
      measured reason instead of an unmeasured one, and the reason is PLACEMENT, not content:
      - **D1/D2/D3 are all green.** `PlcOpenImport` accepts a spliced document; the method body, the property and
        BOTH accessor bodies survive the delete-then-import round trip; and the PLAINTEXT drives the declaration
        exactly as on CODESYS. The content half of the single-document write works on TwinCAT today.
      - **D4 is the blocker, and D4b makes it unrecoverable.** There is no move primitive on the tree item, and
        the import FLATTENS a POU-internal folder just as CODESYS's does - CODESYS survives that only because it
        HAS `move()`. Worse (D4b, new): `PlcOpenImport` exists ONLY on the PLC project, takes only
        `(path, options)`, and always lands the item at the PLC-PROJECT ROOT. A third argument naming a folder is
        `DISP_E_TYPEMISMATCH`. So placement can be neither targeted nor repaired.
      - **That was a live bug, now fixed.** TwinCAT's `WriteXml` (used today for graphical pushes) silently MOVED
        a foldered POU to the project root on every push. It now refuses with a message. Note the standard
        fixture's own `PLC_PRG` lives in a `POUs` folder, so this was reachable on a default project.

- [x] **The TwinCAT live tier — FIXED. First green run: 96 pass / 12 skip / 0 fail.** The cause was not in the
      bridge: three committed fixture solutions name a `.TcPOU` in their `.plcproj` that is not on disk and was
      never in git (two are leftover `VltE2E_*` e2e artifacts). A dangling reference makes the tree report a
      ChildCount that INCLUDES the phantom; resolving it faults `RPC_E_CALL_FAILED` and the TwinCAT System
      Manager dies, taking TcXaeShell with it — after which everything is "RPC server unavailable", which the
      client sees as the generic "waiting for an IDE project".
      - **The disconnect and the crash were ONE fault**, and the disconnect was the symptom. The earlier note
        here had them as two problems and had the bridge failing to bind; the log says it binds fine and dies
        ~4s later on the first tree walk. Bisected by op (`refs`, not `fetch`) then by node.
      - Not fixable in the bridge — a plain PowerShell walk kills the IDE identically. What is ours is not
        shipping a fixture that does it: `FixtureProjectIntegrityTests` now asserts every `.plcproj` reference
        resolves, and was verified to FAIL on a reintroduced phantom.
      - Two parity bugs fell out of the suite finally running: the body-mismatch refusal emitted a DIFFERENT
        sentence per vendor (now word-for-word identical), and the graphical-MOVE test asserted a capability
        TwinCAT does not have (now skipped there, with the vendor fact cited).

## Still open

- [ ] **TwinCAT single-document write — ATTEMPTED, NOT SHIPPED.** Turned on and reverted; the code is back at
      96 pass / 12 skip / 0 fail. What the attempt established, so the next one starts here:
      - **D1–D3 are green** (see above) and DUT/GVL must be EXCLUDED whenever it is turned on — TwinCAT cannot
        export them at all (`E_FAIL`, DIALECT C2), and widening the document path to every kind put a DUT on a
        path whose first step is an export that cannot happen.
      - **Turning it on loses a POU's CHILDREN — 30 live failures, cause not found.** A method vanishes across an
        in-place edit. Notably a hand-spliced document imported through the SAME delete-then-import round trip
        keeps its children (that is what D2 measured), so the difference is in what `PouDocument.Splice` produces,
        not in the transport. That is the thread to pull.
      - **The placement blockers now have a partial answer**: `ExportChild`/`ImportChild` exist (D4, corrected),
        but the archive carries the item's SOURCE PATH, so importing into another folder yields
        `dest/originalPath`. Until that path can be rewritten there is still no usable move, and without a move
        neither D4 (the merge flattens POU-internal folders) nor D4b (the import lands at the PLC-project root)
        can be repaired.

- [ ] **The TwinCAT e2e leaves the fixture DIRTY, and a re-run on a used copy reports false failures.** Measured
      the confusing way: the same reverted code gave 3, then 8, then 0 failures depending only on how used the
      project copy was. Always start from a fresh copy of `test/TwinCAT Project13`. Worth fixing at the source —
      the suite's cleanup does not fully undo itself, which is also how the committed fixtures came to reference
      files that do not exist.
