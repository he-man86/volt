import { expect, test } from "bun:test"
import { parseSource } from "./parser.js"
import { unitAttributes } from "./unit-attributes.js"

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
