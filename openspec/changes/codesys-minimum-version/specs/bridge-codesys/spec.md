## ADDED Requirements

### Requirement: the CODESYS bridge knows its CODESYS version

The CODESYS bridge SHALL read the full version of the underlying CODESYS platform it runs in (not an OEM product's own version) and SHALL report it as `IdeVersion`, not a fixed `"3.5"`.

#### Scenario: version reported
- **WHEN** the bridge starts inside CODESYS 3.5.21.40
- **THEN** the health row reports `IdeVersion` `3.5.21.40`

### Requirement: an unsupported CODESYS is refused clearly

When the CODESYS it runs in lacks an API the bridge needs, the bridge SHALL NOT report itself healthy and SHALL answer every call with code `IDE_UNSUPPORTED` and a fixed English message naming the platform version and the missing capability. It SHALL also write that reason to the CODESYS message window at start. The bridge SHALL NOT refuse by version number alone: an OEM IDE on an older CODESYS platform that has every capability is served.

#### Scenario: CODESYS 3.5.17 lacks a needed API
- **WHEN** the bridge starts inside a CODESYS 3.5.17 that lacks a capability the bridge needs
- **THEN** the message window names 3.5.17 and the missing capability, and every call is refused with `IDE_UNSUPPORTED` instead of failing with a runtime exception

#### Scenario: an older OEM platform with every capability
- **WHEN** the bridge starts inside an OEM IDE (e.g. WAGO, Lenze) on a CODESYS platform older than 3.5.21 that has every needed capability
- **THEN** the bridge is healthy and serves calls, and `IdeVersion` reports the underlying platform version, not the OEM product version

### Requirement: bound assemblies are logged

At start the bridge SHALL log the path and version of `Volt.Wire`, `Volt.Contracts` and `System.Text.Json` as bound in the process.

#### Scenario: one line per assembly
- **WHEN** the bridge starts
- **THEN** the bridge log carries the location and version of each of the three assemblies
