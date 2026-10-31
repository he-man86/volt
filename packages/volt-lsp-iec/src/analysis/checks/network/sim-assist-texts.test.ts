/**
 * SIM-ASSIST'S EDITOR TEXTS, ON THE EDITOR'S SIDE (openspec nwl-schema-completeness-gate 1.2): every text Sim-Assist's
 * LD/FBD editor tests produce (`packages/volt-cli/test/fixtures/nwl-schema/sim-assist-editor-texts.v1.jsonl`) is judged
 * by the network check as the bridge's reader judges it (`SimAssistEditorTextsTests`, its verdicts committed beside the
 * texts): a text the reader accepts draws no network finding, and one it refuses draws one.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { caseRoot } from "../../../../test/support/network-cases.js"
import { networkDiags } from "../../../../test/support/network-docs.js"

const read = (name: string) => readFileSync(join(caseRoot("nwl-schema"), name), "utf8").replace(/\r\n/g, "\n").trim().split("\n")

const texts = read("sim-assist-editor-texts.v1.jsonl").slice(1).map((l, i) => ({ line: i + 2, ...(JSON.parse(l) as { text: string; op: string }) }))
const verdicts = new Map(
  read("sim-assist-editor-texts.v1.verdicts.txt")
    .filter((l) => !l.startsWith("#"))
    .map((l) => {
      const [line, verdict, ...why] = l.split(" ")
      return [Number(line), { accept: verdict === "accept", why: why.join(" ") }] as const
    }),
)

/** TON, the one library FB the editor's texts declare, by its standard interface (as the bridge's test gives it). */
const TON = "FUNCTION_BLOCK TON\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"

test("every text has the bridge reader's verdict", () => {
  expect(texts.length).toBe(1189)
  expect(texts.every((t) => verdicts.has(t.line))).toBe(true)
})

test("the network check accepts what the bridge's reader accepts and refuses what it refuses", () => {
  const disagree: string[] = []
  for (const t of texts) {
    const v = verdicts.get(t.line)!
    const src = TON + t.text
    const found = networkDiags(src).filter((d) => d.code === "network-plain-st")
    if (v.accept && found.length > 0)
      disagree.push(`line ${t.line} (${t.op}) the reader accepts, the LSP refuses: ${found.map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}'`).join("; ")}`)
    if (!v.accept && found.length === 0) disagree.push(`line ${t.line} (${t.op}) the reader refuses (${v.why}), the LSP accepts`)
  }
  expect(disagree.slice(0, 20)).toEqual([])
})
