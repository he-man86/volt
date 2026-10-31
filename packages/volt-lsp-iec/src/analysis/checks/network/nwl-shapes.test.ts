/**
 * THE NWL SCHEMA GATE'S SHAPES, ON THE EDITOR'S SIDE (openspec nwl-schema-completeness-gate 2.2): every text the bridge's
 * writer spells for a generated NWL shape (`packages/volt-cli/test/fixtures/nwl-schema/shapes.v2.jsonl`, the export
 * `NwlSchemaGateTests` writes) is read by the ST parser as a network body and draws nothing from the network check — the
 * LSP accepts while typing every text a pull writes.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { caseRoot, programOf } from "../../../../test/support/network-cases.js"
import { networkDiags } from "../../../../test/support/network-docs.js"

interface Shape {
  language: string
  depth: number
  slot: string
  class: string
  holder: string
  flags: string
  outcome: "spelled" | "refused" | "vendor-refused"
  text?: string
  reason?: string
}

const lines = readFileSync(join(caseRoot("nwl-schema"), "shapes.v2.jsonl"), "utf8").replace(/\r\n/g, "\n").trim().split("\n")
const header: { version: string; scope: string[] } = JSON.parse(lines[0] ?? "{}")
const shapes = lines.slice(1).map((l): Shape => JSON.parse(l))
const texts = [...new Map(shapes.filter((s) => s.outcome === "spelled").map((s) => [s.text!, s])).values()]

test("the export is there: v2, every shape with an outcome", () => {
  expect(header.version).toBe("v2")
  expect(texts.length).toBeGreaterThan(1000)
  expect(shapes.every((s) => (s.outcome === "spelled") === (s.text !== undefined))).toBe(true)
})

test("every spelled shape's text draws nothing from the network check", () => {
  const findings: string[] = []
  for (const s of texts) {
    const src = programOf({ scope: header.scope, text: s.text! })
    for (const d of networkDiags(src))
      if (d.code === "network-plain-st") findings.push(`${s.language} ${s.slot} ${s.class} ${s.holder}=${s.flags}: ${d.message} at '${src.slice(d.span.start, d.span.end)}'`)
  }
  expect(findings.slice(0, 20)).toEqual([])
})
