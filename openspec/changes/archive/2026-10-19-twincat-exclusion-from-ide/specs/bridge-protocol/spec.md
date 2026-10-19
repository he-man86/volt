## ADDED Requirements

### Requirement: TwinCAT reads exclusion from build from the IDE's live property
The TwinCAT bridge SHALL decide whether an item, a member or a folder is excluded from build from the node's live
`Exclude` property, saved or not, and SHALL NOT decide it from the saved `.plcproj`.

#### Scenario: an exclusion not yet saved
- **WHEN** an item is excluded in the IDE and the project is not saved
- **THEN** the item pulls with `%EXCLUDE_FROM_BUILD`

#### Scenario: a re-inclusion
- **WHEN** an excluded item is included again, saved or not
- **THEN** the item pulls as built, with no `%EXCLUDE_FROM_BUILD`, and is not in `unreadable`

#### Scenario: a pushed exclusion
- **WHEN** a push adds or removes `%EXCLUDE_FROM_BUILD` on an item or a member
- **THEN** the IDE's own flag is set or cleared, and a pull reads it back

### Requirement: an excluded TwinCAT folder is answered as an excluded CODESYS folder
A TwinCAT folder excluded from build SHALL be in `unreadableNodes`, and every item under it SHALL be in `unreadable` with
the reason CODESYS gives for the same tree, word for word; none SHALL be pulled as built or read as deleted.

#### Scenario: an excluded folder with a subfolder
- **WHEN** folder `Sim` is excluded and holds `SimType` and `Deep/DeepType`
- **THEN** `unreadableNodes` holds `Sim`, and `unreadable` holds `SimType` and `DeepType`, each "sits in the excluded
  folder" `Sim`
