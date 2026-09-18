/**
 * Inheritance — the oracle for EXTENDS and SUPER^ in the transpiler, recorded BEFORE it is built (tasks.md phase 3½).
 * `oop.ts` already pins which METHOD runs (an inherited one, an override, `SUPER^.M()` from a method); these pin what the
 * corpus leans on and nothing recorded yet answers, one question each: whether calling a derived FB runs its base's body,
 * whether `SUPER^()` does, what an empty derived body runs, and which override a base body reaches — through `THIS^` and
 * through a bare call. Each counter says which body ran.
 */
import type { LanguageTest } from "../../types.js"

const doc = "transpile-st-to-rust phase 3½ — inheritance"

function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

/** A base whose body counts its runs and copies its input; `n` makes each fixture's names its own. */
const base = (n: number): string => `FUNCTION_BLOCK FB_INH_base${n}
VAR_INPUT
	inBase : INT;
END_VAR
VAR_OUTPUT
	outBase : INT;
END_VAR
VAR
	nBase : INT;
	seenBase : INT;
END_VAR
nBase := nBase + 1;
seenBase := inBase;
END_FUNCTION_BLOCK
`

export const INHERITANCE_TESTS: readonly LanguageTest[] = [
  fb("inh_call_runs_derived_body", "FB_INH_derived1", "calling a derived FB: which bodies run, and its base's input and output",
    `${base(1)}
FUNCTION_BLOCK FB_INH_derived1 EXTENDS FB_INH_base1
VAR
	nDerived : INT;
	seenDerived : INT;
END_VAR
nDerived := nDerived + 1;
seenDerived := inBase * 2;
outBase := nDerived * 10;
END_FUNCTION_BLOCK
`,
    "inst : FB_INH_derived1; got : INT;", "inst(inBase := 7, outBase => got);", 2),
  fb("inh_super_call_runs_base_body", "FB_INH_derived2", "`SUPER^()` in a derived body runs the base body on the same instance",
    `${base(2)}
FUNCTION_BLOCK FB_INH_derived2 EXTENDS FB_INH_base2
VAR
	nDerived : INT;
END_VAR
SUPER^();
nDerived := nDerived + 1;
END_FUNCTION_BLOCK
`,
    "inst : FB_INH_derived2;", "inst(inBase := 3);", 2),
  fb("inh_empty_derived_body", "FB_INH_derived3", "a derived FB whose body is empty — does its base body run on a call",
    `${base(3)}
FUNCTION_BLOCK FB_INH_derived3 EXTENDS FB_INH_base3
VAR
	nDerived : INT;
END_VAR
END_FUNCTION_BLOCK
`,
    "inst : FB_INH_derived3;", "inst(inBase := 4);", 2),
  fb("inh_base_body_reaches_override", "FB_INH_derived4", "a base body run by `SUPER^()` calls methods the derived FB overrides — through THIS^ and bare",
    `FUNCTION_BLOCK FB_INH_base4
VAR
	aBase : INT;
	bBase : INT;
END_VAR
THIS^.HookA();
HookB();
END_FUNCTION_BLOCK

METHOD HookA
aBase := aBase + 1;
END_METHOD

METHOD HookB
bBase := bBase + 1;
END_METHOD

FUNCTION_BLOCK FB_INH_derived4 EXTENDS FB_INH_base4
VAR
	aDerived : INT;
	bDerived : INT;
END_VAR
SUPER^();
END_FUNCTION_BLOCK

METHOD HookA
aDerived := aDerived + 1;
END_METHOD

METHOD HookB
bDerived := bDerived + 1;
END_METHOD
`,
    "inst : FB_INH_derived4;", "inst();"),
  fb("inh_super_method_from_body", "FB_INH_derived5", "a derived body calls its base's method through `SUPER^.` and its own override bare",
    `FUNCTION_BLOCK FB_INH_base5
VAR
	nBase : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Bump
nBase := nBase + 1;
END_METHOD

FUNCTION_BLOCK FB_INH_derived5 EXTENDS FB_INH_base5
VAR
	nDerived : INT;
END_VAR
SUPER^.Bump();
Bump();
END_FUNCTION_BLOCK

METHOD Bump
nDerived := nDerived + 10;
END_METHOD
`,
    "inst : FB_INH_derived5;", "inst();"),
  // The corpus passes arguments to SUPER^ — inputs and VAR_IN_OUT (`SUPER^(profile := profile)`, `AxisRef := AxisRef`).
  fb("inh_super_call_with_arguments", "FB_INH_derived6", "`SUPER^(input := …, inout := …)` — does it assign the instance's input and bind the in-out",
    `FUNCTION_BLOCK FB_INH_base6
VAR_INPUT
	inBase : INT;
END_VAR
VAR_IN_OUT
	ioVal : INT;
END_VAR
VAR
	nBase : INT;
	seenBase : INT;
END_VAR
nBase := nBase + 1;
seenBase := inBase;
ioVal := ioVal + inBase;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_INH_derived6 EXTENDS FB_INH_base6
VAR
	nDerived : INT;
END_VAR
SUPER^(inBase := inBase + 100, ioVal := ioVal);
nDerived := nDerived + 1;
END_FUNCTION_BLOCK
`,
    "inst : FB_INH_derived6; shared : INT;", "inst(inBase := 5, ioVal := shared);", 2),
  fb("inh_super_method_reaches_override", "FB_INH_derived7", "a base METHOD run through `SUPER^.` calls a method the derived FB overrides",
    `FUNCTION_BLOCK FB_INH_base7
VAR
	ranTemplate : INT;
	hookBase : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Template
ranTemplate := ranTemplate + 1;
THIS^.Hook();
END_METHOD

METHOD Hook
hookBase := hookBase + 1;
END_METHOD

FUNCTION_BLOCK FB_INH_derived7 EXTENDS FB_INH_base7
VAR
	hookDerived : INT;
END_VAR
SUPER^.Template();
END_FUNCTION_BLOCK

METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD
`,
    "inst : FB_INH_derived7;", "inst();"),
  fb("inh_inherited_method_reaches_override", "FB_INH_derived8", "an inherited METHOD called from outside calls, bare, a method the derived FB overrides",
    `FUNCTION_BLOCK FB_INH_base8
VAR
	ranTemplate : INT;
	hookBase : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Template
ranTemplate := ranTemplate + 1;
Hook();
END_METHOD

METHOD Hook
hookBase := hookBase + 1;
END_METHOD

FUNCTION_BLOCK FB_INH_derived8 EXTENDS FB_INH_base8
VAR
	hookDerived : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD
`,
    "inst : FB_INH_derived8;", "inst.Template();"),
]
