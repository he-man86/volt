## ADDED Requirements

### Requirement: Volt runs on a plain vendor machine
Volt SHALL need nothing on the machine beyond Windows and the vendor IDE it serves: no developer tool, no component only a
developer tool installs; what it needs beyond that it ships (e.g. git).

#### Scenario: a TwinCAT-only PC
- **WHEN** Volt is installed on a machine with only Windows and TwinCAT
- **THEN** pull, push, build and the CLI work, with no Visual Studio or Git for Windows installed

### Requirement: Volt is culture-invariant
Volt SHALL compare, case-fold, parse and format identifiers, numbers and dates independently of the machine's culture.

#### Scenario: Turkish locale
- **WHEN** Volt runs under tr-TR (in the CLI and inside CODESYS)
- **THEN** every declaration section, keyword and identifier is recognised as under en-US
