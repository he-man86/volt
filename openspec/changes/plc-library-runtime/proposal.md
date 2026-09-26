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

(Rewritten 2026-09-25 to what was BUILT. The first version split libraries into tier 1 — pure functions as
transpiler intrinsics — and tier 2 — stateful FBs in a runtime to be designed later. Tier 1 shipped and was then
replaced; the runtime was never needed. design.md §5–§6 hold the decision and the measurements.)

A referenced library is **the code behind the compiled library, written in ST**, and nothing else:

- **The library repo** — `packages/volt-lsp-iec/libraries/<library>/<version>/` holds each element as the declaration
  the bridge materializes plus an ST body. The transpiler lowers those like any project POU; there is no intrinsic per
  element, no runtime crate, and no Standard-specific code in `lower/`.
- **Looked up by the version the project resolved** — `withImplementations` reads the project manifest's
  `RESOLUTION <library>, <version>` and swaps the repo's files in under the materialized ones' paths. A version the
  repo has not written keeps its bodyless declarations and is refused (`call-library`).
- **The only primitives are language operators** the transpiler owns: `s[i]` (a string's character) and `TIME()` /
  `LTIME()` (read from a `CLOCK` global the harness sets per scan).
- **Standard 3.5.18.0 is written** — all 22 elements, strings and FBs. The nine string functions are confirmed by the
  execution oracle's recorded fixtures; the FB bodies are the IEC definitions, not yet recorded.
- **Every library, not just Standard** (the user's principle, 2026-09-25): a library element needed by the transpiler
  is written in ST in the repo, and NO library element is known to the LSP except through its materialization.

## Impact

- `packages/volt-lsp-iec/libraries/` — new: the repo and its resolver.
- `packages/volt-lsp-iec/src/transpile` — the string intrinsics deleted; `s[i]`, `TIME()`/`LTIME()` added;
  `prepareProject` makes a project's library units impossible to leave out.
- `packages/volt-lsp-iec/src/reference` — every library element removed from the built-in catalog.
- `packages/volt-cli` — the library renderer materializes a FUNCTION with no return type instead of dropping it.
- No runtime crate, and no change to the shipping product's behaviour beyond the LSP no longer resolving a library
  element in a project that does not reference its library.
