## ADDED Requirements

### Requirement: the bridge reports what IDE it runs in

The bridge SHALL report on health, for both vendors, the IDE product name (`productName`) and that product's own version (`productVersion`, verbatim) as separate fields beside `ideVersion`, which stays the underlying platform version (CODESYS `3.5.x.y`, as read today; TwinCAT build `3.1.40xx.y`). There SHALL be no second field carrying the platform version.

#### Scenario: plain CODESYS
- **WHEN** the bridge runs inside CODESYS 3.5.21.40
- **THEN** health reports `productName` `CODESYS`, `productVersion` `3.5.21.40` and `ideVersion` `3.5.21.40`

#### Scenario: an OEM IDE whose platform version is readable
- **WHEN** the bridge runs inside an OEM IDE built on CODESYS whose platform version the bridge can read
- **THEN** health reports the OEM's own name and version as `productName` / `productVersion`, and the CODESYS version as `ideVersion`

#### Scenario: TwinCAT
- **WHEN** the bridge runs inside TcXaeShell on a TwinCAT 3.1 build
- **THEN** health reports the shell as `productName` / `productVersion` and the TwinCAT build as `ideVersion`

### Requirement: an unknown platform version is reported as unknown

The bridge SHALL read the underlying platform version only from a source that is part of the platform itself, with no vendor-specific detection. When that source does not answer, `ideVersion` SHALL be null, SHALL NOT be derived from the product version, and an unknown version SHALL NOT by itself be a reason to refuse; any refusal is by missing capability (`IDE_UNSUPPORTED`).

#### Scenario: a version that cannot be read is never guessed
- **WHEN** the platform-version source does not answer
- **THEN** `ideVersion` is null, `productName` and `productVersion` are still reported, and the product version is not copied into `ideVersion`

### Requirement: the bridge reports its release

The bridge SHALL report on health the release version stamped into its binary when it was packaged, distinct for every release, and `(dev)` for an unstamped build — never the shared `1.0.0.0`.

#### Scenario: two releases
- **WHEN** two bridges built from different releases report health
- **THEN** their release values differ, and neither is `1.0.0.0`
