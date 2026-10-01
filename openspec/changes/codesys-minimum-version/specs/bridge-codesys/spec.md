## ADDED Requirements

### Requirement: the CODESYS bridge knows its CODESYS version

The CODESYS bridge SHALL read the full version of the underlying CODESYS platform it runs in (not an OEM product's own version) and SHALL report it as `IdeVersion`, not a fixed `"3.5"`. `IdeVersion` SHALL be a pure version: an OEM product's name is never part of it.

#### Scenario: version reported
- **WHEN** the bridge starts inside CODESYS 3.5.21.40
- **THEN** `health` reports `ideVersion` `3.5.21.40`, and each row's `version` carries the same value

#### Scenario: an OEM product
- **WHEN** the bridge starts inside an OEM IDE whose product name is not `CODESYS`
- **THEN** `ideVersion` is still the platform version alone, and the product name is in the start log and the message-window line

### Requirement: an IDE lacking what the bridge needs is refused clearly

The CODESYS bridge SHALL check, once at start, a single list of the framework capabilities it needs. When one is missing, the bridge SHALL NOT report itself healthy and SHALL answer every call but `health` with code `IDE_UNSUPPORTED` and a fixed English message naming the platform version and the missing capability; `health` SHALL keep answering, every row idle, with `ideVersion` and that message as `unsupported`. It SHALL also write that reason to the CODESYS message window at start. The bridge SHALL NOT refuse by version number alone: an OEM IDE on an older CODESYS platform that has every capability is served. The refusal is applied in the shared host, so both vendors answer it identically.

#### Scenario: a CODESYS that lacks a needed capability
- **WHEN** the bridge starts inside a CODESYS, of any version, that lacks a capability on the list
- **THEN** the message window names the platform version and the missing capability, and every call but `health` is refused with `IDE_UNSUPPORTED` and that text

#### Scenario: an older OEM platform with every capability
- **WHEN** the bridge starts inside an OEM IDE (e.g. WAGO, Lenze) on a CODESYS platform older than 3.5.21 that has every needed capability
- **THEN** the bridge is healthy and serves calls, and `IdeVersion` reports the underlying platform version, not the OEM product version

#### Scenario: the connector carries the refusal
- **WHEN** the connector polls a bridge whose `health` carries `unsupported`
- **THEN** each of that bridge's rows carries the reason (on the control plane's project view and the tray), and the connector never sends it `connect`

Note: this does NOT settle the field failure that opened the change (CODESYS 3.5.17, chat 896f798f). That install had every capability on the list — it printed "connected to IDE" — and failed with a `MissingMethodException` on Volt's own `PipeClient.Call`. The bound-assembly log below is what will diagnose it.

### Requirement: bound assemblies are logged

At start the bridge SHALL log the path and version of `Volt.Wire`, `Volt.Contracts` and `System.Text.Json` as bound in the process.

#### Scenario: one line per assembly
- **WHEN** the bridge starts
- **THEN** the bridge log carries the location and version of each of the three assemblies
