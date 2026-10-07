/**
 * The transpiler's own layering rules fire (openspec transpile-restructure task 1.0.1, design.md P2): each case plants one
 * violation of rule 4, 4b or 6 in a scratch package and asserts the scan names it by rule, with both files; the allowed
 * shape beside each is clean. (`test/frontend/layering.test.ts` runs the scan on the real tree and the front-end and
 * analysis rules' planted cases.)
 */
import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { layeringViolations } from "./check-layering.js"

function scan(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), "volt-layering-"))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return layeringViolations(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const transpileRules = (files: Record<string, string>): string[] => scan(files).filter((v) => /^(4|4b|6) /.test(v))
const leaf = (path: string): Record<string, string> => ({ [path]: "export const x = 1\n" })

test("rule 4: the emitter importing semantics/ is named; the interpreter and lowering may", () => {
  const files = {
    ...leaf("src/transpile/semantics/value.ts"),
    "src/transpile/emit/rust/expr.ts": `import { x } from "../../semantics/value.js"\n`,
    "src/transpile/interp/machine.ts": `import { x } from "../semantics/value.js"\n`,
    "src/transpile/lower/core/build.ts": `import { x } from "../../semantics/value.js"\n`,
  }
  expect(transpileRules(files)).toEqual([
    "4 transpile/emit/rust/expr.ts → transpile/semantics/value.ts: transpile/emit must not import transpile/semantics",
  ])
})

test("rule 4: ir/ imports only itself, semantics/ never lower/, the backends never each other", () => {
  const found = transpileRules({
    ...leaf("src/transpile/semantics/value.ts"),
    ...leaf("src/transpile/lower/core/build.ts"),
    ...leaf("src/transpile/interp/machine.ts"),
    "src/transpile/ir/expr.ts": `import { x } from "../semantics/value.js"\n`,
    "src/transpile/semantics/store.ts": `import { x } from "../lower/core/build.js"\n`,
    "src/transpile/emit/rust/calls.ts": `import { x } from "../../interp/machine.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "4 transpile/ir/expr.ts → transpile/semantics/value.ts: transpile/ir must not import transpile/semantics",
      "4 transpile/semantics/store.ts → transpile/lower/core/build.ts: transpile/semantics must not import transpile/lower",
      "4 transpile/emit/rust/calls.ts → transpile/interp/machine.ts: transpile/emit must not import transpile/interp",
    ].sort(),
  )
})

test("rule 4: only the barrel imports pipeline/; pipeline/ and the barrel import anything", () => {
  const found = transpileRules({
    ...leaf("src/transpile/emit/rust/module.ts"),
    ...leaf("src/transpile/lower/entry/lower-source.ts"),
    "src/transpile/pipeline/index.ts": `import { x } from "../lower/entry/lower-source.js"\nimport { y } from "../emit/rust/module.js"\n`,
    "src/transpile/index.ts": `export * from "./pipeline/index.js"\n`,
    "src/transpile/interp/runner.ts": `import { x } from "../pipeline/index.js"\n`,
    // a test may use the composition root (production rules only)
    "src/transpile/emit/rust/expr.test.ts": `import { lowerAndEmit } from "../../pipeline/index.js"\n`,
  })
  expect(found).toEqual([
    "4 transpile/interp/runner.ts → transpile/pipeline/index.ts: only the transpile barrel imports pipeline/ (it is a composition root)",
  ])
})

test("rule 4b: each lower/ leaf importing past its table is named; the allowed edges are clean", () => {
  const found = transpileRules({
    ...leaf("src/transpile/lower/diagnostics/codes.ts"),
    ...leaf("src/transpile/lower/places/path.ts"),
    ...leaf("src/transpile/lower/calls/invoke.ts"),
    "src/transpile/lower/diagnostics/diagnostic.ts": `import { x } from "../core/lowering.js"\nimport { y } from "./codes.js"\n`,
    "src/transpile/lower/core/lowering.ts": `import { x } from "../diagnostics/codes.js"\nimport { y } from "../places/path.js"\n`,
    "src/transpile/lower/values/fold.ts": `import { x } from "../core/lowering.js"\nimport { y } from "../calls/invoke.js"\n`,
    "src/transpile/lower/project/prepare.ts": `import { x } from "../diagnostics/codes.js"\nimport { y } from "../values/fold.js"\n`,
    // a non-leaf may import any lower/ folder
    "src/transpile/lower/statements/loops.ts": `import { x } from "../calls/invoke.js"\nimport { y } from "../core/lowering.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "4b transpile/lower/diagnostics/diagnostic.ts → transpile/lower/core/lowering.ts: lower/diagnostics is a leaf and must not import lower/core",
      "4b transpile/lower/core/lowering.ts → transpile/lower/places/path.ts: lower/core is a leaf and must not import lower/places",
      "4b transpile/lower/values/fold.ts → transpile/lower/calls/invoke.ts: lower/values is a leaf and must not import lower/calls",
      "4b transpile/lower/project/prepare.ts → transpile/lower/values/fold.ts: lower/project is a leaf and must not import lower/values",
    ].sort(),
  )
})

test("rule 4b: only lower/entry (and the lower barrel) imports lower/project", () => {
  const found = transpileRules({
    ...leaf("src/transpile/lower/project/prepare.ts"),
    "src/transpile/lower/entry/lower-unit.ts": `import { x } from "../project/prepare.js"\n`,
    "src/transpile/lower/index.ts": `export { x } from "./project/prepare.js"\n`,
    "src/transpile/lower/calls/routines.ts": `import { x } from "../project/prepare.js"\n`,
  })
  expect(found).toEqual([
    "4b transpile/lower/calls/routines.ts → transpile/lower/project/prepare.ts: only lower/entry imports lower/project",
  ])
})

test("rule 6: a src/ file importing test/ is named — a test file too; scripts/ and test/ may", () => {
  const found = transpileRules({
    ...leaf("test/conformance/support/rustc.ts"),
    "src/transpile/emit/rust/emit.test.ts": `import { RUSTC } from "../../../../test/conformance/support/rustc.js"\n`,
    "src/transpile/lower/a.ts": `import { RUSTC } from "../../../test/conformance/support/rustc.js"\n`,
    "scripts/b.ts": `import { RUSTC } from "../test/conformance/support/rustc.js"\n`,
    "test/conformance/c.test.ts": `import { RUSTC } from "./support/rustc.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "6 transpile/emit/rust/emit.test.ts → test/conformance/support/rustc.ts: a src/ file imports test/",
      "6 transpile/lower/a.ts → test/conformance/support/rustc.ts: a src/ file imports test/",
    ].sort(),
  )
})
