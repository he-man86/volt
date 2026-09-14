## Why

The transpiler (`transpile-st-to-rust`) now covers the language primitives, each measured against CODESYS. The next
constructs a real ST program calls are not language at all: `LEN`, `CONCAT`, `FIND`, `TON`, `CTU`, `R_TRIG` come
from the **libraries a project references** — `Library Manager/Standard`, `Library Manager/Standard64`. CODESYS
itself draws this line: the corpus's materialized `Standard` folder holds exactly the string functions and the
timers/counters/triggers, and none of the operators (conversions, MAX/LIMIT/SEL/MUX, SHL/ROL, math) the transpiler
already lowers.

Three facts from the corpus shape how these can be executed:

| fact | evidence |
|---|---|
| a referenced library materializes as **signatures only** — no bodies | `Standard/LEN.fun` is `FUNCTION LEN : INT` + `VAR_INPUT STR : STRING(255)`, nothing else; `TON.fb` lists `IN`/`PT`/`Q`/`ET` and even its private `M`/`STARTTIME`, but no code |
| libraries are **versioned per project** | every project resolves `Standard 3.5.18.0`; `Standard64` resolves `3.5.20.0` in three and `3.5.17.0` in pro2193 |
| a library's functions exist **only where it is referenced** | `WLEN(wide)` failed in the fixture project with `Identifier 'WLEN' not defined` — the W-string functions are Standard64's, which that project does not reference |

So library code cannot be transpiled from source (there is none), must follow the version a project resolves, and
must be unavailable where the reference is absent.

## What Changes

Library execution splits into two tiers, by whether a library element has **state**:

- **Tier 1 — pure library functions → library-gated transpiler intrinsics. NOW.** `LEN`/`LEFT`/`RIGHT`/`MID`/
  `CONCAT`/`INSERT`/`DELETE`/`REPLACE`/`FIND` (Standard) and their W-variants (Standard64) are deterministic, with
  no clock and no instance. The transpiler lowers a call to one ONLY when the callee resolves to a symbol
  materialized from that library's `Library Manager` folder — the resolution the LSP already performs
  (`isLibrarySymbol`) — takes parameter names, types and capacities from those signature files, and has every
  behaviour recorded by the execution oracle in a project that references the library.
- **Tier 2 — stateful library FBs → a real runtime library. LATER.** `TON`/`TOF`/`TP`, `CTU`/`CTD`/`CTUD`,
  `R_TRIG`/`F_TRIG`, `RS`/`SR`, `RTC`, and Standard64's `LTON`/`LCTU`/… need FB instances (the frame, blocked on
  `transpile-st-to-rust` design §9) and a simulated clock injected per scan. They are built as a runtime bound by
  (library, resolved version) from the project's `Library Manager` manifest. **How that runtime is written is
  decided when this tier starts** — see design.md.

## Impact

- `packages/volt-lsp-iec/src/transpile/lower` — tier 1: a call resolving to a Standard/Standard64 library symbol
  lowers to an IR intrinsic; any other library call stays a counted `expr-call` gap.
- `transpile-st-to-rust` tasks: the STRING row delivers tier 1 for strings; phase 6 ("the standard library")
  becomes tier 2 of this change.
- No impact on the LSP, the bridge, or the shipping product. No runtime crate is created by tier 1.
