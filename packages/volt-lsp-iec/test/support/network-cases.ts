/**
 * THE NETWORK-TEXT CASE SET'S READER — the editor's side of the bridge's `NetworkTextCases` over
 * `packages/volt-cli/test/fixtures/network-text-st` (`analysis/checks/network/_plain-st.test.ts`):
 *
 *   #### name — one line: what the case pins
 *   === scope            optional: `instance t1 TON`, `pou f`, `name x` — the declarations the body sees
 *   === text             the body, its %LANGUAGE line first
 *   === model            accept: the model it reads to
 *   === canonical        accept, optional: the text the writer gives back
 *   === refused          refuse: `CODE phrase`
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** The plain-ST case set's folder, or the NWL schema gate's (`shapes.v2.jsonl`, openspec nwl-schema-completeness-gate 2.3). */
export function caseRoot(set: "network-text-st" | "nwl-schema"): string {
  return join(import.meta.dir, "..", "..", "..", "volt-cli", "test", "fixtures", set)
}

export interface Case {
  file: string
  name: string
  accept: boolean
  text: string
  scope: string[]
  model?: string
  code?: string
  phrase?: string
}

export function readCases(root: string): Case[] {
  const out: Case[] = []
  for (const dir of ["accept", "refuse"])
    for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith(".cases")).sort()) {
      const lines = readFileSync(join(root, dir, f), "utf8").replace(/\r\n/g, "\n").split("\n")
      let name: string | undefined
      let section: string | undefined
      let sections = new Map<string, string[]>()
      const flush = (): void => {
        if (name === undefined) return
        const get = (s: string): string | undefined => {
          const l = sections.get(s)
          if (l === undefined) return undefined
          let a = 0
          let b = l.length
          while (a < b && l[a]!.trim() === "") a++
          while (b > a && l[b - 1]!.trim() === "") b--
          return l.slice(a, b).join("\n")
        }
        const refused = get("refused")?.trim()
        const sp = refused?.indexOf(" ") ?? -1
        out.push({
          file: `${dir}/${f}`,
          name,
          accept: dir === "accept",
          text: get("text")! + "\n",
          scope: (sections.get("scope") ?? []).map((l) => l.trim()).filter((l) => l.length > 0),
          ...(get("model") !== undefined ? { model: get("model")! } : {}),
          ...(refused !== undefined ? { code: sp < 0 ? refused : refused.slice(0, sp) } : {}),
          ...(refused !== undefined && sp >= 0 ? { phrase: refused.slice(sp + 1).trim() } : {}),
        })
      }
      for (const line of lines) {
        if (line.startsWith("#### ")) {
          flush()
          const head = line.slice(5).trim()
          const dash = head.indexOf(" — ")
          name = dash < 0 ? head : head.slice(0, dash).trim()
          section = undefined
          sections = new Map()
          continue
        }
        if (line.startsWith("=== ")) {
          section = line.slice(4).trim()
          sections.set(section, [])
          continue
        }
        if (section !== undefined) sections.get(section)!.push(line)
      }
      flush()
    }
  return out
}

/** A case's body as a PROGRAM's, its scope's names and instances declared — a shape of the NWL schema gate's export reads
 *  the same way (its scope lines are the case set's). */
export function programOf(c: Pick<Case, "scope" | "text">): string {
  const decls = c.scope.flatMap((line) => {
    const w = line.split(/\s+/)
    if (w[0] === "instance" && w.length === 3) return [`\t${w[1]!.replace(/\[\]$/, "")} : ${w[2]};`]
    if (w[0] === "name") return w.slice(1).map((n) => `\t${n} : BOOL;`)
    return []
  })
  // a `pou` line is a function the body can call (declaring its own EN, as the 55 library POUs that do, 1c); a signature
  // line (`fb TON IN PT => Q ET`, `function g IN => Q`, `program p => Q`) the callee as its declaration states it, and a bare
  // `fb Axis` a block type with no pin
  const pous = c.scope.flatMap((line) => {
    const w = line.split(/\s+/)
    if (w[0] === "pou" && w.length === 2) return [`FUNCTION ${w[1]} : BOOL\nVAR_INPUT\n\tEN : BOOL;\nEND_VAR\n%LANGUAGE ST\n${w[1]} := EN;\nEND_FUNCTION\n`]
    if (w[0] === "fb" && w.length === 2) return [`FUNCTION_BLOCK ${w[1]}\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n`]
    const arrow = w.indexOf("=>")
    if (!["fb", "function", "program"].includes(w[0]!) || arrow < 2) return []
    const vars = (kind: string, names: string[]) => (names.length === 0 ? "" : `${kind}\n${names.map((n) => `\t${n} : BOOL;\n`).join("")}END_VAR\n`)
    const io = vars("VAR_INPUT", w.slice(2, arrow)) + vars("VAR_OUTPUT", w.slice(arrow + 1))
    const [head, end] = w[0] === "fb" ? [`FUNCTION_BLOCK ${w[1]}`, "END_FUNCTION_BLOCK"] : w[0] === "function" ? [`FUNCTION ${w[1]} : BOOL`, "END_FUNCTION"] : [`PROGRAM ${w[1]}`, "END_PROGRAM"]
    return [`${head}\n${io}%LANGUAGE ST\n\n${end}\n`]
  })
  return `${pous.join("")}PROGRAM CaseProgram\nVAR\n\tvolt_case_unused : BOOL;\n${decls.join("\n")}\nEND_VAR\n${c.text}END_PROGRAM\n`
}
