import { describe, expect, test } from "bun:test"
import { parseActive } from "./conditional-pragmas.js"
import { parseSource } from "./parser.js"

/** The statements a METHOD body keeps under its conditional pragmas, as their source text. */
function kept(body: string): string[] | string {
  const source = `FUNCTION_BLOCK FB\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\n${body}\nEND_METHOD\n`
  const unit = parseSource(source).units[1]
  if (unit?.kind !== "method") throw new Error("no method")
  const parsed = parseActive(unit.body)
  return parsed.ok ? parsed.statements.map((s) => source.slice(s.span.start, s.span.end).trim()) : (parsed.firstError ?? "failed")
}

// The branches the `conditional_*` recordings took: a branch not taken may hold text that is no statement at all.
describe("conditional pragmas", () => {
  test("{define} then {IF defined} keeps the IF branch and drops the ELSE text", () => {
    expect(kept("{define F}\n{IF defined (F)}\nn := 42;\n{ELSE}\nnot valid st at all;\n{END_IF}")).toEqual(["n := 42;"])
  })

  test("an undefined name takes ELSE; an ELSIF chain takes its first true branch; {undefine} removes a define", () => {
    expect(kept("{IF defined (NEVER)}\ngibberish here;\n{ELSE}\nn := 1;\n{END_IF}")).toEqual(["n := 1;"])
    expect(kept("{define MID}\n{IF defined (NEVER)}\nbroken one;\n{ELSIF defined (MID)}\nn := 2;\n{ELSE}\nbroken two;\n{END_IF}")).toEqual(["n := 2;"])
    expect(kept("{define T}\n{undefine T}\n{IF defined (T)}\nbroken;\n{ELSE}\nn := 3;\n{END_IF}")).toEqual(["n := 3;"])
  })

  test("a define inside a branch not taken is not made, and a nested chain follows its outer one", () => {
    expect(kept("{IF defined (NO)}\n{define X}\n{END_IF}\n{IF defined (X)}\nn := 1;\n{ELSE}\nn := 2;\n{END_IF}")).toEqual(["n := 2;"])
    expect(kept("{define A}\n{IF defined (A)}\n{IF defined (B)}\nbad;\n{ELSE}\nn := 5;\n{END_IF}\n{END_IF}")).toEqual(["n := 5;"])
  })

  test("a condition other than defined(NAME), or an unbalanced chain, fails — no branch is picked by guess", () => {
    expect(kept("{IF hasvalue (X, '1')}\nn := 1;\n{END_IF}")).toContain("not modelled")
    expect(kept("{IF defined (X)}\nn := 1;")).toContain("without its {END_IF}")
    expect(kept("{ELSE}\nn := 1;\n{END_IF}")).toContain("without an {IF}")
  })
})
