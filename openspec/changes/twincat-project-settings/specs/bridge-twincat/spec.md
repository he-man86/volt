## ADDED Requirements

### Requirement: TwinCAT materializes the project's compiler settings

The TwinCAT bridge SHALL materialize the PLC project's compiler settings as the read-only `Project Settings.projectsettings` descriptor, in the same format the CODESYS bridge uses, read from the settings TwinCAT itself stores. A setting with no vendor source SHALL be omitted, never defaulted.

#### Scenario: a disabled warning
- **WHEN** warning C0371 is disabled in a TwinCAT PLC project and the project is pulled
- **THEN** `Project Settings.projectsettings` contains `Disabled warnings:     C0371`, byte-identical to what the CODESYS bridge writes for the same setting, and the LSP no longer reports that warning
