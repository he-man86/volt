/**
 * `oneArgument` — the one check of every builtin that takes a single argument (task 1.7.2), and what each site lets
 * through besides a plain positional one.
 */
import { expect, test } from "bun:test"
import type { Expr } from "../../../frontend/syntax/index.js"
import { oneArgument } from "./arity.js"

type Call = Extract<Expr, { kind: "call" }>
const x = { kind: "ident_expr", name: "x" } as unknown as Expr
const call = (...args: { value?: Expr; param?: unknown; output?: boolean }[]): Call =>
  ({ kind: "call", callee: { kind: "ident_expr", name: "F" }, args }) as unknown as Call

test("one positional argument is the argument; another count or an empty one is none, whatever a site accepts", () => {
  expect(oneArgument(call({ value: x }))).toBe(x)
  for (const accepts of [{}, { named: true, output: true }] as const) {
    expect(oneArgument(call(), accepts)).toBeUndefined()
    expect(oneArgument(call({ value: x }, { value: x }), accepts)).toBeUndefined()
    expect(oneArgument(call({}), accepts)).toBeUndefined()
  }
})

test("a named or an output argument is none unless the site accepts it", () => {
  const named = call({ value: x, param: { text: "p" } })
  const output = call({ value: x, output: true })
  expect(oneArgument(named)).toBeUndefined()
  expect(oneArgument(output)).toBeUndefined()
  expect(oneArgument(named, { named: true })).toBe(x)
  expect(oneArgument(output, { named: true })).toBeUndefined()
  expect(oneArgument(output, { output: true })).toBe(x)
  expect(oneArgument(named, { output: true })).toBeUndefined()
})
