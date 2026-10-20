## ADDED Requirements

### Requirement: a build may name the applications it compiles
`build` SHALL accept an optional `applications` list of application roots as `refs` publishes them; when present the
bridge SHALL compile only those applications and report only their diagnostics, and when absent it SHALL compile every
application. A root that names no application SHALL be refused with `BAD_REQUEST` naming it, before anything is built.

#### Scenario: one application of two
- **WHEN** a project holds applications `Line1/Plc Logic/App` and `Line2/Plc Logic/App`, and `build` names only the first
- **THEN** only `Line1/Plc Logic/App` is compiled and every diagnostic's path lies under it

#### Scenario: an unknown root
- **WHEN** `build` names `Line3/Plc Logic/App`, which the project does not hold
- **THEN** the bridge answers `BAD_REQUEST` naming `Line3/Plc Logic/App`, and nothing is built
