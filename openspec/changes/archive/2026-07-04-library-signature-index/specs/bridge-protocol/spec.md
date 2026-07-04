## ADDED Requirements

### Requirement: The bridge materializes a namespace stub for every library in the dependency tree

The bridge's library-reference walk SHALL enumerate the FULL library dependency tree — the top-level
Library Manager entries AND their transitive dependencies (via `ILibManItem.GetDependencies()`) — and emit
a `.library` stub for each, carrying at least its `NAMESPACE`. Transitive dependencies (a library pulled in
by another, often `HideWhenReferencedAsDependency`) carry namespaces the source references directly (e.g.
`MEM` from CAA Memory), so omitting them leaves those qualified roots unresolvable. This walk SHALL be
build-free (it reads the library manager, not a compiled model) and part of the ordinary `/refs`/`/fetch`
response. Enumeration SHALL dedup by `(namespace, name)` to survive dependency cycles and multiply-referenced
libraries.

#### Scenario: A transitive dependency's namespace is materialized
- **WHEN** a project references a library that itself depends on `CAA Memory` (namespace `MEM`), and CAA Memory is not a top-level Library Manager entry
- **THEN** a `CAA Memory.library` stub with `NAMESPACE MEM` is emitted, so a source reference to `MEM.LowWord` resolves

#### Scenario: The dependency walk terminates on cycles
- **WHEN** the dependency graph contains a cycle or a library reachable via multiple parents
- **THEN** each library is emitted exactly once and the walk terminates

### Requirement: A verbose fetch returns full referenced-library element signatures

`POST /fetch` SHALL accept an optional `verbose` flag (default false). When set, the response SHALL
additionally carry every referenced-library element's public SIGNATURE — the declaration only, with real
member detail (FB/function `VAR_INPUT`/`VAR_OUTPUT`/`VAR_IN_OUT` pins and types, struct fields, enum
members, GVL vars, interfaces, and the `EXTENDS` base) — rendered as Structured Text with NO implementation
body. Each signature SHALL be pathed under its owning library's folder in the Library Manager
(`…/Library Manager/<LibraryName>/<Element>.<kind>`), matched to that library's `.library` ref by
RESOLUTION. System libraries SHALL be dropped (the LSP's floor is vendor libraries); compiler-mangled
(`__`-prefixed) and non-library entries SHALL be filtered. Extraction reads
`LanguageModelMgr.AllPrecompiledSignatures`; because a freshly-opened project's precompiled set is empty,
the bridge SHALL precompile first via a best-effort build (even a failing app build precompiles the
resolvable libraries). A vendor bridge that cannot extract SHALL return an empty signature set (documented
parity gap); TwinCAT returns none.

#### Scenario: verbose returns a library element's full signature
- **WHEN** a client fetches with `verbose: true` and a referenced library exposes `FUNCTION_BLOCK L_MC4P_MC_MoveAbsolute`
- **THEN** the response includes an item under that library's Library Manager folder containing the FB's declaration with its real input/output pins and types, and no body

#### Scenario: A normal (non-verbose) fetch pays no extraction cost
- **WHEN** a client fetches without `verbose`
- **THEN** no library element signatures are returned and no build is triggered (the transitive `.library` namespace stubs are still present, as they are build-free)

#### Scenario: A vendor without extraction returns none
- **WHEN** the vendor bridge (TwinCAT) cannot extract library signatures
- **THEN** a verbose fetch returns an empty library-signature set, keeping the wire shape identical
