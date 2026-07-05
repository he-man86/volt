## ADDED Requirements

### Requirement: The LSP resolves device-tree instance references

The language server SHALL treat each device-tree instance as a known global. It SHALL load the
device-instance names from the workspace's read-only `.device` files (the filename stem is the instance
name) at initialize, and the unresolved-identifier check SHALL NOT flag a **bare** reference to a known
device name (`MagazineAxes`, `EtherCAT_Master`, a drive or axis). Member access into a device
(`YDrive.lrActPosition`) SHALL fall through unchecked — the device's internal type is not mirrored and its
members are not the LSP's to validate. Device instances SHALL be tracked separately from library
namespaces (different source; a device is a global instance, not a namespace).

#### Scenario: A bare device reference resolves
- **WHEN** source passes a device instance as an argument (`grp := MagazineAxes`) and `MagazineAxes.device` exists in the workspace
- **THEN** no unresolved-identifier diagnostic is raised for `MagazineAxes`

#### Scenario: Device member access is not flagged
- **WHEN** source reads a device member (`YDrive.lrActPosition`, `EtherCAT_Master.xRestart`)
- **THEN** no diagnostic is raised for the member (the reference falls through — device internals are unchecked)

#### Scenario: No device catalog leaves behaviour unchanged
- **WHEN** the workspace has no `.device` files
- **THEN** every identifier is checked as before (empty device-instance set)

### Requirement: `.device` is a read-only device-descriptor kind

The workspace file registry SHALL recognize the `.device` extension as a **read-only** reference kind
(default access `r`). A `.device` file is a device-tree instance descriptor — never pushed to the IDE, and
its filename stem is the device instance's global name. It SHALL materialize by pass-through of the
descriptor body (no source assembly), like other reference kinds.

#### Scenario: A `.device` file is read-only
- **WHEN** a `.device` file is present in the workspace and a push is attempted
- **THEN** it is excluded from the push (read-only), and never sent to the bridge

#### Scenario: A `.device` file materializes verbatim
- **WHEN** a `.device` item is materialized on pull
- **THEN** its descriptor body is written to the workspace unchanged at the item's mirrored tree path
