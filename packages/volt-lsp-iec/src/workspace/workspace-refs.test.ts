/**
 * workspace-refs — the FS scan that feed dead-code seeding (`.task` `Calls:`) and what the symbol table
 * binds beside the sources (`.library` manifests, `.device` instances). Regex/parse bugs here silently break
 * resolution, so pin the extraction + the graceful-empty fallbacks on a hermetic temp workspace.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanWorkspace, scanWorkspaceRefs } from "./workspace-refs.js"
import { WorkspaceStore } from "./workspace-store.js"
import { failLoud } from "../../test/support/fail-loud.js"
import { NETWORK_TEXT_ENABLED } from "../server/config.js"
import { documentDiagnostics } from "../server/document-diagnostics.js"
import { resolveConfig } from "../analysis/index.js"

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "volt-refs-"))
  const sub = join(root, "Task Configuration")
  mkdirSync(sub, { recursive: true })
  // .task files — the `Calls:` line names the entry PROGRAM (nested to exercise the recursive walk).
  writeFileSync(join(sub, "LogicTask.task"), "Type:      Cyclic\nInterval:  T#15ms\nCalls:     CyclicTask\n")
  writeFileSync(join(sub, "MotionTask.task"), "Type:      Cyclic\nCalls:     Program_Motion\n")
  writeFileSync(join(sub, "NoCallsTask.task"), "Type:      Freewheeling\nPriority:  5\n") // no Calls → skipped
  // A task can run SEVERAL programs — the comma list must fully split (regression: old parser grabbed
  // only "Simulation," incl. the trailing comma and dropped the rest). Params around it are ignored.
  writeFileSync(
    join(sub, "MultiTask.task"),
    "Type:      Cyclic\nInterval:  t#4ms\nPriority:  1\nWatchdog:  3200 µs (sensitivity 2)\n" +
      "Calls:     Simulation, General, Mach1_MotionControl, MachineStateSetting, FirstErrorCapture\n",
  )
  // .library — a NAMESPACE line is the qualified root.
  const lib = join(root, "Library Manager")
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, "3SLicense.library"), "LIBRARY 3SLicense\nNAMESPACE _3S_LICENSE\nPLACEHOLDER true\n")
  writeFileSync(join(lib, "NoNs.library"), "LIBRARY NoNs\nPLACEHOLDER true\n") // no NAMESPACE → skipped
  // .device — the stem is the device-tree instance name.
  writeFileSync(join(root, "EtherCAT_Master.device"), "Name: EtherCAT Master\nVendor: X\n")
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

test("the scan's task roots: `Calls:` PROGRAM names, lowercased, recursive; comma lists split; no-Calls skipped", () => {
  expect(scanWorkspaceRefs(root).taskRoots).toEqual(
    new Set([
      "cyclictask",
      "program_motion",
      // every program on the multi-call line, not just the first
      "simulation",
      "general",
      "mach1_motioncontrol",
      "machinestatesetting",
      "firsterrorcapture",
    ]),
  )
})

test("the scan's devices: one instance per `.device` descriptor, named as the file's stem is spelled", () => {
  expect(scanWorkspaceRefs(root).refs.devices).toEqual([{ kind: "device", name: "EtherCAT_Master", uri: join(root, "EtherCAT_Master.device") }])
})

test("the scan's refs: the library manifests (each with its NAMESPACE; one without is no manifest) + the device instances", () => {
  const { refs } = scanWorkspaceRefs(root)
  expect(refs.libraryManifests.map((m) => m.namespace)).toEqual(["_3S_LICENSE"])
  expect(refs.devices.map((d) => d.name)).toEqual(["EtherCAT_Master"])
})

test("a missing / empty root yields nothing, never throws (safe fallback)", () => {
  const missing = join(root, "does-not-exist")
  expect(scanWorkspaceRefs(missing).taskRoots.size).toBe(0)
  expect(scanWorkspaceRefs(missing).refs.devices).toEqual([])
  const empty = scanWorkspaceRefs("").refs
  expect(empty.libraryManifests).toEqual([])
  expect(empty.devices).toEqual([])
})

test("the workspace scan picks up the project's .projectsettings", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-ps-"))
  try {
    writeFileSync(
      join(dir, "Project.projectsettings"),
      ["Disabled warnings:     C0371", "Replace constants:     on", "Max compiler warnings: 100"].join("\n"),
    )
    writeFileSync(join(dir, "Main.pou"), "PROGRAM Main\nVAR\n  n : INT;\nEND_VAR\nn := 1;\nEND_PROGRAM\n")
    const scan = scanWorkspace(dir)
    expect(scan.projectSettings).toEqual([{ folder: dir, diagnostics: { "inout-own-access": "off" } }])
    expect(scan.sources.length).toBe(1) // the settings file is NOT a source unit
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A source unit is a file whose extension is EXACTLY a source extension, as the CLI's classifier decides it: a
// file name IS its wire name, so `E_Mode.Dut` is not the `E_Mode.dut` the IDE publishes and `volt push` refuses
// it as a foreign file. Indexed here, the LSP resolved `E_Mode` from a file Volt will never push.
test("the workspace scan takes a source file only under its exact extension", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-case-"))
  try {
    writeFileSync(join(dir, "E_Mode.Dut"), "TYPE E_Mode : (Idle, Run);\nEND_TYPE\n")
    writeFileSync(join(dir, "FB_New.FB"), "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\n")
    writeFileSync(join(dir, "E_State.dut"), "TYPE E_State : (Off, On);\nEND_TYPE\n")
    const scan = scanWorkspace(dir)
    expect(scan.sources.map((s) => s.path)).toEqual([join(dir, "E_State.dut")])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A UTF-8 BOM is a file-encoding mark, never content: Visual Studio and TcXaeShell save one by default, and the push
// strips it (`Commands.cs` HeadSrc) before the IDE sees the text. Kept here, it stood in front of the DUT's `TYPE` and
// the GVL's `VAR_GLOBAL`, so the file declared NOTHING (a DUT/GVL reads only when it OPENS with its keyword) and every
// use site drew "Unknown type" / "not defined" that CODESYS, handed the stripped text, never gives.
test("the workspace scan reads a file saved with a BOM as the push sends it — without the BOM", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-bom-"))
  try {
    writeFileSync(
      join(dir, "PLC_PRG.pou"),
      "﻿PROGRAM PLC_PRG\nVAR\n\tv : DUT_A;\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := v.nPos + g;\nEND_PROGRAM\n",
    )
    writeFileSync(join(dir, "DUT_A.dut"), "﻿TYPE DUT_A :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n")
    writeFileSync(join(dir, "GVL.gvl"), "﻿VAR_GLOBAL\n\tg : INT;\nEND_VAR\n")
    const scan = scanWorkspace(dir)
    expect(scan.sources.every((s) => !s.source.startsWith("﻿"))).toBe(true)
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
    store.seedDisk(scan.sources.map((f) => ({ uri: f.path, source: f.source })))
    const messages = store
      .workspace()
      .flatMap((d) => documentDiagnostics(store, d).map((x) => `${d.uri}: ${x.message}`))
    expect(messages).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// HeadSrc strips EVERY leading U+FEFF (`TrimStart('\uFEFF')`), not one: a BOM-writing tool re-saving text that already
// kept a U+FEFF char leaves two, and the IDE still receives `TYPE …`. Stripping one left the second in front of the
// keyword, so the DUT declared nothing here and every use drew an "Unknown type" the IDE never gives.
test("the workspace scan strips every leading BOM, as the push does", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-bom2-"))
  try {
    const text = "TYPE DUT_B :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n"
    writeFileSync(join(dir, "DUT_B.dut"), "\uFEFF\uFEFF" + text)
    expect(scanWorkspace(dir).sources.map((s) => s.source)).toEqual([text])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * THE SETTINGS HAVE TO REACH THE ANALYSIS, not merely be parsed out of the file.
 *
 * Everything around this was already covered — `projectDiagnosticsFrom` parses the lines (config.test.ts),
 * `scanWorkspace` finds the file (above), and `resolveConfig` gives the project the last word — and a chain
 * of green links is still not a connected chain. `projectSettings` rides on the SCAN, beside `refs` rather
 * than inside it, so a consumer holding only `scanWorkspaceRefs(dir).refs` gets a workspace where the project's
 * compiler settings silently do nothing. Every test above passes in that world.
 *
 * So this asks the only question that matters end to end: with the file on disk, is the diagnostic GONE?
 * Measured against the real corpus when this was written, pro2193's single `Disabled warnings: C0371` line
 * suppresses 1242 diagnostics — the size of what a broken link would quietly restore.
 */
test("a disabled warning in .projectsettings actually suppresses the diagnostic, end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-ps-"))
  // `n;` is a bare expression statement: C0139, one of the codes the compiler-warnings dialog can switch off.
  const noOpCount = (): number => {
    const scan = scanWorkspace(dir)
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
    store.configs.configure({ vendor: "codesys" }, scan.projectSettings)
    store.setRefs(scan.refs, scan.taskRoots)
    store.seedDisk(scan.sources.map((f) => ({ uri: f.path, source: f.source })))
    let n = 0
    for (const d of store.workspace())
      for (const diag of documentDiagnostics(store, d))
        // the WIRE code, which is what a client sees: `documentDiagnostics` stamps the catalog `Cnnnn`
        // over the internal slug, so filtering on "no-op-statement" here matches nothing and passes vacuously.
        if (String(diag.code) === "C0139") n++
    return n
  }
  try {
    writeFileSync(join(dir, "Main.pou"), "PROGRAM Main\nVAR\n  n : INT;\nEND_VAR\nIMPLEMENTATION ST\nn;\nEND_PROGRAM\n")
    expect(noOpCount(), "without settings it must fire, or this test proves nothing").toBe(1)

    writeFileSync(join(dir, "Project.projectsettings"), "Disabled warnings:     C0139\n")
    expect(noOpCount(), "the project switched it off").toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a workspace with no .projectsettings leaves the editor's settings alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-ps-"))
  try {
    writeFileSync(join(dir, "Main.pou"), "PROGRAM Main\nEND_PROGRAM\n")
    expect(scanWorkspace(dir).projectSettings).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A TwinCAT solution holds one Project Settings per PLC project, at that project's own node. They were one slot, so
// the LAST file the walk read decided every project's warnings: A's switched-off C0139 came back in A.
test("each PLC project's .projectsettings governs its own documents, and none replaces another's", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-ps2-"))
  try {
    const a = join(dir, "PLC", "A", "A Project")
    const b = join(dir, "PLC", "B", "B Project")
    for (const [p, disabled] of [[a, "C0139"], [b, "C0371"]] as const) {
      mkdirSync(join(p, "POUs"), { recursive: true })
      writeFileSync(join(p, "Project Settings.projectsettings"), `Disabled warnings:     ${disabled}\n`)
      writeFileSync(join(p, "POUs", "Prog.pou"), "PROGRAM Prog\nVAR\n  n : INT;\nEND_VAR\nIMPLEMENTATION ST\nn;\nEND_PROGRAM\n")
    }
    const scan = scanWorkspace(dir)
    expect(scan.projectSettings).toEqual([
      { folder: a, diagnostics: { "no-op-statement": "off" } },
      { folder: b, diagnostics: { "inout-own-access": "off" } },
    ])
    const store = new WorkspaceStore(resolveConfig({ vendor: "twincat" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
    store.configs.configure({ vendor: "twincat" }, scan.projectSettings)
    // Two PROGRAMs named Prog are two PLC projects' own; only C0139 is asked about here.
    store.seedDisk(scan.sources.map((f) => ({ uri: f.path, source: f.source })))
    const c0139 = (project: string): number =>
      documentDiagnostics(store, store.workspace().find((d) => d.uri === join(project, "POUs", "Prog.pou"))!).filter(
        (x) => String(x.code) === "C0139",
      ).length
    expect(c0139(a), "A switched C0139 off").toBe(0)
    expect(c0139(b), "B did not").toBe(1)
    expect(store.configs.configFor(join(dir, "Loose.pou")).diagnostics["no-op-statement"], "no project holds it").toBe("warning")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// lsp-same-standard 3.1, finding R15: `volt init` makes the workspace root a git repository, and the scan walked `.git`
// too — every object, on every watched-file event — though nothing in it is an item of the workspace.
test("the scan never reads under `.git`", () => {
  const ws = mkdtempSync(join(tmpdir(), "volt-gitdir-"))
  try {
    mkdirSync(join(ws, ".git", "volt"), { recursive: true })
    writeFileSync(join(ws, ".git", "volt", "Stray.pou"), "PROGRAM Stray\nEND_PROGRAM")
    writeFileSync(join(ws, "P.pou"), "PROGRAM P\nEND_PROGRAM")
    expect(scanWorkspace(ws).sources.map((s) => s.path)).toEqual([join(ws, "P.pou")])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
