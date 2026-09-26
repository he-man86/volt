## SUPERSEDED 2026-09-25 — the library repo (design §6)

Tier 1's intrinsics below are DELETED: the nine string functions are ST in `packages/volt-lsp-iec/libraries/Standard/
3.5.18.0/`, written over `s[i]`, and the same recorded string fixtures confirm them (now 1947 confirmed, up from
1945 — `string_non_ascii_bytes` was only not-lowered for want of `s[i]`, and `cs_clock_reads` for want of
`TIME()`). The history below is kept as it was written.

## Tier 1 — pure library functions as library-gated transpiler intrinsics · DONE (2026-09-21)

Delivered through `transpile-st-to-rust`'s STRING row; tracked there, summarised here. The boxes were still
unticked long after the code landed — `lowerStandardString` in `transpile/lower/builtins.ts` is the whole of it.

- [x] Gate: a call lowers to an intrinsic only when its callee resolves to a symbol under
      `Library Manager/Standard/` (or `Standard64/`); every other call stays a counted `expr-call`.
      `lowerStandardString` resolves the name and checks `libraryOf(sym) === "Standard"` — a project that
      references no Standard has no LEN, and a project FUNCTION called LEN is not this one.
- [x] Signatures read from the materialized `.fun` files — names, types, `STRING(255)` capacities. Taken from the
      symbol's own AST, never recalled: parameters and result both come from `sym.ast`, and an argument converts
      into the declared capacity exactly as the compiler passes it.
- [x] Standard: `LEN`, `LEFT`, `RIGHT`, `MID`, `CONCAT`, `INSERT`, `DELETE`, `REPLACE`, `FIND` — oracle-recorded in
      the fixture project (`Standard 3.5.18.0`), green in the interpreter and the emitted Rust. **69 string
      fixtures rated `confirmed`**; the three that are not are two refusals the vendor also refuses and one
      `not-lowered` (non-ASCII bytes).
- [x] A capacity edge measured, not assumed: a `STRING(300)` passed to a `STRING(255)` input —
      `string_input_truncation` asks `LEN`, `LEFT` and `CONCAT` of a 300-character argument.
- [ ] Standard64: the W-variants — needs a fixture project that references Standard64 before they can be
      recorded. Measured meanwhile as ABSENT rather than guessed: `WLEN`/`WLEFT` answer "Identifier 'WLEN' not
      defined" without the reference, and Standard's `LEN` refuses a WSTRING outright, so `wstring_basic`
      measures the WSTRING without functions at all.

## Tier 2 — the stateful FBs · DONE as ST in the library repo (2026-09-25)

- [x] Prerequisite: FB instances in the frame (`transpile-st-to-rust` design §9, phase 3).
- [x] Prerequisite: a simulated clock injected per scan — `TIME()`/`LTIME()` read a `__clock` global the harness sets.
- [x] **Decision: native Rust crate + TS mirror, or ST shims** (design §5) — ST, and as a repo (design §6).
- [x] `TON`/`TOF`/`TP`, `CTU`/`CTD`/`CTUD`, `R_TRIG`/`F_TRIG`, `RS`/`SR`, `RTC` — bound by (library, resolved version).
- [x] Record the FB bodies against CODESYS (`fixtures/libraries/library-bodies.ts`, timers on the recorded clock).
- [x] Util's `BLINK` (3.5.19.0 and 3.5.21.0, the versions the corpus resolves) — the Util element real code calls
      most (44 sites); its phase timer is Standard's TP, so it is also one repo library running on another. One more
      corpus POU lowers (54 -> 55).
- [x] StringUtils (3.5.18.0, 3.5.20.0) — the STR* functions over a byte, word or string pointer and the helpers they
      call: 24 elements. They needed the STRING CURSOR first (`Lowering.cursors`): a character pointer a caller fills
      with `ADR(s)`, a pointer variable or its own cursor binds the caller's string by its own type and keeps its byte
      offset, so `p^`, `p[i]` and `p := p + n` are characters of that string. Library calls through a namespace
      (`Stu.StrTrimA(…)`) lower too. The library ships compiled, so the bodies began as readings of its contract;
      the recordings below corrected six of them.
- [ ] StringUtils, the rest: the W functions over a BYTE pointer into a WSTRING (`StrLenW`, `StrConcatW`, `StrCpyW`,
      the W pads, `StrTrimW`) need a byte view of a WORD string; `HelpTrim`/`HelpTrimW` return a cursor, which would
      carry its string out of the call; the `CharBufferString` family (`StrCmp`, `StrCpy`, `StrFind`, `StrLen`,
      `StrCpyFrom`, `CharacterAtEquals`) and the formatters are classes. `StrMidA`/`StrTrimA`/`StrReplaceA` wait on
      the pro2193 re-pull to be materialized at all.
- [x] Record StringUtils and Util against CODESYS — the fixture project references both as placeholders now.

## Recorded against CODESYS · DONE (2026-09-26)

- [x] `CodesysTestProject.project` references Util and StringUtils as PLACEHOLDERS, the way a real project does. A
      direct reference (what scripting's `add_library` makes) left them qualified-only — "Identifier 'StrCmpA' not
      defined". The SP21 profile resolves them to Util 3.5.21.0 and StringUtils 3.5.20.0, both in the repo; the corpus
      copy (`test-corpus/CodesysTestProject`) is re-pulled to match.
- [x] The replay lowers against EVERY library the project references (`support/project-libraries.ts`), and so does
      the LSP replay — agreement unchanged. Bound ONCE (`libraryBase`): each fixture's own files are bound on top and
      taken off again, since rebuilding 857 library files per fixture pushed a gate past its hang guard.
- [x] Timers run on a RECORDED CLOCK: a fixture's `clock` names a per-scan `TIME()` array recorded beside the
      outputs, and both backends set `CLOCK` to those instants before each scan.
- [x] A library FB instance expands to its INTERFACE only (`run-paths.ts`) — its private variables are the
      implementation's, written by the repo its own way (and RTC's `CURTIME` is not even readable online).
- [x] `fixtures/libraries/library-bodies.ts` — 20 fixtures, one per edge a contract leaves open. Ten bodies matched
      as written; CODESYS settled the other eight: a compare answers its SIGN; `StrCpyA` counts the terminator it
      writes; `StrPadLeftA`/`RightA` fill to the size given; `StrCmpStart`/`EndA` miss with -1; 16#A0 is a space;
      TP clears ET in the scan a pulse ends with IN low and holds PT while IN stays high; BLINK starts HIGH and keeps
      OUT once disabled. All 20 match in the interpreter and the emitted Rust.

## Open, found on the way

- [ ] Re-pull pro2193 with the bridge that materializes return-less FUNCTIONs — until then its corpus build gate is
      red on `StrReplaceA`, and `StrMidA`/`StrTrimA`/`StrReplaceA` have no declaration to write a body behind.
- [ ] A string cursor over a GLOBAL is refused (`call-inout-global`, 105 corpus POUs: `StrCpyA(pBuffer :=
      ADR(<GVL string>), …)`). The emitted Rust cannot lend a field of `g` beside `g` itself; the fix is the callee
      reaching the global through `g` — a transpiler item, tracked in `transpile-st-to-rust`.
- [ ] The materialization does not record a reference's ACCESS: a direct reference to StringUtils was qualified-only
      in CODESYS while the LSP resolved its bare names. The `.library` manifest would need the reference's
      qualified-only flag for the LSP to refuse a bare `StrCmpA` there, as the compiler does.
- [ ] TwinCAT materializes its libraries under `References/`, which `libraryOf` does not recognise — so on TwinCAT
      the library repo is never consulted. Needs a live TwinCAT pull to confirm the folder name.
- [ ] Standard64: a fixture project that references it, then `libraries/Standard64/<version>/` — the W-functions,
      `LTON`/`LTOF`/`LTP`, `LCTU`/`LCTD`/`LCTUD`.

## What tier 1 did NOT decide, and is now worth writing down

- **A library with no BODY is a different problem, and it is bigger.** Re-measured 2026-09-26, with library units
  refused rather than run empty: `call-library` reaches **188** corpus POUs and is the sole blocker of **2**. By
  library: Lenze motion and modules (`L_IMHP_ModuleHandler` 118 sites, `L_MC1P` 26 elements), error handling
  (`L_IE1P`), EtherCAT, CAA TCP/File/SDO, RecipeManagement — elements that drive hardware, fieldbus, files and
  sockets. Those are not written in ST at all; they need test doubles a test configures (`transpile-st-to-rust`
  design §8), which is a proposal of its own.
- **A library's materialization is not the same thing as the library.** The conformance replay was measured on
  this in passing (2026-09-21): CODESYS's `Standard` materialization models TwinCAT's `Tc2_Standard` well enough
  that giving it to both vendors' replay projects added **zero false positives** across 2595 fixtures. That is a
  measurement about signatures agreeing, not a licence to treat the two as one library — a specific divergence,
  when one is found, is a reason to materialize `Tc2_Standard` separately.

## The spec delta against what was BUILT — re-checked 2026-09-26, before anyone archives this

The delta was rewritten to the library repo (it described tier 1's intrinsics). Against the code:

- [x] *a library element executes only where the project references its library* — met: a body exists only where
      `withImplementations` put the repo's file under the project's own `Library Manager/<library>/`, and
      `prepareProject` marks every library unit, so a bodyless one is refused (`call-library`) rather than run empty.
- [x] *a library element's interface is the materialized one* — met and gated for every library and version the repo
      writes: `test/libraries/repo.test.ts`, against a corpus project that resolves that version.
- [x] *a library element runs only for the version it was written for* — met by the key: the repo is looked up by the
      manifest's RESOLUTION; the same test holds that 3.5.19.0 stays refused.
- [x] *the LSP knows a library only through its materialization* — met: `src/reference/` lists no library element.
      pro2193 calls `StrReplaceA`, which the old bridge never materialized (it dropped return-less functions); the
      bridge renders them now, and the corpus build gate stays red on that one name until pro2193 is re-pulled.
- [x] *a library element's behaviour is recorded against the vendor* — met: `fixtures/libraries/library-bodies.ts`,
      20 fixtures, all matching in both backends (the timers on the recorded clock).
