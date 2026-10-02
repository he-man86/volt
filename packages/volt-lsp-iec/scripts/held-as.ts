/**
 * WHERE THE IDE HOLDS AN ITEM THE RECORDER PUSHED — the pure half of `record-language.ts`'s cleanup, here so it is
 * tested without a bridge (openspec `push-without-header-check` 5.B: a DUT left behind under another name poisoned
 * every later fixture's build, and nothing caught it because the lookup lived inside a script with top-level await).
 *
 * An item pushed as `X.ext` is not always held as `X.ext` afterwards, since the push writes a top-level text as sent
 * (`openspec/changes/push-without-header-check`, measured live 2026-09-30):
 *   - the IDE keeps the spelling of the object it holds, so `x.pou` may come back as `X.pou`;
 *   - a GVL holding a retired `(* @volt-… *)` comment is in the project but listed under `unreadable` by bare name,
 *     and only a FORCED push deletes one (a plain delete is refused UNREADABLE).
 * So each is looked up under its own name first, then under a name the IDE may publish that one object under — the
 * engine's `PushedText.MayBeHeldAs`: the same name in another case. A POU has one name, `X.pou`, since 5.Q (CODESYS
 * named an `.fb` whose text said PROGRAM `X.prg` until then, DIALECT C2f) and a DUT one, `X.dut`, since 5.P —
 * then, for a GVL, in `unreadable`. A bare-name match of any OTHER kind is another item (`X.pou` beside
 * `X.visualization` is legitimate) and is never touched. `before` is the project as it stood before the push: what it
 * already held is not the push's to delete — a refused push leaves only that, and a match there is someone else's.
 */
const FAMILY: Readonly<Record<string, "pou" | "dut">> = {
  pou: "pou",
  dut: "dut",
}
export const extOf = (n: string): string => n.slice(n.lastIndexOf(".") + 1)
export const bareOf = (n: string): string => n.slice(0, n.lastIndexOf(".")).toLowerCase()
export function mayBeHeldAs(pushed: string, held: string): boolean {
  const family = FAMILY[extOf(pushed)]
  return pushed !== held && family !== undefined && FAMILY[extOf(held)] === family && bareOf(pushed) === bareOf(held)
}
/**
 * The kinds a push may leave listed only as `unreadable`: a GVL (measured 2026-09-30). A DUT with no subtype was one
 * too until 5.B; every DUT is `X.dut` now. A DUT is listed `unreadable` only when its content cannot be read at all (a
 * driver/COM error), which no fixture push produces.
 */
const MAY_BE_UNREADABLE = new Set(["gvl"])

export interface Held {
  items: ReadonlySet<string>
  unreadable: ReadonlySet<string>
}
export interface RefsAnswer {
  items: Record<string, string | null>
  unreadable?: string[]
}
export const heldIn = (r: RefsAnswer): Held => ({
  items: new Set(Object.keys(r.items)),
  unreadable: new Set((r.unreadable ?? []).map((n) => n.toLowerCase())),
})

/** The delete ops that remove the items pushed as `wires` wherever `r` (refs now) holds them, and whether they need force. */
export function deleteOpsFor(
  wires: readonly string[],
  r: RefsAnswer,
  before: Held,
): { ops: { op: "deleteItem"; name: string; ifVersion: string | null }[]; force: boolean } {
  const now = heldIn(r)
  const ops: { op: "deleteItem"; name: string; ifVersion: string | null }[] = []
  let force = false
  for (const wire of wires) {
    const held = (now.items.has(wire) ? [wire] : [...now.items].filter((n) => mayBeHeldAs(wire, n))).filter(
      (n) => !before.items.has(n),
    )
    for (const n of held) ops.push({ op: "deleteItem", name: n, ifVersion: r.items[n] ?? null })
    const bare = bareOf(wire)
    if (held.length === 0 && MAY_BE_UNREADABLE.has(extOf(wire)) && now.unreadable.has(bare) && !before.unreadable.has(bare)) {
      ops.push({ op: "deleteItem", name: wire, ifVersion: null })
      force = true
    }
  }
  return { ops, force }
}

/** The fixture wires an earlier killed run left in the project `r0`: held under its own name, a family name, or unreadable. */
export function orphansIn(fixtureWires: Iterable<string>, r0: RefsAnswer): string[] {
  const wires = [...fixtureWires]
  return [
    ...wires.filter((w) => Object.keys(r0.items).some((n) => n === w || mayBeHeldAs(w, n))),
    ...wires.filter((w) => (r0.unreadable ?? []).some((u) => u.toLowerCase() === bareOf(w))),
  ]
}
