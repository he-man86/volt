/**
 * THE COMPLETENESS ORACLE (openspec `bridge-one-to-one` design §2.1): the vendor's OWN archive, before and after,
 * member by member.
 *
 *   bun scripts/completeness.ts <codesys|twincat> [--only <subject>,…] [--write-known]
 *
 * Per subject — a fixture object of each class the disposition table names (CODESYS: the run's CodesysOneToOne copy —
 * CodesysTestProject plus the IDE-authored one-to-one objects, its own fixture so the LSP recorders' host and the rows
 * measured on CodesysTestProject never see them —, then a Pro2193 copy; TwinCAT: the Project14 copy) — it reads archive A (the cores' `archive` read: CODESYS the object's,
 * its IMetaObject's and every IObjectProperty's `SerializableValueNames`, TwinCAT the backing file and its `.plcproj`
 * entry), pulls the item over the pipe, then pushes its text twice through the SHIPPED bridge:
 *
 *   UPDATE  the same text onto the object                          → archive B, compared with A
 *   CREATE  the object deleted, the text pushed under its name, in → archive C, compared with A
 *           the same folder of the same project copy
 *
 * Every member of A (and of B / C) is looked up in `disposition.table.ts`: SPELLED must be equal (and at its measured
 * constant, or the pull refuses it), CACHE is skipped only when its cited `vendor-facts` row exists, IDENTITY must be
 * equal after the update (a create mints it anew), REFUSED must have been refused naming the member, SCOPE is skipped,
 * MEASURE is reported; a member the table does not list fails as `<class>.<member>: undecided`. A value the core could
 * not read (`{ $unreadable }`: it raised, lies past the walk's depth, or is an object with no archive whose ToString
 * names only its class) is a finding of its own wherever the member is compared — it would compare equal to anything.
 * A refused UPDATE is a finding too (an unwritten object reads back unchanged — never a perfect round-trip).
 *
 * A finding is keyed `<class>.<member>` (the table's member form) AND its KIND — what is wrong, value-free: `changed by
 * the create`, `a trailing newline folded by the update`, `lost by the create`, `create refused: <codes> [<markers>]`,
 * … — so a known failure of a member hides no OTHER failure of it. `completeness.known.ts` lists the expected ones,
 * `<vendor>:<class>.<member> — <kind>`, each with the SUBJECTS that fail it and its first finding: a failure of a
 * subject its entry does not list is unexpected, and a listed subject this run RAN that no longer fails is stale —
 * both FAIL the run. A subject is `<project>/<wire name>` (two projects may hold one name). An `--only` run judges, and
 * `--write-known` rewrites, the subjects it ran and no other.
 *
 * It runs on its OWN `ide.ps1` instance (`VOLT_VENDOR_FACTS_INSTANCE`, as `vendor-facts.ts`, whose cores, instance
 * handling and pipe side it reuses), on fixture COPIES only, and closes the IDE in `finally`.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { pipePid, scriptPipe } from "../test/e2e/lib/fixture-ide"
import { landedInFull } from "../test/e2e/lib/workspace"
import { fileOf, folderOf, inFolder, pathIn } from "../test/e2e/lib/main-program"
import { citedCacheRows, dispositionOf, normalizeMember, type Disposition, type Vendor } from "./disposition.table"
import { KNOWN } from "./completeness.known"
import {
  codesysCore,
  fixtureCopy,
  ide,
  INSTANCE,
  pushOutcome,
  twincatCore,
  wireSide,
  type CoreAnswer,
  type CoreRequest,
} from "./vendor-facts"
import { ROWS } from "./vendor-facts.table"

/** `{ "<descendant path>": { "<member path>": value } }` — `""` is the subject itself. */
export type Archive = Record<string, Record<string, unknown>>
export type Phase = "update" | "create"
/** `key` the member (`<class>.<member>`), `kind` what is wrong with it — value-free, so it is the same on every run. */
export type Finding = { key: string; kind: string; subject: string; phase: Phase | "pull"; what: string }
export type Measurement = {
  key: string
  subject: string
  phase: Phase
  equal: boolean
  before: unknown
  after: unknown
}

const json = (v: unknown) => JSON.stringify(v === undefined ? null : v)
const short = (v: unknown) => {
  const s = json(v)
  return s.length > 120 ? s.slice(0, 117) + "..." : s
}

/** Two values as a finding reads them: two texts by their first difference (where, and a few characters each side —
 *  a folded trailing newline must read as one), anything else whole. */
export function difference(x: unknown, y: unknown): string {
  if (typeof x !== "string" || typeof y !== "string") return `${short(x)} -> ${short(y)}`
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  const from = Math.max(0, i - 20)
  return `at character ${i} of ${x.length} -> ${y.length}: ${json(x.slice(from, i + 20))} -> ${json(y.slice(from, i + 20))}`
}

/** A member is PRESENT when the vendor holds a value for it (null and an absent member are no value). */
const present = (v: unknown) => v !== undefined && v !== null

/** A value the core could not read — it compares equal to any other, so it is never judged as a value. */
const unreadable = (v: unknown): v is { $unreadable: string } =>
  typeof v === "object" && v !== null && "$unreadable" in v

/** What is wrong with a member whose value differs, without its values: a text that lost only trailing newline(s), a
 *  member the vendor no longer holds, or any other change. */
export function changeKind(x: unknown, y: unknown, phase: Phase): string {
  if (typeof x === "string" && typeof y === "string" && x.startsWith(y) && /^(\r?\n)+$/.test(x.slice(y.length)))
    return `a trailing newline folded by the ${phase}`
  if (present(x) && !present(y)) return `lost by the ${phase}`
  return `changed by the ${phase}`
}

/** The entry a finding has in `completeness.known.ts`. */
export const knownKey = (vendor: Vendor, f: { key: string; kind: string }) => `${vendor}:${f.key} — ${f.kind}`

/** The codes a pushed write's refusal names (`refused: CODE: reason | CODE: reason`), or `no code` — each with the
 *  markers `pushOutcome` appends to its conflict (`[partiallyApplied]`, `[renamedTo …]` read `[renamedTo]`,
 *  `[remains]`): a refusal that left part of the object behind is not the clean refusal. */
function refusalCodes(outcome: string): string {
  const codes = outcome
    .replace(/^refused: /, "")
    .split(" | ")
    .flatMap((c) => {
      const code = c.slice(0, Math.max(0, c.indexOf(":")))
      if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return []
      const markers = ["partiallyApplied", "renamedTo", "remains"].filter((m) =>
        m === "renamedTo" ? / \[renamedTo [^\]]*\]/.test(c) : c.includes(` [${m}]`),
      )
      return [[code, ...markers.map((m) => `[${m}]`)].join(" ")]
    })
  return codes.length ? codes.join(", ") : "no code"
}

/** A refused write of the subject (`$update`, `$delete`, `$create`): keyed by the refusal's codes and markers; WHICH
 *  subject is the finding's `subject` (the known entry lists its subjects), so another subject's refusal, or another
 *  refusal of this one, is not the known one. */
export function refusalFinding(
  cls: string,
  subject: string,
  write: "update" | "delete" | "create",
  outcome: string,
): Finding {
  return {
    key: `${cls}.$${write}`,
    kind: `${write} refused: ${refusalCodes(outcome)}`,
    subject,
    phase: write === "update" ? "update" : "create",
    what: `${write} refused: ${outcome}`,
  }
}

/** The UPDATE phase's own outcome: a refused update wrote nothing, so archive B equals A whatever Volt lost — the
 *  refusal is the finding. */
export const updateFindings = (cls: string, subject: string, outcome: string): Finding[] =>
  outcome === "accepted" ? [] : [refusalFinding(cls, subject, "update", outcome)]

/** A REFUSED create: the refusal, by its codes and markers — and, when the refusal left an object behind (`remains`:
 *  its archive read after the refusal), that object judged member by member against `a`. A clean refusal left
 *  nothing to judge: every member went with the object, and the refusal is the one finding. */
export function refusedCreateFindings(
  vendor: Vendor,
  cls: string,
  subject: string,
  a: Archive,
  outcome: string,
  remains: Archive | undefined,
  rows: ReadonlySet<string>,
  pulled = "",
): Finding[] {
  // What the pull and the push answered — the pulled text included (an UNSUPPORTED body's line is the pull's refusal).
  const answered = pulled + "\n" + outcome
  const left = remains ? compareArchives(vendor, subject, "create", a, remains, answered, rows).findings : []
  return [...left, refusalFinding(cls, subject, "create", outcome)]
}

/** The findings of one phase: archive `a` (before) against `b` (after), every member of either looked up in the table.
 *  `refusals` is everything the pull and the push answered — a refused member passes only when it is NAMED there. */
export function compareArchives(
  vendor: Vendor,
  subject: string,
  phase: Phase,
  a: Archive,
  b: Archive,
  refusals: string,
  rows: ReadonlySet<string>,
): { findings: Finding[]; measurements: Measurement[] } {
  const findings: Finding[] = []
  const measurements: Measurement[] = []
  const add = (key: string, kind: string, what: string) => findings.push({ key, kind, subject, phase, what })
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const before = a[path]
    const after = b[path]
    const where = path === "" ? subject : `${subject}/${path}`
    const cls = String((before ?? after)!.$class ?? "?")
    if (!before) {
      add(`${cls}.$object`, `added by the ${phase}`, `${where}: an object the ${phase} added`)
      continue
    }
    if (!after) {
      add(`${cls}.$object`, `gone after the ${phase}`, `${where}: gone after the ${phase}`)
      continue
    }
    // A create that made ANOTHER class is one finding, its `$class`; the members the other class archives are that
    // class's, not undecided members of this one — only what the object held before is judged then.
    const sameClass = json(before.$class) === json(after.$class)
    const members = sameClass ? [...Object.keys(before), ...Object.keys(after)] : Object.keys(before)
    for (const m of [...new Set(members)].sort()) {
      const d = dispositionOf(vendor, cls, m)
      const key = `${cls}.${normalizeMember(m)}`
      const x = before[m]
      const y = after[m]
      // A cache is never compared and a scope is another change's: an unreadable value of either is no finding. Any
      // other unreadable value is — a listed member's, and an unlisted one's (the cores' `$names` / `$children`
      // markers: an archive or a child list that could not be read), which is unreadable before it is undecided.
      if (!(d && ("cache" in d || "scope" in d)) && (unreadable(x) || unreadable(y))) {
        const why = [x, y].filter(unreadable).map((v) => v.$unreadable)
        add(key, "unreadable", `unreadable (${where} ${m}): ${[...new Set(why)].join("; ")}`)
        continue
      }
      if (!d) {
        add(key, "undecided", `undecided (${where} ${m} = ${short(present(x) ? x : y)})`)
        continue
      }
      judge(d, {
        key,
        where,
        m,
        x,
        y,
        phase,
        refusals,
        rows,
        add,
        measure: (equal) => measurements.push({ key, subject: where, phase, equal, before: x, after: y }),
      })
    }
  }
  return { findings, measurements }
}

function judge(
  d: Disposition,
  c: {
    key: string
    where: string
    m: string
    x: unknown
    y: unknown
    phase: Phase
    refusals: string
    rows: ReadonlySet<string>
    add: (key: string, kind: string, what: string) => void
    measure: (equal: boolean) => void
  },
) {
  const equal = json(c.x) === json(c.y)
  if ("spelled" in d) {
    if ("constant" in d && present(c.x) && json(c.x) !== json(d.constant))
      c.add(
        c.key,
        "off its measured constant",
        `off its measured constant ${short(d.constant)}: ${short(c.x)} (${c.where} ${c.m}) — the pull must refuse it by name`,
      )
    if (!equal) c.add(c.key, changeKind(c.x, c.y, c.phase), `differs after the ${c.phase} (${c.where} ${c.m}): ${difference(c.x, c.y)}`)
  } else if ("cache" in d) {
    if (!c.rows.has(d.cache)) c.add(c.key, "a cache citing no vendor-facts row", `a cache citing no vendor-facts row ('${d.cache}')`)
  } else if ("identity" in d) {
    if (c.phase === "update" && !equal) c.add(c.key, "identity changed by the update", `identity changed by an in-place write (${c.where} ${c.m})`)
  } else if ("refused" in d) {
    if (present(c.x) && !c.refusals.includes(d.name))
      c.add(c.key, "held but not refused", `held (${c.where} ${c.m} = ${short(c.x)}) but neither the pull nor the push refused '${d.name}'`)
  } else if ("measure" in d) {
    c.measure(equal)
  }
}

/** An expected failure: the subjects that fail it and its first finding. */
export type KnownEntry = { readonly why: string; readonly subjects: readonly string[] }
export type Known = Readonly<Record<string, KnownEntry>>

/** The run's verdict against `known`, per SUBJECT: a failure (member, kind, subject) its entry does not list is
 *  unexpected; a listed subject this run RAN (`ran`) that no longer fails it is stale. A subject this run did not run
 *  is judged for nothing — whatever its entry's kind. Each line reads `<key> @ <subject>`. */
export function verdict(
  vendor: Vendor,
  findings: Finding[],
  known: Known,
  ran: ReadonlySet<string>,
): { unexpected: string[]; stale: string[]; expected: string[] } {
  const failing = new Map<string, Set<string>>()
  for (const f of findings) {
    const k = knownKey(vendor, f)
    failing.set(k, (failing.get(k) ?? new Set()).add(f.subject))
  }
  const unexpected: string[] = []
  const expected: string[] = []
  for (const [k, subjects] of failing)
    for (const s of subjects) (known[k]?.subjects.includes(s) ? expected : unexpected).push(`${k} @ ${s}`)
  const stale: string[] = []
  for (const [k, e] of Object.entries(known))
    if (k.startsWith(vendor + ":"))
      for (const s of e.subjects) if (ran.has(s) && !failing.get(k)?.has(s)) stale.push(`${k} @ ${s}`)
  return { unexpected: unexpected.sort(), stale: stale.sort(), expected: expected.sort() }
}

/** `--write-known`: this vendor's entries with the subjects this run RAN replaced by what it found failing — every
 *  other subject's kept (an `--only` run rewrites only its own), the other vendor's untouched; an entry left with no
 *  subject goes. A new entry's reason is its first finding; a kept entry keeps its reason. */
export function mergeKnown(vendor: Vendor, known: Known, findings: Finding[], ran: ReadonlySet<string>): Known {
  const out: Record<string, KnownEntry> = {}
  for (const [k, e] of Object.entries(known)) {
    const subjects = k.startsWith(vendor + ":") ? e.subjects.filter((s) => !ran.has(s)) : e.subjects
    if (subjects.length) out[k] = { why: e.why, subjects }
  }
  for (const f of findings) {
    const k = knownKey(vendor, f)
    const e = out[k]
    // An entry this run re-fails keeps its (reviewed) reason even when all its subjects ran (gate review of step 4b);
    // only an entry the list never had takes the run's first finding.
    if (!e) out[k] = { why: known[k]?.why ?? f.what, subjects: [f.subject] }
    else if (!e.subjects.includes(f.subject)) out[k] = { why: e.why, subjects: [...e.subjects, f.subject].sort() }
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)))
}

// ── the live run ────────────────────────────────────────────────────────────────────────────────────────────────────

type Core = (req: CoreRequest) => Promise<CoreAnswer>
type Wire = NonNullable<ReturnType<typeof wireSide>["raw"]>
/** `id` is `<project>/<wire>` — what a finding's `subject` and a known entry's subjects name. */
type Subject = { id: string; name: string; wire: string; folder: string; guid?: string; cls: string; why: string }
type Picked = { subjects: Omit<Subject, "id">[]; uncovered: string[] }

/** The wire items of a kind the oracle judges (`exts`) that no subject candidate maps to — never skipped in silence. */
const uncoveredOf = (items: Record<string, string>, exts: Iterable<string>, mapped: ReadonlySet<string>) => {
  const judged = new Set(exts)
  return Object.keys(items)
    .filter((w) => judged.has(w.slice(w.lastIndexOf(".") + 1)) && !mapped.has(w))
    .sort()
}

const ROW = "completeness"
const read = async (core: Core, op: "archive" | "objects", on?: string) =>
  (await core({ kind: "read", row: ROW, read: { op, key: op, on, after: 0, snapshotKey: op } as any })).value

/** CODESYS: the classes whose object IS a wire item, by extension. */
const CS_ITEM_EXT: Record<string, string> = {
  "POUObject.POUObject": "pou",
  "POUObject.POUObjectCheckFunction": "pou",
  "DUTObject.DUTObject": "dut",
  "TextList.TextListEnumerationObject": "dut",
  "InterfaceObject.InterfaceObject": "itf",
  "GVLObject.GVLObject": "gvl",
  "GVLObject.VarPersistentObject": "gvl",
  "NVLObject.NVLObject": "gvl",
  "TaskObject.TaskObject": "task",
}
const TC_ITEM_EXT: Record<string, string> = { TcPOU: "pou", TcDUT: "dut", TcGVL: "gvl", TcIO: "itf", TcTTO: "task" }

type CsObject = {
  guid: string
  name: string
  class: string | null
  parent: string
  props: string[]
  build: { exclude: boolean; linkAlways: boolean; reserve: number } | null
}

/** The CODESYS subjects: a greedy cover of every FEATURE the open project holds — each item class, each member class
 *  below an item, each property class, each non-default build flag on an item and on a member — one wire item at a
 *  time, the item covering the most features first. A feature no item holds is not invented. `uncovered`: a wire item
 *  of a judged kind (`.pou`, `.dut`, …) that no object of a class `CS_ITEM_EXT` knows maps to. */
export function pickCodesys(objects: CsObject[], items: Record<string, string>, refused: readonly string[]): Picked {
  const byGuid = new Map(objects.map((o) => [o.guid, o]))
  const ownerOf = (o: CsObject): CsObject | undefined => {
    for (let cur: CsObject | undefined = o, n = 0; cur && n < 30; cur = byGuid.get(cur.parent), n++)
      if (cur.class && cur.class in CS_ITEM_EXT) return cur
    return undefined
  }
  const features = new Map<string, Set<string>>()
  for (const o of objects) {
    if (!o.class) continue
    const owner = ownerOf(o)
    if (!owner) continue
    const f = features.get(owner.guid) ?? new Set<string>()
    const self = owner === o
    f.add(`${self ? "item" : "member"}:${o.class}`)
    for (const p of o.props) if (p !== "SVFoldersProperty") f.add(`prop:${p}${self ? "" : " (member)"}`)
    if (o.build?.exclude) f.add(`exclude:${self ? "item" : "member"}`)
    if (o.build?.linkAlways) f.add("linkAlways")
    if (o.build && o.build.reserve !== 0) f.add("reserve")
    features.set(owner.guid, f)
  }
  const wireOf = (o: CsObject) => pathIn(items, `${o.name}.${CS_ITEM_EXT[o.class!]}`)
  const candidates = [...features.entries()]
    .map(([g, f]) => ({ o: byGuid.get(g)!, f }))
    .filter((c) => wireOf(c.o) !== undefined)
  const mapped = new Set(
    objects.flatMap((o) => (o.class && o.class in CS_ITEM_EXT && wireOf(o) !== undefined ? [wireOf(o)!] : [])),
  )
  const uncovered = uncoveredOf(items, Object.values(CS_ITEM_EXT), mapped)
  const covered = new Set<string>()
  const out: Omit<Subject, "id">[] = []
  // Every TASK is a subject: what tells two tasks apart (an external event, a disabled watchdog's values, a call's
  // comment) is a member VALUE no feature above names, and a task costs a second.
  for (const c of candidates
    .filter((x) => x.o.class === "TaskObject.TaskObject")
    .sort((x, y) => x.o.name.localeCompare(y.o.name))) {
    const wire = wireOf(c.o)!
    for (const x of c.f) covered.add(x)
    out.push({ name: c.o.name, wire, folder: folderOf(wire), guid: c.o.guid, cls: c.o.class!, why: "every task" })
  }
  for (;;) {
    let best: { o: CsObject; f: Set<string> } | undefined
    let gain = 0
    for (const c of candidates) {
      const g = [...c.f].filter((x) => !covered.has(x)).length
      if (g > gain || (g === gain && g > 0 && best && c.o.name < best.o.name)) {
        best = c
        gain = g
      }
    }
    if (!best || gain === 0) break
    const fresh = [...best.f].filter((x) => !covered.has(x))
    for (const x of best.f) covered.add(x)
    const wire = wireOf(best.o)!
    out.push({
      name: best.o.name,
      wire,
      folder: folderOf(wire),
      guid: best.o.guid,
      cls: best.o.class!,
      why: fresh.sort().join(", "),
    })
  }
  // Every item the pull REFUSES is a subject too (gate review of step 4b, finding 4): it is no wire item, so the cover
  // above never sees it, and its known entries outlived every run unjudged. Its refusal by name is what the run judges.
  for (const o of objects) {
    const at = o.class && o.class in CS_ITEM_EXT ? refusedAt(refused, `${o.name}.${CS_ITEM_EXT[o.class!]}`) : undefined
    if (at === undefined) continue
    const wire = inFolder(at, `${o.name}.${CS_ITEM_EXT[o.class!]}`)
    if (wire in items || out.some((s) => s.wire === wire)) continue
    out.push({ name: o.name, wire, folder: at, guid: o.guid, cls: o.class!, why: REFUSED_SUBJECT })
  }
  return { subjects: out, uncovered }
}

/** Why a subject the pull refuses was taken. */
const REFUSED_SUBJECT = "every item the pull refuses"

/** The folder the pull's `unreadable` list names the item `file` (`<name>.<kind>`) under — each entry is the item's
 *  path, `<folder>/<name>.<kind>` — or undefined when it names none; two are refused by name — a file name two folders
 *  hold names no one object. */
function refusedAt(refused: readonly string[], file: string): string | undefined {
  const hits = refused.filter((u) => fileOf(u) === file)
  if (hits.length > 1) throw new Error(`the pull refuses '${file}' under ${hits.length} folders (${hits.join(", ")})`)
  return hits.length === 1 ? folderOf(hits[0]!) : undefined
}

type TcObject = { name: string; itemType: number; path: string; file: string | null }

export function pickTwincat(objects: TcObject[], items: Record<string, string>, refused: readonly string[]): Picked {
  const out: Omit<Subject, "id">[] = []
  for (const o of objects) {
    const ext = o.file ? o.file.slice(o.file.lastIndexOf(".") + 1) : ""
    if (!(ext in TC_ITEM_EXT)) continue
    const file = `${o.name}.${TC_ITEM_EXT[ext]}`
    const listed = pathIn(items, file)
    const at = listed === undefined ? refusedAt(refused, file) : undefined
    const wire = listed ?? (at === undefined ? undefined : inFolder(at, file))
    if (wire === undefined || out.some((s) => s.wire === wire)) continue
    out.push({ name: o.name, wire, folder: folderOf(wire), cls: ext, why: at !== undefined ? REFUSED_SUBJECT : o.file! })
  }
  const uncovered = uncoveredOf(items, Object.values(TC_ITEM_EXT), new Set(out.map((s) => s.wire)))
  return { subjects: out.sort((x, y) => x.wire.localeCompare(y.wire)), uncovered }
}

async function runSubject(
  vendor: Vendor,
  core: Core,
  wire: Wire,
  s: Subject,
  n: number,
  rows: ReadonlySet<string>,
): Promise<{ findings: Finding[]; measurements: Measurement[]; classes: Set<string>; log: string[] }> {
  const log: string[] = []
  const findings: Finding[] = []
  const measurements: Measurement[] = []
  const classes = new Set<string>()
  const as = `s${n}`
  await core({ kind: "adopt", row: ROW, as, name: s.name, ...(s.guid ? { guid: s.guid } : {}) })
  const A = (await read(core, "archive", as)) as Archive
  for (const d of Object.values(A)) classes.add(String(d.$class))
  let text: string
  try {
    text = await wire.fetchText(s.wire)
  } catch (e) {
    const why = `pull: ${s.wire}: ${(e as Error).message}`
    log.push(why)
    findings.push({ key: `${A[""]!.$class}.$pull`, kind: "pull refused", subject: s.id, phase: "pull", what: why })
    return { findings, measurements, classes, log }
  }
  // UPDATE: the same text onto the object.
  let r = await wire.refs()
  const upd = pushOutcome(await wire.push({ op: "set", name: s.wire, sourceText: text, ifVersion: r.items[s.wire] }))
  log.push(`update: ${upd}`)
  findings.push(...updateFindings(String(A[""]!.$class), s.id, upd))
  const B = (await read(core, "archive", as)) as Archive
  // What the pull and the pushes answered — the pulled text included: an UNSUPPORTED body's line IS the pull's refusal
  // by name of what travels with that body.
  const u = compareArchives(vendor, s.id, "update", A, B, text + "\n" + upd, rows)
  findings.push(...u.findings)
  measurements.push(...u.measurements)
  // CREATE: deleted, then pushed under its name into the same folder.
  r = await wire.refs()
  const del = await wire.push({ op: "deleteItem", name: s.wire, ifVersion: r.items[s.wire] })
  if (!landedInFull(del)) {
    log.push(`delete: ${pushOutcome(del)}`)
    findings.push(refusalFinding(String(A[""]!.$class), s.id, "delete", pushOutcome(del)))
    return { findings, measurements, classes, log }
  }
  const made = pushOutcome(
    await wire.push({ op: "set", name: s.wire, sourceText: text, ifVersion: null }),
  )
  log.push(`create: ${made}`)
  const adoptCreated = async () => {
    await core({
      kind: "adopt",
      row: ROW,
      as: `${as}c`,
      name: s.name,
      ...(vendor === "codesys"
        ? { cls: Object.keys(CS_ITEM_EXT).filter((k) => CS_ITEM_EXT[k] === CS_ITEM_EXT[s.cls]) }
        : {}),
    })
    return (await read(core, "archive", `${as}c`)) as Archive
  }
  if (made !== "accepted") {
    // Refused: the wire says whether it left an object behind (the item is listed again) — that object is judged; a
    // clean refusal is the one finding.
    const remains = s.wire in (await wire.refs()).items ? await adoptCreated() : undefined
    if (remains) log.push("the refused create left the item behind: judged")
    findings.push(
      ...refusedCreateFindings(vendor, String(A[""]!.$class), s.id, A, made, remains, rows, text),
    )
    return { findings, measurements, classes, log }
  }
  const C = await adoptCreated()
  const c = compareArchives(vendor, s.id, "create", A, C, text + "\n" + made, rows)
  findings.push(...c.findings)
  measurements.push(...c.measurements)
  return { findings, measurements, classes, log }
}

const USAGE =
  "usage: bun scripts/completeness.ts <codesys|twincat> [--only <subject>,…] [--write-known] [--dump <file prefix>]"

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const vendor = argv[0] as Vendor
  if (vendor !== "codesys" && vendor !== "twincat") {
    console.error(USAGE)
    return 2
  }
  let only: string[] | undefined
  let writeKnown = false
  let dump: string | undefined
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--only") only = (argv[++i] ?? "").split(",").filter(Boolean)
    else if (argv[i] === "--write-known") writeKnown = true
    else if (argv[i] === "--dump") dump = argv[++i]
    else {
      console.error(USAGE)
      return 2
    }
  }
  const rows = new Set(ROWS.map((r) => r.id))
  const missing = citedCacheRows(vendor).filter((r) => !rows.has(r))
  if (missing.length)
    console.log(`[completeness] cache entries citing no vendor-facts row (each fails where met): ${missing.join(", ")}`)

  // Closed on every exit: `finally` below, and a signal here (openspec shared-ide-machine-rules).
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => { try { ide("down", vendor) } finally { process.exit(130) } })
  ide("up", vendor, "CodesysOneToOne")
  let stopCore = () => {}
  const findings: Finding[] = []
  const measurements: Measurement[] = []
  const exercised = new Set<string>()
  const ranSubjects = new Set<string>()
  const uncovered: string[] = []
  try {
    const pipe = scriptPipe(vendor, process.env.VOLT_PIPE, INSTANCE)
    const pid = pipePid(pipe, vendor)!
    console.log(`[completeness] ${vendor} on ${pipe} (instance ${INSTANCE})`)
    let core: Core
    if (vendor === "codesys") {
      const c = codesysCore(pid)
      await c.ready()
      core = c.request
    } else {
      const c = twincatCore(pid)
      stopCore = c.stop
      await c.ready()
      core = c.request
    }
    const side = wireSide(pipe)
    const wire = side.raw!
    // Each project's tag names its subjects (`<tag>/<wire>`): the run's copy of the served fixture, then Pro2193.
    const projects = vendor === "codesys" ? ["CodesysOneToOne", "Pro2193"] : ["Project14"]
    let n = 0
    for (const project of projects) {
      await core({ kind: "begin", row: ROW })
      if (project === "Pro2193") {
        const a = await core({
          kind: "step",
          row: ROW,
          step: { op: "open", fixture: "Pro2193" },
          fixturePath: fixtureCopy(vendor, "Pro2193"),
        })
        if (a.outcome && a.outcome !== "accepted") throw new Error(`open Pro2193: ${a.outcome}`)
        await side.rebind!()
      }
      const r = await wire.refs()
      const objects = (await read(core, "objects")) as any[]
      if (dump) writeFileSync(`${dump}.${project.replace(/\W+/g, "_")}.json`, JSON.stringify(objects, null, 1))
      const refused: string[] = (r.unreadable ?? []).map((u: { name: string }) => u.name)
      const picked =
        vendor === "codesys"
          ? pickCodesys(objects, r.items, refused)
          : pickTwincat(objects, r.items, refused)
      uncovered.push(...picked.uncovered.map((w) => `${project}/${w}`))
      const subjects = picked.subjects
        .map((s) => ({ ...s, id: `${project}/${s.wire}` }))
        .filter((s) => !only || only.includes(s.wire) || only.includes(s.id))
      console.log(`[completeness] ${project}: ${objects.length} objects, ${subjects.length} subjects`)
      for (const s of subjects) {
        const t0 = Date.now()
        const out = await runSubject(vendor, core, wire, s, ++n, rows)
        ranSubjects.add(s.id)
        findings.push(...out.findings)
        measurements.push(...out.measurements)
        for (const c of out.classes) exercised.add(c)
        console.log(
          `  ${s.wire} [${s.cls}] (${s.why}) — ${out.findings.length} finding(s), ${((Date.now() - t0) / 1000).toFixed(1)} s; ${out.log.join("; ")}`,
        )
      }
      await core({ kind: "cleanup", row: ROW })
      if (project === "Pro2193") await side.rebind!()
    }
  } finally {
    stopCore()
    ide("down", vendor)
  }

  // ── the report ──
  const byKey = new Map<string, Finding[]>()
  for (const f of findings) {
    const k = knownKey(vendor, f).slice(vendor.length + 1)
    byKey.set(k, [...(byKey.get(k) ?? []), f])
  }
  console.log(`\n[completeness] ${byKey.size} failing member/kind pair(s) over ${exercised.size} class(es):`)
  for (const [k, fs] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`  ${k}  (${fs.length}×)  ${fs[0]!.what}`)
  if (measurements.length) {
    console.log(`\n[completeness] measured (cache candidates):`)
    for (const m of measurements)
      console.log(
        `  ${m.key} ${m.subject} ${m.phase}: ${m.equal ? "equal" : `differs ${short(m.before)} -> ${short(m.after)}`}`,
      )
  }
  for (const w of uncovered) console.log(`  UNCOVERED ${w}: a wire item of a judged kind no item class the oracle knows maps to`)
  if (writeKnown) {
    writeKnownFile(mergeKnown(vendor, KNOWN, findings, ranSubjects), vendor)
    return uncovered.length === 0 ? 0 : 1
  }
  const v = verdict(vendor, findings, KNOWN, ranSubjects)
  const at = (line: string) => line.slice(0, line.lastIndexOf(" @ "))
  for (const k of v.unexpected) {
    const subject = k.slice(k.lastIndexOf(" @ ") + 3)
    const f = byKey.get(at(k).slice(vendor.length + 1))!.find((x) => x.subject === subject)!
    console.log(`  UNEXPECTED ${k}: ${f.what}`)
  }
  for (const k of v.stale)
    console.log(`  STALE ${k}: no longer fails — remove the subject from completeness.known.ts (${KNOWN[at(k)]?.why})`)
  console.log(
    `[completeness] ${vendor}: ${v.expected.length} expected, ${v.unexpected.length} unexpected, ${v.stale.length} stale, ${uncovered.length} uncovered`,
  )
  return v.unexpected.length === 0 && v.stale.length === 0 && uncovered.length === 0 ? 0 : 1
}

/** `--write-known`: `completeness.known.ts` rewritten from `known` (`mergeKnown`). A deliberate act, like
 *  `vendor-facts --write`. */
function writeKnownFile(known: Known, vendor: Vendor) {
  const body = Object.entries(known)
    .map(([k, e]) => `  ${JSON.stringify(k)}: {\n    subjects: ${JSON.stringify(e.subjects)},\n    why: ${JSON.stringify(e.why)},\n  },`)
    .join("\n")
  const path = join(import.meta.dir, "completeness.known.ts")
  writeFileSync(path, `${KNOWN_HEADER}import type { Known } from "./completeness"\n\nexport const KNOWN: Known = {\n${body}\n}\n`)
  const mine = Object.keys(known).filter((k) => k.startsWith(vendor + ":")).length
  console.log(`[completeness] wrote ${Object.keys(known).length} known entries (${mine} for ${vendor}) to completeness.known.ts`)
}

export const KNOWN_HEADER = `/**
 * THE COMPLETENESS ORACLE'S EXPECTED FAILURES (openspec \`bridge-one-to-one\` design §2.1):
 * \`<vendor>:<class>.<member> — <kind>\` → the SUBJECTS (\`<project>/<wire name>\`) that fail it and its first finding.
 * The KIND is what is wrong with the member (value-free), so a known failure hides no other failure of the same member,
 * and its subjects name who fails it, so it hides no other subject's. A listed subject the run ran that no longer
 * fails FAILS the run — remove it; a failure not listed here fails it too. An \`--only\` run judges and rewrites only
 * the subjects it ran. Step 3 removes the entries its tasks close; task 4.2 requires this list
 * empty except entries whose reason is a named refusal or a niche. Written by \`completeness.ts --write-known\` and
 * then reviewed — never edited to make a run pass.
 */
`

if (import.meta.main) process.exit(await main())
