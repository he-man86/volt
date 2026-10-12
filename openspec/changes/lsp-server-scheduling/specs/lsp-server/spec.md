## ADDED Requirements

### Requirement: the server does no work twice
The language server SHALL answer a workspace diagnostics pull for an unchanged document as unchanged, SHALL re-parse only
the file a watched-file event names (reference files excepted), and SHALL NOT compute a request the client cancelled
before it was dispatched.

#### Scenario: idle workspace pulls
- **WHEN** the client pulls workspace diagnostics repeatedly and nothing changed
- **THEN** every pull after the first answers unchanged and costs a fraction of a full pass

#### Scenario: saving one file
- **WHEN** one source file is saved
- **THEN** only that file is re-parsed and rebound

### Requirement: the server fails visibly and recovers
A failure in one document SHALL be logged to the client and SHALL NOT leave the server's diagnostics or symbols broken.

#### Scenario: a throwing parse
- **WHEN** parsing one file throws
- **THEN** the error is logged, the server keeps serving, and the next request rebuilds the project scope
