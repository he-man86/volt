## ADDED Requirements

### Requirement: The bridge emits device-tree instances as read-only descriptors

The bridge SHALL walk the project's device tree and emit every device node (controller, fieldbus master,
drive, axis, I/O module, bus coupler) as a **read-only `.device` item** (wire kind `"device"`, item kind
`PlcDevice`), materialized 1:1 with the IDE tree. Each item's body SHALL be a vendor-neutral **descriptor**
— the device Information fields `Name`, `Vendor`, `Type`, `ID`, `Version`, `Order number`, `Description` as
plain `Key: value` lines, with empty fields omitted (so the wire stays shape-identical across devices that
expose different fields). The descriptor SHALL be extracted **without a project build**. `.device` items
SHALL be read-only — never accepted on a push.

Because the parity boundary is the wire, a vendor bridge that cannot yet enumerate its device tree SHALL
emit no device items (a documented parity gap), keeping the wire contract identical in shape.

#### Scenario: A device instance is emitted with its descriptor
- **WHEN** a client fetches a project whose device tree contains `EtherCAT_Master`, `YDrive`, `MagazineAxes`
- **THEN** the bridge returns a read-only `.device` item per node, each body carrying the device's
  Name/Vendor/Type/ID/Version/Description, at the node's mirrored tree path

#### Scenario: A device with children keeps its descriptor inside its own folder
- **WHEN** a device node has children (e.g. `Coupler_I_O_moduls` with its DI/DQ terminals, or the controller with its PLC Logic + hardware)
- **THEN** its descriptor is emitted INSIDE its own folder (`…/Coupler_I_O_moduls/Coupler_I_O_moduls.device`) and its children mirror underneath; a childless leaf is a plain file at the parent level

#### Scenario: A vendor without device-tree extraction returns none
- **WHEN** the vendor bridge cannot enumerate its device tree
- **THEN** it returns no `.device` items and the `/fetch` response shape is unchanged

### Requirement: The bridge emits non-source project objects as read-only descriptors

The bridge SHALL emit each non-source project object that exposes readable content as a read-only descriptor,
built without a project build: **Project Information** (`.projectinfo` — title/version/company/author/…),
**Trace** configs (`.trace` — task/trigger/resolution/samples), **Recipe** definitions (`.recipe` — the
variable list `var : type (column)`), and the **Symbol configuration** (`.symbols` — access flags). A project
object the scripting API exposes NO readable content for (e.g. Project Settings), and an object CODESYS itself
declares opaque because its plugin is absent (`IUnknownObject`), SHALL remain a documented known-skip rather
than an Unknown — so every project node is either mirrored or a deliberate, documented skip with no
unrecognized-type warning.

#### Scenario: Project Information is mirrored
- **WHEN** a project with Information metadata (title/author/version/company) is fetched
- **THEN** the bridge returns a read-only `.projectinfo` item at the root carrying those fields

#### Scenario: Recipe definitions are mirrored with their variables
- **WHEN** a project's Recipe Manager holds recipe definitions
- **THEN** each is emitted as a read-only `.recipe` item nested under the manager, listing every recipe variable with its type

#### Scenario: An unreadable or plugin-opaque object is a documented skip
- **WHEN** the project contains a config object with no readable content (Project Settings) or an object CODESYS declares opaque because its plugin is absent (`IUnknownObject`)
- **THEN** it is deliberately not emitted (a documented known-skip), and does not surface as an unrecognized-type warning

### Requirement: The project tree is mirrored 1:1 into workspace paths

The bridge walk SHALL nest every container — user folders, structural nodes (PLC Logic, Application, Task
Configuration), device-tree groupers, and devices — under its own name, so the materialized workspace
reads exactly as the IDE tree (e.g. `Device/Plc Logic/Application/<usercode>` with hardware devices as
siblings under `Device/`). Source objects SHALL NOT be flattened out of their containing structure.

#### Scenario: User code nests under Application, hardware under Device
- **WHEN** a CODESYS project with a `Device` controller (PLC Logic → Application → POUs) and hardware is fetched
- **THEN** POUs materialize under `Device/Plc Logic/Application/…` and hardware devices materialize as siblings under `Device/`, matching the IDE tree
