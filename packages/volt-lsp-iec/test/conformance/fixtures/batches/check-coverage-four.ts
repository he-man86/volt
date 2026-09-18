/**
 * Checks with no fixture, third set — and the reserved-name question `cc3_bit_access_and_call_result` raised by
 * accident: CODESYS refused a variable called `bit` ("Unexpected token 'bit' found") while the LSP accepted it, which
 * is the family `names/set-reset-name.ts` already covers for `r` and `s`. Which type names are unusable as variable
 * names is measured here rather than guessed.
 */
import type { LanguageTest } from "../../types.js"

const doc = "conformance — checks with no fixture, third set"

function fb(name: string, pouName: string, feature: string, source: string): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

export const CHECK_COVERAGE_FOUR_TESTS: readonly LanguageTest[] = [
  // ONE name per fixture: the IDE stops reporting after the first few parse errors, so a fixture with six of them
  // measures the stop, not the rule.
  fb("cc4_type_name_bit_as_variable", "FB_C4_bitName", "`bit` as a VARIABLE name — the IDE refuses it, and the LSP accepted it",
    `FUNCTION_BLOCK FB_C4_bitName
VAR
	bit : BOOL;
	n : INT;
END_VAR
bit := TRUE;
n := 1;
END_FUNCTION_BLOCK
`),

  fb("cc4_type_name_byte_as_variable", "FB_C4_byteName", "`byte` as a VARIABLE name",
    `FUNCTION_BLOCK FB_C4_byteName
VAR
	byte : INT;
	n : INT;
END_VAR
byte := 2;
n := byte;
END_FUNCTION_BLOCK
`),

  fb("cc4_obsolete_and_deprecated", "FB_C4_uses", "an FB marked obsolete and one marked deprecated, both instantiated and called",
    `{attribute 'obsolete' := 'Use the new one.'}
FUNCTION_BLOCK FB_C4_old
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK

{attribute 'deprecated' := 'Going away.'}
FUNCTION_BLOCK FB_C4_going
VAR
	m : INT;
END_VAR
m := m + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C4_uses
VAR
	legacy : FB_C4_old;
	leaving : FB_C4_going;
END_VAR
legacy();
leaving();
END_FUNCTION_BLOCK
`),

  {
    ...fb("cc4_loop_exit_constant", "FB_C4_loops", "a FOR whose bounds cannot advance, and a WHILE whose condition is a constant",
    `FUNCTION_BLOCK FB_C4_loops
VAR
	i : INT;
	n : INT;
END_VAR
FOR i := 1 TO 10 BY 0 DO
	n := n + 1;
END_FOR
WHILE TRUE DO
	n := n + 1;
END_WHILE
REPEAT
	n := n + 1;
UNTIL FALSE
END_REPEAT
END_FUNCTION_BLOCK
`),
    execSkip:
      "a loop that cannot exit never completes its scan, so the done flag the recorder waits on cannot rise — the fixture working as designed",
  },

  // `ambiguous-global` has no fixture yet on purpose: it needs TWO GVLs declaring one name, and a GVL in this catalog
  // is visible to every other fixture — a first attempt declared `gShared`, which `var_external_gvl` already declares,
  // and `var_external_consumer` silently read 1 where it had always read 100. It also cannot be a `function_block`
  // fixture whose first unit is a VAR_GLOBAL: the bridge refuses the push, the object being a GVL in the IDE.
  fb("cc4_inout_in_initializer", "FB_C4_inoutInit", "a VAR_IN_OUT named in another declaration's initial value, and one given an initial value of its own",
    `FUNCTION_BLOCK FB_C4_inoutInit
VAR_IN_OUT
	source : INT;
	seeded : INT := 3;
END_VAR
VAR
	copyOf : INT := source;
END_VAR
copyOf := copyOf + 1;
END_FUNCTION_BLOCK
`),

  fb("cc4_not_instantiable", "FB_C4_abstractUser", "an ABSTRACT FB instantiated, and an abstract METHOD given a body",
    `{attribute 'abstract'}
FUNCTION_BLOCK FB_C4_abstract
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

{attribute 'abstract'}
METHOD Shape : INT
Shape := 1;
END_METHOD

FUNCTION_BLOCK FB_C4_abstractUser
VAR
	cannot : FB_C4_abstract;
	n : INT;
END_VAR
cannot();
n := cannot.n;
END_FUNCTION_BLOCK
`),

  fb("cc4_output_reference_type", "FB_C4_outputs", "a VAR_OUTPUT declared as a REFERENCE and one declared as a POINTER",
    `FUNCTION_BLOCK FB_C4_producing
VAR_OUTPUT
	viaReference : REFERENCE TO INT;
	viaPointer : POINTER TO INT;
END_VAR
VAR
	held : INT := 4;
END_VAR
viaReference REF= held;
viaPointer := ADR(held);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C4_outputs
VAR
	maker : FB_C4_producing;
	taken : INT;
END_VAR
maker();
taken := maker.viaPointer^;
END_FUNCTION_BLOCK
`),

  fb("cc4_attribute_value_string", "FB_C4_attrs", "an attribute whose value is not a quoted string, and one given no value where it needs one",
    `FUNCTION_BLOCK FB_C4_attrs
VAR
	{attribute 'symbol' := readwrite}
	unquoted : INT;
	{attribute 'instance-path'}
	noValue : STRING(80);
	n : INT;
END_VAR
n := unquoted;
END_FUNCTION_BLOCK
`),

  fb("cc4_pack_mode_not_allowed", "FB_C4_packMode", "{attribute 'pack_mode'} on an FB and on a variable, where only a STRUCT takes it",
    `{attribute 'pack_mode' := '1'}
FUNCTION_BLOCK FB_C4_packed
VAR
	flag : BOOL;
	wide : DINT;
END_VAR
wide := wide + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_C4_packMode
VAR
	inner : FB_C4_packed;
	{attribute 'pack_mode' := '1'}
	onAVariable : DINT;
END_VAR
inner();
onAVariable := onAVariable + 1;
END_FUNCTION_BLOCK
`),

  fb("cc4_data_recursion_struct", "FB_C4_structLoop", "a STRUCT that contains itself",
    `TYPE DUT_C4_node :
STRUCT
	value : INT;
	next : DUT_C4_node;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_C4_structLoop
VAR
	tree : DUT_C4_node;
END_VAR
tree.value := 1;
END_FUNCTION_BLOCK
`),

  fb("cc4_data_recursion_fb", "FB_C4_fbLoop", "an FB holding an instance of ITSELF",
    `FUNCTION_BLOCK FB_C4_fbLoop
VAR
	mine : FB_C4_fbLoop;
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK
`),
]
