/**
 * THE PLAIN-ST CASE SET'S READER — the editor's side of the bridge's `NetworkTextCases` over
 * `packages/volt-cli/test/fixtures/network-text-st` (openspec network-text-st 2.3, `analysis/checks/network/_plain-st.test.ts`),
 * in the v2 set's `.cases` format (whose own reader is `frontend/types/network/network-cases.test.ts`'s, deleted with v2).
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

/** The plain-ST case set's folder. */
export function caseRoot(set: "network-text-st"): string {
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
