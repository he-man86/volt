import { expect, test } from "bun:test"
import { parseSource } from "../parse/parser.js"
import { declarationAttributes, memberAttributes, readAttribute, unitAttributes } from "./attributes.js"

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
  const parseResult = parseSource(source, { networkText: true })
  const byName = new Map([...declarationAttributes(parseResult)].map(([decl, names]) => [decl.names[0]!.text, [...names].sort()]))
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
  const parseResult = parseSource(source, { networkText: true })
  const byName = new Map([...memberAttributes(parseResult)].map(([unit, names]) => ["name" in unit ? unit.name.text : unit.kind, [...names]]))
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
  const parseResult = parseSource(source, { networkText: true })
  const byName = new Map([...unitAttributes(parseResult)].map(([unit, names]) => ["name" in unit ? unit.name.text : unit.kind, [...names].sort()]))
  expect(byName.get("FB_A")).toEqual(["call_after_global_init_slot", "call_after_global_init_slot=50000", "instance-path", "reflection"])
  expect(byName.has("FB_B")).toBe(false)
  expect(byName.has("AfterInit")).toBe(false)
})

// The pragma word is case-sensitive, as every other pragma word is: `{ATTRIBUTE 'volt_bogus'}` is no attribute — CODESYS
// does not warn about the unknown name it would carry (`prag_rule_unknown_attribute_upper_case`, analysis-conformance 3.10).
test("an attribute is spelled `attribute` in lower case; `{ATTRIBUTE '…'}` is none", () => {
  expect(readAttribute("{attribute 'volt_x' := 'v'}")).toEqual({ name: "volt_x", value: "v" })
  expect(readAttribute("{ATTRIBUTE 'volt_x'}")).toBeUndefined()
  expect(readAttribute("{Attribute 'volt_x'}")).toBeUndefined()
})

// …and one written as a STATEMENT in a body belongs to nothing: CODESYS does not warn about the unknown name it carries
// (`prag_rule_unknown_attribute_in_body`, analysis-conformance 3.10), and attached to the unit the printer wrote it above
// the unit a second time.
test("an attribute in a body is attached to no node", () => {
  const parseResult = parseSource("FUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\n{attribute 'volt_x'}\nout := 1;\nEND_FUNCTION_BLOCK\n", { networkText: true })
  expect(parseResult.units[0]!.attributes).toBeUndefined()
  expect([...unitAttributes(parseResult).values()]).toEqual([])
})

// …a KNOWN name included (the 3.10 gate review): `{ATTRIBUTE 'qualified_only'}` above a GVL leaves its global readable
// bare — both vendors build `out := g_…;` clean (`prag_rule_qualified_only_upper_case`) — so it attaches as nothing.
test("`{ATTRIBUTE 'qualified_only'}` is no attribute of the list", () => {
  const parseResult = parseSource("{ATTRIBUTE 'qualified_only'}\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n", { networkText: true })
  expect(parseResult.units[0]!.attributes).toBeUndefined()
  const lower = parseSource("{attribute 'qualified_only'}\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n", { networkText: true })
  expect(lower.units[0]!.attributes?.map((a) => a.name)).toEqual(["qualified_only"])
})
