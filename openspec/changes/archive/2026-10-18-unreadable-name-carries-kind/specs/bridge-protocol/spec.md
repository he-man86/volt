## ADDED Requirements

### Requirement: an unreadable item is named by its path
Each `unreadable` entry of `refs` and `fetch` SHALL be an item, with `name` its full path `<folder>/<name>.<kind>`, minted
by the same function that names items in `items`, and a `reason`. Both members SHALL be present. A tree node with no file
(an object with no wire path: a container, or an object whose kind could not be read) SHALL NOT be in `unreadable`.

#### Scenario: a function block whose body cannot be read
- **WHEN** the walk classifies `Device/Plc Logic/Application/CM_Carrier` as a POU and its read fails
- **THEN** `unreadable` holds `{ "name": "Device/Plc Logic/Application/CM_Carrier.pou", "reason": … }`

#### Scenario: an FB and its visualization of one name, the FB unreadable
- **WHEN** a folder holds `CM_Carrier.pou` (unreadable) and `CM_Carrier.visualization` (readable)
- **THEN** `unreadable` names `…/CM_Carrier.pou`, and a forced `deleteItem` of that name addresses the FB

#### Scenario: a verbatim-named kind
- **WHEN** a TwinCAT `Untitled2.tmc` cannot be read
- **THEN** its entry is `…/Untitled2.tmc`, and a client that knows that path does not get it in `removed`

### Requirement: a tree node with no file is listed apart
Each `unreadableNodes` entry of `refs` and `fetch` SHALL name an object with no wire path, by its path
`<folder>/<name>`, with a `reason`: a container, or an object whose kind could not be read.
A container whose properties could not be read SHALL leave its subtree unwalked, so no item under it is reported
removed. Both members SHALL be present. `refs` and `fetch` over one walk SHALL give the same
lists.

#### Scenario: a manager setting no text spells
- **WHEN** the CODESYS walk meets a Library Manager whose setting no text spells
- **THEN** `unreadableNodes` holds `{ "name": "<folder>/Library Manager", "reason": … }`, and `unreadable` does not

#### Scenario: a container whose properties cannot be read
- **WHEN** the CODESYS walk cannot read a container's properties, and a client knows an item under it
- **THEN** the container is in `unreadableNodes`, and that item is not in `removed`

### Requirement: a push op resolves by its whole path
A push op SHALL be resolved by its folder, bare name and the kind its extension states, on both drivers; an op naming
`X.dut` SHALL NOT reach an object `X` of another kind, readable or not. A create onto a name a POU, DUT or GVL of the
same application holds (DIALECT C38) SHALL be refused `ITEM_EXISTS` naming that item, force or not.

#### Scenario: a DUT beside an unreadable POU of its name
- **WHEN** the IDE holds `Data/X.pou`, whose body cannot be read, and a push sets `Data/X.dut`
- **THEN** it is refused `ITEM_EXISTS` naming `Data/X.pou`; the POU is not read, not opened and not re-typed
