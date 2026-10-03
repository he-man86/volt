## ADDED Requirements

### Requirement: TwinCAT materializes the project's compiler settings

The TwinCAT bridge SHALL materialize the PLC project's compiler settings as the read-only `Project Settings.projectsettings` descriptor, in the same format the CODESYS bridge uses, read from the settings TwinCAT itself stores: the disabled warnings from the saved `.plcproj` (their only source), Replace constants, Max compiler warnings and Project defines from the automation interface (the value in effect). A setting with no vendor source (Warnings as errors, Unicode identifiers, UTF-8 encoding, Breakpoint logging) SHALL be omitted, never defaulted. For the same settings, every row both vendors source SHALL be byte-identical to the CODESYS bridge's.

#### Scenario: a disabled warning
- **WHEN** warning C0371 is disabled in a TwinCAT PLC project and the project is pulled
- **THEN** `Project Settings.projectsettings` contains `Disabled warnings:     C0371`, byte-identical to what the CODESYS bridge writes for the same setting, and the LSP no longer reports that warning

#### Scenario: the same compile options on both vendors
- **WHEN** Replace constants is off, the warning limit is 100 and the defines are `A, B` on a TwinCAT and a CODESYS project
- **THEN** both descriptors carry `Replace constants:     off`, `Max compiler warnings: 100` and `Project defines:       A, B`, and the limit drops the same warnings on both
