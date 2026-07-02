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
