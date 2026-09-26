# Design — plc-library-runtime

> §1–§5 are the decision record, kept as written. §6 is what was BUILT (2026-09-25) and supersedes them where they
> differ: there are no library-gated intrinsics any more — a library element is ST in the library repo.

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

## 5. DECIDED — tier 2's runtime is written in ST

Tier 2 cannot start before FB instances exist (`transpile-st-to-rust` design §9) and a simulated clock is designed.
When it does, one choice has to be made:

| | native Rust crate + TypeScript mirror | library shims written in ST, compiled by our transpiler |
|---|---|---|
| sources per element | two (Rust for emitted code, TS for the interpreter) | one |
| drift between backends | possible — caught only by the oracle | impossible by construction |
| prerequisites | a crate location and build | the memory model (§9) for byte-level string internals; FB instances; the clock as an input |
| readable emitted output | calls into a crate | the shims are transpiled like user code |
| fidelity to a library version | per-version modules | per-version shim sets |

**DECIDED 2026-09-24 — the ST column, plus exactly one intrinsic.** The measurement that settles it:

- **Seven of the ten Standard FBs already work.** `R_TRIG`, `F_TRIG`, `CTU`, `CTD`, `CTUD`, `SR` and `RS` were
  written out in ST as the standard defines them and run through the current pipeline unchanged: they lower, the
  interpreter produces the right edge/count/latch results, and the emitted Rust is ordinary transpiled code
  (`self.q = self.clk & (!self.m);`). Nothing had to be built. Two of the three prerequisites this table listed for
  the ST column are met — FB instances landed, and byte-level strings are tier 1's intrinsics, not tier 2's problem.
- **`TIME` arithmetic works too** — `el := now - start; done := el >= T#3S` lowers and evaluates. So the clocked
  timers are not blocked by their type, only by one missing fact.
- **The clock is the whole remaining gap.** `TON`/`TOF`/`TP` need "what time is it", which the standard's own
  signature (`IN`, `PT`, `Q`, `ET`) gives them no way to ask for. (This first proposed an invented `__NOW()`. The
  language already has the answer — CODESYS's `TIME()` operator, which `cs_clock_reads` builds with no library at all
  — so that is what lowers, and `TON` is ordinary ST.)

Both halves are load-bearing in real code, so neither can be skipped. Across the corpus's project files
(Library Manager excluded):

| | declarations | files |
|---|---|---|
| clock-free — `R_TRIG` `F_TRIG` `CTU` `CTD` `CTUD` `SR` `RS` | 319 | ~43 |
| clocked — `TON` `TOF` `TP` | 282 | ~47 |

Writing one intrinsic is a smaller commitment than maintaining a Rust crate and a TypeScript mirror of it, and it
collapses this table's second row: with the library written in ST, backend drift is impossible by construction
rather than caught after the fact by the oracle. The intrinsic itself still has two backends, but it is one
function returning one number, not ten stateful function blocks.


## 6. BUILT 2026-09-25 — a library repo, and no intrinsic per element

The ST column, taken all the way: the library is not a set of shims beside the transpiler but **the code behind the
compiled library**, kept as a repo the transpiler reads like any other source.

- `packages/volt-lsp-iec/libraries/<library>/<version>/` holds each element as its materialized declaration with an
  ST body written in. The interface is byte-identical to what the bridge materializes (a function may add a private
  VAR for its loop counters, nothing a call sees) — `test/libraries/standard.test.ts` holds every file to that.
- `libraries/index.ts` `withImplementations` is the whole lookup: a project manifest's `RESOLUTION <library>, <version>`
  names a folder, and that folder's files replace the declarations under their own uri. **A version the repo has not
  written keeps its bodyless declarations and stays refused** (`call-library`) — the per-version requirement §4
  asked for, met by the key rather than by a check.
- The transpiler has **no Standard-specific code**. The nine string intrinsics (`lowerStandardString`, the interpreter's
  string table, the prelude's `iec_len`…`iec_find`) are deleted; LEN…FIND are ST over `s[i]` — a language operator,
  0-based, a BYTE, already measured by `string_non_ascii_bytes` (`text[0]` is `BYTE#99`). The recorded string
  fixtures pass against the ST unchanged, which makes CODESYS the oracle for the library's own code.
- The only primitives are the language's: `s[i]` (`char`/`setchar`) and `TIME()`/`LTIME()`, read from a `__clock`
  global (LTIME, ns) the harness sets per scan.
- A library written over POINTERS INTO STRINGS — StringUtils is nothing else — needed one pointer form more, the STRING
  CURSOR (2026-09-26): a `POINTER TO BYTE` / `WORD` / `STRING` input a caller fills with a string's address binds that
  string as a hidden VAR_IN_OUT of the caller's own type (the routine is lowered once per string type) and keeps its
  byte offset as its value, exactly as an element pointer keeps its index. Its `p^` and `p[i]` are characters of the
  bound string through the same `s[i]` primitive. It is form 2 with an offset, not a byte-addressable memory: a pointer
  into anything but a string is still refused.

**Recorded (2026-09-26).** The fixture project references Util and StringUtils as placeholders (as a real project does
— a direct reference is qualified-only), and `fixtures/libraries/library-bodies.ts` asks CODESYS what every element the
repo writes does at the edges its contract leaves open. Timers run on a RECORDED CLOCK: each fixture stores `TIME()`
per scan beside the outputs, and the replay sets the transpiler's `CLOCK` to those instants, so a TON matches exactly
although the simulator runs in real time. Ten bodies matched the first time; eight did not, and CODESYS settled each —
a compare answers its sign, StrCpyA counts the terminator, a pad fills to the size given, StrCmpStart/EndA miss with -1,
16#A0 is a space, TP clears ET in the scan a pulse ends with IN low, BLINK starts HIGH and keeps OUT once disabled. All
20 fixtures now match in both backends.

Two harness decisions carry this. The replay lowers against EVERY library the fixture project references, as the
recording did, bound once (`libraryBase`) with each fixture's own files bound on top — the same shape the LSP replay
already used. And a library FB instance is recorded by its INTERFACE only: what a body keeps privately is the
implementation's, so the repo's body is held to the inputs and outputs and nothing else.

**Not in scope of this decision.** `Standard` is not what blocks the corpus — the namespaces that do are third-party
(`L_LA` 128 POUs, `stu` 105, `CmpApp` 93). ST shims fix the library the standard defines, not the libraries a
customer bought.

