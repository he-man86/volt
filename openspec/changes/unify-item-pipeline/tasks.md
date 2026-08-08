# Tasks

Every step holds Engine **493** offline (433 when this was written), CLI 124, connector 80, and live CODESYS
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


## Not done

- [ ] **Driver thinning** — move the six descriptor renderers + `Unitize`, diagnostic severity/line/column
      parsing, the build-success criterion, the warn-once idiom and the `Lookup`/`dirty` semantics up into
      Engine. The drivers are **not** to be rewritten: zero C# tests execute either one, CODESYS reaches the IDE
      through reflected string literals so a rename has no compiler check, and the only oracle is a live run that
      is not CI.
- [ ] **TwinCAT.** `WritesPouAsOneDocument` is still false there and D1–D4 in `DIALECT.md` are still unmeasured,
      so TwinCAT keeps the per-child transport — which is now the ONLY thing keeping that code alive.
