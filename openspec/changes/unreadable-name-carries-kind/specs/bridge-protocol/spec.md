## ADDED Requirements

### Requirement: an unreadable item is named by its path
Each `unreadable` entry of `refs` and `fetch` SHALL be an item, with `name` its full path `<folder>/<name>.<kind>`, minted
by the same function that names items in `items`, and a `reason`. Both members SHALL be present. A tree node with no file
(a container setting no text spells, or an object whose kind could not be read) SHALL NOT be in `unreadable`.

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
Each `unreadableNodes` entry of `refs` and `fetch` SHALL name a tree node that has no file, by its path
`<folder>/<name>`, with a `reason`. Both members SHALL be present. `refs` and `fetch` over one walk SHALL give the same
lists.

#### Scenario: a manager setting no text spells
- **WHEN** the CODESYS walk meets a Library Manager whose setting no text spells
- **THEN** `unreadableNodes` holds `{ "name": "<folder>/Library Manager", "reason": … }`, and `unreadable` does not
