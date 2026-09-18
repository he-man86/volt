# Status — after the first CODESYS recording session

**42 of 44 plan tasks done.** The close-out (`close-out.md`) describes the change as delivered; this records what
the recording session that followed it added, corrected, and opened.

Suite: **2490 pass, 0 fail**. Fixtures: **967**, of which 622 confirmed, 201 refused, 20 not-lowered, 65 unasked,
34 lsp-gap, 3 diverges, 22 unaskable. Of the 625 both sides execute, **99.5% match**.

---

## What the recording answered

`bun run record:exec` put 64 questions to CODESYS 3.5.21.40. Five things we had were WRONG, each now measured:

| | what the vendor said |
|---|---|
| **enum default** | **zero if zero is one of the values, otherwise the FIRST enumerator.** `(Reverse := -1, Neutral := 0, Forward := 1)` starts at Neutral and `(High := 10, None := 0)` at None — neither is the first. Reach returned 46 → 55 of 304 bodies. |
| **`pack_mode` on an FB** | it applies: SIZEOF 16 aligned, **13** packed. A packed layout must not be rounded up at the end either. |
| **negating a TIME** | does not compile. It had been admitted on the reasoning that a duration is arithmetic on milliseconds. |
| **FB output into another type** | does not compile — but by FAMILY, not exact type: `sum => wide` (INT into DINT) is an ordinary widening. |
| **REAL → integer** | goes through a 64-bit register whose out-of-range and NaN answer is `i64::MIN`, then wraps. Four of five points fit; the fifth is open (below). |

Seven refusals were CONFIRMED correct, and `ADD(a, b)` turns out not to be ST at all (`';' expected instead of
'ADD'`), so the call-form refusal needs no work.

## What the recording exposed about the fixtures themselves

**Thirteen fixtures measured nothing, because of their own variable names.** `r`, `s`, `lt` and `gt` are reserved —
they are IL operators — so `domain_sqrt_negative` and twelve others recorded `Unexpected token 'r' found` instead of
an answer, and were then marked `refused` as if that were the vendor's verdict on what they ask. Renamed and
re-recorded.

This is the general lesson worth keeping: **a fixture that fails for an incidental reason looks exactly like a
fixture that proved something.** The `refused` rating cannot tell them apart, and did not.

## Corrections to work done earlier in the change

- **`refused` was an overclaim.** It documented itself as "the vendor rejects it AND so do we" and only checked the
  vendor. 16 fixtures were counted as evidence while the LSP accepted them silently. Now it asks both sides:
  refused 217 → 201, lsp-gap 18 → 34 — the measurement changed, not the gaps.
- **The evidence probe was wrong three times** before it was trustworthy: it read only semantic diagnostics (missing
  parse errors), skipped network text (`computeSemanticDiagnostics` does not read a graphical body), and used a
  made-up URI (a signature-name check compares against the file's). Each mistake invented gaps that did not exist.
- **`refused.test.ts` ignored parse errors**, so any refusal the parser catches read as an LSP gap.
- **`CATEGORIES` and `ALL_TESTS` disagreed** — the rating was merged onto a flattened copy, so a per-category report
  read every rating as absent.

## Open, with the measurement each needs

| item | needs |
|---|---|
| `real_to_dint_below_range` | `LREAL_TO_DINT(-1.0E30)` records `-2147483648` where the model that fits the other four says `0`, and only the SIGN differs. `real_to_dint_runtime_*` put the same magnitudes behind arithmetic no compiler folds — recorded 2026-09-18, awaiting reading. |
| token echo wording | Two dated live confirmations disagree: `Limit : INT;` → `'LIMIT'` (2026-09-03) and `lt : BOOL;` → `'lt'` (2026-09-18). `echo_*_case_*` ask with the same word in three spellings. Changing `describeToken` was tried and reverted — it fixes one and breaks the other. |
| the 16 reserved IL operators | Proved reserved, and adding them costs **44 LSP-only messages** (agreement 863 → 841) because a failed declaration cascades into "not defined" for every later use. `docs/reserved-il-operators.md` records the set and the prerequisite: semantic diagnostics must not cascade from a name whose declaration failed to parse. |
| `instanceRelative` | Still no reaching case. The asymmetry is real in the code (`POU:NAME` vs `FB:NAME`) but three attempts to reach the refusal lowered correctly or hit an earlier one. |
| STRING is UTF-8 | `LEN('$FF')` is 2 and `LEN('caf$C3$A9')` is 7, so a CODESYS STRING holds UTF-8 and LEN counts BYTES. We store one character per escape. A whole encoding model, not a patch. |

## What is NOT in this change, and still governs everything

`src/transpile/index.ts` states it: **56,629 METHOD/ACTION bodies are unreachable**, so about **0.10%** of every
executable body in the corpus lowers. Real PLC logic lives in methods and actions. That work is out of scope here
(D6) and is the natural next change.

---

# Second recording session — 2026-09-18

## `unasked` is zero

Every one of the 967 fixtures has now been put to a real CODESYS. It was 140 when the ceiling was first written and
59 at the start of this session, and the important part is what those 59 turned out to be: **only ten had never been
asked. The other forty-nine were SKIPPED BY THE RECORDER** because they declared nothing PLC_PRG could read — a DUT,
a GVL, an INTERFACE, an FB whose only members are VAR_TEMP. `runPaths` found no path, `record-exec.ts` filtered the
case out, and the fixture sat rated "unasked" as though the question were open. It was not open. It was never put.

That distinction is the session's main lesson, and it is the same one the thirteen reserved-name fixtures taught:
**a fixture that never reached the compiler looks exactly like a fixture whose answer is pending.** The rating could
not tell them apart either.

The fix was in three parts, each cheap:

1. a DUT or GVL fixture declares an instance (or copies its global into one) — the recorder reads `PLC_PRG.<path>`,
   so that is all it took;
2. `pragma-tc.ts`'s three helpers instantiate, which put all eighteen Beckhoff pragmas through CODESYS;
3. `record-exec.ts` no longer filters on `names.length > 0` — a case with nothing to read still answers *does it
   compile, and does the scan finish*.

## What the vendor said that we did not know

| fixture | answer |
|---|---|
| `DUT_XO_mode`, `DUT_X2_grade` | the ZERO enumerator, confirming the measured enum-default rule on two more shapes |
| `DUT_X3_counter` | `UDINT#100` — a type-level `:= 100` survives into an instance |
| eighteen `Tc*` pragmas | inert on CODESYS: `TcRetain` still starts at 0, a `TcRpcEnable` method runs and returns TRUE |
| `itf_var_section_declaration` | an INTERFACE with a VAR section **compiles** |
| `sn_interface_mismatch`, `sn_dut_mismatch` | a declared name unlike the POU's is **not an error** |
| `refuse_var_temp_struct` | **compiles** — `var-temp-composite` is our refusal, not the vendor's |
| `refuse_inout_not_given` | `VAR_IN_OUT 'io' must be assigned in call of 'FB_LANG_inoutmissing_target'` |
| `type_codesys_vector` | `vec4[0]`…`vec4[3]` — four elements, indices from zero |

## Product bugs this exposed

- **`__VECTOR[4] OF REAL` had neither bounds nor open dims.** The count was stored as `upper` with no `lower`, and
  `ArrayDim` holds indices. `resolve.ts` needs both ends to fold and produced an unbounded array; `openDims` needs
  both absent and said it was not open. Its size, its index checks and its members were all working from nothing.
  Now written out as `ARRAY[0..size-1]`, as the comment beside it already claimed. The vendor confirmed it.
- **The emitted Rust did not stop on an infinity** while the interpreter did — `cf6dcf1366` taught one backend and
  not the other. Real arithmetic is wrapped in `iec_finite` now.
- **A vendor fault was rated `unasked`.** "The IDE built it, ran it, and the scan never completed" is an answer, and
  the rater threw away the very measurements the infinity rule is built on. It agrees by faulting too now.

## Recorder bugs this exposed

- **It wrote the JSON once, at the end.** A case that wedges the runtime gets the process killed on its hang guard,
  so two measured answers were lost to a third case that hung `oa.start()`. It dumps after every case.
- **An error recorded after a fault is not evidence.** In two batches the first case whose scan never completed was
  followed by every remaining case timing out — including cases that answer fine alone, and re-running the same four
  in isolation SWAPPED which error each reported. Successes cannot be contaminated and are kept; an error after a
  fault is dropped and the case stays unrecorded, which is the truth. Verified against five known-good cases: there
  is no position effect, the fault really does spread.
- This mattered directly: the infinity rule's two cases had sat at positions 3 and 4 of their batch. Re-measured at
  positions 1 and 2 — **it holds**, and only the quoted error STRINGS were run-order artifacts.

## Where the numbers stand

```
confirmed    681      refused      195      not-lowered   25
lsp-gap       35      diverges      4       unaskable     27      unasked  0
```

The vendor has answered **905 of 967**. Of the **685 we both execute, we match 681 — 99.4%**.

## What is next

1. **`not-lowered` is now the honest reach number**, and it is what D6 is about. The blockers the corpus reports:
   `value-string-order` 4 · `expr-call` 2 · one each of `expr-assign_expr`, `attr-instance-path`, `stmt-expr_stmt`,
   `conversion-type`, `var-temp-composite`, `pointer-targets`, `sizeof-unmeasured`, `call-inout-alias`,
   `for-bound-call`, `adr-offset`, `interface-any-input`, `slot-unknown`.
2. **35 `lsp-gap`** — the vendor rejects a source and we do not. Sixteen are the reserved IL operators, still blocked
   on the parse-error cascade (`docs/reserved-il-operators.md`).
3. **4 `diverges`** — unchanged, each with its measurement recorded above.
4. **The METHOD/ACTION bodies** (D6) still govern everything: ~0.10% of executable bodies in the corpus lower.
