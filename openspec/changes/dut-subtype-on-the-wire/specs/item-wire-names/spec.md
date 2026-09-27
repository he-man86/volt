## ADDED Requirements

### Requirement: a DUT's wire name carries its subtype

The engine SHALL name a DUT on the wire `<name>.struct`, `<name>.enum`, `<name>.union` or `<name>.alias`, derived
from its declaration in the one place a full wire name is minted. `refs`, `fetch`, every push op, and every
version and folder map SHALL use that name. No wire message SHALL carry `.dut`. A client SHALL NOT map a file
extension to another wire extension: a workspace file's name IS its item's wire name.

#### Scenario: an enum is published as an enum
- **WHEN** a project holds `TYPE E_Mode : (Idle, Run); END_TYPE`
- **THEN** `refs` lists `E_Mode.enum` and `fetch` returns it under that name

#### Scenario: the CLI writes what the wire says
- **WHEN** `volt pull` receives `E_Mode.enum` in folder `DUTs`
- **THEN** it writes `src/DUTs/E_Mode.enum` without reading the declaration

#### Scenario: project and library DUTs agree
- **WHEN** a library signature and a project item are both enums
- **THEN** both carry the `.enum` extension

### Requirement: a subtype change is an update of the same object

Below the vendor seam the four DUT names SHALL be one object, the bare name. In one push, a DUT op that changes
only the subtype SHALL update that object's content and SHALL NOT delete or create it: a `set` whose `toName`
differs from `name` only in the DUT subtype, and a `delete` of one subtype paired with a `set` (create) of another
subtype for the same bare name, guarded by the delete's `ifVersion`. Any other pair of ops on one bare DUT name
SHALL be refused with `BAD_REQUEST` naming both ops.

#### Scenario: git sees a rename
- **WHEN** a push carries `set X.struct toName X.enum ifVersion v` with an enum body
- **THEN** the IDE's DUT `X` holds the enum body, keeps its folder, and the next `refs` lists `X.enum` and not
  `X.struct`

#### Scenario: git sees delete plus add
- **WHEN** a push carries `delete X.struct ifVersion v` and `set X.enum` with an enum body
- **THEN** the result is the same as the rename, and a stale `v` is refused as a version conflict like any update

#### Scenario: two edits on one DUT
- **WHEN** a push carries `set X.struct` and `set X.enum` (both without delete)
- **THEN** it is refused with `BAD_REQUEST` naming both ops, and the IDE is unchanged

### Requirement: a baseline keyed by the old wire name is refused

A workspace sidecar (`.git/volt/ide-refs.json`) holding a `.dut` key SHALL be refused by name with the instruction
to run `volt pull`, as a malformed sidecar is. There SHALL be no translation of old keys.

#### Scenario: a workspace from the previous CLI
- **WHEN** `volt push` runs with a sidecar holding `E_Mode.dut`
- **THEN** it stops before sending anything and names `volt pull` as the fix
