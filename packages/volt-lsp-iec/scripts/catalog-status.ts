#!/usr/bin/env bun
/**
 * List the CODESYS error/warning catalog with implementation + verification status. The catalog
 * (`docs/codesys-reference/error-catalog.json`) is the master checklist; this renders it as a scannable table
 * so you can see, at a glance, which codes we implement and which are verified byte-identical against a live IDE.
 *
 *   bun scripts/catalog-status.ts                 # everything, grouped by status
 *   bun scripts/catalog-status.ts implemented     # only implemented
 *   bun scripts/catalog-status.ts --unverified    # implemented but NOT yet verified on codesys
 *   bun scripts/catalog-status.ts --our           # only rows that map to one of our checks
 */
import { errorCatalog } from "../src/reference/error-codes.js"

const arg = process.argv[2]
const onlyUnverified = process.argv.includes("--unverified")
const onlyOurs = process.argv.includes("--our")

let rows = errorCatalog()
if (arg && !arg.startsWith("--")) rows = rows.filter((e) => e.status === arg)
if (onlyOurs) rows = rows.filter((e) => e.ourCode !== null)
if (onlyUnverified) rows = rows.filter((e) => e.status === "implemented" && !e.verified?.codesys)

const V = (b: boolean | undefined) => (b ? "✓" : "·")
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

// A 3-way status matrix per code:
//   LSP — do we implement a check for it (`ourCode` set)?
//   CS  — verified byte-identical against a live CODESYS build?
//   TC  — verified byte-identical against a live TwinCAT build?
const all = errorCatalog()
const impl = all.filter((e) => e.status === "implemented")
console.log(
  `catalog: ${all.length} codes | LSP ${all.filter((e) => e.ourCode).length} | ` +
    `verified CS ${impl.filter((e) => e.verified?.codesys).length} · TC ${impl.filter((e) => e.verified?.twincat).length}\n`,
)

console.log(`${pad("code", 6)} LSP CS TC  ${pad("status", 12)} ${pad("ourCode", 28)} category`)
console.log("─".repeat(88))
for (const e of rows.sort((a, b) => a.code.localeCompare(b.code)))
  console.log(
    `${pad(e.code, 6)}  ${V(e.ourCode !== null)}  ${V(e.verified?.codesys)}  ${V(e.verified?.twincat)}  ` +
      `${pad(e.status, 12)} ${pad(e.ourCode ?? "—", 28)} ${e.category ?? ""}`,
  )
console.log(`\n${rows.length} rows`)
