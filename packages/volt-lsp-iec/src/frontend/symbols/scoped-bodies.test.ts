/**
 * THE BODY WALK — `bodies()` over every ST body a parse result holds, each with the scope it resolves against.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "./incremental.js"
import { bodies } from "./scoped-bodies.js"

// Rule Y17 (frontend-conformance 3.1.2): units inside a source NAMESPACE block are scoped and analysed like units outside
// one — the walk reached only top-level units, so an FB inside a namespace was never analysed at all. No vendor holds a
// namespace block (the push refuses it, `sym_namespace_block_unit_checked`); this is the LSP reading such a text.
test("the bodies of units inside a NAMESPACE block are walked, each against its own scope (Y17)", () => {
  const src = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR f : INT; END_VAR
f := 1;
END_FUNCTION_BLOCK
METHOD M : INT
M := f;
END_METHOD
NAMESPACE Inner
FUNCTION Fn : INT
Fn := 2;
END_FUNCTION
END_NAMESPACE
END_NAMESPACE`
  const parseResult = parseSource(src, { networkText: true })
  const project = buildSymbolTable([{ uri: "NS.fb", parseResult, source: src }])
  const walked = [...bodies(parseResult.units, project)].map((b) => `${b.scope.kind}:${b.scope.name}<${b.scope.parent?.name}`)
  expect(walked).toEqual(["pou:Foo<NS", "method:M<Foo", "pou:Fn<Inner"])
})
