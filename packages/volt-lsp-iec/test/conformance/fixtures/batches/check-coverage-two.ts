/**
 * The checks no fixture ever triggered (measured 2026-09-16: 56 of the 85 diagnostic codes the analysis can emit were
 * never produced by any fixture in the catalog).
 *
 * That is the same hole `check-coverage.ts` was written for, one level up: the replay fails only on a FALSE POSITIVE and
 * its ratchet counts only fixtures that exist, so a check with no fixture has never had its message compared with the
 * IDE's — it could be worded anything at all, or fire on the wrong thing, and nothing here would notice. Each fixture
 * below is INVALID code written to trigger one check, or a few that belong together; what CODESYS says about it is
 * recorded by `bun run record:language`, and the replay then requires the LSP to say exactly that.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — checks with no fixture"

/** Each fixture's POU is INSTANTIATED in PLC_PRG: CODESYS compiles only what the program entry point reaches, so a POU
 *  nobody instantiates is dead code and the build reports nothing about it — every one of these recorded empty first. */
function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

export const CHECK_COVERAGE_TWO_TESTS: readonly LanguageTest[] = [
  fb("cc2_exit_outside_loop", "FB_C2_exit", "EXIT and CONTINUE outside any loop",
    `FUNCTION_BLOCK FB_C2_exit
VAR
	n : INT;
END_VAR
n := 1;
EXIT;
CONTINUE;
END_FUNCTION_BLOCK
`),

  fb("cc2_indexing_and_arity", "FB_C2_index", "indexing something that is not an array, and an array indexed with the wrong number of dimensions",
    `FUNCTION_BLOCK FB_C2_index
VAR
	plain : INT;
	grid : ARRAY[1..2, 1..2] OF INT;
	taken : INT;
END_VAR
taken := plain[1];
taken := grid[1];
taken := grid[1, 1, 1];
END_FUNCTION_BLOCK
`),

  fb("cc2_call_recursion", "FB_C2_recursive", "a FUNCTION that calls itself, and an FB whose METHOD calls itself",
    `FUNCTION F_C2_loop : INT
VAR_INPUT
	depth : INT;
END_VAR
F_C2_loop := F_C2_loop(depth := depth - 1);
END_FUNCTION

FUNCTION_BLOCK FB_C2_recursive
VAR
	n : INT;
END_VAR
n := F_C2_loop(depth := 3);
END_FUNCTION_BLOCK
`),

  fb("cc2_base_and_interface_not_found", "FB_C2_missing", "EXTENDS a name that does not exist, and IMPLEMENTS one that does not either",
    `FUNCTION_BLOCK FB_C2_missing EXTENDS FB_C2_noSuchBase IMPLEMENTS ITF_C2_noSuchInterface
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`),

  fb("cc2_circular_inheritance", "FB_C2_circleA", "two FBs that EXTEND each other",
    `FUNCTION_BLOCK FB_C2_circleA EXTENDS FB_C2_circleB
VAR
	a : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C2_circleB EXTENDS FB_C2_circleA
VAR
	b : INT;
END_VAR
END_FUNCTION_BLOCK
`),

  fb("cc2_constant_and_external", "FB_C2_decls", "a VAR CONSTANT with no initial value, a VAR_EXTERNAL naming no global, and a VAR_EXTERNAL with an initializer",
    `FUNCTION_BLOCK FB_C2_decls
VAR CONSTANT
	cMissing : INT;
END_VAR
VAR_EXTERNAL
	gNoSuchGlobal : INT;
	gWithInit : INT := 5;
END_VAR
VAR
	n : INT;
END_VAR
n := cMissing + gNoSuchGlobal + gWithInit;
END_FUNCTION_BLOCK
`),

  fb("cc2_duplicate_inherited_variable", "FB_C2_shadowChild", "a derived FB declaring a variable its base already has",
    `FUNCTION_BLOCK FB_C2_shadowParent
VAR
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C2_shadowChild EXTENDS FB_C2_shadowParent
VAR
	shared : INT;
END_VAR
shared := shared + 1;
END_FUNCTION_BLOCK
`),

  fb("cc2_type_name_and_method_without_parens", "FB_C2_names", "a TYPE name used as a value, and a METHOD referenced without its parentheses",
    `TYPE DUT_C2_mode :
(
	Idle,
	Busy
);
END_TYPE

FUNCTION_BLOCK FB_C2_named
END_FUNCTION_BLOCK

METHOD Value : INT
Value := 3;
END_METHOD

FUNCTION_BLOCK FB_C2_names
VAR
	other : FB_C2_named;
	n : INT;
	m : INT;
END_VAR
n := DUT_C2_mode;
m := other.Value;
END_FUNCTION_BLOCK
`),

  fb("cc2_var_in_interface", "FB_C2_itfUser", "an INTERFACE that declares a VAR section",
    `INTERFACE ITF_C2_withVar
VAR
	held : INT;
END_VAR
METHOD Run : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_C2_itfUser
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`),

  fb("cc2_property_lacks_getter", "FB_C2_setOnly", "a PROPERTY with only a SET, read as a value",
    `FUNCTION_BLOCK FB_C2_setOnly
VAR
	stored : INT;
	readBack : INT;
END_VAR
Level := 4;
readBack := Level;
END_FUNCTION_BLOCK

PROPERTY Level : INT
SET
stored := Level;
END_SET
END_PROPERTY
`),

  fb("cc2_in_out_not_assigned", "FB_C2_caller", "a call that leaves a VAR_IN_OUT unbound, and one that binds it to a literal",
    `FUNCTION_BLOCK FB_C2_needsInOut
VAR_IN_OUT
	target : INT;
END_VAR
target := target + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C2_caller
VAR
	worker : FB_C2_needsInOut;
	own : INT;
END_VAR
worker();
worker(target := 5);
END_FUNCTION_BLOCK
`),

  fb("cc2_fb_not_instantiated", "FB_C2_typeAsValue", "an FB TYPE used where a value belongs, and its METHOD called on the type",
    `FUNCTION_BLOCK FB_C2_plain
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Get : INT
Get := n;
END_METHOD

FUNCTION_BLOCK FB_C2_typeAsValue
VAR
	taken : INT;
END_VAR
taken := FB_C2_plain.Get();
END_FUNCTION_BLOCK
`),
]
