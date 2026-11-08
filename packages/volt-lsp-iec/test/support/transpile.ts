/**
 * THE TRANSPILER'S COLOCATED-TEST HELPERS — lower a source and require success (`ir`), lower and print it as Rust
 * (`rust`), and the one-PROGRAM template the statement tests wrap a body in (`wrap`). Most tests are about the SHAPE,
 * not the failure path, so a lowering diagnostic fails the test where it is asked.
 */
import { expect } from "bun:test"
import { emitRust, type LibraryFile, lowerSource } from "../../src/transpile/index.js"

/** The exec oracle project's "UTF-8 Encoding for STRING" — on, what every run recording was made under — as its
 *  `.projectsettings` states it: handed beside a test's source that lowers a STRING past ASCII or a STRING <-> WSTRING
 *  conversion, which no stated setting refuses (`string-encoding-unstated`). */
export const UTF8_ON: readonly LibraryFile[] = [{ uri: "Project Settings.projectsettings", source: "UTF-8 encoding:        on\n" }]

/** Lower (beside `files`) and require success. */
export function ir(src: string, name?: string, files: readonly LibraryFile[] = []) {
  const { pou, diagnostics } = lowerSource(src, name, files)
  expect(diagnostics).toEqual([])
  return pou!
}

/** Lower, require success, and print the POU as Rust. */
export function rust(src: string): string {
  return emitRust(ir(src)).code
}

/** A PROGRAM `P` around `body`, declaring `vars`. */
export const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`
