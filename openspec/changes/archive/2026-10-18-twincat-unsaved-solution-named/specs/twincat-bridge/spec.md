## ADDED Requirements

### Requirement: a TwinCAT window whose solution has no file says why it is not served
A TwinCAT window whose solution has no `.sln` file (a `.tsproj` opened with File > Open > Project where no `.sln` holds
it) SHALL keep no `health` row — saving it opens a modal Save As dialog, which every push and build would raise — and
every refusal on it SHALL be `PLC_DISCONNECTED` naming the cause and the remedy.

#### Scenario: a .tsproj opened with no solution file
- **WHEN** the engineer opens `TwinCAT Project14.tsproj` with File > Open > Project and no `.sln` holds it
- **THEN** `health.projects` holds no row for the window, and `refs` answers `PLC_DISCONNECTED` "This TwinCAT window's
  solution is not saved; save it (File > Save All) to sync it."

#### Scenario: a saved solution
- **WHEN** the window holds `Lift.sln`
- **THEN** the row is named `Lift`, as today
