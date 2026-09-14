# Design — plc-library-runtime

## 1. The boundary is CODESYS's own: operator vs library element

A name the compiler provides (`MAX`, `REAL_TO_INT`, `SHL`, `EXPT`, `TRUNC`) is language, and the transpiler owns it.
A name that exists only because a project references a library (`LEN`, `CONCAT`, `TON`, `CTU`) is a library
element. The evidence is the materialized `Library Manager/Standard` folder: it contains exactly the string functions
and the timers/counters/triggers, plus internals (`LEN_INTERNAL`, `MEMCOPY_INTERNAL`) — and no operator.

The STRING **type** — capacity, truncation, comparison, literals — is language, and so are the `*_TO_STRING` /
`STRING_TO_*` conversions. Only the string FUNCTIONS are library.

## 2. The gate is name resolution, not a list

A library element is available exactly where the project references its library. The LSP already materializes a
referenced library's signatures into `Library Manager/<library>/` and resolves names against them
(`symbols/isLibrarySymbol`). The transpiler binds an intrinsic only when a call's callee resolves to such a symbol
under the right library folder. No second index, no hardcoded "these names exist" table — a project without the
reference leaves `WLEN` unresolved, exactly as CODESYS does.

## 3. Signatures come from the materialized files

Parameter names, parameter types and result types — including capacities (`CONCAT` returns `STRING(255)`, every
string input is `STRING(255)`) — are read from the library's `.fun`/`.fb` files, never recalled. A consequence worth
measuring rather than assuming: a `STRING(300)` passed to a `STRING(255)` input is truncated on the way in.

## 4. Behaviour comes from the execution oracle, per library version

Every tier-1 intrinsic is recorded by `bun run record:exec` in a fixture project that references the library at the
version the recording names. A library version with no recording is reported as unverified, not assumed to behave
like another version. (The fixture project references `Standard` only: Standard64 needs a fixture that references it
before its W-functions can be recorded.)

## 5. OPEN — how tier 2's runtime is written (decide when tier 2 starts)

Tier 2 cannot start before FB instances exist (`transpile-st-to-rust` design §9) and a simulated clock is designed.
When it does, one choice has to be made:

| | native Rust crate + TypeScript mirror | library shims written in ST, compiled by our transpiler |
|---|---|---|
| sources per element | two (Rust for emitted code, TS for the interpreter) | one |
| drift between backends | possible — caught only by the oracle | impossible by construction |
| prerequisites | a crate location and build | the memory model (§9) for byte-level string internals; FB instances; the clock as an input |
| readable emitted output | calls into a crate | the shims are transpiled like user code |
| fidelity to a library version | per-version modules | per-version shim sets |

Neither is taken here.
