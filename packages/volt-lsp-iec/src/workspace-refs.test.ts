/**
 * workspace-refs loaders — the FS scanners that feed dead-code seeding (`.task` `Calls:`) and what the symbol table
 * binds beside the sources (`.library` manifests, `.device` instances). Regex/parse bugs here silently break
 * resolution, so pin the extraction + the graceful-empty fallbacks on a hermetic temp workspace.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTaskRoots, loadDeviceInstances, loadWorkspaceRefs, scanWorkspace } from "./workspace-refs.js"
import { WorkspaceStore } from "./server/workspace-store.js"
import { documentDiagnostics } from "./server/diagnostics.js"
import { messagesFor, resolveConfig } from "./analysis/index.js"

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

test("loadTaskRoots: `Calls:` PROGRAM names, lowercased, recursive; comma lists split; no-Calls skipped", () => {
  expect(loadTaskRoots(root)).toEqual(
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

test("loadDeviceInstances: one instance per `.device` descriptor, named as the file's stem is spelled", () => {
  expect(loadDeviceInstances(root)).toEqual([{ kind: "device", name: "EtherCAT_Master", uri: join(root, "EtherCAT_Master.device") }])
})

test("loadWorkspaceRefs: the library manifests (each with its NAMESPACE; one without is no manifest) + the device instances", () => {
  const refs = loadWorkspaceRefs(root)
  expect(refs.libraryManifests.map((m) => m.namespace)).toEqual(["_3S_LICENSE"])
  expect(refs.devices.map((d) => d.name)).toEqual(["EtherCAT_Master"])
})

test("a missing / empty root yields nothing, never throws (safe fallback)", () => {
  const missing = join(root, "does-not-exist")
  expect(loadTaskRoots(missing).size).toBe(0)
  expect(loadDeviceInstances(missing)).toEqual([])
  const empty = loadWorkspaceRefs("")
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
    writeFileSync(join(dir, "Main.prg"), "PROGRAM Main\nVAR\n  n : INT;\nEND_VAR\nn := 1;\nEND_PROGRAM\n")
    const scan = scanWorkspace(dir)
    expect(scan.projectDiagnostics).toEqual({ "inout-own-access": "off" })
    expect(scan.sources.length).toBe(1) // the settings file is NOT a source unit
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A source unit is a file whose extension is EXACTLY a source extension, as the CLI's classifier decides it: a
// file name IS its wire name, so `E_Mode.Enum` is not the `E_Mode.enum` the IDE publishes and `volt push` refuses
// it as a foreign file. Indexed here, the LSP resolved `E_Mode` from a file Volt will never push.
test("the workspace scan takes a source file only under its exact extension", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-case-"))
  try {
    writeFileSync(join(dir, "E_Mode.Enum"), "TYPE E_Mode : (Idle, Run);\nEND_TYPE\n")
    writeFileSync(join(dir, "FB_New.FB"), "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\n")
    writeFileSync(join(dir, "E_State.enum"), "TYPE E_State : (Off, On);\nEND_TYPE\n")
    const scan = scanWorkspace(dir)
    expect(scan.sources.map((s) => s.path)).toEqual([join(dir, "E_State.enum")])
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
      join(dir, "PLC_PRG.prg"),
      "﻿PROGRAM PLC_PRG\nVAR\n\tv : DUT_A;\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := v.nPos + g;\nEND_PROGRAM\n",
    )
    writeFileSync(join(dir, "DUT_A.struct"), "﻿TYPE DUT_A :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n")
    writeFileSync(join(dir, "GVL.gvl"), "﻿VAR_GLOBAL\n\tg : INT;\nEND_VAR\n")
    const scan = scanWorkspace(dir)
    expect(scan.sources.every((s) => !s.source.startsWith("﻿"))).toBe(true)
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
    store.seedDisk(scan.sources.map((f) => ({ uri: f.path, source: f.source })))
    const messages = store
      .workspace()
      .flatMap((d) => documentDiagnostics(store, messagesFor("codesys"), d).map((x) => `${d.uri}: ${x.message}`))
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
    writeFileSync(join(dir, "DUT_B.struct"), "\uFEFF\uFEFF" + text)
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
 * of green links is still not a connected chain. `projectDiagnostics` rides on the SCAN, beside `refs` rather
 * than inside it, so a consumer holding only `loadWorkspaceRefs(dir)` gets a workspace where the project's
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
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys", diagnostics: scan.projectDiagnostics }))
    store.workspaceRefs = loadWorkspaceRefs(dir)
    store.taskRoots = loadTaskRoots(dir)
    store.seedDisk(scan.sources.map((f) => ({ uri: f.path, source: f.source })))
    let n = 0
    for (const d of store.workspace())
      for (const diag of documentDiagnostics(store, messagesFor("codesys"), d))
        // the WIRE code, which is what a client sees: `documentDiagnostics` stamps the catalog `Cnnnn`
        // over the internal slug, so filtering on "no-op-statement" here matches nothing and passes vacuously.
        if (String(diag.code) === "C0139") n++
    return n
  }
  try {
    writeFileSync(join(dir, "Main.prg"), "PROGRAM Main\nVAR\n  n : INT;\nEND_VAR\nIMPLEMENTATION ST\nn;\nEND_PROGRAM\n")
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
    writeFileSync(join(dir, "Main.prg"), "PROGRAM Main\nEND_PROGRAM\n")
    expect(scanWorkspace(dir).projectDiagnostics).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
