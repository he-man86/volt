## ADDED Requirements

### Requirement: a CODESYS library parameter value is spelled in its library's manifest
The `.library` manifest of a CODESYS library reference SHALL carry one `PARAMETER <library> <name> := <value>` line per
parameter value the project sets for it, in the vendor's order, byte-identical to the TwinCAT line for the same name and
value. Such a value SHALL NOT be a reason in `unreadableNodes`. A value for a library no walked reference names SHALL
stay a reason in the manager's one entry.

#### Scenario: a parameter set in the project
- **WHEN** the project sets parameter `PARAM.X` of library `Util` to `16` in the Library Manager
- **THEN** the `.library` manifest of `Util` holds `PARAMETER Util PARAM.X := 16`, `16` being the text the Parameters tab
  shows

#### Scenario: a value edited in the IDE
- **WHEN** the engineer changes that value to `32` in the IDE
- **THEN** the version of the `Util` manifest changes, and so does the project version
