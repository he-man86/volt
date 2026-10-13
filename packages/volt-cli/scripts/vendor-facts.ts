/**
 * THE ONE VENDOR-FACT PROBE (openspec `vendor-fact-probe`): every row of `vendor-facts.table.ts`, run on its OWN
 * `ide.ps1` instance, diffed against the committed `vendor-facts.<vendor>.json`.
 *
 *   bun scripts/vendor-facts.ts <codesys|twincat> [--write]
 *
 * It starts the IDE itself — `ide.ps1 up -Instance vendor-fact-probe` (or `$VOLT_VENDOR_FACTS_INSTANCE`, so a change
 * runs it on its own instance; never `$VOLT_E2E_INSTANCE`, which names an e2e IDE already up) on a COPY of a
 * committed fixture (CODESYS on the runscript `vendor-facts.codesys.py`, TwinCAT `-Fixture 14`) — and closes it in
 * `finally`. The pipe resolves through
 * `test/e2e/lib/fixture-ide.ts` like every other script: a `VOLT_PIPE` no instance owns is refused, naming it.
 *
 * Each row runs ONE STEP AT A TIME. A `via: "push"` step is one declarative op over the instance's pipe through the
 * shipped bridge (refs, then push with `ifVersion` — what `volt push` sends); every other step and every read goes to
 * the long-lived VENDOR CORE (CODESYS: request files answered on the IDE's UI thread; TwinCAT: one PowerShell process,
 * COM on this instance's XAE, one JSON line each way). The push cannot live in the core: the CODESYS core runs on the
 * thread that serves the pipe, and a pipe call from it deadlocks. TwinCAT's `build` and its diagnostics come from the
 * bridge's own `build` op, because a DTE build out of process leaves every Output pane empty (measured,
 * the deleted `probe-tc-refusal-measure.ps1`) — the one place the runner routes by vendor. Its `diagnostics` read is
 * `{ success, diagnostics }`: the build's own verdict, and every diagnostic that names no item is kept (a failed or
 * unreadable build must never read like a clean one).
 *
 * A push refusal records what LANDED (`[partiallyApplied]`, `[renamedTo …]`, `[remains]`), and a handle exists only for
 * an object a create MADE — so cleanup never deletes an object the row did not create.
 *
 * A step's outcome (`accepted` / `refused: <the vendor's words>`) is DATA. A read that throws, or a request past its
 * timeout, aborts the run naming the fact, the read and the step — a probe bug is never a value.
 *
 * The snapshot: `{ "<fact>": { "steps": [...], "<read key>": value } }`, keys sorted at every level, guids replaced by
 * per-row tokens (`guid-1`, … by first appearance — a fresh object's guid differs every run, its SAMENESS is the fact),
 * no timestamps, pids or addresses. A run diffs against the committed file and exits 1 naming every differing
 * `<fact>.<key>` with both values; `--write` replaces the file (and prints the same list). A change to the snapshot is a
 * DIALECT finding to record.
 */
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { copyRoot, pipePid, scriptPipe, type Vendor } from "../test/e2e/lib/fixture-ide"
import { callOn } from "../test/e2e/lib/pipe"
import { landedInFull } from "../test/e2e/lib/workspace"
import { ROWS, type Read, type Row, type Step } from "./vendor-facts.table"

/**
 * The `ide.ps1` instance the runner `up`s and `down`s: `VOLT_VENDOR_FACTS_INSTANCE`, else its reserved
 * `vendor-fact-probe`. Never `VOLT_E2E_INSTANCE` — that names an e2e IDE that is already UP and only talked to; the
 * runner restarts and closes its instance, so sharing the variable would tear a live e2e IDE down. Set but empty is
 * refused by name (an empty instance is `ide.ps1`'s default one, which the runner must not own either).
 */
export function instanceOf(env: Record<string, string | undefined>): string {
  const named = env.VOLT_VENDOR_FACTS_INSTANCE
  if (named === undefined) return "vendor-fact-probe"
  if (named === "") throw new Error("VOLT_VENDOR_FACTS_INSTANCE is set but empty: name an instance or unset it")
  return named
}
export const INSTANCE = instanceOf(process.env)
const HERE = import.meta.dir
const FIXTURES = join(HERE, "..", "test", "fixtures")
/** The committed fixtures an `open` step may name. Only a committed fixture can be opened (design 0.1). */
const FIXTURE_FILES: Record<string, string> = {
  CodesysTestProject: "CodesysTestProject.project",
  // CodesysTestProject + the IDE-authored bridge-one-to-one objects (scripts/author-one-to-one-fixture.py) — its own
  // file, so the rows measured on CodesysTestProject and the LSP recorders it hosts never see them.
  CodesysOneToOne: "CodesysOneToOne.project",
  Pro2193: "Pro2193-94-95-96_COdesys.project",
}
/** Per-request timeouts. A request past it aborts the run — there is no retry. */
const TIMEOUT_MS = 60_000
const LONG_TIMEOUT_MS = 300_000
const LONG_OPS = new Set(["build", "open", "close", "reload"])

// ── the plan: one vendor's steps and reads ───────────────────────────────────────────────────────────────────────────

/** A read made concrete: one handle, one step, its key in the snapshot. `after` is the plan step index it follows
 *  (-1 = before the first step). */
type Concrete<T> = T extends unknown
  ? Omit<T, "at" | "on"> & { on?: string; after: number; snapshotKey: string }
  : never
export type ConcreteRead = Concrete<Read>
export type Plan = { row: Row; vendor: Vendor; steps: Step[]; reads: Read[] }

export function planRow(row: Row, vendor: Vendor): Plan {
  const mine = (x: { vendor?: Vendor }) => x.vendor === undefined || x.vendor === vendor
  return { row, vendor, steps: row.steps.filter(mine), reads: row.reads.filter(mine) }
}

const list = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

function tagIndex(plan: Plan, tag: string): number | undefined {
  if (tag === "start") return -1
  if (tag === "end") return plan.steps.length - 1
  const i = plan.steps.findIndex((s) => s.tag === tag)
  return i < 0 ? undefined : i
}

/** Every read of the plan, one per (handle, step), in run order. The key gains `.<handle>` when the read names
 *  several handles and `@<tag>` when it runs after several steps. */
export function expandReads(plan: Plan): ConcreteRead[] {
  const out: ConcreteRead[] = []
  for (const r of plan.reads) {
    const ats = list(r.at)
    const ons = list(r.on)
    for (const at of ats)
      for (const on of ons.length ? ons : [undefined]) {
        const { at: _a, on: _o, ...rest } = r
        const after = tagIndex(plan, at)
        if (after === undefined)
          throw new Error(`${plan.row.id}: read \`${r.key}\` is at \`${at}\`, which no step is tagged`)
        const snapshotKey = r.key + (ons.length > 1 ? `.${on}` : "") + (ats.length > 1 ? `@${at}` : "")
        out.push({ ...rest, on, after, snapshotKey })
      }
  }
  return out.sort((a, b) => a.after - b.after)
}

const WRITES = new Set(["setText", "rename", "move", "delete"])
const isBuiltin = (h: string) => h === "root" || h === "home" || h.startsWith("tree:")

/** Every table error, by row and vendor. Empty = the table runs. Checked before any IDE starts. */
export function validateTable(rows: readonly Row[]): string[] {
  const findings: string[] = []
  const ids = new Set<string>()
  for (const row of rows) {
    if (ids.has(row.id)) findings.push(`${row.id}: two rows with this id`)
    ids.add(row.id)
    for (const vendor of ["codesys", "twincat"] as const) {
      if (row.vendors[vendor] !== true) continue
      const plan = planRow(row, vendor)
      const where = `${row.id} (${vendor})`
      const tags = new Map<string, number>()
      const defined = new Map<string, number>()
      plan.steps.forEach((s, i) => {
        if (s.tag) tags.set(s.tag, (tags.get(s.tag) ?? 0) + 1)
        if ((s.op === "create" || WRITES.has(s.op)) && !("via" in s && (s.via === "push" || s.via === "script")))
          findings.push(`${where}: step ${i} ${s.op} has no \`via\` — every write names push or script`)
        const uses = [
          "on" in s ? s.on : undefined,
          s.op === "create" || s.op === "tryNames" ? s.parent : undefined,
          s.op === "move" ? s.to : undefined,
          s.op === "find" ? s.under : undefined,
          s.op === "setText" && s.via === "script" ? s.implFrom : undefined,
        ]
        for (const h of uses)
          if (h !== undefined && !isBuiltin(h) && !(defined.has(h) && defined.get(h)! < i))
            findings.push(`${where}: step ${i} ${s.op} names handle \`${h}\`, which no earlier create/find defines`)
        if (s.op === "create" || s.op === "find") defined.set(s.as, i)
        if (s.op === "tryNames") findings.push(...tryNamesFindings(s, `${where}: step ${i} tryNames`))
        if (s.op === "create" && s.via === "script" && (s.factory || s.vendorClass || s.init)) {
          if (vendor !== "codesys")
            findings.push(`${where}: step ${i} create ${s.as} names a vendor factory or class — CODESYS only`)
          if (s.factory && (s.vendorClass || s.init))
            findings.push(`${where}: step ${i} create ${s.as} names a factory AND a class — one or the other`)
          if (s.init && !s.vendorClass)
            findings.push(`${where}: step ${i} create ${s.as} initializes members without a vendorClass`)
        }
        if (s.op === "create" && s.via === "script" && s.dataType !== undefined && s.kind !== "property")
          findings.push(`${where}: step ${i} create ${s.as} names a data type — only a property create takes one`)
        if (s.op === "open" && !(s.fixture in FIXTURE_FILES))
          findings.push(`${where}: step ${i} opens \`${s.fixture}\`, not a committed fixture this runner knows`)
      })
      for (const [tag, n] of tags) if (n > 1) findings.push(`${where}: tag \`${tag}\` is used by ${n} steps`)
      const keys = new Map<string, number>()
      for (const r of plan.reads) {
        for (const at of list(r.at)) {
          const after = tagIndex(plan, at)
          if (after === undefined) {
            findings.push(`${where}: read \`${r.key}\` is at \`${at}\`, which no step is tagged`)
            continue
          }
          if (r.op === "fetched" && list(r.on).length === 0)
            findings.push(`${where}: read \`${r.key}\` (fetched) names no subject`)
          if (r.op === "tried" && plan.steps[after]?.op !== "tryNames")
            findings.push(`${where}: read \`${r.key}\` (tried) is at \`${at}\`, which is no tryNames step`)
          for (const on of list(r.on))
            if (!isBuiltin(on) && !(defined.has(on) && defined.get(on)! <= after))
              findings.push(`${where}: read \`${r.key}\` names handle \`${on}\`, which no earlier create/find defines`)
        }
        const ats = list(r.at)
        const ons = list(r.on)
        for (const at of ats)
          for (const on of ons.length ? ons : [undefined]) {
            const k = r.key + (ons.length > 1 ? `.${on}` : "") + (ats.length > 1 ? `@${at}` : "")
            keys.set(k, (keys.get(k) ?? 0) + 1)
          }
      }
      for (const [k, n] of keys) if (n > 1) findings.push(`${where}: ${n} reads produce the key \`${k}\``)
    }
  }
  return [...new Set(findings)]
}

/** A tryNames step's own errors: script-only, at least one name, at most 500 (what renders whole), each once. */
function tryNamesFindings(s: Extract<Step, { op: "tryNames" }>, where: string): string[] {
  const out: string[] = []
  if ((s.via as string) !== "script") out.push(`${where} is script-only — a push meets Volt's own pre-flight`)
  if (s.names.length === 0) out.push(`${where} asks no name`)
  if (s.names.length > 500) out.push(`${where} asks ${s.names.length} names — more than 500 do not render whole`)
  const seen = new Set<string>()
  for (const n of s.names) {
    if (seen.has(n.toUpperCase())) out.push(`${where} asks \`${n}\` twice (names compare case-insensitively)`)
    seen.add(n.toUpperCase())
  }
  return out
}

// ── running one row ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One request to a vendor core; the answer is `{ outcome }` for a step, `{ value }` otherwise. */
export type CoreRequest =
  | { kind: "begin"; row: string }
  | { kind: "step"; row: string; step: Step; fixturePath?: string }
  | { kind: "read"; row: string; read: ConcreteRead }
  | { kind: "path"; row: string; on: string }
  | { kind: "adopt"; row: string; as: string; name: string; guid?: string; cls?: string[] }
  | { kind: "cleanup"; row: string }
/** `made`: a create step whose object EXISTS although the step raised (its declaration write threw after the create) —
 *  the subject is kept, so reads reach the object that is there and cleanup removes it. */
export type CoreAnswer = { outcome?: string; value?: unknown; made?: boolean }
/** The bridge's own build (TwinCAT): its `success` and every diagnostic it returned. */
export type BuildOutcome = { success: boolean; diagnostics: unknown[] }

/** What a row needs from the pipe side. */
export interface WireSide {
  step(step: Step, ctx: RowContext): Promise<string>
  build(ctx: RowContext): Promise<BuildOutcome>
  /** The handle's item text as the shipped bridge's `fetch` answers it — what `volt pull` writes. */
  fetched(on: string, ctx: RowContext): Promise<string>
  cleanup(ctx: RowContext): Promise<void>
  /** After the IDE replaced its project (open, close, reload): make the bridge bind the project it now has. */
  rebind?(): Promise<void>
  /** The shipped bridge's own ops, for a runner that addresses items by wire name rather than by a row's handles (the
   *  completeness oracle, openspec bridge-one-to-one 2.1): each waits until a project is served, as the steps do. */
  raw?: {
    refs(): Promise<any>
    fetchText(wire: string): Promise<string>
    push(op: Record<string, unknown>): Promise<any>
  }
}
export type RowDeps = { vendor: Vendor; core: (req: CoreRequest) => Promise<CoreAnswer>; wire: WireSide }

/** What the runner knows of a row's handles — enough to address them on the wire. */
export type HandleInfo = {
  name: string
  kind?: string
  parent?: string
  created: "script" | "push" | "found"
  original?: string
  home?: string
  restored?: boolean
}
export type RowContext = {
  row: Row
  handles: Map<string, HandleInfo>
  core: (req: CoreRequest) => Promise<CoreAnswer>
  /** The last build's outcome, when the wire side built (TwinCAT). */
  build?: BuildOutcome
}

export function stepLabel(s: Step): string {
  if (s.op === "tryNames") return `tryNames ${s.tag ?? ""} (${s.names.length} ${s.kind} names under ${s.parent})`
  const what =
    "as" in s
      ? s.as
      : s.op === "invoke"
        ? s.path
        : "on" in s && s.on !== undefined
          ? s.on
          : s.op === "open"
            ? s.fixture
            : ""
  return `${s.op}${what ? " " + what : ""}${"via" in s && s.via === "push" ? " (push)" : ""}`
}

/** Run one row for one vendor and return its snapshot entry. Cleanup runs on both sides whatever happened. */
export async function runRow(row: Row, deps: RowDeps): Promise<Record<string, unknown> | string> {
  const applies = row.vendors[deps.vendor]
  if (applies === undefined) throw new Error(`${row.id}: not asked of ${deps.vendor}`)
  if (applies !== true) return `absent: ${applies.absent}`
  const plan = planRow(row, deps.vendor)
  const reads = expandReads(plan)
  const ctx: RowContext = { row, handles: new Map(), core: deps.core }
  const outcomes: string[] = []
  const refused = new Map<string, string>()
  const snap: Record<string, unknown> = {}
  const twincatBuild = deps.vendor === "twincat"

  const doReads = async (after: number) => {
    for (const r of reads.filter((x) => x.after === after)) {
      const where = `${row.id}: read \`${r.snapshotKey}\` after ${after < 0 ? "the start" : `step ${after} (${stepLabel(plan.steps[after]!)})`}`
      if (r.on && refused.has(r.on)) {
        snap[r.snapshotKey] = `no subject: ${refused.get(r.on)} was refused`
        continue
      }
      try {
        if (r.op === "absent") snap[r.snapshotKey] = `absent: ${r.reason}`
        else if (r.op === "diagnostics" && twincatBuild) snap[r.snapshotKey] = bridgeDiagnostics(ctx, r.mentioning)
        else if (r.op === "fetched") snap[r.snapshotKey] = await deps.wire.fetched(r.on!, ctx)
        else if (r.op === "diagnostics")
          snap[r.snapshotKey] = asSet((await deps.core({ kind: "read", row: row.id, read: r })).value)
        else snap[r.snapshotKey] = (await deps.core({ kind: "read", row: row.id, read: r })).value ?? null
      } catch (e) {
        throw new Error(`${where}: ${(e as Error).message}`, { cause: e })
      }
    }
  }

  let failed: Error | undefined
  try {
    await deps.core({ kind: "begin", row: row.id })
    await doReads(-1)
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i]!
      const label = stepLabel(s)
      let outcome: string
      let made = false
      try {
        if ("via" in s && s.via === "push") outcome = await deps.wire.step(s, ctx)
        else if (s.op === "build" && twincatBuild) {
          // The build call itself was answered; whether it compiled is `success`, recorded by the diagnostics read.
          ctx.build = await deps.wire.build(ctx)
          outcome = "accepted"
        } else {
          const a = await deps.core({
            kind: "step",
            row: row.id,
            step: s,
            fixturePath: s.op === "open" ? fixtureCopy(deps.vendor, s.fixture) : undefined,
          })
          outcome = a.outcome ?? "accepted"
          made = s.op === "create" && outcome !== "accepted" && a.made === true
          if (made) outcome += " (the object was made)"
        }
      } catch (e) {
        throw new Error(`${row.id}: step ${i} (${label}): ${(e as Error).message}`, { cause: e })
      }
      if (s.op === "create" || s.op === "find") {
        if (outcome === "accepted" || made) {
          const prev = ctx.handles.get(s.as)
          ctx.handles.set(s.as, {
            name: s.name,
            kind: s.op === "create" ? s.kind : prev?.kind,
            parent: s.op === "create" ? s.parent : undefined,
            created: s.op === "find" ? "found" : s.via,
          })
          refused.delete(s.as)
          // A push-created object is adopted by the core, so reads reach it.
          if (s.op === "create" && s.via === "push")
            await deps.core({ kind: "adopt", row: row.id, as: s.as, name: s.name })
        } else refused.set(s.as, label)
      }
      if (s.op === "rename" && outcome === "accepted") ctx.handles.get(s.on)!.name = s.to
      if ((s.op === "open" || s.op === "reload") && deps.wire.rebind) await deps.wire.rebind()
      outcomes.push(`${label}: ${outcome}`)
      await doReads(i)
    }
  } catch (e) {
    failed = e as Error
  }
  // Cleanup runs on both sides whatever happened; a cleanup failure never hides the failure that came first.
  const cleanupErrors: string[] = []
  for (const clean of [() => deps.wire.cleanup(ctx), () => deps.core({ kind: "cleanup", row: row.id })])
    try {
      await clean()
    } catch (e) {
      cleanupErrors.push((e as Error).message)
    }
  if (failed && cleanupErrors.length)
    throw new Error(`${failed.message} — and its cleanup failed too: ${cleanupErrors.join("; ")}`)
  if (failed) throw failed
  if (cleanupErrors.length) throw new Error(`${row.id}: cleanup failed: ${cleanupErrors.join("; ")}`)
  return canonicalGuids({ steps: outcomes, ...snap }) as Record<string, unknown>
}

/** A build's messages are a SET: CODESYS lists one build's messages in a different order run to run (measured
 *  2026-10-11: 744 messages, the same multiset, two orders), so the order is not a fact and is not recorded — sorted
 *  as TwinCAT's are. A value that is not a list is a probe fault, never a set of nothing. */
function asSet(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`a diagnostics read answered ${JSON.stringify(value)}, not a list`)
  return (
    value
      // Keyed WITHOUT guid values: a fresh object's guid differs every run, so ordering by it would reorder the list,
      // and with it the per-row guid tokens handed out by first appearance.
      .map(
        (d) =>
          [JSON.stringify(sortDeep(d), (_k, v) => (v && typeof v === "object" && "$guid" in v ? "" : v)), d] as const,
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, d]) => d)
  )
}

/** TwinCAT's build, from the bridge: its `success`, and the diagnostics that name one of the row's subjects, name NO
 *  item (an unresolved file, or the bridge's own "this list is INCOMPLETE" — dropping those made a failed build read
 *  like a clean one), or — with `mentioning` — mention that word (a user of a changed type, on an item the row did not
 *  make). */
function bridgeDiagnostics(ctx: RowContext, mentioning: string | undefined): BuildOutcome {
  if (!ctx.build) throw new Error("no build has run in this row")
  const names = new Set([...ctx.handles.values()].map((h) => h.name.toLowerCase()))
  const word = mentioning?.toLowerCase()
  const diagnostics = ctx.build.diagnostics
    .filter(
      (d: any) =>
        d.name == null ||
        names.has(
          String(d.name)
            .replace(/\.[^.]*$/, "")
            .toLowerCase(),
        ) ||
        (word !== undefined &&
          String(d.message ?? "")
            .toLowerCase()
            .includes(word)),
    )
    .map((d: any) => ({
      code: d.code ?? null,
      member: d.member ?? null,
      message: d.message,
      name: d.name ?? null,
      severity: d.severity,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { success: ctx.build.success, diagnostics }
}

// ── the snapshot ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `{ "$guid": "…" }` → `guid-<n>`, numbered by first appearance in the value. */
export function canonicalGuids(value: unknown): unknown {
  const seen = new Map<string, string>()
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      if (Object.keys(o).length === 1 && typeof o.$guid === "string") {
        const g = o.$guid.toLowerCase()
        if (!seen.has(g)) seen.set(g, `guid-${seen.size + 1}`)
        return seen.get(g)
      }
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]))
    }
    return v
  }
  return walk(value)
}

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    )
  return value
}

/** Every `<fact>.<key>` (or `<fact>` for a non-object entry) whose value differs, with both values. Sorted. */
export function diffSnapshots(committed: Record<string, unknown>, measured: Record<string, unknown>): string[] {
  const flat = (s: Record<string, unknown>) => {
    const m = new Map<string, string>()
    for (const [fact, v] of Object.entries(s))
      if (v && typeof v === "object" && !Array.isArray(v))
        for (const [k, x] of Object.entries(v as Record<string, unknown>))
          m.set(`${fact}.${k}`, JSON.stringify(sortDeep(x)))
      else m.set(fact, JSON.stringify(sortDeep(v)))
    return m
  }
  const a = flat(committed)
  const b = flat(measured)
  const out: string[] = []
  for (const k of new Set([...a.keys(), ...b.keys()]))
    if (a.get(k) !== b.get(k)) out.push(`${k}: committed ${a.get(k) ?? "(none)"} / measured ${b.get(k) ?? "(none)"}`)
  return out.sort()
}

// ── the live sides ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A fresh copy of a committed fixture, under this instance's copy root (so the instance's resolver still owns it). */
export function fixtureCopy(vendor: Vendor, fixture: string): string {
  const file = FIXTURE_FILES[fixture]
  if (!file) throw new Error(`no committed fixture '${fixture}'`)
  const dir = join(copyRoot(tmpdir(), vendor, INSTANCE), "vendor-facts")
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, `${fixture}-${Date.now()}${file.slice(file.lastIndexOf("."))}`)
  copyFileSync(join(FIXTURES, file), dst)
  return dst
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000} s`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** A cleanup may reopen the run's own copy, so it gets the long timeout too. A tryNames step asks every name it holds:
 *  60 s plus 5 s a name (TwinCAT took ~1.8 s an ask, through the push, in the 2026-10-03 logs). */
export const requestTimeout = (req: CoreRequest) =>
  req.kind === "step" && req.step.op === "tryNames"
    ? TIMEOUT_MS + 5_000 * req.step.names.length
    : (req.kind === "step" && LONG_OPS.has(req.step.op)) ||
        req.kind === "cleanup" ||
        // The completeness oracle's whole-project reads: every object of a 3363-object project (Pro2193) is minutes.
        (req.kind === "read" && (req.read.op === "objects" || req.read.op === "archive"))
      ? LONG_TIMEOUT_MS
      : TIMEOUT_MS

/** A request as the cores read it: JSON in ASCII, every other character a `\uXXXX` escape. The CODESYS core is
 *  IronPython 2.7 reading a file, the TwinCAT core PowerShell reading a console line in the OEM code page — a name like
 *  `Fööbar` (C28) must arrive as itself, not as whatever the reader decodes its bytes to. */
export const asciiJson = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))

/** The visible top-level window titles a process owns — what names a modal dialog that stopped the UI thread. */
export function windowsOf(pid: number): string {
  const ps =
    'Add-Type -Namespace VF -Name W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr p); ' +
    'public delegate bool EnumProc(System.IntPtr h, System.IntPtr p); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); ' +
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);\'; ' +
    `$out = New-Object System.Collections.ArrayList; [VF.W]::EnumWindows({ param($h, $p) [uint32]$o = 0; [void][VF.W]::GetWindowThreadProcessId($h, [ref]$o); ` +
    `if ($o -eq ${pid} -and [VF.W]::IsWindowVisible($h)) { $sb = New-Object System.Text.StringBuilder 256; [void][VF.W]::GetWindowText($h, $sb, 256); [void]$out.Add($sb.ToString()) }; $true }, [IntPtr]::Zero) | Out-Null; $out -join ' | '`
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    timeout: 30_000,
  })
  return (r.stdout ?? "").trim() || `unreadable (${(r.stderr ?? "").trim().split("\n")[0]})`
}

/** The CODESYS core: request files in `%LOCALAPPDATA%\volt-bridge\vendor-facts\<pid>\`, answered on the IDE's UI
 *  thread by `vendor-facts.codesys.py`. */
export function codesysCore(pid: number): { request: (req: CoreRequest) => Promise<CoreAnswer>; ready: () => Promise<void> } {
  const dir = join(process.env.LOCALAPPDATA ?? "", "volt-bridge", "vendor-facts", String(pid))
  let seq = 0
  const wait = async (file: string, ms: number, what: string) => {
    const until = Date.now() + ms
    while (!existsSync(file)) {
      if (Date.now() > until) throw new Error(`${what}: no answer within ${ms / 1000} s`)
      await Bun.sleep(100)
    }
  }
  return {
    ready: () => wait(join(dir, "ready"), LONG_TIMEOUT_MS, "the CODESYS core never armed"),
    async request(req) {
      const n = String(++seq)
      const tmp = join(dir, "request.tmp")
      writeFileSync(tmp, asciiJson({ seq: n, ...req }))
      renameSync(tmp, join(dir, "request"))
      const done = join(dir, `${n}.done`)
      const error = join(dir, `${n}.error`)
      const until = Date.now() + requestTimeout(req)
      while (!existsSync(done)) {
        if (existsSync(error)) throw new Error(readFileSync(error, "utf8").trim())
        if (Date.now() > until)
          throw new Error(
            `the CODESYS core did not answer ${req.kind} within ${requestTimeout(req) / 1000} s (windows of CODESYS ${pid}: ${windowsOf(pid)})`,
          )
        await Bun.sleep(100)
      }
      // The answer files stay: the core may still hold `.done` open for a moment, and the directory is per-pid and
      // cleared when the core arms.
      return JSON.parse(readFileSync(join(dir, `${n}.out`), "utf8")) as CoreAnswer
    },
  }
}

/** The TwinCAT core: ONE PowerShell process for the session, one JSON request per stdin line, one answer per stdout
 *  line marked `@@vf ` (anything else it prints is log). */
export function twincatCore(xaePid: number) {
  const ps = spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(HERE, "vendor-facts.twincat.ps1"),
      "-XaePid",
      String(xaePid),
      "-Instance",
      INSTANCE,
    ],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  )
  let buf = ""
  const waiting: ((line: string) => void)[] = []
  ps.stdout.setEncoding("utf8")
  ps.stdout.on("data", (d: string) => {
    buf += d
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "")
      buf = buf.slice(nl + 1)
      if (line.startsWith("@@vf ")) waiting.shift()?.(line.slice(5))
      else if (line.trim()) console.log(`  [twincat core] ${line}`)
    }
  })
  const next = (what: string, ms: number) =>
    withTimeout(new Promise<string>((resolve) => waiting.push(resolve)), ms, what)
  let seq = 0
  return {
    ready: async () => {
      const first = JSON.parse(await next("the TwinCAT core never armed", LONG_TIMEOUT_MS))
      if (first.error) throw new Error(first.error)
    },
    async request(req: CoreRequest): Promise<CoreAnswer> {
      const n = ++seq
      const answer = next(`the TwinCAT core did not answer ${req.kind}`, requestTimeout(req))
      ps.stdin.write(asciiJson({ seq: n, ...req }) + "\n")
      const a = JSON.parse(await answer)
      if (a.seq !== n) throw new Error(`the TwinCAT core answered request ${a.seq} to request ${n}`)
      if (a.error) throw new Error(a.error)
      return a as CoreAnswer
    },
    stop: () => {
      ps.stdin.end()
      ps.kill()
    },
  }
}

/** What the pipe side calls: one op on the instance's pipe. Injected so the side runs offline against a fake bridge. */
export type PipeCall = (op: string, body?: unknown) => Promise<any>
/** The serving states the contract names (`HealthStatus`): `idle` = detected, not served; the other two = served. */
const SERVED = new Set(["healthy", "degraded"])

/** One push's answer as the step's outcome: `accepted`, or `refused: <code>: <reason>` per conflict with what LANDED
 *  marked — `[partiallyApplied]`, `[renamedTo <full name>]`, `[remains]` — so a refusal after part of the op landed never
 *  reads like a clean one. */
export function pushOutcome(p: any): string {
  if (landedInFull(p)) return "accepted"
  const conflicts = (p?.conflicts ?? []) as any[]
  if (conflicts.length === 0) return `refused: (no conflict given) ${JSON.stringify(p)}`
  return (
    "refused: " +
    conflicts
      .map(
        (c) =>
          `${c.code}: ${c.reason}` +
          (c.partiallyApplied ? " [partiallyApplied]" : "") +
          (c.renamedTo ? ` [renamedTo ${c.renamedTo}]` : "") +
          (c.remains ? " [remains]" : ""),
      )
      .join(" | ")
  )
}

/** The pipe side: every `via: "push"` write is one op through the shipped bridge, and TwinCAT's build. */
export function wireSide(
  pipe: string,
  opts: { call?: PipeCall; sleep?: (ms: number) => Promise<void>; serveTimeoutMs?: number } = {},
): WireSide {
  const call: PipeCall = opts.call ?? ((op, body) => callOn(pipe, op, body))
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms))
  const serveTimeoutMs = opts.serveTimeoutMs ?? LONG_TIMEOUT_MS
  const refs = () => withTimeout(call("refs"), TIMEOUT_MS, "refs")
  /** Wait until a project is served, asking the bridge to connect the one it lists. Every failure on the way is kept and
   *  retried, and the timeout names the last one; a status the contract does not name is refused at once. `reconnect`
   *  connects once even when health already reads served (the project behind it was replaced). */
  const serving = async (reconnect = false) => {
    const until = Date.now() + serveTimeoutMs
    let last = "no health answer yet"
    let mustConnect = reconnect
    for (;;) {
      let rows: any[] | undefined
      try {
        rows = ((await withTimeout(call("health"), TIMEOUT_MS, "health"))?.projects ?? []) as any[]
      } catch (e) {
        last = `health: ${(e as Error).message}`
      }
      if (rows) {
        for (const p of rows)
          if (p.status !== "idle" && !SERVED.has(p.status))
            throw new Error(`health: project '${p.project}' has status '${p.status}', which the contract does not name`)
        if (!mustConnect && rows.some((p) => SERVED.has(p.status))) return
        const project = (rows.find((p) => SERVED.has(p.status)) ?? rows[0])?.project
        if (!project) last = "health lists no project"
        else
          try {
            await withTimeout(call("connect", { project }), LONG_TIMEOUT_MS, "connect")
            mustConnect = false
            last = `connect ${project}: answered, but the project is still idle`
          } catch (e) {
            last = `connect ${project}: ${(e as Error).message}`
          }
      }
      if (Date.now() >= until) throw new Error(`the bridge on ${pipe} never served a project again (last: ${last})`)
      await sleep(1500)
    }
  }
  /** The item's FULL wire name: its bare name with a source extension, exactly one. */
  const wireName = (r: any, name: string) => {
    const hits = Object.keys(r.items ?? {}).filter(
      (k) => /\.(pou|itf|gvl|dut)$/.test(k) && k.slice(0, k.lastIndexOf(".")) === name,
    )
    if (hits.length !== 1) throw new Error(`refs names ${hits.length} source item(s) '${name}.*' (${hits.join(", ")})`)
    return hits[0]!
  }
  const folderOf = async (ctx: RowContext, handle: string, r: any): Promise<string> => {
    const h = ctx.handles.get(handle)
    if (handle !== "root" && !h) throw new Error(`no handle '${handle}'`)
    if (handle === "root" || h!.kind === "folder")
      return ((await ctx.core({ kind: "path", row: ctx.row.id, on: handle })).value as string[]).join("/")
    if (!h) throw new Error("unreachable")
    return r.folders[wireName(r, h.name)] ?? ""
  }
  const push = async (op: Record<string, unknown>): Promise<any> => {
    await serving()
    const r = await refs()
    return withTimeout(call("push", { expectedProjectVersion: r.projectVersion, ops: [op] }), LONG_TIMEOUT_MS, "push")
  }
  const fetchText = async (wire: string) => {
    const f = await withTimeout(call("fetch", { knownItems: {}, onlyItems: [wire] }), TIMEOUT_MS, "fetch")
    const it = (f.changed ?? []).find((i: any) => i.name === wire)
    if (typeof it?.sourceText !== "string") throw new Error(`fetch returned no text for ${wire}`)
    return it.sourceText as string
  }
  /** A native rename that ran before a refusal stays: the handle follows the item to its new name. */
  const follow = (h: HandleInfo, p: any) => {
    for (const c of (p?.conflicts ?? []) as any[])
      if (typeof c.renamedTo === "string") h.name = c.renamedTo.slice(0, c.renamedTo.lastIndexOf("."))
  }
  const EXT: Record<string, string> = { dut: "dut", gvl: "gvl", interface: "itf" }
  const onHandle = async (s: Step, ctx: RowContext, r: any, h: HandleInfo, wire: string): Promise<any> => {
    const ifVersion = r.items[wire]
    switch (s.op) {
      case "setText": {
        if (s.via !== "push") throw new Error("unreachable")
        const current = await fetchText(wire)
        if (h.original === undefined) h.original = current
        let text: string
        if (s.restore) {
          text = h.original
          h.restored = true
        } else if (s.source !== undefined) text = s.source
        else if (s.prepend !== undefined) text = s.prepend + current
        else if (s.after !== undefined) {
          const lines = current.split("\n")
          const at = lines.findIndex((l) => l.replace(/\r$/, "") === s.after!.line)
          if (at < 0) throw new Error(`${wire} has no line '${s.after.line}'`)
          lines.splice(at + 1, 0, s.after.add)
          text = lines.join("\n")
        } else throw new Error("setText via push names no source, prepend, after or restore")
        return push({ op: "set", name: wire, sourceText: text, ifVersion })
      }
      case "rename":
        return push({ op: "set", name: wire, toName: `${s.to}${wire.slice(wire.lastIndexOf("."))}`, ifVersion })
      case "move":
        return push({
          op: "set",
          name: wire,
          toFolder: s.to === "home" ? h.home : await folderOf(ctx, s.to, r),
          ifVersion,
        })
      case "delete":
        return push({ op: "deleteItem", name: wire, ifVersion })
      default:
        throw new Error(`${s.op} has no push form`)
    }
  }
  return {
    raw: {
      refs: async () => {
        await serving()
        return refs()
      },
      fetchText: async (wire) => {
        await serving()
        return fetchText(wire)
      },
      push,
    },
    async step(s, ctx) {
      await serving()
      const r = await refs()
      if (s.op === "create" && s.via === "push") {
        const toFolder = await folderOf(ctx, s.parent, r)
        const p = await push({
          op: "set",
          name: `${s.name}.${EXT[s.kind] ?? "pou"}`,
          toFolder,
          sourceText: s.source,
          ifVersion: null,
        })
        // A handle only for an object this create MADE: one that landed, or one whose rollback failed (`remains`). A
        // create refused because the name was taken made nothing — a handle would have cleanup delete the object that
        // already had the name.
        if (landedInFull(p) || ((p?.conflicts ?? []) as any[]).some((c) => c.remains))
          ctx.handles.set(s.as, { name: s.name, kind: s.kind, parent: s.parent, created: "push" })
        return pushOutcome(p)
      }
      if (!("on" in s) || s.on === undefined) throw new Error(`${s.op} via push names no handle`)
      const h = ctx.handles.get(s.on)
      if (!h) throw new Error(`no handle '${s.on}'`)
      const wire = wireName(r, h.name)
      if (h.home === undefined) h.home = r.folders[wire] ?? ""
      const p = await onHandle(s, ctx, r, h, wire)
      follow(h, p)
      return pushOutcome(p)
    },
    async rebind() {
      // A solution reload leaves the TwinCAT worker on dead COM handles (measured: the next refs answered
      // INTERNAL_ERROR COMException); a `connect` to the project the IDE now has re-resolves it. Right after a CODESYS
      // `open`, health may still name a project the IDE no longer has (measured 2026-10-11: PLC_DISCONNECTED), so the
      // connect is retried like any other wait to be served, and a timeout names the last refusal.
      await serving(true)
    },
    async fetched(on, ctx) {
      const h = ctx.handles.get(on)
      if (!h) throw new Error(`no handle '${on}'`)
      await serving()
      return fetchText(wireName(await refs(), h.name))
    },
    async build() {
      await serving()
      const b = await withTimeout(call("build", {}), LONG_TIMEOUT_MS, "build")
      if (typeof b?.success !== "boolean")
        throw new Error(`the bridge's build answered no success: ${JSON.stringify(b)}`)
      return { success: b.success, diagnostics: (b.diagnostics ?? []) as unknown[] }
    },
    async cleanup(ctx) {
      // What the push side made or changed: push-created items, and found items whose text a push changed and the
      // row did not restore. Nothing to do asks nothing (a row may end with no project open).
      const todo = [...ctx.handles.values()]
        .reverse()
        .filter((h) => h.created === "push" || (h.created === "found" && h.original !== undefined && !h.restored))
      if (todo.length === 0) return
      await serving()
      for (const h of todo) {
        const r = await refs()
        if (!Object.keys(r.items ?? {}).some((k) => k.slice(0, k.lastIndexOf(".")) === h.name)) continue
        const w = wireName(r, h.name)
        const p = await push(
          h.created === "push"
            ? { op: "deleteItem", name: w, ifVersion: r.items[w] }
            : { op: "set", name: w, sourceText: h.original, ifVersion: r.items[w] },
        )
        if (!landedInFull(p)) throw new Error(`cleanup of ${w}: ${pushOutcome(p)}`)
      }
    },
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `codesysFixture`: the committed CODESYS fixture `up` serves (a `FIXTURE_FILES` name) — `ide.ps1`'s own default,
 *  CodesysTestProject, when omitted. The completeness oracle serves `CodesysOneToOne`. */
export function ide(action: "up" | "down", vendor: Vendor, codesysFixture?: string): void {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(HERE, "ide.ps1"),
    action,
    "-Vendor",
    vendor,
    "-Instance",
    INSTANCE,
  ]
  if (action === "up") {
    if (vendor === "codesys") {
      args.push("-RunScript", join(HERE, "vendor-facts.codesys.py"))
      if (codesysFixture !== undefined) {
        const file = FIXTURE_FILES[codesysFixture]
        if (!file) throw new Error(`no committed fixture '${codesysFixture}'`)
        args.push("-Fixture", join(FIXTURES, file))
      }
    }
    else args.push("-Fixture", "14")
    args.push("-Wait")
  }
  const r = spawnSync("powershell", args, { stdio: "inherit", timeout: 900_000 })
  if (r.status !== 0)
    throw new Error(`ide.ps1 ${action} -Vendor ${vendor} -Instance ${INSTANCE} failed (exit ${r.status ?? r.error})`)
}

export const snapshotPath = (vendor: Vendor) => join(HERE, `vendor-facts.${vendor}.json`)

const USAGE = "usage: bun scripts/vendor-facts.ts <codesys|twincat> [--write] [--only <fact>,<fact>…]"

/** The command line. `--only` runs, compares and writes only the named facts (the rest of the committed snapshot is
 *  kept) — for working on a row; a full run is the check. */
export function parseArgs(argv: string[]): { vendor: Vendor; write: boolean; only: string[] | undefined } {
  let vendor: Vendor | undefined
  let write = false
  let only: string[] | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--write") write = true
    else if (a === "--only") only = (argv[++i] ?? "").split(",").filter(Boolean)
    else if ((a === "codesys" || a === "twincat") && vendor === undefined) vendor = a
    else throw new Error(USAGE)
  }
  if (!vendor) throw new Error(USAGE)
  for (const f of only ?? []) {
    const row = ROWS.find((r) => r.id === f)
    if (!row) throw new Error(`--only: no row \`${f}\` in vendor-facts.table.ts`)
    if (row.vendors[vendor] === undefined) throw new Error(`--only: \`${f}\` is not asked of ${vendor}`)
  }
  return { vendor, write, only: only?.length ? only : undefined }
}

/** The snapshot a run stands for: the measured one, or — with `--only` — the committed one with those facts replaced. */
export function mergeSnapshot(
  committed: Record<string, unknown>,
  measured: Record<string, unknown>,
  only: string[] | undefined,
): Record<string, unknown> {
  if (!only) return measured
  const out = { ...committed }
  for (const f of only) out[f] = measured[f]
  return out
}

/** The IDE a snapshot stands for (design 3): CODESYS 3.5 SP21, TwinCAT 3.1 in TcXaeShell — and, once a snapshot is
 *  committed, exactly the BUILD it was recorded on (`committed` = its `ide-identity` fact). Another IDE is refused BEFORE
 *  a row runs: its answers are never recorded, and never diffed against the committed ones as if the vendor had changed.
 *  Recording another build is a deliberate act (move the snapshot aside, `--write`), never a side effect of a run.
 *  `identity` is the measured `ide-identity` fact. */
export function refuseIdeVersion(vendor: Vendor, identity: unknown, committed?: unknown): string | undefined {
  type Id = {
    exe?: { exe?: string; ProductVersion?: string; DteVersion?: string }
    automation?: { TcRemoteManagerVersion?: string }
  }
  const id = identity as Id
  const unread = `ide-identity did not answer an exe version: ${JSON.stringify(identity)}`
  if (typeof id !== "object" || id === null || !id.exe?.exe) return unread
  const file = basename(snapshotPath(vendor))
  const was = committed as Id | undefined
  if (vendor === "codesys") {
    const v = id.exe.ProductVersion
    if (!v) return unread
    if (!/^3\.5\.21\./.test(v)) return `CODESYS ${v} is not 3.5 SP21 — the snapshot is SP21's; refused, never recorded`
    const w = was?.exe?.ProductVersion
    return w === undefined || w === v
      ? undefined
      : `CODESYS ${v} is not ${w}, the build ${file} was recorded on — refused, never diffed; to record this IDE, ` +
          "move the snapshot aside and run --write deliberately"
  }
  const v = id.automation?.TcRemoteManagerVersion
  if (!v) return unread
  if (!/^3\.1\./.test(v) || id.exe.exe !== "TcXaeShell.exe")
    return `TwinCAT ${v} in ${id.exe.exe} is not TwinCAT 3.1 in TcXaeShell — refused, never recorded`
  if (was === undefined) return undefined
  const shell = (x: Id) => `${x.automation?.TcRemoteManagerVersion} in ${x.exe?.exe} ${x.exe?.DteVersion}`
  return shell(id) === shell(was)
    ? undefined
    : `TwinCAT ${shell(id)} is not ${shell(was)}, the build ${file} was recorded on — refused, never diffed; to ` +
        "record this IDE, move the snapshot aside and run --write deliberately"
}

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error((e as Error).message)
    return 2
  }
  const { vendor, write, only } = args
  const findings = validateTable(ROWS)
  if (findings.length) {
    console.error("the table does not run:\n  " + findings.join("\n  "))
    return 1
  }
  // A VOLT_PIPE the instance does not own is refused BEFORE anything starts (spec: "a pipe the instance does not own").
  if (process.env.VOLT_PIPE) scriptPipe(vendor, process.env.VOLT_PIPE, INSTANCE)

  ide("up", vendor)
  let stopCore = () => {}
  try {
    const pipe = scriptPipe(vendor, process.env.VOLT_PIPE, INSTANCE)
    const pid = pipePid(pipe, vendor)!
    console.log(`[vendor-facts] ${vendor} on ${pipe}`)
    let request: (req: CoreRequest) => Promise<CoreAnswer>
    if (vendor === "codesys") {
      const core = codesysCore(pid)
      await core.ready()
      request = core.request
    } else {
      const core = twincatCore(pid)
      stopCore = core.stop
      await core.ready()
      request = core.request
    }
    const wire = wireSide(pipe)
    // The IDE first, on every run (an --only run too): another version is refused before any row runs.
    const identity = await runRow(ROWS.find((r) => r.id === "ide-identity")!, { vendor, core: request, wire })
    const path = snapshotPath(vendor)
    const committed = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {}
    const refused = refuseIdeVersion(vendor, identity, committed["ide-identity"])
    if (refused) {
      console.error(`[vendor-facts] ${refused}`)
      return 1
    }
    const measured: Record<string, unknown> = {}
    for (const row of ROWS) {
      if (row.vendors[vendor] === undefined || (only && !only.includes(row.id))) continue
      if (row.id === "ide-identity") {
        measured[row.id] = identity
        continue
      }
      const t0 = Date.now()
      measured[row.id] = await runRow(row, { vendor, core: request, wire })
      console.log(`[vendor-facts] ${row.id}: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      if (process.env.VOLT_FACTS_VERBOSE) console.log(JSON.stringify(sortDeep(measured[row.id]), null, 1))
    }
    const snapshot = sortDeep(mergeSnapshot(committed, measured, only)) as Record<string, unknown>
    const diff = diffSnapshots(committed, snapshot)
    for (const d of diff) console.log(`  ${d}`)
    if (write) {
      writeFileSync(path, JSON.stringify(snapshot, null, "\t") + "\n")
      console.log(`[vendor-facts] wrote ${basename(path)} (${diff.length} difference(s) from what was committed)`)
      return 0
    }
    if (!existsSync(path)) {
      console.error(`[vendor-facts] no committed ${basename(path)} — record one with --write`)
      return 1
    }
    console.log(
      `[vendor-facts] ${diff.length === 0 ? "every fact as committed" : `${diff.length} fact(s) differ from ${basename(path)}`}`,
    )
    return diff.length === 0 ? 0 : 1
  } finally {
    stopCore()
    ide("down", vendor)
  }
}

if (import.meta.main) process.exit(await main())
