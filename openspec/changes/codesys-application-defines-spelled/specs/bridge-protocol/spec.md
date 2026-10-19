## ADDED Requirements

### Requirement: a container's own facts are a read-only descriptor inside it
A tree container whose own facts no other item states SHALL have one read-only descriptor item inside it, named after the
container, with the container's own kind, rendered by the shared descriptor format. The descriptor SHALL exist exactly
when the container has a fact to state; a build property at its defaults states none. A push to it SHALL be refused, and
the container SHALL NOT appear in `unreadableNodes` for a fact its descriptor states.

#### Scenario: an application with compiler defines
- **WHEN** the CODESYS application `Device/Plc Logic/Application` has the compiler define `A` and no other build setting
- **THEN** `items` holds `Device/Plc Logic/Application/Application.application`, whose `Compiler defines` row is `A`, and
  `unreadableNodes` does not name the application

#### Scenario: an application with every build setting at its default
- **WHEN** an application's build property holds no define, no undefine and no flag
- **THEN** `items` holds no `.application` item for it, and `unreadableNodes` does not name it

#### Scenario: a push to the descriptor
- **WHEN** a push sets `Device/Plc Logic/Application/Application.application`
- **THEN** it is refused as a push to any read-only descriptor is

#### Scenario: a define changed in the IDE
- **WHEN** the engineer changes the application's define from `A` to `B`
- **THEN** the descriptor's text has `B` and its version changes

### Requirement: an application's defines have one spelling on both vendors
A TwinCAT PLC project's compiler defines SHALL be spelled in a `.application` descriptor at the PLC project node the
walk states in `applications`, and the `Project defines` row of that PLC project's `.projectsettings` SHALL be absent.

#### Scenario: a TwinCAT PLC project with a define
- **WHEN** PLC project `Lift` has the compiler define `A`
- **THEN** its `.application` descriptor's `Compiler defines` row is `A`, and its `Project Settings.projectsettings` has no
  `Project defines` row

### Requirement: the LSP reads every application's defines and every project's settings
The LSP SHALL answer `defined(x)` in an item from the compiler defines of the application whose root is the longest prefix
of the item's path, and SHALL keep each `.projectsettings` for the project or application it sits in rather than only the
last one read.

#### Scenario: two applications with different defines
- **WHEN** application `Line1` defines `A` and application `Line2` defines nothing, and both hold `{IF defined(A)}`
- **THEN** the branch is live in `Line1`'s items and not in `Line2`'s

#### Scenario: two PLC projects with different settings
- **WHEN** TwinCAT PLC projects `Lift` and `Line1` each have a `.projectsettings` disabling different warnings
- **THEN** each project's items are checked with its own settings
