## ADDED Requirements

### Requirement: a TwinCAT window serves its solution under the name XAE states
The TwinCAT bridge SHALL name the bound solution by the name XAE states for it (the name Solution Explorer shows), not
by its `.sln` file, so a solution with no file is served like any other.

#### Scenario: a .tsproj opened directly
- **WHEN** the engineer opens `TwinCAT Project14.tsproj` with File > Open > Project, and XAE states the solution's name
  `TwinCAT Project14` with no `.sln` file
- **THEN** `health.projects` holds one `idle` row `TwinCAT Project14`, and `connect { "project": "TwinCAT Project14" }`
  binds it

#### Scenario: a saved solution
- **WHEN** the window holds `Lift.sln`
- **THEN** the row is named `Lift`, as today
