## ADDED Requirements

### Requirement: one tree node is at most one unreadableNodes entry
`refs` and `fetch` SHALL list a tree node at most once in `unreadableNodes`, with everything it holds that no text spells
joined into that entry's one `reason`, and the node SHALL count once in the project version. Two different objects of one
name and different kinds SHALL stay two entries.

#### Scenario: a library manager holding stray redirections and parameter values
- **WHEN** the CODESYS Library Manager at `Device/Plc Logic/Application/Library Manager` redirects placeholders `a` and `b`
  that no reference names, and sets parameter values no manifest spells
- **THEN** `unreadableNodes` holds exactly one entry for that node, whose reason names `a`, `b` and the parameter values

#### Scenario: a library manager whose only unspelled fact is a stray redirection
- **WHEN** the manager redirects placeholder `a` that no reference names, and every parameter value is spelled
- **THEN** `unreadableNodes` holds one entry for the manager, naming `a`

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
