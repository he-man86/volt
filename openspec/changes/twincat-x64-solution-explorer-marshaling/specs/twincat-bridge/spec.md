## ADDED Requirements

### Requirement: the TwinCAT bridge works on a plain TwinCAT install
The TwinCAT bridge SHALL read XAE's Solution Explorer hierarchy without any component that only a developer tool (such as
Visual Studio) installs, choosing its reader by the bitness of the XAE process; when the hierarchy cannot be read at all, it
SHALL report `IDE_UNSUPPORTED` with one sentence naming the IDE and what is missing.

#### Scenario: a TwinCAT-only machine
- **WHEN** the bridge serves a 32-bit TcXaeShell on a machine without Visual Studio's 64-bit msenvp registration
- **THEN** `refs`, fetch, push and build succeed

#### Scenario: no reader possible
- **WHEN** the hierarchy cannot be marshalled at all
- **THEN** `health` states it and every op answers `IDE_UNSUPPORTED` with the named sentence
