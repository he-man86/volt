## ADDED Requirements

### Requirement: one unreadable object never fails refs

When the bridge cannot read one project object, `refs` SHALL report that object as unreadable by name and SHALL
return every other item. It SHALL NOT fail the whole walk with `INTERNAL_ERROR`.

#### Scenario: the Pro2193 objects
- **WHEN** `refs` runs on a copy of Pro2193, with or without a prior scripting read of `SER_OperationModeType`
- **THEN** it returns the project's items, and any object it cannot read is listed as unreadable by name
