## ADDED Requirements

### Requirement: Both bridges serve library data in one canonical shape

For the same concept, CODESYS and TwinCAT SHALL emit byte-identically-shaped library data on the wire: a
`.library` manifest in the single canonical form (`LIBRARY`/`NAMESPACE`/`RESOLUTION`/`PLACEHOLDER`/`SYSTEM`/
`DEPENDENCIES`). When a bridge can also extract library element signatures, they SHALL be the same `LibSignature`
records rendered by the one shared renderer. The vendor-neutral work (manifest format, rendering, foldering,
`(unresolved)` surfacing) SHALL live once in `Volt.Bridge.Core`; each driver SHALL contribute only its irreducible
vendor extraction, with no duplicated formatting/rendering logic.

#### Scenario: The library manifest is identical in shape across vendors
- **WHEN** each bridge materializes a referenced library's `.library` stub
- **THEN** both produce the canonical `LIBRARY/NAMESPACE/RESOLUTION/PLACEHOLDER/SYSTEM/DEPENDENCIES` manifest via
  the shared `LibraryManifest` builder — never a vendor-specific format

#### Scenario: Library element signatures are a documented TwinCAT limitation
- **WHEN** a TwinCAT project references a library
- **THEN** the bridge returns the library ref + manifest (name/namespace/resolution), but NOT its element
  signatures — the out-of-process automation surface does not expose the language model (see the change's
  research). CODESYS (in-process) does return them; when a future in-process TwinCAT path exists it SHALL reuse
  the same shared renderer. The gap is surfaced, never faked.

### Requirement: Property accessors round-trip identically on both bridges

A property's GET-only, SET-only, and GET+SET accessor shape SHALL round-trip byte-identically through both
bridges — no phantom accessor is synthesized (e.g. a `__SETVALUE` on a get-only property) and none is dropped.

#### Scenario: A GET-only property is not given a phantom setter
- **WHEN** a GET-only property is fetched and pushed back through the TwinCAT bridge
- **THEN** it round-trips as GET-only, with no synthesized `__SETVALUE`, matching the CODESYS result
