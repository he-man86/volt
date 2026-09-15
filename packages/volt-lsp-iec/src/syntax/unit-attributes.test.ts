import { expect, test } from "bun:test"
import { parseSource } from "./parser.js"
import { memberAttributes, unitAttributes } from "./unit-attributes.js"

// A `call_after_global_init_slot` method runs once per instance before the first scan (conformance
// `state_call_after_global_init_counts`) — lowering has to know WHICH method, which the folded map above cannot say.
test("memberAttributes names the METHOD an attribute sits on, and no POU", () => {
  const source = `FUNCTION_BLOCK FB_A
END_FUNCTION_BLOCK

METHOD Plain
END_METHOD

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterInit
END_METHOD
`
  const parseResult = parseSource(source)
  const byName = new Map([...memberAttributes(parseResult, source)].map(([unit, names]) => ["name" in unit ? unit.name.text : unit.kind, [...names]]))
  expect([...byName]).toEqual([["AfterInit", ["call_after_global_init_slot"]]])
})

// The transpiler refuses an FB the compiler treats specially (`instance-path`, `call_after_*`), and the AST keeps no
// pragmas — so this map is the only place those attributes are seen (transpile-st-to-rust phase 3 step 3).
test("an attribute belongs to the POU it sits in or precedes; a METHOD's folds into its FB; a commented one is ignored", () => {
  const source = `{attribute 'reflection'}
FUNCTION_BLOCK FB_A
VAR
	{attribute 'instance-path'}
	sPath : STRING;
END_VAR
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterInit
END_METHOD

// {attribute 'call_after_init'}
FUNCTION_BLOCK FB_B
END_FUNCTION_BLOCK
`
  const parseResult = parseSource(source)
  const byName = new Map([...unitAttributes(parseResult, source)].map(([unit, names]) => ["name" in unit ? unit.name.text : unit.kind, [...names].sort()]))
  expect(byName.get("FB_A")).toEqual(["call_after_global_init_slot", "instance-path", "reflection"])
  expect(byName.has("FB_B")).toBe(false)
  expect(byName.has("AfterInit")).toBe(false)
})
