/**
 * THE SHARED NETWORK-TEXT CASE SET, ON THE EDITOR'S SIDE (openspec ld-fbd-coverage design "2R.3"): every case of
 * `packages/volt-cli/test/fixtures/network-text` — the files the bridge's `NetworkTextCaseTests` reads. An accept case
 * reads with no finding; a refuse case is refused under its code, with its phrase. One source for both suites, so "the
 * LSP refuses while typing what a push would refuse" is a parity both check: a case one side accepts and the other
 * refuses fails both.
 *
 *   #### name — one line: what the case pins, and the rule
 *   === scope            optional: `instance t1 TON`, `pou f`, `name x` — the declarations the body sees
 *   === text             the body, its %LANGUAGE line first
 *   === model            accept: the model it reads to — the bridge compares it whole, this side its SHAPE (below)
 *   === canonical        accept, optional: the text the writer gives back
 *   === refused          refuse: `CODE phrase`
 */
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type BodySpan, type NetworkScopeView, isGraphicalBody, parseSource, readNetworkText, unitBodies } from "../../syntax/index.js"
import type {
  NetworkSplit,
  NetworkTarget,
  NetworkTextBody,
  NetworkTextStatement,
  NetworkValue,
} from "../../syntax/index.js"

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..", "volt-cli", "test", "fixtures", "network-text")

interface Case {
  file: string
  name: string
  accept: boolean
  text: string
  scope: string[]
  model?: string
  code?: string
  phrase?: string
}

function readCases(): Case[] {
  const out: Case[] = []
  for (const dir of ["accept", "refuse"])
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith(".cases")).sort()) {
      const lines = readFileSync(join(ROOT, dir, f), "utf8").replace(/\r\n/g, "\n").split("\n")
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

/** The case's scope as the bridge's `NetworkTextCase.ScopeOf` builds it: its instances, its POUs, every name. */
function scopeOf(c: Case): NetworkScopeView {
  const names = new Set<string>()
  const pous = new Set<string>()
  const instances = new Map<string, string>()
  for (const line of c.scope) {
    const w = line.split(/\s+/)
    if (w[0] === "instance" && w.length === 3) instances.set(w[1]!.toUpperCase(), w[2]!)
    else if ((w[0] === "pou" || w[0] === "fb") && w.length === 2) pous.add(w[1]!.toUpperCase())
    else if (w[0] === "name") for (const n of w.slice(1)) names.add(n.toUpperCase())
    else throw new Error(`${c.file}/${c.name}: a scope line is \`instance <name> <type>\`, \`pou <name>\` or \`name <n>…\`, not '${line}'`)
  }
  const declares = (n: string): boolean => names.has(n.toUpperCase()) || pous.has(n.toUpperCase()) || instances.has(n.toUpperCase())
  // `instance fbs[] CTU` — an ARRAY of FBs, whose elements `fbs[1]` are the instances (2R.5, the bridge's `NetworkScope.ArrayKey`).
  const element = (h: string): string | undefined => {
    const m = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\[[^[\]]+\]$/.exec(h)
    return m === null ? undefined : instances.get(m[1]!.toUpperCase() + "[]")
  }
  return { isPou: (n) => pous.has(n.toUpperCase()), instanceType: (h) => instances.get(h.toUpperCase()) ?? element(h), declares }
}

/** The case's body, inside a POU as a workspace file holds it. */
function bodyOf(c: Case): BodySpan {
  const src = `FUNCTION_BLOCK F_CASE\nVAR\nEND_VAR\n${c.text}END_FUNCTION_BLOCK\n`
  const b = unitBodies(parseSource(src, { networkText: true }, "codesys").units[0]!).find(isGraphicalBody)
  if (b === undefined) throw new Error(`${c.file}/${c.name}: no graphical body`)
  return b
}

const CASES = readCases()

test("the case set is there: both sides of every rule group it names", () => {
  expect(CASES.filter((c) => c.accept).length).toBeGreaterThanOrEqual(60)
  expect(CASES.filter((c) => !c.accept).length).toBeGreaterThanOrEqual(60)
})

// ── the model, as far as the editor's tree states it ─────────────────────────────────────────────────────────────────
//
// The bridge's side compares the whole model (`NetworkModelDump`). The editor's tree is the same TREE — what a branch is
// fed, which slot holds a box, which item a split binds — but not the members the bridge derives from it (an output's
// slot number, `conn:`/`eno:`/`name:`, an EXECUTE box's ST as one string). So each accept case is compared as its SHAPE:
// the case's `=== model` with those derivations dropped, against the same notation rendered from the LSP's parse. A
// reading the two parsers disagree on fails here, not only in `network-parse.test.ts`.

const OPERAND = /^[A-Za-z0-9_.#%'"?:\-$]+$/
const operand = (text: string): string => (text.length > 0 && OPERAND.test(text) ? text : "`" + text + "`")
const quote = (s: string): string =>
  '"' + s.replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]!) + '"'
/** A coil's target as the bridge dumps it: `[S=|R=][rise:|fall:][not:](name | jmp:L | ret)`. */
const target = (t: NetworkTarget): string => {
  let name = t.jump === true ? "jmp:" + t.text : t.ret === true ? "ret" : operand(t.text)
  if (t.negated === true) name = "not:" + name
  if (t.edge !== undefined) name = (t.edge === "rising" ? "rise:" : "fall:") + name
  return (t.op === "S=" ? "S=" : t.op === "R=" ? "R=" : "") + name
}
/** A pin's own modifiers as the bridge dumps them: `/` rising, `\` falling, `!` negated. */
const pinFlags = (f: { negated?: true; edge?: "rising" | "falling" } | undefined): string =>
  (f?.edge === "rising" ? "/" : f?.edge === "falling" ? "\\" : "") + (f?.negated === true ? "!" : "")
/** A coil list as the bridge dumps it: a lone plain jump or return keeps its own form. */
const assignShape = (targets: readonly NetworkTarget[], value: NetworkValue): string => {
  const only = targets.length === 1 ? targets[0]! : undefined
  if (only !== undefined && (only.op ?? ":=") === ":=" && only.negated === undefined && only.edge === undefined) {
    if (only.jump === true) return "(jmp " + only.text + " " + shapeOf(value) + ")"
    if (only.ret === true) return "(ret " + shapeOf(value) + ")"
  }
  return "(:= " + targets.map(target).join(" ") + " " + shapeOf(value) + ")"
}

/** The wired ENO pin, `ENO => v`, as the bridge dumps it: the box's first output. */
const enoPin = (v: { eno?: { target?: NetworkTarget } }): string[] =>
  v.eno?.target !== undefined ? ["=>ENO:" + operand(v.eno.target.text)] : []

/** An operator pin's default formal (`IN<n>`, MOVE's and NOT's `IN`) — the model holds none. */
const isDefault = (type: string, pin: number, formal: string): boolean => {
  const t = type.toUpperCase()
  return formal.toUpperCase() === (t === "MOVE" || t === "NOT" ? "IN" : `IN${pin + 1}`)
}

function shapeOf(v: NetworkValue): string {
  switch (v.kind) {
    case "operand":
      return operand(v.text)
    case "empty_slot":
      return "_"
    case "split_ref":
      return "#" + v.name.text.replace(/^split/i, "")
    case "not":
      return "not:" + shapeOf(v.operand)
    case "edge":
      return (v.rising ? "rise:" : "fall:") + shapeOf(v.operand)
    case "nested_assign":
      return assignShape(v.targets, v.value)
    case "nested_split":
      return "(split " + v.split.text.replace(/^split/i, "") + " " + shapeOf(v.value) + ")"
    case "word":
      return (
        "(" + [v.head.text, ...v.operands.map(shapeOf), ...enoPin(v), ...v.outputs.map((o) => "=>:" + operand(o.text)),
          ...(v.en !== undefined ? [pinFlags(v.enFlags) + "en:" + shapeOf(v.en)] : [])].join(" ") + ")"
      )
    case "call": {
      // An instance's type compared case-free: IEC names are, and the two scopes keep the declaration's spelling differently.
      const head = v.instance === true ? operand(v.boxType).toUpperCase() + "@" + operand(v.head.text) : operand(v.boxType)
      // The model lists a box's inputs, then its outputs (the ENO pin first).
      const inputs = v.pins.flatMap((p) =>
        p.kind === "input"
          ? // An operator's call form is the operator's box, its default formals no fact of the model.
            [pinFlags(p) + (p.name !== undefined && !(v.operatorCall === true && isDefault(v.boxType, v.pins.filter((q) => q.kind === "input").indexOf(p), p.name.text)) ? p.name.text + "=" : "") + shapeOf(p.value)]
          : [],
      )
      const outputs = v.pins.flatMap((p) =>
        p.kind === "output" && p.target !== undefined ? ["=>" + (p.name?.text ?? "") + ":" + operand(p.target.text)] : [],
      )
      return "(" + [head, ...inputs, ...enoPin(v), ...outputs, ...(v.en !== undefined ? [pinFlags(v.enFlags) + "en:" + shapeOf(v.en)] : [])].join(" ") + ")"
    }
    case "parallel":
      return (
        "(par " + (v.shortCircuit ? "sc" : "seq") + " " + (v.input !== undefined ? shapeOf(v.input) : "-") +
        v.branches.map((b) => " " + shapeOf(b)).join("") + ")"
      )
    case "execute":
      return "(EXECUTE" + (v.en !== undefined ? " " + pinFlags(v.enFlags) + "en:" + shapeOf(v.en) : "") + ")"
    default:
      throw new Error(`no shape for a '${(v as { kind: string }).kind}' value`)
  }
}

function statementShape(s: NetworkTextStatement, splits: readonly NetworkSplit[]): string {
  switch (s.kind) {
    case "assign":
      return assignShape(s.targets, s.value)

    case "split_def":
      return "(split " + (splits.find((x) => x.definition === s)?.varId ?? "?") + " " + shapeOf(s.value) + ")"
    case "value":
      return shapeOf(s.value)
    case "empty":
      return "_"
    default:
      throw new Error(`no shape for a '${(s as { kind: string }).kind}' statement`)
  }
}

function shapeOfBody(body: NetworkTextBody): string {
  const out: string[] = []
  for (const n of body.networks) {
    let head = "NETWORK"
    if (n.label !== undefined) head += " label:" + n.label.text
    if (n.disabled) head += " disabled"
    if (n.title !== undefined) head += " title:" + quote(n.title)
    if (n.comment !== undefined) head += " comment:" + quote(n.comment)
    if (n.unsupported !== undefined) head += " unsupported:" + quote(n.unsupported.text)
    if (n.unsupportedHash !== undefined) head += " hash:" + n.unsupportedHash
    out.push(head)
    for (const s of n.statements) out.push(statementShape(s, n.splits))
  }
  return normalized(out.join("\n"))
}

/** The bridge's model dump with the members only the bridge derives dropped, layout-free. */
function caseShape(model: string): string {
  return normalized(
    model
      .replace(/\(EXECUTE "(?:[^"\\]|\\.)*"/g, "(EXECUTE")
      .replace(/ (?:conn|main|eno):\d+/g, "")
      .replace(/ name:[^\s()]+/g, "")
      .replace(/=>\d+:/g, "=>:")
      // a comment's line break: the bridge holds the IDE's CR LF (P10), the editor's tree joins the lines with LF
      .replace(/ comment:"(?:[^"\\]|\\.)*"/g, (c) => c.replace(/\\r\\n/g, "\\n"))
      // an instance's type compared case-free (see `shapeOf`)
      .replace(/\(([^\s()@]+)@/g, (_m, t: string) => "(" + t.toUpperCase() + "@"),
  )
}

const normalized = (dump: string): string =>
  dump.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l.length > 0).join("\n")

for (const c of CASES.filter((x) => x.accept))
  test(`accepted: ${c.file}/${c.name}`, () => {
    const read = readNetworkText(bodyOf(c), scopeOf(c), "codesys")
    expect(read.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([])
    if (c.model === undefined) throw new Error(`${c.file}/${c.name}: an accept case states its model`)
    expect(shapeOfBody(read)).toBe(caseShape(c.model))
  })

for (const c of CASES.filter((x) => !x.accept))
  test(`refused: ${c.file}/${c.name} (${c.code} ${c.phrase ?? ""})`, () => {
    const read = readNetworkText(bodyOf(c), scopeOf(c), "codesys")
    const found = read.diagnostics.some(
      (d) => d.code === c.code && (c.phrase === undefined || d.message.toLowerCase().includes(c.phrase.toLowerCase())),
    )
    expect(found ? "refused as stated" : read.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n") || "accepted").toBe("refused as stated")
  })
