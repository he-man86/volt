## ADDED Requirements

### Requirement: a build or push never runs inside another build or push

The bridge SHALL NOT start a build or a push while another build or push is running on the same IDE, on either
vendor. A build or push that arrives while one runs SHALL be refused at once with the coded error `IDE_BUSY`, which
states that nothing was applied, and SHALL change nothing. The refusal SHALL be identical on both vendors and for
pipe and relay callers alike. `health` SHALL keep answering throughout.

#### Scenario: a retried build
- **WHEN** a build is requested while an earlier build is still compiling
- **THEN** the second request is refused `IDE_BUSY` at once, and only one compile runs

#### Scenario: a push during a build
- **WHEN** a push arrives while a build compiles
- **THEN** it is refused `IDE_BUSY`, and the project is unchanged

#### Scenario: health during a build
- **WHEN** `health` is requested while a build compiles
- **THEN** it answers at once, as today

#### Scenario: a build after a build
- **WHEN** a build is requested after the previous build has answered
- **THEN** it runs normally
