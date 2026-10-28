## ADDED Requirements

### Requirement: a push receipt's removed proves each removal
A push answer's `removed` SHALL name a path only when the receipt walk read its folder and no longer holds it, so a
client may take `removed` as proof that a delete took effect without reading the project again.

#### Scenario: a delete the IDE accepted but did not perform
- **WHEN** a push's `deleteItem` is answered success by the IDE and the item is still in the project
- **THEN** its path is not in `removed`, and the answer says the delete did not take

#### Scenario: a delete under a folder the receipt walk could not read
- **WHEN** a landed `deleteItem` names an item under one of the receipt's `unwalkedFolders`
- **THEN** its path is not in `removed`
