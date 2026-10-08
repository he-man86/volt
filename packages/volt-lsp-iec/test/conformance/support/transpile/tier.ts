/**
 * The TIER of a fixture: the highest band of the language its own body reaches (split out of the confidence module,
 * transpile-restructure 1.8.3).
 */
import type { IrPou } from "../../../../src/transpile/index.js"
import type { Tier } from "../../fixtures/map-row.js"

/**
 * The highest band the fixture's OWN body reaches.
 *
 * NOT the whole program. Every FB fixture is assembled under a synthesized `PLC_PRG` that declares an instance and
 * calls it, so reading `pou.body` files 1,719 of the 1,935 fixtures under `call` — on a statement no fixture wrote,
 * which makes the ladder useless for deciding what is simple. Measured both ways: own-body gives 329 `decl`,
 * 1,324 `arith`, 54 `control`, 24 `aggregate`, 88 `call`, 116 `indirect`.
 */
export function tierOf(pou: IrPou, ownPouName: string): Tier {
  const seen = new Set<string>()
  const expr = (e: unknown): void => {
    if (e === null || typeof e !== "object") return
    const n = e as Record<string, unknown>
    if (typeof n.kind === "string") seen.add(n.kind)
    for (const k of ["left", "right", "value", "index", "operand", "tag", "of", "base", "cond", "call"]) expr(n[k])
    for (const k of ["args", "elements", "arms", "inputs", "inouts", "lent"])
      if (Array.isArray(n[k])) (n[k] as unknown[]).forEach(expr)
    place(n.place)
    place(n.instance) // an `invoke`'s receiver — a call through a pointer or an in-out is reached only here
  }
  const place = (p: unknown): void => {
    if (p === null || typeof p !== "object") return
    const n = p as Record<string, unknown>
    if (n.root !== undefined) seen.add("place-root")
    for (const step of (n.path ?? []) as Record<string, unknown>[]) {
      seen.add(`place-${String(step.kind)}`)
      expr(step.index)
    }
    place(n.guard) // a dereference guard is a place of its own, and it is what makes the access indirect
  }
  const stmt = (s: unknown): void => {
    if (s === null || typeof s !== "object") return
    const n = s as Record<string, unknown>
    if (typeof n.kind === "string") seen.add(`stmt-${n.kind}`)
    for (const k of ["value", "cond", "selector"]) expr(n[k])
    // A LOOP'S TEST IS `{ cond, atEnd }`, not an expression — it has no `kind`, and `cond` is not a key `expr`
    // recurses through, so `WHILE iface.Ready()` and `WHILE NOT w.3` contributed NOTHING and their fixtures were
    // filed `control` instead of `indirect`. The sweep walks these bands in order, so a mis-banded fixture is
    // worked in the wrong pass — in the one table whose stated purpose is to be measured rather than judged.
    expr((n.test as Record<string, unknown> | undefined)?.cond)
    place(n.target)
    for (const k of ["then", "else", "body", "init", "step", "arms", "args", "inputs", "inouts", "lent"])
      for (const x of (n[k] ?? []) as Record<string, unknown>[]) {
        if (typeof x?.kind === "string") stmt(x)
        else if (Array.isArray(x?.body)) (x.body as unknown[]).forEach(stmt)
      }
  }
  const up = ownPouName.toUpperCase()
  const mine = pou.layouts.filter((l) => l.name.toUpperCase() === up)
  if (mine.length > 0) {
    for (const l of mine) (l.body ?? []).forEach(stmt)
    for (const r of pou.routines) if ((r.fb ?? "").toUpperCase() === up) r.body.forEach(stmt)
  } else {
    pou.body.forEach(stmt)
    for (const r of pou.routines) if (r.fb === undefined) r.body.forEach(stmt)
  }
  const has = (...k: string[]): boolean => k.some((x) => seen.has(x))
  if (has("dispatch", "freeze", "copy", "place-bit", "place-root")) return "indirect"
  if (has("invoke", "stmt-call")) return "call"
  if (has("place-field", "place-index")) return "aggregate"
  if (has("stmt-if", "stmt-switch", "stmt-loop", "stmt-break", "stmt-continue", "stmt-return")) return "control"
  if (has("binary", "unary", "convert", "builtin")) return "arith"
  return "decl"
}
