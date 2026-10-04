## ADDED Requirements

### Requirement: a build reports only its own messages

The CODESYS bridge SHALL answer a `build` with the messages that build wrote (its own message categories) and SHALL derive `success` from those messages only; output of scripts, stderr and other message categories SHALL NOT appear as build diagnostics. The diagnostics' shape is unchanged, and an unreadable message store SHALL still be an error diagnostic.

#### Scenario: a script wrote to stderr before the build
- **WHEN** a script has written a line to stderr in the IDE and a clean project is built
- **THEN** the build answers `success: true` and carries no diagnostic for the script's lines

#### Scenario: a real compile error
- **WHEN** the project holds a compile error
- **THEN** the build answers `success: false` and reports that error as before
