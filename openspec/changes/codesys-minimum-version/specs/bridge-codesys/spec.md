## ADDED Requirements

### Requirement: the CODESYS bridge knows its CODESYS version

The CODESYS bridge SHALL read the full version of the CODESYS it runs in and SHALL report it as `IdeVersion`, not a fixed `"3.5"`.

#### Scenario: version reported
- **WHEN** the bridge starts inside CODESYS 3.5.21.40
- **THEN** the health row reports `IdeVersion` `3.5.21.40`

### Requirement: an unsupported CODESYS is refused clearly

Below the supported minimum (CODESYS 3.5 SP21) the bridge SHALL NOT report itself healthy and SHALL answer every call with a coded refusal naming the found and the required version. It SHALL also write that reason to the CODESYS message window at start.

#### Scenario: CODESYS 3.5.17
- **WHEN** the bridge starts inside CODESYS 3.5.17
- **THEN** the message window says CODESYS 3.5.17 is not supported and SP21 or newer is needed, and every call is refused with code `IDE_UNSUPPORTED` and a fixed English message naming 3.5.17 and the minimum, instead of failing with a runtime exception

### Requirement: bound assemblies are logged

At start the bridge SHALL log the path and version of `Volt.Wire`, `Volt.Contracts` and `System.Text.Json` as bound in the process.

#### Scenario: one line per assembly
- **WHEN** the bridge starts
- **THEN** the bridge log carries the location and version of each of the three assemblies
