/**
 * new-in-expression — C0454: a `__NEW` assignment-expression embedded in another expression. A bare `__NEW`
 * allocation statement is fine.
 */
import { test, expect } from "bun:test"
import { diagnose } from "../../../../test/support/diagnose.js"

const MSG =
  "It is not possible to use an assignment expression with the __NEW operator in another expression. Use the pointer variable instead."

const msgs = (body: string): string[] => {
  const src = `TYPE stv : STRUCT\n x:INT;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR\n p : POINTER TO stv;\nEND_VAR\n${body}\nEND_PROGRAM`
  return diagnose(src)
    .filter((d) => d.code === "new-in-expression")
    .map((d) => d.message)
}

test("C0454: a __NEW assignment-expression in a condition is flagged; a bare __NEW statement is not", () => {
  expect(msgs(`IF (p := __NEW(stv)) = 0 THEN\n RETURN;\nEND_IF`)).toEqual([MSG])
  expect(msgs(`p := __NEW(stv);`)).toEqual([])
})
