## ADDED Requirements

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
