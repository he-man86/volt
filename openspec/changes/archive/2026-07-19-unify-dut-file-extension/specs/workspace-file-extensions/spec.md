## MODIFIED Requirements

### Requirement: Writable source items are named by kind

Every writable source item SHALL materialize with an extension that names its KIND:
`function_block → .fb`, `program → .prg`, `function → .fun`, `interface → .itf`, `gvl → .gvl`. A DUT
SHALL be a SINGLE wire kind `dut` materialized as a single `.dut` extension — the four variants
(structure, enumeration, union, alias) SHALL NOT split into distinct wire kinds or extensions on a read,
mirroring the IDEs' own model (a DUT is one object type). A POU SHALL be named by its kind regardless of
body language — an editable graphical (FBD/LD) body and a read-only graphical (CFC/SFC) body of a
function block are both `<name>.fb`. The bridge SHALL choose the extension from the item's kind
(`ItemKind.ExtFor`); kind SHALL NOT be carried on the wire (it is recovered from content on push).

#### Scenario: A POU is named by kind, not body language
- **WHEN** the IDE contains a function block with a textual body, a second with an editable FBD body, and a third with a read-only CFC body
- **THEN** all three materialize as `<name>.fb`, and a program is `.prg` and a function is `.fun`

#### Scenario: Every DUT variant is one kind and one extension
- **WHEN** the IDE contains an enumeration, a structure, a union, and an alias
- **THEN** each is emitted as wire kind `dut` and materializes as `<name>.dut` — no `.enum`/`.struct`/`.union`/`.alias` and no per-variant wire kind

#### Scenario: Interfaces and GVLs use their kind extension
- **WHEN** the IDE contains an interface or a GVL
- **THEN** each materializes as `.itf`/`.gvl` respectively

### Requirement: Access is read from content; the DUT subkind is not a Volt concept

The CLI SHALL derive a POU file's push-ability from its content — a body led by `READONLY` is
read-only, a `NETWORK`-led or textual body is writable — while reference kinds stay read-only by their
extension. The bridge SHALL recover an item's kind from file content on push-back (the ST declaration
header for textual kinds; the `NETWORK`-token VG body for editable graphical POUs), never from the
extension. Volt SHALL NOT classify a DUT's struct/enum/union/alias subkind anywhere — not on a read, not
on a create. A refs/fetch walk SHALL report every DUT as wire kind `dut` with no per-DUT declaration read
for classification, and create SHALL use one code (`PlcDut`) for every DUT, letting the IDE derive the
subtype from the written declaration (TwinCAT natively; CODESYS via one `create_dut` call whose skeleton
is reshaped by the subsequent declaration write).

#### Scenario: A DUT is created with one code regardless of subtype
- **WHEN** an agent pushes a new `.dut` file whose body declares a `STRUCT` (or `UNION`, an enum list, or a type alias)
- **THEN** the bridge creates it with the single DUT code and writes the declaration, and the IDE materializes the correct DUT category from that declaration — Volt never inspects the subtype

#### Scenario: A refs/fetch walk does not classify DUT subkinds
- **WHEN** the tree is walked to answer refs or fetch
- **THEN** every DUT is reported as wire kind `dut` with no extra per-DUT declaration read for classification

#### Scenario: Kind is recovered from content for POUs
- **WHEN** an agent edits and pushes a `.fb`/`.prg`/`.fun`/`.itf`/`.gvl` file
- **THEN** the bridge reconstructs the correct kind from the content and applies the push

### Requirement: Both vendor bridges emit identical wire kinds

Both the CODESYS and TwinCAT drivers SHALL emit byte-identical refs/fetch responses for the same project
(the parity boundary is the pipe wire). For DUTs this SHALL hold by construction: both drivers emit the
single wire kind `dut` with NO per-vendor subkind classifier on the read path (removing the prior hazard
of two independent classifiers — CODESYS `RefineDut` and the shared declaration parser — having to agree).

#### Scenario: A DUT-heavy project is byte-identical across vendors
- **WHEN** the same project (structs, enums, unions, aliases) is served by the CODESYS bridge and by the TwinCAT bridge
- **THEN** the refs and fetch responses are identical, each DUT reported as `dut`

## ADDED Requirements

### Requirement: The DUT collapse re-materializes once

Collapsing the four DUT kinds/extensions to `dut`/`.dut` SHALL change the affected items' wire names
(because the wire item name includes the extension), and their file paths only — `structureVersion`
hashes the sorted bare names, so it is unchanged. On the first pull after the change, a bound workspace SHALL
re-materialize the affected DUTs — the `*.{struct,enum,union,alias}` files removed and the `*.dut` files
created — reconciled through native git as deletes and adds, with no custom migration step. Because a DUT
name is unique in the project's type namespace, collapsing four extensions into one SHALL never produce a
file-name collision.

#### Scenario: A bound workspace re-materializes DUTs on the next pull
- **WHEN** a workspace bound before the change (holding `Foo.struct`, `Bar.enum`, `Baz.alias`) is pulled after it
- **THEN** those files are removed and `Foo.dut`, `Bar.dut`, `Baz.dut` are created, with no other item churn and no data loss
