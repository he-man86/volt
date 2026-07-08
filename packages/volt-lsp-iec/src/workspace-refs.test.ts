/**
 * workspace-refs loaders — the FS scanners that feed dead-code seeding (`.task` `Calls:`) and the
 * identifier-skip sets (`.library` `NAMESPACE`, `.device` stems). Regex/parse bugs here silently break
 * suppression, so pin the extraction + the graceful-empty fallbacks on a hermetic temp workspace.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTaskRoots, loadLibraryNamespaces, loadDeviceInstances, loadWorkspaceRefs } from "./workspace-refs.js"

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

test("loadLibraryNamespaces: `NAMESPACE` line, lowercased; no-NAMESPACE files skipped", () => {
  expect(loadLibraryNamespaces(root)).toEqual(new Set(["_3s_license"]))
})

test("loadDeviceInstances: `.device` file stems, lowercased", () => {
  expect(loadDeviceInstances(root)).toEqual(new Set(["ethercat_master"]))
})

test("loadWorkspaceRefs combines library namespaces + device instances", () => {
  const refs = loadWorkspaceRefs(root)
  expect(refs.libraryNamespaces).toEqual(new Set(["_3s_license"]))
  expect(refs.deviceInstances).toEqual(new Set(["ethercat_master"]))
})

test("a missing / empty root yields empty sets, never throws (safe fallback)", () => {
  const missing = join(root, "does-not-exist")
  expect(loadTaskRoots(missing).size).toBe(0)
  expect(loadLibraryNamespaces(missing).size).toBe(0)
  const empty = loadWorkspaceRefs("")
  expect(empty.libraryNamespaces.size).toBe(0)
  expect(empty.deviceInstances.size).toBe(0)
})
