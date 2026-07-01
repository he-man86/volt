# workspace-file-extensions Specification

## Purpose
TBD - created by syncing change unify-item-file-extensions. Update Purpose after archive.
## Requirements
### Requirement: Writable source items materialize as `.st`

Every writable source item SHALL materialize as a single `.st` workspace file. This covers the
textual Structured Text kinds (`program`, `function`, `function_block`, `interface`, `gvl`,
`structure`, `enumeration`, `union`, `alias`) and editable graphical POU bodies (FBD, LD). The
bridge SHALL choose the extension from the item's writability and body language, not from a
per-kind extension table: a source POU whose body is textual (ST) or editable graphical (FBD/LD)
SHALL be named `<name>.st`.

#### Scenario: A textual DUT is `.st`
- **WHEN** the IDE contains an enumeration, structure, union, alias, GVL, or interface
- **THEN** it materializes as `<name>.st`, not `<name>.enum`/`.struct`/`.gvl`/`.itf`/…

#### Scenario: An editable graphical POU is `.st`
- **WHEN** the IDE contains a POU with an editable FBD or LD body
- **THEN** it materializes as `<name>.st` carrying the NETWORK-token VG form, not `<name>.fbd`/`.ld`

### Requirement: Read-only kinds keep distinct extensions

Read-only items SHALL NOT collapse to `.st`. Read-only graphical bodies SHALL keep `.cfc`/`.sfc`
(their language is declaration-only and not content-detectable, and they must stay flagged
read-only), and every opaque reference kind SHALL keep its own extension (`.library`, `.task`,
`.image_pool`, `.parameter_list`, `.text_list`, `.recipe_manager`, `.visualization`,
`.visualization_manager`, `.library_manager`, `.class_diagram`, `.external_types`, `.tmc`). A
folder SHALL remain a `.gitkeep` marker.

#### Scenario: A CFC body keeps its extension
- **WHEN** the IDE contains a POU with a read-only CFC or SFC body
- **THEN** it materializes as `<name>.cfc`/`<name>.sfc`, not `<name>.st`

#### Scenario: An opaque reference keeps its extension
- **WHEN** the IDE contains a library, task, visualization, or other reference kind
- **THEN** it materializes with that kind's own extension and read-only access

### Requirement: Access is derived from the extension, kind from content

The CLI SHALL derive a file's access (`.st` = writable, all retained extensions = read-only) from
its extension alone. The bridge SHALL recover an item's kind from file **content** on push-back
(the ST declaration header for textual kinds; the NETWORK-token VG body for editable graphical
POUs), never from the `.st` extension. Collapsing to `.st` SHALL NOT lose kind or access
information.

#### Scenario: Kind is recovered from content on push
- **WHEN** an agent edits and pushes a `.st` file holding a `FUNCTION_BLOCK`, `TYPE … END_TYPE`,
  `INTERFACE`, `VAR_GLOBAL`, or a NETWORK-led graphical body
- **THEN** the bridge reconstructs the correct item kind from the content and applies the push

#### Scenario: `.st` is the only writable extension
- **WHEN** the CLI decides whether a workspace path is pushable
- **THEN** only `.st` is writable; `.cfc`/`.sfc` and every reference extension are read-only

### Requirement: The collapse changes wire identity once

Because the wire item **name includes the extension**, collapsing SHALL change the wire names of
the affected items and therefore `structureVersion`. On the first pull after the change, a bound
workspace SHALL re-materialize the collapsed items — the old per-kind files are deleted and the
`.st` files created — reconciled through native git as ordinary deletes and adds, with no custom
migration step. Both vendor bridges SHALL apply the same extension normalization in shared Core so
their responses stay byte-identical.

#### Scenario: A bound workspace re-materializes on first pull
- **WHEN** a workspace bound before the change is pulled after it
- **THEN** the previously `.enum`/`.fbd`/`.itf`/… files are removed and equivalent `.st` files
  appear, with no data loss

#### Scenario: Both bridges agree byte-for-byte
- **WHEN** the same project is served by the CODESYS and Beckhoff bridges after the change
- **THEN** both emit identical `.st` wire names and identical content hashes
