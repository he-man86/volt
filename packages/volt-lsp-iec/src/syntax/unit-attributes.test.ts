import { expect, test } from "bun:test"
import { parseSource } from "./parser.js"
import { declarationAttributes, memberAttributes, unitAttributes } from "./unit-attributes.js"

// An `instance-path` STRING is set from the project tree (user decision 2026-09-15) — lowering has to know WHICH variable
// carries the attribute, which the folded map cannot say.
test("declarationAttributes names the variable declaration an attribute sits on", () => {
  const source = `{attribute 'reflection'}
FUNCTION_BLOCK FB_A
VAR
	plain : INT;
	{attribute 'instance-path'}
	{attribute 'noinit'}
	sPath : STRING(255);
	after : INT;
END_VAR
END_FUNCTION_BLOCK
`
  const parseResult = parseSource(source)
  const byName = new Map([...declarationAttributes(parseResult, source)].map(([decl, names]) => [decl.names[0]!.text, [...names].sort()]))
  expect([...byName]).toEqual([["sPath", ["instance-path", "noinit"]]])
})

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
  // the set holds the NAME, and `name=value` beside it where the pragma carries one (`addAttribute`), so a consumer
  // that needs the value has it — `pack_mode=1` is a different struct layout from `pack_mode=2`
  expect([...byName]).toEqual([["AfterInit", ["call_after_global_init_slot", "call_after_global_init_slot=50000"]]])
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
  expect(byName.get("FB_A")).toEqual(["call_after_global_init_slot", "call_after_global_init_slot=50000", "instance-path", "reflection"])
  expect(byName.has("FB_B")).toBe(false)
  expect(byName.has("AfterInit")).toBe(false)
})
