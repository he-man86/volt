/**
 * AST → IR for one bound unit: the per-POU pipeline — its frame or its root instance, the body, the init step, the
 * post-POU finish and the storage checks.
 *
 * Lowering is **total**: it never throws. A construct it cannot represent becomes a `LowerDiagnostic` with a stable
 * code and the POU lowers to nothing — so an untestable POU is reported, never silently wrong, and
 * `scripts/lower-completeness.ts` can count exactly what blocks the corpus. Its input is code CODESYS COMPILES (the
 * contract in `../../index.ts`): a rule here exists for valid programs only.
 */

import { pouContext, routineContext } from "../core/keys.js"
import { isPlainStNetworkBody, isStBody, type TopLevel } from "../../../frontend/syntax/index.js"
import { type Scope, scopeUri } from "../../../frontend/symbols/index.js"
import type { LoweringProject } from "../project/prepare.js"
import { lowerDiagnostic, type LoweredPou } from "../diagnostics/diagnostic.js"
import { Lowering } from "../core/lowering.js"
import { newShared, type Shared } from "../core/shared.js"
import { covers, type Escapes, escapesSeen, isEmpty, joined, runOnEscapes } from "../pointers/escape.js"
import { layOutImage } from "../pointers/image.js"
import { grownTargets, type PointerTarget, seedTargets } from "../pointers/state.js"
import { anyImage, rewriteImage } from "../pointers/image-rewrite.js"
import { refuseUnmeasuredRawBools } from "../pointers/raw-bool.js"
import { initStep } from "../init/step.js"
import { foldBindings, provenBindings } from "../init/bindings.js"
import { foldPou } from "../values/fold.js"
import { narrowPou } from "../values/promote.js"
import { shortCircuitPou } from "../expressions/operators.js"
import { finishInterfaces } from "./finish.js"
import type { IrLayout, IrPou, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { openDims } from "../places/bounds.js"
import { declareVars } from "../storage/declare.js"
import { declareLists, unloweredGlobals } from "../places/globals.js"
import { buildInitSequence } from "../init/sequence.js"
import { localInits } from "../init/temp-resets.js"
import { lowerBlock } from "../statements/statements.js"
import { storageRefusal } from "./checks.js"
import { storageOf } from "../storage/layout.js"
import { resolveNamedType } from "../../../frontend/types/index.js"
import { calledLayout } from "../calls/routines.js"
import { type BodyRefusal, bodyOf } from "../calls/body.js"
import { withoutReplacedGenerics } from "../calls/specialize.js"

/** How many lowerings the escape pass may take to reach its fixed point (`pointers/escape.ts`): the first finds what is
 *  stored, the second lowers on that answer — and finds the same, unless a body only the answer let lower stores more. */
const ESCAPE_PASSES = 4

/**
 * Lower one already-bound unit. The workspace path: the caller owns the project scope and its index.
 *
 * THE ESCAPE PASS (model 3, design.md §3.3 step 4d) is a lowering of its own: the first lowering records every address
 * store and copy; when it stored none, it IS the result. Otherwise the unit is lowered again on that answer — which
 * variables the byte image holds, which pointers hold tags — until a lowering finds nothing its answer did not have.
 *
 * The constants fold last (`values/fold.ts` `foldPou`). `fold` false skips it: the IR as the rules built it, every
 * constant sub-expression still in place — what `fold-agreement.test.ts` compares the AST fold against.
 */
export function lowerUnit(unit: TopLevel, scope: Scope, prepared: LoweringProject, fold = true): LoweredPou {
  if (unit.kind !== "program" && unit.kind !== "function_block")
    return { diagnostics: [lowerDiagnostic("unit-kind", `${unit.kind} is not lowered yet`, unit.span, scopeUri(scope))] }
  let answer: Escapes | undefined
  // the target sets a use read while they still grew (`pointers/state.grownTargets`), each as it ended — design.md §3.3
  // step 4f, task 4.13 (a): the next lowering starts with them, so no use lowers on part of a set
  const seed = new Map<string, readonly PointerTarget[]>()
  for (let pass = 1; ; pass++) {
    const shared = newShared(prepared.attributes, unit.name.text, prepared.libraryUnits)
    if (answer !== undefined) runOnEscapes(shared, answer)
    seedTargets(shared, seed)
    const lowered = lowerOnce(unit, scope, prepared.project, shared, fold)
    const seen = escapesSeen(shared)
    const grown = grownTargets(shared)
    const settled = answer === undefined ? isEmpty(seen) : covers(answer, seen)
    if (settled && grown.size === 0) return once(lowered)
    if (pass === ESCAPE_PASSES) return grown.size === 0 ? once(lowered) : stillGrowing(unit, scopeUri(scope), grown)
    if (!settled) answer = answer === undefined ? seen : joined(answer, seen)
    for (const [key, targets] of grown) seed.set(key, targets)
  }
}

/** The answer with each refusal once: a body or routine refused at its first call is reported again at every later one
 *  (`calls/routines.ts` `again`) — the same diagnostic, which the POU states once. */
const once = (lowered: LoweredPou): LoweredPou => (lowered.diagnostics.length < 2 ? lowered : { ...lowered, diagnostics: [...new Set(lowered.diagnostics)] })

/** A target set that still grew under a use in the last lowering the escape loop takes — refused, never lowered on part
 *  of a set. (Each lowering is seeded with every set the previous one ended with, so one more lowering settles any set.) */
function stillGrowing(unit: TopLevel, uri: string | undefined, grown: ReadonlyMap<string, readonly PointerTarget[]>): LoweredPou {
  const keys = [...grown.keys()].join(", ")
  return { diagnostics: [lowerDiagnostic("pointer-targets", `the targets of ${keys} still grew after a use read them, ${ESCAPE_PASSES} lowerings on`, unit.span, uri)] }
}

/** One lowering of the unit, on the escape answer `shared` carries (none on the first). */
function lowerOnce(unit: Extract<TopLevel, { kind: "program" | "function_block" }>, scope: Scope, project: Scope, shared: Shared, fold: boolean): LoweredPou {
  const lowering = new Lowering(scope, project, shared)
  // A body the ST parser does not read — network text, or a read-only CFC/SFC/IL body, which is empty — would lower to
  // a POU that "succeeds" and does nothing. Refuse it explicitly, before anything is declared; FBD/LD reach the backend
  // through network text, not through here.
  if (!isStBody(unit.body) || isPlainStNetworkBody(unit.body))
    return refusedBody(lowering, unit, bodyOf(lowering, unit, unit.body, undefined, { library: false }) as BodyRefusal)
  // every list's VAR_GLOBAL is the application's storage, reached by the body or not (`places/globals.ts`)
  declareLists(lowering)
  lowering.isRoot = true
  lowering.displayName = unit.name.text
  lowering.frameContext = pouContext(unit.name.text)
  // its VAR_TEMP are the scan's locals, keyed as a routine's are (a pointer's key, an instance handle's context)
  lowering.routineContext = routineContext(lowering.frameContext)
  const asInstance = runsAsInstance(unit, scope)
  const body = asInstance ? rootInstance(lowering, unit) : programBody(lowering, unit)
  if (!Array.isArray(body)) return body
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  const init = initStep(lowering, unit.span)
  // every store into an interface has lowered by now: each call through one gets its instances (`finish.ts`)
  finishInterfaces(lowering, [...body, ...(init ?? [])])
  if (init === undefined || lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  // Every construct lowered — but every SLOT (and every field of a layout) also needs a runtime representation. An unused
  // `p : POINTER TO INT` lowered cleanly, then the Rust emitter threw on its type: a backend must accept whatever lowering
  // accepts (transpiler review 2026-09-14). Checked only here, so a POU another construct blocks keeps that blocker's
  // category in the coverage report.
  const layouts = [...lowering.layouts.values()]
  const routines = [...lowering.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  // a BOOL held as its byte, read where no measured operator took its byte (`pointers/raw-bool.ts`)
  refuseUnmeasuredRawBools(lowering, [body, init, ...layouts.flatMap((l) => (l.body === undefined ? [] : [l.body])), ...routines.map((r) => r.body)])
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  const refused = slotRefusal(lowering, unit, layouts, routines)
  if (refused !== undefined) return refused
  // an FB's own struct already carries its name, so the POU that holds one instance of it is named apart
  const name = asInstance ? `${unit.name.text}__root` : unit.name.text
  const locals = lowering.localSlots.length === 0 ? {} : { locals: lowering.localSlots }
  const pou: IrPou = withoutReplacedGenerics({ name, slots: lowering.slots, ...locals, body, layouts, routines, globals: lowering.globals, ...unloweredGlobals(lowering), ...(init.length > 0 ? { init } : {}), span: unit.span })
  // the constants folded last, over the IR every rule above built (`values/fold.ts`, lean 2), then the narrow-arithmetic
  // rule over the folded IR (`values/promote.ts` `narrowPou`, lean 3), and a quiet AND / OR short-circuits
  // (`expressions/operators.ts` `shortCircuitPou`, lean 5)
  // a binding nothing reads before it runs is its slot's initial value once the image pass placed every address
  // (`init/bindings.ts`, lean 7.8.8) — proven on the init step as built, before the image pass rewrites its places
  const proven = provenBindings(lowering, init)
  const imaged = withImage(lowering, pou)
  const lowered = imaged.pou === undefined ? imaged : { ...imaged, pou: foldBindings(imaged.pou, proven) }
  return lowered.pou === undefined || !fold ? lowered : { ...lowered, pou: shortCircuitPou(narrowPou(foldPou(lowered.pou))) }
}

/**
 * The POU with its byte image laid out and every place that reaches it rewritten (`pointers/image.ts`,
 * `image-rewrite.ts`) — the POU as it was when nothing escaped and no place reaches the image.
 */
function withImage(lowering: Lowering, pou: IrPou): LoweredPou {
  const slots = [...pou.slots]
  const globals = [...pou.globals]
  const laid = layOutImage(lowering, slots, globals, pou.span)
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  const bodies = [pou.body, ...(pou.init === undefined ? [] : [pou.init]), ...pou.layouts.flatMap((l) => (l.body === undefined ? [] : [l.body])), ...pou.routines.map((r) => r.body)]
  if (laid === undefined && !anyImage(bodies)) return { pou, diagnostics: [] }
  const rewritten = rewriteImage(lowering, { slots, globals, body: pou.body, ...(pou.init === undefined ? {} : { init: pou.init }), span: pou.span })
  if (rewritten === undefined) return { diagnostics: lowering.diagnostics }
  const image = laid ?? { size: 0, bytes: [], regions: [] }
  return { pou: { ...pou, slots, globals, ...rewritten, image }, diagnostics: [] }
}

/**
 * Whether a PROGRAM has METHODs, ACTIONs or PROPERTIES of its own. A PROGRAM with METHODs, ACTIONs or PROPERTIES runs them
 * on its one instance (conformance `fbcall_program_own_members`), so it lowers as one, as an FB does — its bare `M()` was
 * `call-this`, having no instance to run on. Others keep their slots. A PROPERTY counts for exactly the reason a METHOD
 * does: its accessor is a routine that runs on the instance. Leaving it out meant a PROGRAM whose ONLY own member is a
 * property was not an instance, and reading that property from its body reported `place-not-local` — while adding any
 * METHOD beside it made the same program lower.
 */
function ownMembers(unit: Extract<TopLevel, { kind: "function_block" | "program" }>, scope: Scope): boolean {
  return unit.kind === "program" && [...scope.symbols.values()].flat().some((s) => s.kind === "method" || s.kind === "action" || s.kind === "property")
}

/** Whether the unit lowers as an instance the POU holds (`rootInstance`): an FB, or a PROGRAM with members of its own. */
function runsAsInstance(unit: Extract<TopLevel, { kind: "function_block" | "program" }>, scope: Scope): boolean {
  return unit.kind === "function_block" || ownMembers(unit, scope)
}

/**
 * A PROGRAM's ARRAY[*] VAR_IN_OUT, if it has one. A PROGRAM's VAR_IN_OUT is the caller's variable — and a root has no
 * caller, so the harness owns it, as a root FB's in-outs are owned beside its instance (`rootInstance`). `declareVars`
 * gives it an ordinary slot. Only an `ARRAY[*]` stays refused: its size comes from the caller's array, and there is none.
 */
function open(lowering: Lowering, unit: Extract<TopLevel, { kind: "function_block" | "program" }>) {
  return unit.varSections
    .filter((s) => s.sectionKind === "VAR_IN_OUT")
    .flatMap((s) => s.decls)
    .find((d) => openDims(lowering.resolve(d.type)) > 0)
}

/** A PROGRAM lowered as its own frame: its variables declared (its VAR_TEMP the scan's locals), its init sequence built,
 *  its body lowered behind its locals' initializers that run — or the refusal that stopped it. */
function programBody(lowering: Lowering, unit: Extract<TopLevel, { kind: "function_block" | "program" }>): IrStmt[] | LoweredPou {
  const array = open(lowering, unit)
  if (array !== undefined)
    return {
      diagnostics: [
        lowerDiagnostic(
          "root-inout",
          `${unit.name.text} has the ARRAY[*] VAR_IN_OUT ${array.names.map((n) => n.text).join(", ")}, whose size only a caller's array gives`,
          array.span,
          lowering.uri,
        ),
      ],
    }
  // the POU's own frame is the one place an initializer that is not a constant can become an init-step statement
  declareVars(lowering, unit.varSections, true)
  // Lowered HERE, before the body, though they RUN in the init step: `p : POINTER TO INT := ADR(x)` stores an
  // address, and the body's `p^` is only allowed because that store is known (`pointerTargets`). The statements
  // are kept for `initStep` to place; only the order they are BUILT in moves.
  if (buildInitSequence(lowering) === undefined) return { diagnostics: lowering.diagnostics }
  const parsed = bodyOf(lowering, unit, unit.body, undefined, { library: false })
  if ("code" in parsed) return refusedBody(lowering, unit, parsed)
  // its VAR_TEMP: the scan's locals, started over on every scan (conformance `life_program_var_temp_runs`; 7.6.4)
  return [...(localInits(lowering) ?? []), ...lowerBlock(lowering, parsed.statements)]
}

/** The refusal of a lowered POU whose storage a backend cannot hold (`checks.ts` `storageRefusal`), at the POU. */
function slotRefusal(lowering: Lowering, unit: Extract<TopLevel, { kind: "function_block" | "program" }>, layouts: readonly IrLayout[], routines: readonly IrRoutine[]): LoweredPou | undefined {
  const refused = storageRefusal(lowering, layouts, routines)
  return refused === undefined ? undefined : { diagnostics: [lowerDiagnostic(refused.code, refused.message, refused.at?.span ?? unit.span, refused.at?.uri ?? lowering.uri)] }
}

/**
 * An FB lowered on its own runs as what it only ever is — an instance: the POU holds one, named as the FB, and each scan
 * calls it. Its body then sees THIS^, its bases' fields, SUPER^ and its own methods exactly as a called instance's does
 * (phase 3½). It was lowered as if it were a PROGRAM, where none of those exist, so every derived FB the corpus holds
 * stopped at its `SUPER^()` (128 of them).
 *
 * Its VAR_IN_OUT is the CALLER's variable, and a root has no caller — so the harness is the caller: one variable per
 * in-out, owned by the POU frame beside the instance and bound to every scan's call. That is the same binding a real
 * caller makes (the recorded semantics are unchanged: the callee reads and writes the caller's storage), and it is what
 * a test needs — write the variable, run a scan, read it back. An `ARRAY[*]` has no size to own, so it stays refused.
 */
function rootInstance(lw: Lowering, unit: Extract<TopLevel, { kind: "function_block" | "program" }>): IrStmt[] {
  const type = storageOf(lw, resolveNamedType(unit.name.text, lw.project, scopeUri(lw.scope)), unit.name.span)
  // A POU THAT SUCCEEDS AND DOES NOTHING IS THE ONE OUTCOME THIS FILE REFUSES EVERYWHERE ELSE. An empty body was
  // returned with no diagnostic when the unit resolved to something that is not an FB — which cannot happen for a
  // PROGRAM or FUNCTION_BLOCK that bound, so it is a lowering bug, and it was reported as a clean run.
  // `calledLayout` bails for itself; only the non-FB arm was silent.
  if (type.kind !== "function_block") {
    lw.bail("root-type", `${unit.name.text} resolves to a ${type.kind}, not a function block lowering can instance`, unit.span)
    return []
  }
  const layout = calledLayout(lw, type.name, unit.span)
  if (layout === undefined) return []
  const open = (layout.inouts ?? []).find((s) => openDims(s.type) > 0)
  if (open !== undefined) {
    lw.bail("root-inout", `${unit.name.text} has the ARRAY[*] VAR_IN_OUT ${open.name}, whose size only a caller's array gives`, unit.span)
    return []
  }
  const inouts: Place[] = (layout.inouts ?? []).map((slot) => {
    lw.slot({ ...unit.name, text: slot.name }, slot.type, "VAR")
    return { slot: lw.slots.length - 1, path: [], type: slot.type, span: unit.span }
  })
  lw.slot(unit.name, type, "VAR")
  return [{ kind: "call", instance: { slot: lw.slots.length - 1, path: [], type, span: unit.span }, fb: layout.name, inouts, span: unit.span }]
}

/** The POU's own body refused (`bodyOf`): a POU with no IR, the refusal its one diagnostic. */
function refusedBody(lowering: Lowering, unit: TopLevel, refusal: BodyRefusal): LoweredPou {
  return { diagnostics: [lowerDiagnostic(refusal.code, refusal.message, unit.span, lowering.uri)] }
}
