/**
 * Shared live-bridge fixture helpers for the recording scripts (verify-catalog.ts, record-gaps.ts). Speaks the
 * push wire and keeps the headless fixture project clean between repros.
 *
 * UNREADABLE-safe (learned the hard way): a malformed push can leave an item that's invisible in `/refs` but
 * blocks re-create — delete it with the `UNREADABLE000000` sentinel version, then recreate. Reachability note:
 * an untasked POU is NOT compiled, so a repro must live in / be called from the tasked PLC_PRG to build. Safe
 * against the headless FIXTURE project only.
 */
import { call } from "./bridge.js"

export const MINIMAL_PLC = "PROGRAM PLC_PRG\nEND_PROGRAM\n"
export const pushOps = (ops: unknown[]): Promise<any> => call("push", { expectedProjectVersion: null, ops })

export interface Fixture {
  /** Push (create/update) an item, recovering the UNREADABLE-but-exists state. Tracks the name for cleanup. */
  set(name: string, src: string): Promise<void>
  /** Delete an item (UNREADABLE-safe). */
  del(name: string): Promise<void>
  /** Reset to a known-clean project: minimal PLC_PRG + every touched/non-baseline item deleted. */
  reset(): Promise<void>
}

/** Open a fixture against the connected bridge: captures the baseline item set (libs/device/task/PLC_PRG present
 *  before any repro) so `reset()` only removes what a repro added. */
export async function openFixture(): Promise<Fixture> {
  const BASELINE = new Set(Object.keys((await call("refs")).items))
  let touched = new Set<string>() // every item a repro created — so UNREADABLE ones still get cleaned
  const set = async (name: string, src: string): Promise<void> => {
    touched.add(name)
    const v = (await call("refs")).items[name] ?? null
    const r = await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: v }])
    if (r.accepted) return
    // Rejected → the item is UNREADABLE (invisible in /refs but blocks re-create). Delete with the sentinel, recreate.
    await pushOps([{ op: "deleteItem", name, ifVersion: "UNREADABLE000000" }])
    await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: null }])
  }
  const del = async (name: string): Promise<void> => {
    const v = (await call("refs")).items[name] ?? "UNREADABLE000000"
    await pushOps([{ op: "deleteItem", name, ifVersion: v }])
  }
  const reset = async (): Promise<void> => {
    await set("PLC_PRG.prg", MINIMAL_PLC)
    const listed = Object.keys((await call("refs")).items).filter((n) => !BASELINE.has(n) && n !== "PLC_PRG.prg")
    for (const name of new Set([...listed, ...touched])) if (name !== "PLC_PRG.prg") await del(name)
    touched = new Set()
  }
  return { set, del, reset }
}
