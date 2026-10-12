/**
 * the fixtures of `lifecycle.ts` — part D.
 *
 * One slice of `lifecycle.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const LIFECYCLE_TESTS_D: readonly LanguageTest[] = [
  {
    name: "tr_23_fb_init_argument_from_pending_init_reversed",
    pouName: "FB_LANG_tr23r_holder",
    kind: "function_block",
    feature: "an FB_Init argument naming a variable declared AFTER the instance, whose initializer is a FUNCTION call",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    note: "transpile-review-2026-09-29 task 23: the reversed-order twin.",
    plcPrgVar: "holder : FB_LANG_tr23r_holder;",
    plcPrgBody: "holder();",
    source: `FUNCTION F_LANG_tr23r_inc : INT
VAR_INPUT
	n : INT;
END_VAR
F_LANG_tr23r_inc := n + 1;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr23r_target
VAR
	got : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	v : INT;
END_VAR
got := v;
END_METHOD

FUNCTION_BLOCK FB_LANG_tr23r_holder
VAR
	h : FB_LANG_tr23r_target(v := x);
	x : INT := F_LANG_tr23r_inc(3);
	got : INT;
END_VAR
got := h.got;
END_FUNCTION_BLOCK
`,
  },
  // Task 29: a user METHOD whose name is also a Rust prelude trait method (Clone / To_Owned / Into / Try_Into). With a
  // result, the emitted call picks the trait's method (E0308). Without one it compiles and silently runs the trait's
  // method instead of the user's body. Each name, with and without a result (recorded 2026-09-29).
  ...(["Clone", "To_Owned", "Into", "Try_Into"] as const).flatMap((method): LanguageTest[] => {
    const slug = method.toLowerCase()
    return [
      {
        name: `tr_29_method_named_${slug}_result`,
        pouName: `FB_LANG_tr29_${slug}_r`,
        kind: "function_block",
        feature: `a METHOD named ${method} returning a field, called from outside`,
        fromDoc: "08-identifiers.md",
        note: "transpile-review-2026-09-29 task 29 (emit/rust/names.ts baseFnName reserves no prelude trait method name).",
        plcPrgVar: `b : FB_LANG_tr29_${slug}_r; res : INT;`,
        plcPrgBody: `res := b.${method}();`,
        source: `FUNCTION_BLOCK FB_LANG_tr29_${slug}_r
VAR
	v : INT := 100;
END_VAR
END_FUNCTION_BLOCK

METHOD ${method} : INT
${method} := v;
END_METHOD
`,
      },
      {
        name: `tr_29_method_named_${slug}_no_result`,
        pouName: `FB_LANG_tr29_${slug}_n`,
        kind: "function_block",
        feature: `a METHOD named ${method} with no result, clearing a field, called as a statement`,
        fromDoc: "08-identifiers.md",
        note: "transpile-review-2026-09-29 task 29: the result-less call compiles in Rust and runs the derived trait method.",
        plcPrgVar: `b : FB_LANG_tr29_${slug}_n; res : INT;`,
        plcPrgBody: `b.${method}();\nres := b.v;`,
        source: `FUNCTION_BLOCK FB_LANG_tr29_${slug}_n
VAR
	v : INT := 100;
END_VAR
END_FUNCTION_BLOCK

METHOD ${method}
v := 0;
END_METHOD
`,
      },
    ]
  }),
]
