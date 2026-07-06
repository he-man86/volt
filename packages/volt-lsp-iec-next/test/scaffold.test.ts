import { test, expect } from "bun:test"

// Task 0 smoke test: the package builds and every layer barrel is importable.
test("all layer barrels import", async () => {
  for (const layer of [
    "syntax",
    "symbols",
    "types",
    "analysis",
    "services",
    "reference",
    "graphical",
    "server",
    "transpile",
  ]) {
    await expect(import(`../src/${layer}/index.js`)).resolves.toBeDefined()
  }
})

test("public barrel imports", async () => {
  await expect(import("../src/index.js")).resolves.toBeDefined()
})
