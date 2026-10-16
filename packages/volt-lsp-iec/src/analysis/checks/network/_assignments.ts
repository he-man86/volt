/**
 * The network-text ASSIGNMENT checks (`network-analysis.ts` runs them per network): each `target := value` pair the ST
 * assignment rules apply to — a mismatch, a narrowing, and the hole an untyped source carries to its destination.
 */
import {
  type Expr,
  type NetworkTarget,
  type NetworkTextStatement,
  type NetworkValue,
  executeBoxes,
  networkValueExpr,
  walkStatements,
  walkValues,
} from "../../../frontend/syntax/index.js"
import { inferExprType, renderType } from "../../../frontend/types/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { compilerExprText } from "../../shared/expr-echo.js"
import { isHole, reported } from "../../shared/hole.js"
import { assignmentPairError, narrowingPairError } from "../../shared/rules.js"
import type { Messages } from "../../messages/index.js"

/**
 * The `target := value` pairs an assignment rule applies to: an assign's value against the target it is written to,
 * and the plain assignments inside EXECUTE boxes.
 *
 * NOT a pair: a value that is a box's OUTPUT — `x := f(…)`, `x := f(…).ENO`, an EXECUTE box — nor a box's `=> v` pin.
 * In FBD/LD such a target is a wire from a box pin, whose type is the IDE's remit (the box's declared pin type, through
 * EN/ENO), not an ST assignment; the LSP applying its assignment rule there invented errors on box wiring the editor
 * owns. Whether a value IS a box is a fact of the tree (`call`, `execute`), never a guess from its ST reading: an edge
 * is no box (`x := R_EDGE(a)` pairs as `x := <BOOL>`, its opaque reading), backticked text is an operand whatever it
 * spells, and an EXECUTE box's own lines are ST the IDE compiles as ST, `o := F(k);` included. Nor a wire's
 * definition: the vendor's Demux holds no type, so a wire is no assignment target a build checks — its producer flows
 * to its consumers, which are typed as the build types them (`network-analyze` `usesTypeOf`). Nor a value with no ST
 * reading (`PARALLEL`, a group with an empty slot): its type is no expression's.
 */
function assignmentPairs(statements: readonly NetworkTextStatement[]): Assignment[] {
  const pairs: Assignment[] = []
  for (const s of statements) {
    // A CHAINED assignment (`a := b S= v;`) writes ONE value to every target: each target is its own assignment to
    // type-check, but the value — and so a hole in it — is one (see `checkHoles`).
    // The value's own box is the IDE's, through `.ENO` too: `x := f(…).ENO` reads BOOL for what CONSUMES it (a
    // group, a NOT), but the assignment is still a wire from the box's pin, not an ST assignment.
    // An assignment below the top level (S2, `(t := v)`) is the same Assign item, one level down.
    if (s.kind === "assign") pairOf(s.targets, s.value, pairs)
    for (const v of walkValues(s)) if (v.kind === "nested_assign") pairOf(v.targets, v.value, pairs)
    for (const x of executeBoxes(s))
      if (x.ok)
        walkStatements(x.statements, (st) => {
          if (st.kind === "assign" && st.op === undefined)
            pairs.push({ targets: [st.target], value: st.value })
        })
  }
  return pairs
}

function pairOf(targets: readonly NetworkTarget[], v: NetworkValue, pairs: Assignment[]): void {
  const box = v.kind === "call" || v.kind === "execute"
  const value = networkValueExpr(v)
  if (value !== undefined && !box) pairs.push({ targets: targets.flatMap((t) => (t.expr === undefined ? [] : [t.expr])), value })
}

/** One value and the targets it is written to — several for a chained assignment. */
type Assignment = { readonly targets: readonly Expr[]; readonly value: Expr }

/**
 * network-unknown-source: an assignment whose SOURCE the compiler could not type carries the hole to the destination,
 * exactly as an ST assignment does (conformance `cc_vg_undeclared`, `cc_vg_unknown_member`). `analysis/shared/hole` holds
 * the one definition of "could not type", and it reads the evidence the earlier checks left in `out` — so this runs
 * LAST, after `checkUndeclared`, for the same reason `unknown-source` is the last ST check.
 *
 * Reported once per VALUE: a chained assignment's targets share the value's one range, and a message per target put
 * one code on that range several times — which the corpus gate refuses and no build was measured to give (lenze-mid,
 * task 5.5). The destination named is the target the value is written to, the last.
 */
export function checkHoles(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const seen = reported(out)
  for (const { targets, value } of assignmentPairs(statements)) {
    if (!isHole(value, scope, project, seen)) continue
    const target = targets[targets.length - 1]
    if (target === undefined) continue
    const dest = inferExprType(target, scope, project)
    if (dest.kind === "unknown") continue
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "network-unknown-source",
      message: messages.cannotConvert(messages.unknownType(compilerExprText(value)), renderType(dest)),
    })
  }
}

/** Assignment pair type-checks (assignment mismatch + narrowing), EXECUTE boxes included. */
export function checkStatements(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const { targets, value } of assignmentPairs(statements))
    for (const target of targets) checkPair(target, value, scope, project, messages, out)
}

/** Run the shared per-pair rules (assignment mismatch → error, narrowing → warning) on one `target := value`. */
function checkPair(target: Expr, value: Expr, scope: Scope, project: Scope, messages: Messages, out: DiagnosticItem[]): void {
  const mismatch = assignmentPairError(target, value, scope, project, messages)
  if (mismatch !== undefined) out.push(mismatch)
  const narrowing = narrowingPairError(target, value, scope, project, messages)
  if (narrowing !== undefined) out.push(narrowing)
}
