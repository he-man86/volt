/**
 * the fixtures of `network-graphical.ts` — part D: the call boxes whose members openspec ld-fbd-coverage 2R.4 measured
 * (B7: every member the text does not spell is an editor cache, derived on push, or its network is refused). A box's
 * `CallType` and its input names are not in the text; the push derives them from the callee's declaration where a box
 * without them does not compile — measured in simulation (CODESYS SP21, design "2R.4"): a FUNCTION's and a METHOD's
 * box. One fixture per call kind and per derivation rule, each pushed through the bridge and built: a FUNCTION called
 * positionally, by name, with two inputs and with one value too many (nothing derived: no name for it), a METHOD, a
 * conversion and a PROGRAM (both left to the vendor's fresh value, which runs as the drawn one). The 2R.4 gate added
 * the derivation's edges: too FEW positional values, a VAR_IN_OUT input declared before the VAR_INPUTs (and one
 * qualified CONSTANT), a positional pin followed by a named pin of the same formal, a METHOD called positionally, a
 * METHOD through an INTERFACE variable, an instance's ACTION and the FB's own METHOD, and a LIBRARY function's box
 * (bare and namespace-qualified, its result consumed or read through ENO) — the push derives nothing for a library's.
 */
import type { LanguageTest } from "../../types.js"
import { doc, ng } from "./network-graphical-shared.js"

const calls = `${doc}#fb`

/** A FUNCTION_BLOCK holding one FBD network `statement`, after the `callees` it calls. */
function callerFb(name: string, callees: string, statement: string, vars = ""): string {
  return (
    `${callees}FUNCTION_BLOCK ${name}\nVAR\n\tv : INT := 4;\n\tw : INT := 5;\n\ty : INT;\n\td : DINT := 6;\n\tgo : BOOL;\n\tx : BOOL;\n${vars}END_VAR\n\n` +
    `IMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\n\nEND_FUNCTION_BLOCK\n`
  )
}

const inc = `FUNCTION F_NG_m_inc : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\nF_NG_m_inc := i + 1;\nEND_FUNCTION\n\n`
const add = `FUNCTION F_NG_m_add : INT\nVAR_INPUT\n\tfirst : INT;\n\tsecond : INT;\nEND_VAR\nF_NG_m_add := first + second;\nEND_FUNCTION\n\n`
const split = `FUNCTION F_NG_m_split : INT
VAR_INPUT
	source : INT;
END_VAR
VAR_OUTPUT
	doubled : INT;
END_VAR
doubled := source * 2;
F_NG_m_split := source + 1;
END_FUNCTION

`
const owner =
  `FUNCTION_BLOCK FB_NG_m_owner\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
  `METHOD M_twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nM_twice := k * 2;\nEND_METHOD\n\n`
const io = `FUNCTION F_NG_m_io : INT\nVAR_IN_OUT\n\tacc : INT;\nEND_VAR\nVAR_INPUT\n\tstep : INT;\nEND_VAR\nacc := acc + step;\nF_NG_m_io := acc;\nEND_FUNCTION\n\n`
const constIo = `FUNCTION F_NG_m_cio : INT\nVAR_IN_OUT CONSTANT\n\tc : INT;\nEND_VAR\nVAR_INPUT\n\ti : INT;\nEND_VAR\nF_NG_m_cio := c * 10 + i;\nEND_FUNCTION\n\n`
const itf = `INTERFACE I_NG_m_get\nMETHOD M_get : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n`
const actor =
  `FUNCTION_BLOCK FB_NG_m_actor\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` + `ACTION Act\nn := n + 1;\nEND_ACTION\n\n`
const half = `\nMETHOD M_half : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nM_half := k / 2;\nEND_METHOD\n`
const sub = `PROGRAM P_NG_m_sub\nVAR_INPUT\n\ton : BOOL;\nEND_VAR\nVAR\n\tseen : BOOL;\nEND_VAR\nseen := on;\nEND_PROGRAM\n\n`
const str = "\ttxt : STRING := 'abc';\n"

export const NETWORK_GRAPHICAL_TESTS_D: readonly LanguageTest[] = [
  ng("ng_m_function_positional", "FB_NG_m_pos", "a FUNCTION called positionally: its box carries the derived CallType and input name",
    callerFb("FB_NG_m_pos", inc, "y := F_NG_m_inc(v);"), calls),
  ng("ng_m_function_named", "FB_NG_m_named", "a FUNCTION called with its input named: the derived CallType",
    callerFb("FB_NG_m_named", inc, "y := F_NG_m_inc(i := v);"), calls),
  ng("ng_m_function_two_inputs", "FB_NG_m_two", "a FUNCTION with two inputs, both positional: each takes the declaration's name in order",
    callerFb("FB_NG_m_two", add, "y := F_NG_m_add(v, w);"), calls),
  ng("ng_m_function_too_many", "FB_NG_m_many", "a FUNCTION given one positional value more than it declares: nothing is derived, and the build names the arity",
    callerFb("FB_NG_m_many", inc, "y := F_NG_m_inc(v, w);"), calls),
  ng("ng_m_function_output_unwired", "FB_NG_m_unwired", "a FUNCTION whose VAR_OUTPUT is not wired: its box lists it all the same, as drawn",
    callerFb("FB_NG_m_unwired", split, "y := F_NG_m_split(v);"), calls),
  ng("ng_m_function_enabled", "FB_NG_m_enabled", "an enabled FUNCTION call with a named output pin: the ENO echo, then its outputs",
    callerFb("FB_NG_m_enabled", split, "F_NG_m_split(source := v, doubled => y) ENO EN go;"), calls),
  ng("ng_m_method_call", "FB_NG_m_method", "a METHOD of an instance: its box carries the derived CallType Method",
    callerFb("FB_NG_m_method", owner, "y := fbm.M_twice(k := v);", "\tfbm : FB_NG_m_owner;\n"), calls),
  ng("ng_m_conversion", "FB_NG_m_conv", "a conversion: the vendor's fresh CallType, which runs as the drawn Conversion",
    callerFb("FB_NG_m_conv", "", "y := DINT_TO_INT(d);"), calls),
  ng("ng_m_program_call", "FB_NG_m_prog", "a PROGRAM call: the vendor's fresh CallType, which runs as the drawn Program",
    callerFb("FB_NG_m_prog", sub, "P_NG_m_sub(on := go);"), calls),
  ng("ng_m_function_too_few", "FB_NG_m_few", "a FUNCTION of two inputs given one positional value: the first takes its name, the second is left unwired",
    callerFb("FB_NG_m_few", add, "y := F_NG_m_add(v);"), calls),
  ng("ng_m_function_in_out_first", "FB_NG_m_iofirst", "a FUNCTION whose VAR_IN_OUT is declared before its VAR_INPUT: the positional values take the declaration's order across both",
    callerFb("FB_NG_m_iofirst", io, "y := F_NG_m_io(w, v);"), calls),
  ng("ng_m_function_constant_in_out", "FB_NG_m_cio", "a FUNCTION whose first block is VAR_IN_OUT CONSTANT: its variable is the first input all the same",
    callerFb("FB_NG_m_cio", constIo, "y := F_NG_m_cio(v, w);"), calls),
  ng("ng_m_function_positional_then_named_same", "FB_NG_m_twice_named", "a positional value then a named pin of the same formal: two pins named alike",
    callerFb("FB_NG_m_twice_named", inc, "y := F_NG_m_inc(v, i := w);"), calls),
  ng("ng_m_method_positional", "FB_NG_m_method_pos", "a METHOD of an instance called positionally: its CallType, no input name derived",
    callerFb("FB_NG_m_method_pos", owner.replace("FB_NG_m_owner", "FB_NG_m_owner2"), "y := fbm.M_twice(v);", "\tfbm : FB_NG_m_owner2;\n"), calls),
  ng("ng_m_interface_method", "FB_NG_m_itf", "a METHOD through an INTERFACE variable: a method's box, its CallType Method",
    callerFb("FB_NG_m_itf", itf, "y := itf.M_get(k := v);", "\titf : I_NG_m_get;\n"), calls),
  ng("ng_m_action_call", "FB_NG_m_action", "an ACTION of an instance: its box as the push builds it",
    callerFb("FB_NG_m_action", actor, "fba.Act();", "\tfba : FB_NG_m_actor;\n"), calls),
  ng("ng_m_own_method", "FB_NG_m_own", "the FB's own METHOD called without an instance: its box as the push builds it",
    callerFb("FB_NG_m_own", "", "y := M_half(k := v);") + half, calls),
  ng("ng_m_library_function", "FB_NG_m_lib", "a LIBRARY function's box, its result consumed: its CallType and input name derived from the IDE's library signature (2R.4b)",
    callerFb("FB_NG_m_lib", "", "y := LEN(txt);", str), calls),
  ng("ng_m_library_function_named", "FB_NG_m_lib_named", "a LIBRARY function's box with its input named, its result consumed — the drawn form (bakon-nano's REPLACE/DELETE)",
    callerFb("FB_NG_m_lib_named", "", "y := LEN(STR := txt);", str), calls),
  ng("ng_m_library_function_eno", "FB_NG_m_lib_eno", "a LIBRARY function's box read through ENO with no EN",
    callerFb("FB_NG_m_lib_eno", "", "x := LEN(txt) ENO;", str), calls,
    "CODESYS builds it clean; TwinCAT does not (\"Function 'LEN' requires exactly '1' inputs\") and the LSP says nothing " +
      "there — niche: accepted loss (0 occurrences in the corpora: no function box in the six shows ENO without EN, " +
      "2026-10-17). A project FUNCTION's box builds on both (`rcc_network_eno_function_without_en`)."),
  ng("ng_m_library_function_qualified", "FB_NG_m_lib_ns", "a LIBRARY function through its namespace, its result consumed: nothing derived (the signature is read by bare name; niche)",
    callerFb("FB_NG_m_lib_ns", "", "y := Standard.LEN(txt);", str), calls),
  ng("ng_m_library_function_qualified_eno", "FB_NG_m_lib_ns_eno", "a LIBRARY function through its namespace, read through ENO with no EN",
    callerFb("FB_NG_m_lib_ns_eno", "", "x := Standard.LEN(txt) ENO;", str), calls),
]
