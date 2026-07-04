# workspace-file-extensions Specification

## Purpose
TBD - created by syncing change unify-item-file-extensions. Update Purpose after archive.
## Requirements
### Requirement: Writable source items are named by kind

Every writable source item SHALL materialize with an extension that names its KIND:
`function_block → .fb`, `program → .prg`, `function → .fun`, `interface → .itf`, `structure → .struct`,
`enumeration → .enum`, `union → .union`, `alias → .alias`, `gvl → .gvl`. A POU SHALL be named by its
kind regardless of body language — an editable graphical (FBD/LD) body and a read-only graphical
(CFC/SFC) body of a function block are both `<name>.fb` — so the extension always reveals what the
item is. The bridge SHALL choose the extension from the item's kind (`ItemKind.ExtFor`); kind SHALL
NOT be carried on the wire (it is recovered from content on push).

#### Scenario: A POU is named by kind, not body language
- **WHEN** the IDE contains a function block with a textual body, a second with an editable FBD body, and a third with a read-only CFC body
- **THEN** all three materialize as `<name>.fb`, and a program is `.prg` and a function is `.fun`

#### Scenario: DUTs, interfaces, and GVLs use their kind extension
- **WHEN** the IDE contains an enumeration, structure, union, alias, interface, or GVL
- **THEN** each materializes as `.enum`/`.struct`/`.union`/`.alias`/`.itf`/`.gvl` respectively

### Requirement: Read-only graphical POUs are marked in content, not by extension

Because POUs are named by kind, the extension SHALL NOT encode read-only access for a POU. A read-only
graphical POU (a CFC/SFC body) SHALL materialize with an in-content marker: its body is a leading
`READONLY <LANG>` line (e.g. `READONLY CFC`), stating it is read-only because the body is graphical.
Read-only for a POU SHALL be detected from this marker (the body's first significant token is
`READONLY`), never from the extension. Opaque reference kinds (`library`, `task`, `image_pool`,
`text_list`, `recipe_manager`, `visualization`, `visualization_manager`, `library_manager`,
`class_diagram`, `external_types`, `tmc`) SHALL remain read-only by their own extension. A folder SHALL
remain a `.gitkeep` marker.

#### Scenario: A read-only CFC POU carries a content marker
- **WHEN** the IDE contains a function block whose body is a read-only CFC
- **THEN** it materializes as `<name>.fb` whose body begins with `READONLY CFC` — no `.cfc` extension and no wire flag mark it

#### Scenario: A reference kind keeps its extension and is read-only
- **WHEN** the IDE contains a library, task, or visualization
- **THEN** it materializes with that kind's own extension and is read-only

### Requirement: Access is read from content; kind from content

The CLI SHALL derive a POU file's push-ability from its content — a body led by `READONLY` is
read-only, a `NETWORK`-led or textual body is writable — while reference kinds stay read-only by
their extension. The bridge SHALL recover an item's kind from file content on push-back (the ST
declaration header for textual kinds; the NETWORK-token VG body for editable graphical POUs), never
from the extension. The kind-based naming SHALL NOT lose kind or access information.

#### Scenario: Kind is recovered from content on push
- **WHEN** an agent edits and pushes a `.fb`/`.prg`/`.fun`/`.struct`/`.itf`/`.gvl` file
- **THEN** the bridge reconstructs the correct kind from the content and applies the push

#### Scenario: A read-only POU is not pushed
- **WHEN** a `.fb` file whose body begins with `READONLY` (a CFC/SFC body) is edited and a push is attempted
- **THEN** the CLI refuses it up front from the marker, and the bridge refuses it as a backstop

### Requirement: Build-excluded source is marked in content, not a side manifest

A source item's exclude-from-build state SHALL be recorded IN the file, NOT in a separate excluded-paths
manifest, because the LSP analyzes files on disk with no live bridge to read the per-item `excludeFromBuild`
wire flag (see bridge-protocol "Exclude-from-build is a per-item wire flag"). On pull, a source item whose
`excludeFromBuild` flag is `true` SHALL materialize with a leading `(* @volt-exclude-from-build *)` ST comment
(idempotent — never duplicated). This marker is Volt-managed, not real IDE source: on push the CLI SHALL strip
it before sending to the bridge, so it never reaches the IDE's stored source (and does not re-duplicate on the
next pull). The LSP and coverage harness SHALL read the marker as the on-disk source of the flag — it is how an
offline workspace or a committed corpus gates diagnostics on excluded objects. Only source-kind files carry it
(reference kinds are never analyzed and stay read-only by their extension).

#### Scenario: A build-excluded object materializes with the marker
- **WHEN** the IDE reports an item with `excludeFromBuild: true` and a pull materializes it
- **THEN** its source file begins with `(* @volt-exclude-from-build *)` — no side manifest records the exclusion

#### Scenario: The marker is stripped on push
- **WHEN** an excluded source file (leading `(* @volt-exclude-from-build *)`) is pushed back
- **THEN** the CLI strips the marker so the IDE's stored source is unchanged, and the next pull does not duplicate it

#### Scenario: The LSP reads the marker offline
- **WHEN** the LSP analyzes an on-disk workspace (or the committed corpus) with no live bridge
- **THEN** it skips diagnostics on files carrying the marker, exactly as if the wire flag were `true`

### Requirement: The scheme change re-materializes once

Because the wire item name includes the extension, moving from `.st` to kind extensions SHALL change
the affected items' wire names (and only their file paths — `structureVersion` hashes the sorted bare
names, so it is unchanged). On the first pull after the change, a bound workspace SHALL re-materialize
the affected items — the `*.st` files removed and the kind-named files created — reconciled through
native git as deletes and adds, with no custom migration step. Both vendor bridges SHALL apply the
same kind-based naming in shared Core.

#### Scenario: A bound workspace re-materializes on first pull
- **WHEN** a workspace bound under the `.st` scheme is pulled after this change
- **THEN** the `*.st` files are removed and equivalent `.fb`/`.prg`/`.fun`/`.itf`/`.struct`/… files appear, with no data loss

#### Scenario: structureVersion is unchanged by the rename
- **WHEN** only the extensions change (bare names identical)
- **THEN** `structureVersion` is unchanged, regardless of vendor

### Requirement: Library signatures materialize under the Library Manager, not a separate tree

Referenced-library public signatures SHALL materialize INTO the mirrored CODESYS tree — each element under
its owning library's folder in the Library Manager (`…/Library Manager/<LibraryName>/<Element>.<kind>`),
co-located with that library's `.library` stub — NOT into a separate `libs/` tree. Files SHALL use the same
kind-based extensions as project source (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`)
and contain declarations/signatures only (no implementation bodies). They SHALL be **read-only**: never a
push target, never reconciled to the IDE. They are committed and change only when a referenced library is
added, removed, or version-bumped.

#### Scenario: A library element is a kind-named signature file in its library's folder
- **WHEN** the `L_MC4P` library exposes a struct `AxesGroup`
- **THEN** it materializes at `…/Library Manager/L_MC4P_MotionControlCam/AxesGroup.struct` (beside `L_MC4P_MotionControlCam.library`), containing only its declaration, and is not editable or pushable

#### Scenario: Library signatures are never pushed
- **WHEN** a push is computed
- **THEN** no library signature file is included — they are a read-only library mirror, not project source

