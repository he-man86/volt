## ADDED Requirements

### Requirement: a TwinCAT attach serves what its XAE has open

A TwinCAT worker that attaches to its XAE window SHALL serve that window's first TwinCAT project without any client
sending `select`, as a CODESYS bridge serves its primary project. A project the window opens after the attach SHALL be
taken up by the health poll. A `select` by name SHALL serve another project, and the project it names SHALL never be
replaced by the attach.

#### Scenario: a bridge with no local client serves
- **WHEN** a TwinCAT worker attaches to an XAE whose solution holds a TwinCAT project, and no client sends `select`
- **THEN** its health row reads `healthy` and `refs` answers with the project's items

#### Scenario: a project opened after the attach
- **WHEN** the XAE had no TwinCAT project open at the attach, and one is opened later
- **THEN** the next health poll takes it up and the bridge serves it, with no `select`

#### Scenario: a named select wins
- **WHEN** a client selects another project of the window by name
- **THEN** that project is served, and neither the health poll nor a recovery returns to the attached one

### Requirement: the attached project is recovered like a selected one

The project the attach took up SHALL be the worker's standing selection, so a recovery after the XAE re-registers its
DTE re-establishes it by name.

#### Scenario: the XAE re-registers
- **WHEN** a bridge serving the project it attached to loses its DTE and recovers
- **THEN** it serves the same project again, by name
