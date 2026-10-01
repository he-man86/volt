## ADDED Requirements

### Requirement: one unreadable object never fails refs

When the bridge cannot read one project object, `refs` SHALL report that object as unreadable by name and SHALL
return every other item. It SHALL NOT fail the whole walk with `INTERNAL_ERROR`.

An object whose kind cannot be read still counts toward `projectVersion`, ONE entry per object (two of one name
are two objects). Its folder AND its own subtree SHALL count as not walked, so nothing beneath it is reported
removed. The root is spelled `""` and covers the whole project. A push op that names such an object's bare name,
when that name is not a published identity, SHALL be refused `UNREADABLE` by name and SHALL carry no version.
A failure that does not belong to one object, such as an ambiguous or non-fitting vendor overload or a vendor
member that is missing, SHALL fail the operation by name. It is not reported as every object being unreadable.

#### Scenario: the Pro2193 objects
- **WHEN** `refs` runs on a copy of Pro2193, with or without a prior scripting read of `SER_OperationModeType`
- **THEN** it returns the project's items, and any object it cannot read is listed as unreadable by name

#### Scenario: an unreadable root-level object
- **WHEN** the Device node at the project root cannot be classified, and the client's baseline holds items under
  `Device/...`
- **THEN** `refs` and `fetch` name `Device` unreadable and report none of those items removed

#### Scenario: a binder failure
- **WHEN** no vendor read overload, or more than one, fits the arguments
- **THEN** the walk fails by name; it does not answer success with every object unreadable
