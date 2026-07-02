## ADDED Requirements

### Requirement: The bridge extracts a referenced-library symbol catalog, versioned per library

The bridge SHALL be able to extract a **catalog of every referenced library's public symbols** — the
name, kind (FB/function/struct/enum/interface/GVL), and owning library/namespace of each — rendered as
minimal Structured Text declaration stubs (a header + name + empty body; NO member bodies in this
phase). Because a library's contents are immutable for a given `(name, version, resolution)`, extraction
SHALL be keyed and cached per **library version**, not per project state: a cheap version manifest
(`namespace → {version, resolutionId, catalogHash}`) lets a client fetch catalog entries only for
libraries whose version changed, so an unchanged library set costs nothing. Extraction MAY require a
project build (the compiler populates the symbol model); the bridge SHALL only extract on demand, gated
on a version-manifest diff, never on every `/fetch`. A vendor bridge that cannot extract SHALL return an
empty catalog + empty manifest (documented parity gap), keeping the wire contract identical in shape.

#### Scenario: Only changed libraries are re-extracted
- **WHEN** a client requests library signatures with its known library-version manifest and no library version has changed
- **THEN** the bridge returns no signature payload (the client's `libs/` is already current) without paying the build+extract cost

#### Scenario: A referenced library's public signatures are returned as ST
- **WHEN** a client requests signatures for a library new to it (e.g. `L_MC4P`, `PACK_ML`)
- **THEN** the bridge returns that library's public POU/DUT/GVL/interface declarations as Structured Text, one entry per element, namespaced — with no implementation bodies

#### Scenario: A vendor without extraction returns none
- **WHEN** the vendor bridge cannot extract library signatures
- **THEN** it returns an empty library-signature set and an empty version manifest
