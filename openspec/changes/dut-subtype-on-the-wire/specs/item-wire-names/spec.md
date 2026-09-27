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
- **THEN** both carry the `.enum` extension, from the one subtype reader

A declaration that states no subtype (no `:`, nothing after it, or `END_TYPE` straight after it) SHALL NOT be
given one: the item is published as unreadable, never under a guessed subtype.

#### Scenario: a declaration with no subtype
- **WHEN** a project DUT's declaration is `TYPE X END_TYPE`
- **THEN** `fetch` lists `X` in `unreadable` and publishes no `X.alias`

### Requirement: a subtype change is an update of the same object

Below the vendor seam the four DUT names SHALL be one object, the bare name. In one push, a DUT op that changes
only the subtype SHALL update that object's content and SHALL NOT delete or create it: a `set` whose `toName`
differs from `name` only in the DUT subtype, and a `delete` of one subtype paired with a `set` (create) of another
subtype for the same bare name, guarded by the delete's `ifVersion`. Any other pair of ops on one bare DUT name
SHALL be refused with `BAD_REQUEST` naming both ops. The rule is about one DUT under two subtype names: a DUT op
beside a same-named op of another kind (`X.fb`) is not a pair.

A DUT op's name SHALL agree with its body: a `set` (update, create, or the name it renames to) whose declaration's
subtype is not the one its wire name carries SHALL be refused with `BAD_REQUEST` naming the op's name and the name
its declaration implies, and nothing written. A `delete` names one wire item: a `delete X.struct` when the IDE's
`X` is an enum SHALL NOT delete `X`, with or without `force`.

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

#### Scenario: a file rewritten as another subtype but not renamed
- **WHEN** a push carries `set X.struct ifVersion v` with an enum body
- **THEN** it is refused with `BAD_REQUEST` naming `X.struct` and `X.enum`, and the IDE is unchanged

#### Scenario: deleting a stale subtype file
- **WHEN** the IDE's DUT `X` is an enum and a push carries `delete X.struct`
- **THEN** the DUT `X` is not deleted

### Requirement: a baseline keyed by the old wire name is refused

A workspace sidecar (`.git/volt/ide-refs.json`) holding a `.dut` key SHALL be refused by name, exactly as a
malformed one is: the refusal names the key, the file to delete, and `volt pull`. Every command that loads the
baseline refuses — `volt pull` included, since it cannot rebuild a baseline it first has to load. There SHALL be
no translation of old keys. A pending baseline holding one SHALL never be promoted by `volt merge --continue`.

A pull with no baseline SHALL still retire every file whose item a complete walk no longer lists (other than an
item the walk could not read): with nothing to report removals against, carrying such a file forward would let
its next edit recreate an item the IDE deleted.

#### Scenario: a workspace from the previous CLI
- **WHEN** `volt push` or `volt pull` runs with a sidecar holding `E_Mode.dut`
- **THEN** it stops before sending anything and names `.git/volt/ide-refs.json` and `volt pull` as the fix

#### Scenario: the fix, after the IDE deleted a DUT
- **WHEN** the IDE deleted `E_Mode` since the last pull, the sidecar is deleted as told, and `volt pull` runs
- **THEN** `src/DUTs/E_Mode.enum` is gone and the rebuilt baseline holds no `E_Mode`
