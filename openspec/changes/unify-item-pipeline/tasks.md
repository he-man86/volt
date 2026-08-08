# Tasks

Every step holds Engine 455 offline (was 433 when this was written), CLI 124, connector 80, and live CODESYS
e2e **99 pass / 8 skip / 0 fail**. The live run is the gate, and it earned that four separate times below —
each of the last four entries under "what the live gate caught" passed the entire offline suite first.

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

- [ ] **`Item/`** — one model both directions, killing the 4-way duplication (`ParsedPou` → `PouData` → ST text →
      `StSplitResult`, and `ChildData`/`StChild`/`ParsedChild`/`ParsedProperty` for a member).
- [ ] **`Text/`** — one owner for the canonical ST format instead of an emitter and a parser that are not quite
      inverse (five verified asymmetries).
- [ ] **Driver thinning** — move the six descriptor renderers + `Unitize`, diagnostic severity/line/column
      parsing, the build-success criterion, the warn-once idiom and the `Lookup`/`dirty` semantics up into
      Engine. The drivers are **not** to be rewritten: zero C# tests execute either one, CODESYS reaches the IDE
      through reflected string literals so a rename has no compiler check, and the only oracle is a live run that
      is not CI.
- [ ] **TwinCAT.** `WritesPouAsOneDocument` is still false there and D1–D4 in `DIALECT.md` are still unmeasured,
      so TwinCAT keeps the per-child transport — which is now the ONLY thing keeping that code alive.
