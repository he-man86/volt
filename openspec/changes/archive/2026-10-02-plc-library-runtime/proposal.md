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
- `packages/volt-cli` — the library renderer materializes a FUNCTION with no return type instead of dropping it; the
  fixture project (`test/fixtures/CodesysTestProject.project`) references Util and StringUtils as placeholders.
- `packages/volt-lsp-iec/test/conformance` — the replay lowers against every referenced library, bound once; a
  fixture can run on a recorded clock; `fixtures/libraries/library-bodies.ts` holds every repo body to CODESYS.
- No runtime crate, and no change to the shipping product's behaviour beyond the LSP no longer resolving a library
  element in a project that does not reference its library.

## Close-out (2026-10-02, archived at 23/29)

Built: the library repo (`packages/volt-lsp-iec/libraries/<library>/<version>/`, ST bodies keyed by the manifest's
RESOLUTION) for Standard 3.5.18.0, Util (BLINK) and StringUtils, recorded against CODESYS and green in the interpreter
and the emitted Rust; the spec delta was re-checked against the code at archive and describes what was built. Six
items stay open. They are **backlog for after `transpile-restructure`** (they change transpiler lowering, which that
change restructures first) and are marked "handed off" (not ticked) in `tasks.md`. Verbatim:

1. Standard64: the W-variants — needs a fixture project that references Standard64 before they can be
   recorded. Measured meanwhile as ABSENT rather than guessed: `WLEN`/`WLEFT` answer "Identifier 'WLEN' not
   defined" without the reference, and Standard's `LEN` refuses a WSTRING outright, so `wstring_basic`
   measures the WSTRING without functions at all.
2. StringUtils, the rest: the W functions over a BYTE pointer into a WSTRING (`StrLenW`, `StrConcatW`, `StrCpyW`,
   the W pads, `StrTrimW`) need a byte view of a WORD string; `HelpTrim`/`HelpTrimW` return a cursor, which would
   carry its string out of the call; the `CharBufferString` family (`StrCmp`, `StrCpy`, `StrFind`, `StrLen`,
   `StrCpyFrom`, `CharacterAtEquals`) and the formatters are classes. `StrMidA`/`StrTrimA`/`StrReplaceA` wait on
   the pro2193 re-pull to be materialized at all.
   *(At hand-off: the pro2193 re-pull is done and `StrMidA`/`StrTrimA`/`StrReplaceA` are written; the rest stands.)*
3. A string cursor over a GLOBAL is refused (`call-inout-global`, 105 corpus POUs: `StrCpyA(pBuffer :=
   ADR(<GVL string>), …)`). The emitted Rust cannot lend a field of `g` beside `g` itself; the fix is the callee
   reaching the global through `g` — a transpiler item, tracked in `transpile-st-to-rust`.
4. The materialization does not record a reference's ACCESS: a direct reference to StringUtils was qualified-only
   in CODESYS while the LSP resolved its bare names. The `.library` manifest would need the reference's
   qualified-only flag for the LSP to refuse a bare `StrCmpA` there, as the compiler does.
5. TwinCAT materializes its libraries under `References/`, which `libraryOf` does not recognise — so on TwinCAT
   the library repo is never consulted. Needs a live TwinCAT pull to confirm the folder name.
6. Standard64: a fixture project that references it, then `libraries/Standard64/<version>/` — the W-functions,
   `LTON`/`LTOF`/`LTP`, `LCTU`/`LCTD`/`LCTUD`.
