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
