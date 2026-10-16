/**
 * THE TRANSPILER'S COLOCATED-TEST HELPERS — lower a source and require success (`ir`), lower and print it as Rust
 * (`rust`), and the one-PROGRAM template the statement tests wrap a body in (`wrap`). Most tests are about the SHAPE,
 * not the failure path, so a lowering diagnostic fails the test where it is asked.
 */
import { expect } from "bun:test"
import { emitRust, lowerSource } from "../../src/transpile/index.js"

/** Lower and require success. */
export function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

/** Lower, require success, and print the POU as Rust. */
export function rust(src: string): string {
  return emitRust(ir(src)).code
}

/** A PROGRAM `P` around `body`, declaring `vars`. */
export const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`
