/**
 * A POINTER PARAMETER — the facts `pointer-model.md` §8 step 1 ("form 2") is built on. Recorded BEFORE any of it is
 * implemented, like `memory-model.ts` beside it.
 *
 * The design says a `POINTER TO T` input the callee only DEREFERENCES is a `VAR_IN_OUT` binding with a `^` on every
 * use — no new IR, no emitter change, and 62 of the corpus's 99 pointer parameters are that shape. `pointer-order`
 * refuses them today, and it is the sole blocker of 2 POUs and stops 105.
 *
 * WHAT HAS TO BE TRUE for that erasure to be sound, and what each fixture asks:
 *
 *   ptrparam_read           the callee reads `p^` — the caller's value arrives
 *   ptrparam_write          the callee writes `p^` — the CALLER's variable changes, so it is a borrow and not a copy
 *   ptrparam_two_targets    two calls, two different `ADR` arguments — THE question form 1 cannot answer, because
 *                           form 1 records one target per pointer and this pointer has two
 *   ptrparam_method         the same, on a METHOD rather than a FUNCTION — methods are lowered once, so a
 *                           per-call binding is the only shape that can work
 *   ptrparam_function_block a `POINTER TO` input of an FB, which is stored on the instance rather than a frame
 *   ptrparam_passed_on      the callee hands its pointer input to a SECOND callee — a borrow of a borrow
 *   ptrparam_kept           the callee STORES it in a field and reads it on a later scan. This one must NOT become
 *                           a borrow; it is what the `≤ 30` handle column counts, and the recording says what the
 *                           vendor does so the refusal can be checked rather than assumed
 *   ptrparam_unsupplied     a pointer input nobody fills, dereferenced. The value is 0 and the deref faults, which
 *                           is the same "the vendor stops" answer `cc_fp_ptr_deref` records for a local
 *
 * Each asks ONE question, so a case the compiler rejects cannot hide the others.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust pointer-model.md §8"

/** One pointer-parameter question: the POU plus whatever callee it needs, read through PLC_PRG. */
function pp(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar,
    plcPrgBody,
    ...(cycles === undefined ? {} : { cycles }),
    source,
  }
}

export const POINTER_PARAMETER_TESTS: readonly LanguageTest[] = [
  pp(
    "ptrparam_read",
    "FB_LANG_ptrparam_read",
    "a POINTER TO input the callee only reads through — the plain borrow",
    `FUNCTION F_LANG_ptrread : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
F_LANG_ptrread := p^;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_ptrparam_read
VAR
	value : INT := 41;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
got := F_LANG_ptrread(p := ADR(value));
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_read;",
    "inst();",
  ),

  pp(
    "ptrparam_write",
    "FB_LANG_ptrparam_write",
    "the callee WRITES through its pointer input — whether the caller's variable changes says borrow or copy",
    `FUNCTION F_LANG_ptrwrite : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
p^ := 77;
F_LANG_ptrwrite := 1;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_ptrparam_write
VAR
	value : INT := 5;
END_VAR
VAR_OUTPUT
	after : INT;
	wrote : INT;
END_VAR
wrote := F_LANG_ptrwrite(p := ADR(value));
after := value;
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_write;",
    "inst();",
  ),

  pp(
    "ptrparam_two_targets",
    "FB_LANG_ptrparam_two_targets",
    "ONE pointer input, TWO call sites with different ADR arguments — the case a single recorded target cannot hold",
    `FUNCTION F_LANG_ptrtwo : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
F_LANG_ptrtwo := p^;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_ptrparam_two_targets
VAR
	first : INT := 11;
	second : INT := 22;
END_VAR
VAR_OUTPUT
	fromFirst : INT;
	fromSecond : INT;
END_VAR
fromFirst := F_LANG_ptrtwo(p := ADR(first));
fromSecond := F_LANG_ptrtwo(p := ADR(second));
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_two_targets;",
    "inst();",
  ),

  pp(
    "ptrparam_method",
    "FB_LANG_ptrparam_method",
    "a POINTER TO input of a METHOD, called twice with different targets — a method body is lowered once",
    `FUNCTION_BLOCK FB_LANG_ptrparam_method
VAR
	a : INT := 3;
	b : INT := 4;
END_VAR
VAR_OUTPUT
	fromA : INT;
	fromB : INT;
END_VAR
fromA := Read(p := ADR(a));
fromB := Read(p := ADR(b));
END_FUNCTION_BLOCK

METHOD Read : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
Read := p^ * 10;
END_METHOD
`,
    "inst : FB_LANG_ptrparam_method;",
    "inst();",
  ),

  pp(
    "ptrparam_function_block",
    "FB_LANG_ptrparam_fb",
    "a POINTER TO input of an FB — it lives on the instance, not on a call frame",
    `FUNCTION_BLOCK FB_LANG_ptrtaker
VAR_INPUT
	p : POINTER TO INT;
END_VAR
VAR_OUTPUT
	seen : INT;
END_VAR
seen := p^;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_ptrparam_fb
VAR
	value : INT := 63;
	taker : FB_LANG_ptrtaker;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
taker(p := ADR(value));
got := taker.seen;
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_fb;",
    "inst();",
  ),

  pp(
    "ptrparam_passed_on",
    "FB_LANG_ptrparam_passed_on",
    "the callee hands its pointer input to a SECOND callee — a borrow of a borrow",
    `FUNCTION F_LANG_ptrinner : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
F_LANG_ptrinner := p^ + 1;
END_FUNCTION

FUNCTION F_LANG_ptrouter : INT
VAR_INPUT
	p : POINTER TO INT;
END_VAR
F_LANG_ptrouter := F_LANG_ptrinner(p := p);
END_FUNCTION

FUNCTION_BLOCK FB_LANG_ptrparam_passed_on
VAR
	value : INT := 8;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
got := F_LANG_ptrouter(p := ADR(value));
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_passed_on;",
    "inst();",
  ),

  pp(
    "ptrparam_kept",
    "FB_LANG_ptrparam_kept",
    "the callee KEEPS its pointer input in a field and reads it a scan later — the shape a borrow may not become",
    `FUNCTION_BLOCK FB_LANG_ptrkeeper
VAR_INPUT
	p : POINTER TO INT;
END_VAR
VAR
	held : POINTER TO INT;
END_VAR
VAR_OUTPUT
	fromHeld : INT;
END_VAR
IF held <> 0 THEN
	fromHeld := held^;
END_IF
held := p;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_ptrparam_kept
VAR
	value : INT := 31;
	keeper : FB_LANG_ptrkeeper;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
keeper(p := ADR(value));
got := keeper.fromHeld;
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_kept;",
    "inst();",
    3,
  ),

  pp(
    "ptrparam_unsupplied",
    "FB_LANG_ptrparam_unsupplied",
    "a POINTER TO input nobody fills, dereferenced — the value is 0 and the deref is what stops the task",
    `FUNCTION_BLOCK FB_LANG_ptrunfilled
VAR_INPUT
	p : POINTER TO INT;
END_VAR
VAR_OUTPUT
	seen : INT;
END_VAR
seen := p^;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_ptrparam_unsupplied
VAR
	taker : FB_LANG_ptrunfilled;
END_VAR
VAR_OUTPUT
	got : INT;
END_VAR
taker();
got := taker.seen;
END_FUNCTION_BLOCK
`,
    "inst : FB_LANG_ptrparam_unsupplied;",
    "inst();",
  ),
]
