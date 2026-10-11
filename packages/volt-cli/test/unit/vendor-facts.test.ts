/**
 * The vendor-fact runner's logic, offline (openspec `vendor-fact-probe` 2.3): the table is well-formed for each vendor,
 * a row runs step by step with each read after the step it names, every step's outcome is data, a vendor that lacks a
 * fact is recorded by name, the snapshot is sorted with per-row guid tokens, and the diff names the fact and both
 * values. The vendor cores and the pipe are fakes here; the live run is task 3.1.
 */
import { describe, expect, it } from "bun:test"
import { ROWS, type Row, type Step } from "../../scripts/vendor-facts.table"
import {
  canonicalGuids,
  diffSnapshots,
  expandReads,
  mergeSnapshot,
  parseArgs,
  planRow,
  refuseIdeVersion,
  runRow,
  sortDeep,
  validateTable,
  wireSide,
  type RowContext,
  type RowDeps,
  asciiJson,
  requestTimeout,
  type CoreRequest,
  instanceOf,
} from "../../scripts/vendor-facts"

const row = (r: Partial<Row>): Row => ({
  id: "t",
  dialect: ["C2e"],
  vendors: { codesys: true, twincat: true },
  steps: [],
  reads: [],
  ...r,
})

describe("the table", () => {
  it("is well-formed for both vendors", () => {
    expect(validateTable(ROWS)).toEqual([])
  })

  it("names a write without a path, an unknown handle, an unknown tag and a duplicate key", () => {
    const bad = row({
      steps: [
        { op: "create", as: "a", kind: "folder", name: "A", parent: "root", via: "script" },
        // @ts-expect-error — a write with no `via` is a table error the type system and the validator both refuse
        { tag: "x", op: "delete", on: "a" },
        { tag: "x", op: "build" },
      ],
      reads: [
        { key: "k", at: "x", on: "nope", op: "guid" },
        { key: "k", at: "missing", op: "children", on: "a" },
        { key: "k2", at: ["x"], on: "a", op: "guid" },
        { key: "k2", at: "x", on: "a", op: "parent" },
      ],
    })
    const findings = validateTable([bad])
    expect(findings).toContain("t (codesys): step 1 delete has no `via` — every write names push or script")
    expect(findings).toContain("t (codesys): tag `x` is used by 2 steps")
    expect(findings).toContain("t (codesys): read `k` names handle `nope`, which no earlier create/find defines")
    expect(findings).toContain("t (codesys): read `k` is at `missing`, which no step is tagged")
    expect(findings).toContain("t (codesys): 2 reads produce the key `k2`")
  })

  it("refuses a read on a handle only the other vendor's steps define", () => {
    const r = row({
      steps: [
        {
          vendor: "twincat",
          tag: "made",
          op: "create",
          as: "x",
          kind: "folder",
          name: "X",
          parent: "root",
          via: "script",
        },
      ],
      reads: [{ key: "g", at: "end", on: "x", op: "guid" }],
    })
    expect(validateTable([r])).toContain("t (codesys): read `g` names handle `x`, which no earlier create/find defines")
  })
})

describe("planning a row", () => {
  it("keeps only the vendor's steps and reads and spells one key per (handle, step)", () => {
    const r = row({
      steps: [
        { tag: "a", op: "create", as: "x", kind: "folder", name: "X", parent: "root", via: "script" },
        { vendor: "twincat", tag: "b", op: "reload" },
        { tag: "c", op: "build" },
      ],
      reads: [
        { key: "guid", at: ["a", "c"], on: ["x", "root"], op: "guid" },
        { vendor: "twincat", key: "t", at: "b", on: "x", op: "children" },
      ],
    })
    const plan = planRow(r, "codesys")
    expect(plan.steps.map((s) => s.op)).toEqual(["create", "build"])
    expect(expandReads(plan).map((x) => `${x.after} ${x.snapshotKey}`)).toEqual([
      "0 guid.x@a",
      "0 guid.root@a",
      "1 guid.x@c",
      "1 guid.root@c",
    ])
    expect(expandReads(planRow(r, "twincat")).map((x) => `${x.after} ${x.snapshotKey}`)).toContain("1 t")
  })
})

describe("running a row", () => {
  function fake(answers: { outcome?: (i: number) => string; read?: (op: string, on?: string) => unknown } = {}) {
    const log: string[] = []
    let n = 0
    const deps: RowDeps = {
      vendor: "codesys",
      core: async (req) => {
        log.push(
          `core ${req.kind}${req.kind === "step" ? " " + req.step.op : req.kind === "read" ? " " + req.read.op : ""}`,
        )
        if (req.kind === "step") return { outcome: answers.outcome?.(n++) ?? "accepted" }
        if (req.kind === "read") return { value: answers.read?.(req.read.op, req.read.on) ?? null }
        if (req.kind === "path") return { value: ["Device", "Application"] }
        return { value: null }
      },
      wire: {
        step: async (step) => {
          log.push(`push ${step.op}`)
          return "accepted"
        },
        build: async () => ({ success: true, diagnostics: [] }),
        cleanup: async () => {
          log.push("push cleanup")
        },
      },
    }
    return { deps, log }
  }

  it("runs each read after its step, records every outcome, and cleans up both sides", async () => {
    const { deps, log } = fake({ read: (op) => (op === "guid" ? { $guid: "AAAA" } : ["A"]) })
    const r = row({
      steps: [
        { tag: "made", op: "create", as: "x", kind: "folder", name: "X", parent: "root", via: "script" },
        { tag: "pushed", op: "setText", on: "x", via: "push", source: "TYPE X : INT;\nEND_TYPE\n" },
      ],
      reads: [
        { key: "guid", at: ["made", "pushed"], on: "x", op: "guid" },
        { key: "kids", at: "end", on: "x", op: "children" },
      ],
    })
    const snap = await runRow(r, deps)
    expect(log).toEqual([
      "core begin",
      "core step create",
      "core read guid",
      "push setText",
      "core read guid",
      "core read children",
      "push cleanup",
      "core cleanup",
    ])
    expect(snap).toEqual({
      steps: ["create x: accepted", "setText x (push): accepted"],
      "guid@made": "guid-1",
      "guid@pushed": "guid-1",
      kids: ["A"],
    })
  })

  it("reads on a subject whose create was refused say so instead of asking", async () => {
    const { deps, log } = fake({ outcome: () => "refused: An object with the name 'Compute' already exists" })
    const r = row({
      steps: [{ tag: "made", op: "create", as: "m", kind: "method", name: "Compute", parent: "root", via: "script" }],
      reads: [{ key: "guid", at: "made", on: "m", op: "guid" }],
    })
    expect(await runRow(r, deps)).toEqual({
      steps: ["create m: refused: An object with the name 'Compute' already exists"],
      guid: "no subject: create m was refused",
    })
    expect(log).not.toContain("core read guid")
  })

  it("records a vendor that lacks the fact by name and asks nothing", async () => {
    const { deps, log } = fake()
    expect(await runRow(row({ vendors: { twincat: true, codesys: { absent: "no such surface" } } }), deps)).toBe(
      "absent: no such surface",
    )
    expect(log).toEqual([])
  })

  it("cleans up even when a read fails, and the failure names the fact and the read", async () => {
    const { deps, log } = fake()
    deps.core = async (req) => {
      log.push(`core ${req.kind}`)
      if (req.kind === "read") throw new Error("no member Foo")
      return { outcome: "accepted", value: null }
    }
    const r = row({ steps: [{ tag: "a", op: "build" }], reads: [{ key: "m", at: "a", op: "member", path: "app.Foo" }] })
    await expect(runRow(r, deps)).rejects.toThrow("t: read `m` after step 0 (build): no member Foo")
    expect(log.slice(-2)).toEqual(["push cleanup", "core cleanup"])
  })

  it("a failing cleanup does not hide the failure that came first", async () => {
    const { deps } = fake()
    deps.core = async (req) => {
      if (req.kind === "step") throw new Error("the CODESYS core did not answer step within 60 s")
      if (req.kind === "cleanup") throw new Error("the CODESYS core did not answer cleanup within 300 s")
      return { value: null }
    }
    const r = row({ steps: [{ tag: "a", op: "invoke", on: "root", path: "app.x", set: 0 }] })
    const run = runRow(r, deps)
    await expect(run).rejects.toThrow("t: step 0 (invoke app.x): the CODESYS core did not answer step within 60 s")
    await expect(runRow(r, deps)).rejects.toThrow(
      "and its cleanup failed too: the CODESYS core did not answer cleanup within 300 s",
    )
  })
})

describe("a build's messages on CODESYS (the core's read)", () => {
  it("are a SET: the order the IDE lists them in is not recorded (two runs of one build listed 744 in two orders)", async () => {
    const a = { code: "C0004", severity: "Error", text: "'DI_10' is no component of 'IQSlices'" }
    const b = { code: "C0032", severity: "Error", text: "Cannot convert type 'IQSlices' to type 'ANY_INT'" }
    const deps = (value: unknown[]): RowDeps => ({
      vendor: "codesys",
      core: async (req) =>
        req.kind === "step" ? { outcome: "accepted" } : { value: req.kind === "read" ? value : null },
      wire: {
        step: async () => "accepted",
        build: async () => ({ success: true, diagnostics: [] }),
        cleanup: async () => {},
      },
    })
    const r = row({ steps: [{ tag: "built", op: "build" }], reads: [{ key: "d", at: "built", op: "diagnostics" }] })
    const one = (await runRow(r, deps([b, a, b]))) as any
    const two = (await runRow(r, deps([a, b, b]))) as any
    expect(one.d).toEqual([a, b, b])
    expect(two.d).toEqual(one.d)
  })

  it("orders them without their guids, so a fresh object's guid cannot reorder the list or its tokens", async () => {
    const on = (g: string, text: string) => ({ guid: { $guid: g }, text })
    const deps = (value: unknown[]): RowDeps => ({
      vendor: "codesys",
      core: async (req) =>
        req.kind === "step" ? { outcome: "accepted" } : { value: req.kind === "read" ? value : null },
      wire: {
        step: async () => "accepted",
        build: async () => ({ success: true, diagnostics: [] }),
        cleanup: async () => {},
      },
    })
    const r = row({ steps: [{ tag: "built", op: "build" }], reads: [{ key: "d", at: "built", op: "diagnostics" }] })
    const one = (await runRow(r, deps([on("ffff", "b"), on("0000", "a")]))) as any
    const two = (await runRow(r, deps([on("0000", "b"), on("ffff", "a")]))) as any
    expect(one.d).toEqual([
      { guid: "guid-1", text: "a" },
      { guid: "guid-2", text: "b" },
    ])
    expect(two.d).toEqual(one.d)
  })
})

describe("a build's outcome on TwinCAT (the bridge's build)", () => {
  const twincatDeps = (build: { success: boolean; diagnostics: unknown[] }): RowDeps => ({
    vendor: "twincat",
    core: async (req) => (req.kind === "step" ? { outcome: "accepted" } : { value: null }),
    wire: { step: async () => "accepted", build: async () => build, cleanup: async () => {} },
  })
  const r = row({
    steps: [
      { tag: "made", op: "create", as: "x", kind: "dut", name: "VltF_X", parent: "root", via: "script" },
      { tag: "built", op: "build" },
    ],
    reads: [{ key: "diagnostics", at: "built", op: "diagnostics" }],
  })

  it("records the build's success, and keeps a diagnostic that names no item (an unread or unresolved build)", async () => {
    const incomplete = { name: null, severity: "error", message: "volt could not finish reading the build output" }
    const other = { name: "MAIN.pou", severity: "error", message: "not the row's" }
    const snap = (await runRow(r, twincatDeps({ success: false, diagnostics: [incomplete, other] }))) as any
    expect(snap.diagnostics).toEqual({
      success: false,
      diagnostics: [{ code: null, member: null, message: incomplete.message, name: null, severity: "error" }],
    })
  })

  it("keeps a diagnostic on another item when it mentions the read's subject (a user of the changed type)", async () => {
    const user = { name: "MAIN.pou", severity: "error", message: "'ePRODUCTION' is no component of 'E_PACKML_MODE'" }
    const m = row({
      ...r,
      reads: [{ key: "diagnostics", at: "built", op: "diagnostics", mentioning: "E_PackML_Mode" }],
    })
    const snap = (await runRow(m, twincatDeps({ success: true, diagnostics: [user] }))) as any
    expect(snap.diagnostics.diagnostics.map((d: any) => d.message)).toEqual([user.message])
  })
})

describe("a create the core refused after the object was made", () => {
  it("keeps the subject: reads reach the object, and the outcome says it was made", async () => {
    const asked: string[] = []
    const deps: RowDeps = {
      vendor: "codesys",
      core: async (req) => {
        if (req.kind === "step") return { outcome: "refused: ArgumentException: bad declaration", made: true }
        if (req.kind === "read") {
          asked.push(req.read.op)
          return { value: { $guid: "AB" } }
        }
        return { value: null }
      },
      wire: {
        step: async () => "accepted",
        build: async () => ({ success: true, diagnostics: [] }),
        cleanup: async () => {},
      },
    }
    const r = row({
      steps: [
        { tag: "made", op: "create", as: "d", kind: "dut", name: "VltF_D", parent: "root", via: "script", decl: "x" },
      ],
      reads: [{ key: "guid", at: "made", on: "d", op: "guid" }],
    })
    expect(await runRow(r, deps)).toEqual({
      steps: ["create d: refused: ArgumentException: bad declaration (the object was made)"],
      guid: "guid-1",
    })
    expect(asked).toEqual(["guid"])
  })
})

describe("the pipe side", () => {
  type Call = { op: string; body?: any }
  /** A fake bridge: `items` is refs' item map; `push` answers each push. */
  function bridge(opts: {
    items?: Record<string, string>
    push?: (body: any) => any
    health?: () => any
    connect?: () => any
  }) {
    const calls: Call[] = []
    let items = { ...(opts.items ?? {}) }
    const call = async (op: string, body?: any) => {
      calls.push({ op, body })
      if (op === "health") return opts.health ? opts.health() : { projects: [{ project: "P", status: "healthy" }] }
      if (op === "connect") return opts.connect ? opts.connect() : {}
      if (op === "refs") return { projectVersion: "v", items, folders: {} }
      if (op === "push") {
        const a = opts.push ? opts.push(body) : { accepted: true, conflicts: [] }
        if (a.accepted && body.ops[0].op === "set" && body.ops[0].sourceText !== undefined)
          items = { ...items, [body.ops[0].name]: "1" }
        return a
      }
      if (op === "fetch") return { changed: [{ name: body.onlyItems[0], sourceText: "TEXT\n" }] }
      throw new Error(`unexpected ${op}`)
    }
    return { call, calls, setItems: (i: Record<string, string>) => (items = i) }
  }
  const ctxOf = (core: RowDeps["core"] = async () => ({ value: ["Application"] })): RowContext => ({
    row: row({}),
    handles: new Map(),
    core,
  })

  it("a refused create leaves no handle, so cleanup never deletes the object that already had the name", async () => {
    const b = bridge({
      items: { "PLC_PRG.pou": "7" },
      push: () => ({ accepted: false, conflicts: [{ code: "NAME_TAKEN", reason: "create collided" }] }),
    })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    const ctx = ctxOf()
    const step: Step = {
      op: "create",
      as: "x",
      kind: "program",
      name: "PLC_PRG",
      parent: "root",
      via: "push",
      source: "S",
    }
    expect(await wire.step(step, ctx)).toBe("refused: NAME_TAKEN: create collided")
    expect(ctx.handles.has("x")).toBe(false)
    await wire.cleanup(ctx)
    expect(b.calls.filter((c) => c.op === "push").length).toBe(1)
  })

  it("a refused create whose object REMAINS is cleaned up, and the outcome says so", async () => {
    const b = bridge({
      push: () => ({ accepted: false, conflicts: [{ code: "UNSUPPORTED", reason: "rollback failed", remains: true }] }),
    })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    const ctx = ctxOf()
    const step: Step = {
      op: "create",
      as: "x",
      kind: "program",
      name: "VltF_R",
      parent: "root",
      via: "push",
      source: "S",
    }
    expect(await wire.step(step, ctx)).toBe("refused: UNSUPPORTED: rollback failed [remains]")
    expect(ctx.handles.get("x")?.created).toBe("push")
  })

  it("a refusal says what landed, and a native rename that ran moves the handle to the new name", async () => {
    const b = bridge({
      items: { "VltR_Check.pou": "3" },
      push: () => ({
        accepted: false,
        conflicts: [
          { code: "UNSUPPORTED", reason: "text refused", partiallyApplied: true, renamedTo: "VltR_CheckBounds.pou" },
        ],
      }),
    })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    const ctx = ctxOf()
    ctx.handles.set("check", { name: "VltR_Check", created: "found" })
    const step: Step = { op: "rename", on: "check", to: "VltR_CheckBounds", via: "push" }
    expect(await wire.step(step, ctx)).toBe(
      "refused: UNSUPPORTED: text refused [partiallyApplied] [renamedTo VltR_CheckBounds.pou]",
    )
    expect(ctx.handles.get("check")!.name).toBe("VltR_CheckBounds")
  })

  it("never serving again names the last cause", async () => {
    const b = bridge({
      health: () => ({ projects: [{ project: "P", status: "idle" }] }),
      connect: () => {
        throw new Error("PLC_DISCONNECTED: project 'P' is not open")
      },
    })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {}, serveTimeoutMs: 0 })
    await expect(wire.build(ctxOf())).rejects.toThrow(
      "never served a project again (last: connect P: PLC_DISCONNECTED: project 'P' is not open)",
    )
  })

  it("a rebind retries a connect the IDE is not ready for yet (an open just replaced the project)", async () => {
    let connects = 0
    let served = false
    const b = bridge({
      health: () => ({ projects: [{ project: "P2", status: served ? "healthy" : "idle" }] }),
      connect: () => {
        if (++connects === 1) throw new Error("PLC_DISCONNECTED: could not attach P2")
        served = true
        return {}
      },
    })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    await wire.rebind!()
    expect(connects).toBe(2)
  })

  it("a rebind reconnects even when health already reads served (a TwinCAT reload leaves dead COM handles)", async () => {
    const b = bridge({})
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    await wire.rebind!()
    expect(b.calls.filter((c) => c.op === "connect").length).toBe(1)
  })

  it("a status the contract does not name is refused by name, not taken for serving", async () => {
    const b = bridge({ health: () => ({ projects: [{ project: "P", status: "exploded" }] }) })
    const wire = wireSide("pipe", { call: b.call, sleep: async () => {} })
    await expect(wire.build(ctxOf())).rejects.toThrow("health: project 'P' has status 'exploded'")
  })

  it("the build answers its success with its diagnostics", async () => {
    const b = bridge({})
    const call = async (op: string, body?: any) =>
      op === "build" ? { success: false, duration: 1, diagnostics: [{ name: null }] } : b.call(op, body)
    const wire = wireSide("pipe", { call, sleep: async () => {} })
    expect(await wire.build(ctxOf())).toEqual({ success: false, diagnostics: [{ name: null }] })
  })
})

describe("the rows re-measure what DIALECT records as measured", () => {
  const keys = (id: string, vendor: "codesys" | "twincat") =>
    expandReads(planRow(ROWS.find((r) => r.id === id)!, vendor)).map((r) => r.snapshotKey)
  const steps = (id: string, vendor: "codesys" | "twincat") =>
    planRow(ROWS.find((r) => r.id === id)!, vendor).steps.map((s) => `${s.op}${s.tag ? "@" + s.tag : ""}`)

  it("C2e: the p_* tree code after the reload, 623/607 → struct, and a build on each IDE-authored subject", () => {
    expect(keys("dut-subtype-in-place", "twincat")).toEqual(
      expect.arrayContaining([
        "item-type.p_enum@reloaded",
        "item-type.q_union@q_pushed",
        "item-type.q_alias@reloaded",
        "diagnostics-pack",
      ]),
    )
    expect(keys("dut-subtype-in-place", "codesys")).toContain("diagnostics-iq")
    const tc = steps("dut-subtype-in-place", "twincat")
    expect(tc.indexOf("build@pack_built")).toBe(tc.indexOf("setText@pack_struct") + 1)
    // The user is CALLED from the main program on both vendors, or the negative control compiles nothing.
    const plan = planRow(ROWS.find((r) => r.id === "dut-subtype-in-place")!, "twincat")
    const wired = plan.steps.findIndex((s) => s.op === "setText" && s.on === "main")
    expect(wired).toBeGreaterThan(-1)
    expect(wired).toBeLessThan(tc.indexOf("build@built"))
    const cs = steps("dut-subtype-in-place", "codesys")
    expect(cs.indexOf("build@iq_built")).toBe(cs.indexOf("setText@iq_struct") + 1)
  })

  it("C19b: the PLC-side TcTTO's CycleTime (µs) beside the two system-manager copies", () => {
    expect(keys("tc-task-items", "twincat")).toEqual(
      expect.arrayContaining([
        "tto-cycle-us",
        "fixture-cycle-100ns",
        "fixture-cycle-context-ns",
        "fixture-tto-cycle-us",
      ]),
    )
  })

  it("C2k: a member created before the text turns FUNCTION is kept, and the next one is refused", () => {
    for (const v of ["codesys", "twincat"] as const)
      expect(keys("pou-members-follow-text", v)).toEqual(
        expect.arrayContaining(["kfb-children@km-function", "kfb-children@second-member"]),
      )
    expect(keys("pou-members-follow-text", "twincat")).toEqual(
      expect.arrayContaining(["children@with-method", "children@with-property", "folder-after-create"]),
    )
  })

  it("V1: the IDE's UI culture is read on both vendors, so a run on another locale names it beside its refusal texts", () => {
    for (const v of ["codesys", "twincat"] as const) {
      const r = expandReads(planRow(ROWS.find((r) => r.id === "ide-identity")!, v)).find(
        (r) => r.snapshotKey === "ui-culture",
      )
      expect(r?.op).toBe("process")
      expect(r && r.op === "process" && r.what).toBe("culture")
    }
  })

  it("C30: int 0 is not asked — it opens a modal dialog that stops the UI thread (recorded in C30, not kept)", () => {
    expect(steps("task-kind", "codesys")).not.toContain("invoke@int-0")
    expect(keys("task-kind", "codesys")).not.toContain("kind@int-0")
    expect(keys("task-kind", "codesys")).toEqual(expect.arrayContaining(["kind@int-1", "kind@string", "kind@enum"]))
  })

  it("C2g: the icon's interface set, the language model, and broken-text, interface and GVL subjects", () => {
    expect(keys("kind-source", "codesys")).toEqual(
      expect.arrayContaining([
        "interfaces.d_struct@created",
        "language-model.d_struct@created",
        "signature.b_dut@created",
        "signature.b_pou@created",
        "signature.itf@created",
        "signature.gvl@created",
      ]),
    )
  })
})

describe("the snapshot", () => {
  it("turns every guid into a per-row token by first appearance", () => {
    expect(canonicalGuids({ a: { $guid: "X" }, b: [{ $guid: "Y" }, { $guid: "X" }] })).toEqual({
      a: "guid-1",
      b: ["guid-2", "guid-1"],
    })
  })

  it("sorts keys at every level and keeps array order", () => {
    expect(JSON.stringify(sortDeep({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 0 } }))).toBe(
      '{"a":{"c":0,"d":[3,{"y":2,"z":1}]},"b":1}',
    )
  })

  it("diffs by fact and key, naming both values", () => {
    const committed = { "task-kind": { kind: "Cyclic", steps: ["a: accepted"] }, gone: { x: 1 } }
    const measured = { "task-kind": { kind: "Freewheeling", steps: ["a: accepted"] }, added: "absent: why" }
    expect(diffSnapshots(committed, measured)).toEqual([
      'added: committed (none) / measured "absent: why"',
      "gone.x: committed 1 / measured (none)",
      'task-kind.kind: committed "Cyclic" / measured "Freewheeling"',
    ])
    expect(diffSnapshots(committed, committed)).toEqual([])
  })
})

describe("the IDE a run measures (design 3: SP21 and TwinCAT 3.1 only)", () => {
  const cs = (v: string) => ({ exe: { exe: "CODESYS.exe", ProductVersion: v }, platform: {}, steps: [] })
  const tc = (exe: string, v: string) => ({ exe: { exe }, automation: { TcRemoteManagerVersion: v }, steps: [] })

  it("accepts CODESYS 3.5 SP21 and TwinCAT 3.1 in TcXaeShell", () => {
    expect(refuseIdeVersion("codesys", cs("3.5.21.40"))).toBeUndefined()
    expect(refuseIdeVersion("twincat", tc("TcXaeShell.exe", "3.1.4024.74"))).toBeUndefined()
  })

  it("refuses another version by name, before anything is recorded", () => {
    expect(refuseIdeVersion("codesys", cs("3.5.18.40"))).toBe(
      "CODESYS 3.5.18.40 is not 3.5 SP21 — the snapshot is SP21's; refused, never recorded",
    )
    expect(refuseIdeVersion("twincat", tc("TcXaeShell.exe", "3.1.4026.10"))).toBeUndefined()
    expect(refuseIdeVersion("twincat", tc("TcXaeShell.exe", "4.0.1.0"))).toBe(
      "TwinCAT 4.0.1.0 in TcXaeShell.exe is not TwinCAT 3.1 in TcXaeShell — refused, never recorded",
    )
    expect(refuseIdeVersion("twincat", tc("devenv.exe", "3.1.4024.74"))).toBe(
      "TwinCAT 3.1.4024.74 in devenv.exe is not TwinCAT 3.1 in TcXaeShell — refused, never recorded",
    )
  })

  it("refuses any build but the one the committed snapshot was recorded on, naming both", () => {
    const committedCs = cs("3.5.21.40")
    const committedTc = { ...tc("TcXaeShell.exe", "3.1.4024.74"), exe: { exe: "TcXaeShell.exe", DteVersion: "15.0" } }
    expect(refuseIdeVersion("codesys", cs("3.5.21.40"), committedCs)).toBeUndefined()
    expect(refuseIdeVersion("codesys", cs("3.5.21.50"), committedCs)).toBe(
      "CODESYS 3.5.21.50 is not 3.5.21.40, the build vendor-facts.codesys.json was recorded on — refused, never " +
        "diffed; to record this IDE, move the snapshot aside and run --write deliberately",
    )
    const same = { ...committedTc, exe: { exe: "TcXaeShell.exe", DteVersion: "15.0" } }
    expect(refuseIdeVersion("twincat", same, committedTc)).toBeUndefined()
    const newer = { ...tc("TcXaeShell.exe", "3.1.4026.10"), exe: { exe: "TcXaeShell.exe", DteVersion: "15.0" } }
    expect(refuseIdeVersion("twincat", newer, committedTc)).toBe(
      "TwinCAT 3.1.4026.10 in TcXaeShell.exe 15.0 is not 3.1.4024.74 in TcXaeShell.exe 15.0, the build " +
        "vendor-facts.twincat.json was recorded on — refused, never diffed; to record this IDE, move the snapshot " +
        "aside and run --write deliberately",
    )
    const otherShell = { ...committedTc, exe: { exe: "TcXaeShell.exe", DteVersion: "16.0" } }
    expect(refuseIdeVersion("twincat", otherShell, committedTc)).toContain("TcXaeShell.exe 16.0 is not")
  })

  it("refuses an identity it cannot read rather than passing it", () => {
    expect(refuseIdeVersion("codesys", "absent: x")).toBe('ide-identity did not answer an exe version: "absent: x"')
    expect(refuseIdeVersion("twincat", { exe: {}, steps: [] })).toBe(
      'ide-identity did not answer an exe version: {"exe":{},"steps":[]}',
    )
  })
})

describe("the command line", () => {
  it("takes one vendor, --write, and --only <facts>", () => {
    expect(parseArgs(["codesys"])).toEqual({ vendor: "codesys", write: false, only: undefined })
    expect(parseArgs(["twincat", "--write", "--only", "tc-task-items,ide-identity"])).toEqual({
      vendor: "twincat",
      write: true,
      only: ["tc-task-items", "ide-identity"],
    })
  })

  it("refuses a missing or unknown vendor, a fact the table does not have, and a fact the vendor is not asked", () => {
    expect(() => parseArgs([])).toThrow("usage")
    expect(() => parseArgs(["beckhoff"])).toThrow("usage")
    expect(() => parseArgs(["codesys", "--only", "no-such-fact"])).toThrow("--only: no row `no-such-fact`")
    expect(() => parseArgs(["codesys", "--only", "tc-task-items"])).toThrow(
      "--only: `tc-task-items` is not asked of codesys",
    )
  })

  it("with --only, compares and writes only those facts and keeps the rest of the committed snapshot", () => {
    const committed = { a: { x: 1 }, b: { y: 2 } }
    expect(mergeSnapshot(committed, { b: { y: 3 } }, ["b"])).toEqual({ a: { x: 1 }, b: { y: 3 } })
    expect(mergeSnapshot(committed, { b: { y: 3 } }, undefined)).toEqual({ b: { y: 3 } })
  })

  // review (abstract-member-push 1): VOLT_E2E_INSTANCE names an e2e IDE that is ALREADY UP; the runner `up`s and
  // `down`s its instance, so reading that variable would tear a live e2e IDE down. It has its own variable.
  it("runs on its own instance: VOLT_VENDOR_FACTS_INSTANCE, never VOLT_E2E_INSTANCE", () => {
    expect(instanceOf({})).toBe("vendor-fact-probe")
    expect(instanceOf({ VOLT_E2E_INSTANCE: "foo" })).toBe("vendor-fact-probe")
    expect(instanceOf({ VOLT_E2E_INSTANCE: "foo", VOLT_VENDOR_FACTS_INSTANCE: "bar" })).toBe("bar")
    expect(() => instanceOf({ VOLT_VENDOR_FACTS_INSTANCE: "" })).toThrow("VOLT_VENDOR_FACTS_INSTANCE")
  })
})

describe("the fold-ins (design 4): bridge-refusal-review's probes are rows", () => {
  const byId = (id: string) => {
    const r = ROWS.find((x) => x.id === id)
    if (!r) throw new Error(`no row ${id}`)
    return r
  }
  const keys = (id: string, vendor: "codesys" | "twincat") =>
    expandReads(planRow(byId(id), vendor)).map((r) => r.snapshotKey)
  const tries = (id: string, vendor: "codesys" | "twincat") =>
    planRow(byId(id), vendor).steps.filter((s): s is Extract<Step, { op: "tryNames" }> => s.op === "tryNames")
  const words = (n: number) => [...Array(n)].map((_, i) => `W${i}`)

  it("a tryNames step is script-only, ≤ 500 distinct names, and a `tried` read follows one", () => {
    const bad = row({
      steps: [
        { op: "create", as: "fb", kind: "function_block", name: "F", parent: "root", via: "script" },
        // @ts-expect-error — a tryNames through the push would meet the driver's own RefusedName pre-flight
        { tag: "p", op: "tryNames", kind: "method", parent: "fb", names: ["A"], via: "push" },
        { tag: "many", op: "tryNames", kind: "method", parent: "fb", names: words(501), via: "script" },
        { tag: "dup", op: "tryNames", kind: "method", parent: "fb", names: ["A", "a", "B"], via: "script" },
        { tag: "none", op: "tryNames", kind: "method", parent: "nope", names: [], via: "script" },
        { tag: "b", op: "build" },
      ],
      reads: [{ key: "v", at: "b", op: "tried", what: "verdicts" }],
    })
    const findings = validateTable([bad])
    expect(findings).toContain("t (codesys): step 1 tryNames is script-only — a push meets Volt's own pre-flight")
    expect(findings).toContain("t (codesys): step 2 tryNames asks 501 names — more than 500 do not render whole")
    expect(findings).toContain("t (codesys): step 3 tryNames asks `a` twice (names compare case-insensitively)")
    expect(findings).toContain("t (codesys): step 4 tryNames asks no name")
    expect(findings).toContain("t (codesys): step 4 tryNames names handle `nope`, which no earlier create/find defines")
    expect(findings).toContain("t (codesys): read `v` (tried) is at `b`, which is no tryNames step")
  })

  it("a setText that copies another handle's body names a handle the row defines", () => {
    const bad = row({
      steps: [
        { op: "create", as: "a", kind: "program", name: "A", parent: "root", via: "script" },
        { op: "setText", on: "a", via: "script", implFrom: "ghost" },
      ],
    })
    expect(validateTable([bad])).toContain(
      "t (codesys): step 1 setText names handle `ghost`, which no earlier create/find defines",
    )
  })

  it("a tryNames request waits for every name it asks (TwinCAT took ~1.8 s an ask in the logs)", () => {
    const step = (n: number): CoreRequest => ({
      kind: "step",
      row: "t",
      step: { op: "tryNames", kind: "method", parent: "fb", names: words(n), via: "script" },
    })
    expect(requestTimeout(step(500))).toBeGreaterThanOrEqual(500 * 4_000)
    expect(requestTimeout(step(1))).toBeGreaterThanOrEqual(60_000)
  })

  it("a request reaches a core in ASCII: every other character is a \\u escape (IronPython 2.7, the console code page)", () => {
    const names = ["Fööbar", "a​b", "名前", "a\\b", 'a"b']
    const text = asciiJson({ names })
    expect(/^[\x20-\x7e]*$/.test(text)).toBe(true)
    expect(text).toContain("F\\u00f6\\u00f6bar")
    expect(JSON.parse(text)).toEqual({ names })
  })

  it("refused-names (C28): the 1494 words the logs asked as a METHOD, and 216 as ACTION / PROPERTY / top-level FB", () => {
    for (const v of ["codesys", "twincat"] as const) {
      const t = tries("refused-names", v)
      const of = (prefix: string) =>
        t.filter((s) => s.tag!.startsWith(prefix + ".") && !s.tag!.includes(".casing-")).flatMap((s) => s.names)
      const distinct = (ws: string[]) => new Set(ws.map((w) => w.toUpperCase())).size
      expect(of("METHOD").length).toBe(1494)
      expect(distinct(of("METHOD"))).toBe(1494)
      for (const k of ["ACTION", "PROPERTY", "TOPLEVEL"]) expect(distinct(of(k))).toBe(216)
      for (const s of t) expect(s.names.length).toBeLessThanOrEqual(500)
      // Through the vendor API: a push would meet the driver's own RefusedName pre-flight, the list under test.
      for (const s of planRow(byId("refused-names"), v).steps) if ("via" in s) expect(s.via).toBe("script")
      expect(keys("refused-names", v).sort()).toEqual(t.map((s) => s.tag!).sort())
      expect(t.find((s) => s.tag!.startsWith("TOPLEVEL."))?.parent).toBe("root")
    }
  })

  it("refused-names (C28) measures that the refusal is case-insensitive: every kind asks casing controls", () => {
    // Every consumer relies on it (the drivers' lists match OrdinalIgnoreCase, the gate upper-cases every word), so the
    // table asks the casing variants the logs asked (`log` / `Log` / `lOg`, `To_Bool`, `__Foo` …) in groups of their
    // own — a tryNames step asks a word once — beside the spelling each vocabulary group asks.
    for (const v of ["codesys", "twincat"] as const) {
      const t = tries("refused-names", v)
      for (const k of ["METHOD", "ACTION", "PROPERTY", "TOPLEVEL"]) {
        const casing = t.filter((s) => s.tag!.startsWith(`${k}.casing-`))
        const asked = new Map(
          t.filter((s) => s.tag!.startsWith(`${k}.`) && !s.tag!.includes(".casing-"))
            .flatMap((s) => s.names)
            .map((n) => [n.toUpperCase(), n] as const),
        )
        expect(casing.length).toBeGreaterThan(0)
        const spellings = new Map<string, Set<string>>()
        for (const s of casing)
          for (const n of s.names) {
            // each control is another spelling of a word the kind's vocabulary asks
            expect(asked.get(n.toUpperCase())).toBeDefined()
            expect(asked.get(n.toUpperCase())).not.toBe(n)
            const all = spellings.get(n.toUpperCase()) ?? new Set([asked.get(n.toUpperCase())!])
            expect(all.has(n)).toBe(false)
            spellings.set(n.toUpperCase(), all.add(n))
          }
        expect([...(spellings.get("LOG") ?? [])].sort()).toEqual(["LOG", "Log", "lOg", "log"])
        expect(keys("refused-names", v)).toEqual(expect.arrayContaining(casing.map((s) => s.tag!)))
      }
      const method = t.filter((s) => s.tag!.startsWith("METHOD.casing-")).flatMap((s) => s.names)
      expect(method).toEqual(expect.arrayContaining(["To_Bool", "__FOO", "sin", "Min", "public"]))
    }
  })

  it("identifier-shapes (C28): every shape for a POU and all five member kinds, and CODESYS builds a backtick name", () => {
    for (const v of ["codesys", "twincat"] as const) {
      const t = tries("identifier-shapes", v)
      expect(t.map((s) => s.tag)).toEqual(["pou", "method", "action", "property", "itf_method", "itf_property"])
      for (const s of t) expect(s.names).toEqual(expect.arrayContaining(["Run", "Fööbar", "`ab`", "`ab", "a__b", "_"]))
      expect(keys("identifier-shapes", v)).toEqual(expect.arrayContaining(t.map((s) => s.tag!)))
    }
    expect(keys("identifier-shapes", "codesys")).toEqual(
      expect.arrayContaining(["diagnostics@built", "diagnostics@negative"]),
    )
  })

  it("task-priority-range (C19c): every value the log sent, XML-escaped, read back off TaskDef and the module Context", () => {
    const sent = planRow(byId("task-priority-range"), "twincat")
      .steps.filter((s) => s.op === "invoke" && s.tag?.startsWith("="))
      .map((s) => (s.op === "invoke" && "args" in s ? String(s.args?.[0]) : ""))
    expect(sent).toHaveLength(19)
    expect(sent).toContain("<TreeItem><TaskDef><Priority>&lt;5&gt;</Priority></TaskDef></TreeItem>")
    expect(sent).toContain("<TreeItem><TaskDef><Priority>&amp;</Priority></TaskDef></TreeItem>")
    expect(sent).toContain("<TreeItem><TaskDef><Priority></Priority></TaskDef></TreeItem>")
    expect(keys("task-priority-range", "twincat")).toEqual(
      expect.arrayContaining(["taskdef@=99999999999", "context@=99999999999", "taskdef@=<5>"]),
    )
    expect(byId("task-priority-range").vendors.codesys).toBeUndefined()
  })

  it("interface-accessor-write (D41): the accessor's slots, its declaration written by script, and each build", () => {
    expect(keys("interface-accessor-write", "codesys")).toEqual(
      expect.arrayContaining([
        "has-implementation.get",
        "implementation-aspect.set",
        "declaration.set@set-written",
        "diagnostics@created",
        "diagnostics@set-built",
        "diagnostics@get-built",
      ]),
    )
  })

  it("body-language-change (N24): CODESYS through the shipped push, TwinCAT through ImplementationText", () => {
    const cs = planRow(byId("body-language-change"), "codesys").steps
    expect(cs.filter((s) => s.op === "setText" && s.on === "pou").every((s) => "via" in s && s.via === "push")).toBe(
      true,
    )
    expect(keys("body-language-change", "codesys")).toEqual(
      expect.arrayContaining([
        "guid.pou@graphical",
        "aspect.pou@graphical",
        "aspect.set@graphical",
        "diagnostics@graphical-built",
      ]),
    )
    const tc = planRow(byId("body-language-change"), "twincat").steps
    expect(tc.some((s) => s.op === "setText" && "implFrom" in s && s.implFrom === "fbd")).toBe(true)
    expect(keys("body-language-change", "twincat")).toEqual(expect.arrayContaining(["diagnostics"]))
    // N24 says the FBD body stays unchanged under refused ST and the archive over ST reads back VERBATIM: the reads are
    // the whole ImplementationText, not a list of element names (which a changed attribute or value would not move).
    const tcReads = byId("body-language-change").reads.filter((r) => r.vendor === "twincat" && r.op === "member")
    for (const r of tcReads) expect(r.op === "member" && r.path).toBe("item.ImplementationText")
    expect(keys("body-language-change", "twincat")).toEqual(
      expect.arrayContaining(["fbd-body@made", "fbd-body@st-over-fbd", "st-body@made", "st-body@fbd-over-st"]),
    )
  })

  it("move-target (C2q): CODESYS into Device and Task Configuration; TwinCAT into a POU node and References", () => {
    const to = (v: "codesys" | "twincat") =>
      planRow(byId("move-target"), v).steps.flatMap((s) => (s.op === "move" ? [`${s.to} ${s.via}`] : []))
    expect(to("codesys")).toEqual(["folder script", "device script", "taskconfig script"])
    expect(to("twincat")).toEqual(["folder script", "pou script", "references script"])
    expect(keys("move-target", "twincat")).toEqual(expect.arrayContaining(["root-children@into-references"]))
    // C2q's TwinCAT target is a POU node (602, a program), as the deleted probe's was; CODESYS reads what the device
    // and the task configuration hold after the move, not only where the subject stayed.
    const target = planRow(byId("move-target"), "twincat").steps.find((s) => s.op === "create" && s.as === "pou")
    expect(target?.op === "create" && target.kind).toBe("program")
    expect(keys("move-target", "codesys")).toEqual(
      expect.arrayContaining(["device-children@into-device", "taskconfig-children@into-taskconfig"]),
    )
  })

  it("no committed snapshot holds a path of this machine or account (a refused import quotes its archive path)", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const { tmpdir, homedir } = require("node:os") as typeof import("node:os")
    for (const v of ["codesys", "twincat"]) {
      const text = readFileSync(new URL(`../../scripts/vendor-facts.${v}.json`, import.meta.url), "utf8")
      for (const local of [tmpdir(), homedir()]) expect(text).not.toContain(JSON.stringify(local).slice(1, -1))
      expect(text).not.toMatch(/[A-Z]:\\Users\\/)
    }
  })
})
