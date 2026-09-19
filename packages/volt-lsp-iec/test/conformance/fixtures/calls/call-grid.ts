/**
 * CALLEE KIND × ARGUMENT FORM — the grid `calls/call-shapes.ts` covers in forty hand-picked cases.
 *
 * Six things can be called and six ways to pass an argument, and the combination is where the behaviour lives:
 *
 *   FUNCTION   FB   METHOD   ACTION   PROPERTY   library function
 *   positional   named   output-binding   VAR_IN_OUT   omitted   EN/ENO
 *
 * Most of that product is a real question and almost none of it is recorded as a grid. The ones that matter most:
 *
 *   OMITTING AN INPUT means two different things. An FB instance RETAINS its inputs between calls, so leaving one
 *   out on the second call is normal and the old value stands; a FUNCTION has no instance to retain anything.
 *   `call-arguments.ts` says exactly this and it is checked for a FUNCTION only.
 *
 *   MIXING NAMED AND POSITIONAL is refused by every check in the analyzer as "can't bind by index", which is a
 *   statement about OUR ability to check it, not about the vendor's about accepting it. Nothing recorded says
 *   whether CODESYS takes it.
 *
 *   ORDER OF EVALUATION shows only when an argument has a side effect. Two inputs that each bump a counter say
 *   which one ran first, and a VAR_IN_OUT bound after them says when the binding happened.
 *
 * Each probe reads a value, so the answer is a number and not a message — except where the vendor refuses, and then
 * the refusal is the answer.
 */
import type { LanguageTest } from "../../types.js"

/** The callee every probe shares: two inputs, an output, an in-out, and a method and property beside them. */
const TARGET = `FUNCTION_BLOCK FB_LANG_cg_target
VAR_INPUT
\tfirst : INT;
\tsecond : INT;
END_VAR
VAR_OUTPUT
\tsum : INT;
END_VAR
VAR_IN_OUT
\ttouched : INT;
END_VAR
VAR
\tcalls : INT;
END_VAR
calls := calls + 1;
sum := first + second;
touched := touched + 1;
END_FUNCTION_BLOCK

METHOD Twice : INT
VAR_INPUT
\tn : INT;
END_VAR
Twice := n * 2;
END_METHOD

PROPERTY Count : INT
GET
Count := calls;
END_GET
END_PROPERTY
`

const FUNC = `FUNCTION FUN_LANG_cg_add : INT
VAR_INPUT
\ta : INT;
\tb : INT;
END_VAR
FUN_LANG_cg_add := a + b;
END_FUNCTION
`

/** The vendor's verdict where a probe is refused. An FB takes NO positional argument, whatever its inputs. */
const REFUSED: Readonly<Record<string, string>> = {
  cg_fb_positional: "Assignment to input missing for parameter '1' in call of 'FB_LANG_CG_TARGET'",
  cg_fb_mixed: "Assignment to input missing for parameter '1' in call of 'FB_LANG_CG_TARGET'",
}

function probe(slug: string, decls: string, body: string, outType: string, feature: string, cycles = 1): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "04-pous.md",
    ...(REFUSED[slug] !== undefined ? { refused: REFUSED[slug]! } : {}),
    cycles,
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `${TARGET}\n${FUNC}\nFUNCTION_BLOCK ${pou}\nVAR\n\ttarget : FB_LANG_cg_target;\n\tmark : INT;\n${decls}\n\tout : ${outType};\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

export const CALL_GRID_TESTS: readonly LanguageTest[] = [
  // ── an FB, every argument form ──────────────────────────────────────────────────────────────
  probe("cg_fb_positional", "", "target(1, 2, mark);\nout := target.sum;", "INT", "an FB called with positional arguments"),
  probe("cg_fb_named", "", "target(first := 1, second := 2, touched := mark);\nout := target.sum;", "INT", "an FB called with every argument named"),
  probe(
    "cg_fb_mixed",
    "",
    "target(1, second := 2, touched := mark);\nout := target.sum;",
    "INT",
    "an FB called with a positional and a named argument — refused by our checks as unbindable; does the vendor take it?",
  ),
  probe(
    "cg_fb_output_bound",
    "\tgot : INT;",
    "target(first := 1, second := 2, touched := mark, sum => got);\nout := got;",
    "INT",
    "an FB's output bound with `=>` in the call",
  ),
  probe(
    "cg_fb_omitted_input",
    "",
    "target(first := 7, second := 3, touched := mark);\ntarget(second := 4, touched := mark);\nout := target.sum;",
    "INT",
    "an FB called again with `first` LEFT OUT — the instance retains it, so the sum should be 7 + 4",
  ),
  probe(
    "cg_fb_inout_counts",
    "",
    "target(first := 1, second := 2, touched := mark);\nout := mark;",
    "INT",
    "the VAR_IN_OUT the callee incremented, read back in the caller",
  ),

  // ── a FUNCTION ──────────────────────────────────────────────────────────────────────────────
  probe("cg_fun_positional", "", "out := FUN_LANG_cg_add(1, 2);", "INT", "a FUNCTION called positionally"),
  probe("cg_fun_named", "", "out := FUN_LANG_cg_add(a := 1, b := 2);", "INT", "a FUNCTION called with named arguments"),
  probe("cg_fun_mixed", "", "out := FUN_LANG_cg_add(1, b := 2);", "INT", "a FUNCTION called with one of each"),
  probe(
    "cg_fun_named_reversed",
    "",
    "out := FUN_LANG_cg_add(b := 1, a := 2);",
    "INT",
    "a FUNCTION whose named arguments are written in the other order",
  ),

  // ── a METHOD and a PROPERTY ─────────────────────────────────────────────────────────────────
  probe("cg_method_positional", "", "out := target.Twice(21);", "INT", "a METHOD called positionally"),
  probe("cg_method_named", "", "out := target.Twice(n := 21);", "INT", "a METHOD called with its input named"),
  probe(
    "cg_property_after_calls",
    "",
    "target(first := 1, second := 2, touched := mark);\ntarget(first := 1, second := 2, touched := mark);\nout := target.Count;",
    "INT",
    "a PROPERTY read after two calls — the GET sees the callee's own state",
  ),

  // ── evaluation order, which only a side effect can show ─────────────────────────────────────
  probe(
    "cg_argument_order",
    "\tstep : INT;\n\tfirstSeen : INT;\n\tsecondSeen : INT;",
    "step := 0;\ntarget(first := FUN_LANG_cg_add(step, 1), second := FUN_LANG_cg_add(step, 2), touched := mark);\nout := target.sum;",
    "INT",
    "two inputs that each read the same variable — the sum says nothing moved between them",
  ),
  probe(
    "cg_inout_bound_after_write",
    "",
    "mark := 100;\ntarget(first := 1, second := 2, touched := mark);\nout := mark;",
    "INT",
    "a VAR_IN_OUT bound to a variable the caller wrote just before — 101 if the binding is at the call",
  ),

  // ── repeated calls, where an instance's state is the answer ─────────────────────────────────
  probe(
    "cg_instance_state_over_scans",
    "",
    "target(first := 1, second := 2, touched := mark);\nout := target.Count;",
    "INT",
    "an FB instance's own counter after three scans",
    3,
  ),
]
