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
