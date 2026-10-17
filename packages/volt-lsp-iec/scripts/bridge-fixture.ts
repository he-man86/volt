/**
 * Shared live-bridge fixture helpers for the recording scripts (verify-catalog.ts). Speaks the
 * push wire and keeps the fixture project clean between repros.
 *
 * UNREADABLE-safe (learned the hard way): a malformed push can leave an item that's invisible in `/refs` but
 * blocks re-create — delete it with the `UNREADABLE000000` sentinel version, then recreate. Reachability note:
 * an untasked POU is NOT compiled, so a repro must live in / be called from the tasked PLC_PRG to build. Safe
 * against the committed FIXTURE project only.
 */
import { call, landedInFull, VENDOR } from "./bridge.js"
import { fileOf, inFolder, legacyCreateFolder, mainProgram } from "../../volt-cli/test/e2e/lib/main-program.js"

export const MINIMAL_PLC = "PROGRAM PLC_PRG\nEND_PROGRAM\n"
export const pushOps = (ops: unknown[]): Promise<any> => call("push", { expectedProjectVersion: null, ops })

export interface Fixture {
  /** Push (create/update) an item by its FILE name (`X.pou`; `PLC_PRG.pou` is the main program wherever it sits),
   *  recovering the UNREADABLE-but-exists state. Tracks it for cleanup. */
  set(name: string, src: string): Promise<void>
  /** Delete an item by its file name (UNREADABLE-safe). */
  del(name: string): Promise<void>
  /** Reset to a known-clean project: minimal PLC_PRG + every touched/non-baseline item deleted. */
  reset(): Promise<void>
}

/** Open a fixture against the connected bridge: captures the baseline item set (libs/device/task/PLC_PRG present
 *  before any repro) so `reset()` only removes what a repro added. */
export async function openFixture(): Promise<Fixture> {
  const refs0 = await call("refs")
  const BASELINE = new Set(Object.keys(refs0.items))
  // The wire names an item by its PATH (openspec multi-application-tree): the main program is found where it sits, and
  // a repro's items are created where `toFolder: ""` created them before the path wire (`legacyCreateFolder`).
  const main = mainProgram(refs0)
  const createIn = legacyCreateFolder(main, VENDOR)
  const pathOf = (file: string): string => (file === fileOf(main.path) ? main.path : inFolder(createIn, file))
  let touched = new Set<string>() // every item path a repro created — so UNREADABLE ones still get cleaned
  const set = async (file: string, src: string): Promise<void> => {
    const name = pathOf(file)
    touched.add(name)
    const v = (await call("refs")).items[name] ?? null
    const r = await pushOps([{ op: "set", name, sourceText: src, ifVersion: v }])
    if (landedInFull(r)) return
    // Rejected → the item is UNREADABLE (invisible in /refs but blocks re-create). Delete with the sentinel, recreate.
    await pushOps([{ op: "deleteItem", name, ifVersion: "UNREADABLE000000" }])
    await pushOps([{ op: "set", name, sourceText: src, ifVersion: null }])
  }
  const delPath = async (name: string): Promise<void> => {
    const v = (await call("refs")).items[name] ?? "UNREADABLE000000"
    await pushOps([{ op: "deleteItem", name, ifVersion: v }])
  }
  const del = (file: string): Promise<void> => delPath(pathOf(file))
  const reset = async (): Promise<void> => {
    await set(fileOf(main.path), MINIMAL_PLC)
    const listed = Object.keys((await call("refs")).items).filter((n) => !BASELINE.has(n) && n !== main.path)
    for (const name of new Set([...listed, ...touched])) if (name !== main.path) await delPath(name)
    touched = new Set()
  }
  return { set, del, reset }
}
