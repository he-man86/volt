/**
 * THE TWO CONSTANT FOLDS AGREE (openspec transpile-restructure design.md P3a, task 1.8.9).
 *
 * There are two folds and there have to be: the AST fold (`types/const/fold.constEval`) serves the LSP on code that is
 * never lowered — declarations, CASE labels, array bounds, diagnostics — and lowering before any IR exists; the IR fold
 * (`semantics/fold.constantValue`) serves lowering after its conversions are in, through the interpreter's own
 * arithmetic. They cannot be one function without `types/` depending on the IR, so they are held together the way the
 * two backends are: on every constant expression the lowered fixtures hold, both answer, and the answers are the same.
 *
 * WHAT IS COMPARED. Every lowered fixture's own bodies (its PLC_PRG, and each routine and layout of a unit its own source
 * declares — a library body's spans are another file's) are walked; each IR expression is matched, by its exact span, to
 * the AST expression it was lowered from — the OUTERMOST IR node at that span that is not a conversion lowering wrapped
 * around it (`irBySpan` says why not the deepest). Every one of those AST expressions the front-end calls a CONSTANT
 * (`constancyOf`) is compared — whichever fold answers, or neither: the comparison starts from the front-end's
 * constancy, not from what the IR fold happens to answer, so an expression only one side folds is counted, not skipped.
 * A literal is left out (both read the parser's value); so is a STRING (the AST fold has none).
 *
 * A READ OF A CONSTANT. Lowering keeps a `VAR CONSTANT` as storage — a `load` of its slot, as the vendor reads a
 * non-replaced constant (`const_non_replaced`, `prag_const_non_replaced_write`) — and the slot's `init` is lowering's own
 * fold of its declaration. So the IR's answer for `k * 2` is the IR fold over the expression with each such load read as
 * its slot's `init` (`withConstantSlots`): a plain slot of the body's own frame or the application's globals, never a
 * parameter (a `VAR_INPUT CONSTANT` holds the caller's argument, not its default).
 *
 * The same VALUE, of the same KIND (an integer, a REAL, a BOOL — the AST fold rounds a REAL to its width, so the value
 * carries it) is agreement; anything else — one side answering nothing, or neither — is a disagreement. A known
 * disagreement (`KNOWN`) that agrees again, or is no longer compared at all, fails the test naming the mark to delete.
 */
import { expect, test } from "bun:test"
import { bodyStatements, parseSource, type BodySpan, type Expr, type Span, type TopLevel } from "../../src/frontend/syntax/index.js"
import { build, scopeForUnit } from "../../src/frontend/symbols/index.js"
import { constancyOf, constEval, wrapToWidth, type ElementaryType } from "../../src/frontend/types/index.js"
import type { IrExpr, IrPou, IrSlot, Place } from "../../src/transpile/index.js"
import { forEachExpr, type IrNode } from "../../src/transpile/ir/walk.js"
import { constantValue } from "../../src/transpile/semantics/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture } from "./support/fixture-units.js"
import { SELECTION, whole } from "./support/fixture-suite.js"
import { PROJECT_BASE, PROJECT_LIBRARY, PROJECT_MANIFESTS, projectDevices } from "./support/project-libraries.js"
import { lowerSource } from "../../src/transpile/index.js"
import { RECORDING_ENVIRONMENT } from "./support/recording-environment.js"

/** The libraries as the LSP binds them, once; each fixture's own source is bound on top for its walk, then taken off. */
const PROJECT = build.buildSymbolTable(
  PROJECT_LIBRARY.map((f) => {
    if (f.parseResult === undefined) throw new Error(`${f.uri} is not parsed`)
    return { uri: f.uri, source: f.source, parseResult: f.parseResult }
  }),
  PROJECT_MANIFESTS,
  "codesys",
  RECORDING_ENVIRONMENT,
  projectDevices("codesys"),
)

const key = (s: Span): string => `${s.start}:${s.end}`

/** Every AST expression of a unit, by span, with the unit it belongs to. */
function astExpressions(units: readonly TopLevel[]): Map<string, { expr: Expr; unit: TopLevel }> {
  const out = new Map<string, { expr: Expr; unit: TopLevel }>()
  const visit = (node: unknown, unit: TopLevel): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, unit))
    if (node === null || typeof node !== "object") return
    const n = node as { kind?: unknown; span?: Span }
    // a POU body is parsed on demand — its statements, as the vendor compiles them (`bodyStatements`)
    if (n.kind === "body") return visit(bodyStatements(node as BodySpan).statements, unit)
    if (typeof n.kind === "string" && n.span !== undefined && EXPRESSION_KINDS.has(n.kind) && !out.has(key(n.span)))
      out.set(key(n.span), { expr: node as Expr, unit })
    for (const [k, child] of Object.entries(node)) if (k !== "span") visit(child, unit)
  }
  for (const unit of units) visit(unit, unit)
  return out
}

/** The AST expression kinds a fold reads — the literal is left out on purpose (see the header). */
const EXPRESSION_KINDS = new Set(["ident_expr", "global_expr", "member", "unary", "binary", "call"])

/**
 * The IR expression each span was lowered to: the OUTERMOST node at that span that is not a conversion lowering wrapped
 * around it. Not the deepest: lowering builds helpers under a node with the node's own span (a pointer's target tag, a
 * clock's scale factor), and those are parts of a lowering, not the expression's value. One conversion IS the value: a
 * CONSTANT whose slot is wider than its type is READ in its type's run-time width (`IrSlot.readAs`, 6.A.29: `D : DINT :=
 * K + 1` holds 2147483648 and every read of it is -2147483648), so its load with that conversion is the read.
 */
function irBySpan(bodies: readonly Body[]): Map<string, { expr: IrExpr; slotOf: SlotOf }> {
  const out = new Map<string, { expr: IrExpr; slotOf: SlotOf }>()
  const isRead = (e: IrExpr, slotOf: SlotOf): boolean =>
    e.kind === "convert" && e.value.kind === "load" && e.value.place.path.length === 0 && slotOf(e.value.place)?.readAs !== undefined
  // pre-order, so the first node met at a span is the outermost
  for (const { nodes, slotOf } of bodies)
    forEachExpr(nodes, (e) => void ((e.kind !== "convert" || isRead(e, slotOf)) && !out.has(key(e.span)) && out.set(key(e.span), { expr: e, slotOf })))
  return out
}

/** The slot a place of one body names — the frame that body's places index — or undefined for any other place. */
type SlotOf = (p: Place) => IrSlot | undefined
interface Body {
  nodes: readonly IrNode[]
  slotOf: SlotOf
}

/** A frame lookup: a root-less place indexes `own`, a routine's `local` one `locals`, a `global` one the globals. */
function frame(pou: IrPou, own: readonly IrSlot[], locals: readonly IrSlot[] = []): SlotOf {
  return (p) => (p.root === undefined ? own[p.slot] : p.root === "local" ? locals[p.slot] : p.root === "global" ? pou.globals[p.slot] : undefined)
}

/** The bodies of the units the fixture's own source declares — never a library routine's, whose spans index another file. */
function ownBodies(pou: IrPou, own: ReadonlySet<string>): Body[] {
  const ownName = (name: string): boolean => own.has(name.split(".")[0]!.toUpperCase())
  const fieldsOf = (fb: string | undefined): readonly IrSlot[] => pou.layouts.find((l) => l.name.toUpperCase() === fb?.toUpperCase())?.fields ?? []
  // a body's VAR_TEMP are its run's locals (7.6.4): the scan's and an FB body's `local` places index them
  const program = frame(pou, pou.slots, pou.locals)
  return [
    { nodes: pou.body, slotOf: program },
    { nodes: pou.init ?? [], slotOf: program },
    ...pou.routines.filter((r) => ownName(r.name)).map((r) => ({ nodes: r.body, slotOf: frame(pou, fieldsOf(r.fb), r.locals) })),
    ...pou.layouts.filter((l) => ownName(l.name)).map((l) => ({ nodes: l.body ?? [], slotOf: frame(pou, l.fields, l.locals) })),
  ]
}

/**
 * `e` with every load of a constant's slot read as the slot's `init` (see the header): a load the front-end reads as a
 * CONSTANT (`constantRead`, by its span — a direct address `%MW30` is a slot too, and no constant), of a whole slot (no
 * path, no dereference) of the body's own frame or the globals, holding a scalar, that is not a parameter. Any other load
 * stays, and the IR fold answers nothing for it.
 */
function withConstantSlots(e: IrExpr, slotOf: SlotOf, constantRead: (at: Span) => boolean): IrExpr {
  const visit = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(visit)
    if (n === null || typeof n !== "object") return n
    const load = n as IrExpr
    if (load.kind === "load" && load.place.path.length === 0 && load.place.guard === undefined && constantRead(load.span)) {
      const slot = slotOf(load.place)
      if (slot !== undefined && slot.section !== "VAR_INPUT" && slot.section !== "VAR_IN_OUT" && typeof slot.init !== "object")
        return { kind: "const", value: slot.init, type: load.type, span: load.span } satisfies IrExpr
    }
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === "span" || k === "type" ? v : visit(v)]))
  }
  return visit(e) as IrExpr
}

const kindOf = (v: unknown): string => (typeof v === "bigint" ? "integer" : typeof v === "number" ? "real" : typeof v)

/**
 * The AST fold's value as the IR node's type holds it. The AST fold is untyped — `-1` is -1 wherever it stands — and the
 * IR node is typed by its context: `b : BYTE := … -1 …` may hold the folded literal as the BYTE it is stored as, 255, with
 * no conversion node left to peel. So the AST value is stored the way a store stores it (an integer wrapped to the
 * type's width, an integer into a REAL as that number, a REAL rounded to float32) before the two are compared.
 */
function asTyped(value: unknown, t: ElementaryType): unknown {
  // a BIT holds a BOOLEAN (`semantics/store.ts` `fit`); the AST fold reads `b : BIT := 1` as the integer it is written as
  if (typeof value === "bigint" && t.name === "BIT") return value !== 0n
  if (typeof value === "bigint" && (t.family === "int" || t.family === "bitstring")) return wrapToWidth(value, t)
  // an integer stored into a REAL is that number (an enum member into a REAL, `cc_enum_into_real`)
  const real = typeof value === "bigint" && t.family === "real" ? Number(value) : value
  return typeof real === "number" && t.family === "real" && t.bits === 32 ? Math.fround(real) : real
}
const same = (a: unknown, b: unknown): boolean => kindOf(a) === kindOf(b) && (typeof a === "number" ? Object.is(a, b) : a === b)

/**
 * THE DISAGREEMENTS FOUND, each an expected failure naming the task that owns it (task 1.8.9, 2026-10-08). Each still
 * disagrees or the test fails naming the mark to delete.
 *
 * A LIBRARY ENUM'S STORAGE: Util's WEEKDAY is 2 bytes (`dt_library_enum_storage`), a base its materialized declaration
 * does not carry, so the front-end leaves its size unknown (`types/enums` `enumStorage`) where lowering stores it as an INT
 * — the known divergence `LIBRARY_ENUM_BASE_NOT_MATERIALIZED` (`support/divergences.ts`). (It was filed under 6.A.31's
 * layout class until 6.A.31 gave the front-end the layout, `types/layout.ts`, and every STRUCT, FB instance, ARRAY and
 * packed DUT SIZEOF came to agree.)
 *
 * NOT A CONSTANT: `constancyOf` answers CONSTANT for a read-only PARAMETER (a `VAR_INPUT CONSTANT`, a `VAR_IN_OUT
 * CONSTANT`, and expressions over one) and for a direct address (`%MW30 + 1`) — none a compile-time constant, so
 * neither fold answers. `constancyOf` conflates read-only with compile-time constant: C0018 (a write to it) and C0041
 * (one passed to a VAR_IN_OUT) read the first, C0218/C0162 (a CASE label, a repeat count) the second, so splitting it
 * is not cheap, and what CODESYS says of such a CASE label is unmeasured. Niche (the gate of 1.8a+1.9, 2026-10-08): no
 * `VAR_INPUT CONSTANT` or `VAR_IN_OUT CONSTANT` section, and no direct address in a CASE label, array bound or repeat
 * count, in the six corpora.
 */
const LIBRARY_ENUM_STORAGE = "LIBRARY_ENUM_BASE_NOT_MATERIALIZED: a library enum's materialized declaration carries no base, so the AST fold has no size for it"
const NOT_A_CONSTANT = "niche: accepted loss (0 occurrences in the corpora) — constancyOf calls a read-only parameter or a direct address a CONSTANT"
/** lsp-quick-fixes, review of step 1 (2026-10-12): a CONSTANT of a SUBRANGE that states no initial value RUNS — at the
 *  lower bound when the subrange is named (`qf_c0228_before_subrange`: out = 4), at 0 when it is inline
 *  (`qf_c0228_before_inline_subrange`: out = 1), which the IR fold gives — but is NO constant to the compiler: "Array
 *  border cap does not evaluate to a valid signed integer constant" (`qf_c0228_bound_subrange`, `qf_c0228_bound_inline_
 *  subrange`, both vendors) — which the AST fold follows (`values.ts` `isSubrange`): the two folds answer two measured
 *  questions. */
const SUBRANGE_BARE_CONSTANT =
  "niche: accepted loss (0 occurrences in the corpora) — a subrange's constant with no initial value runs (named: at its lower bound; inline: at 0) but does not evaluate as a constant; the AST fold answers the second"
/** transpile-restructure 6.A.14: a body's SHL / SHR of an untyped literal by a constant count — lowering folds it at 64 bits as
 *  recorded (`tr_a14_*`: SHL(1, 40) 2^40); the AST fold gives an untyped literal under a shift no width without a typed
 *  context and answers nothing (frontend-conformance 4.6.1, `UNTYPED_OPERAND` in `fixtures/types/constant-evaluation.ts`).
 *  An initializer's context types it there (`GC_REC_* : LWORD := SHL(1, 40)`, the corpora's 44 such lines, agree). */
const UNTYPED_SHIFT =
  "niche: accepted loss (0 occurrences in the corpora of a constant untyped-literal shift in a body: the 268 `SHL/SHR(<literal>, …)` there are all declaration initializers, whose type is the context) — the AST fold gives an untyped literal under a shift no width without a typed context (`UNTYPED_OPERAND`)"
/** transpile-restructure 6.A.30: a body's ROL / ROR of an untyped literal stored into a variable — lowering rotates it in the
 *  destination's width as recorded (`tr_a30_rotate_untyped_literal*`: ROL(129, 1) into a WORD 258); the AST fold gives an
 *  untyped literal under a rotation no width without a typed context and answers nothing, as for a shift (`UNTYPED_SHIFT`).
 *  An initializer's context types it there (`tr_a30_rotate_untyped_literal_initializer` agrees). */
const UNTYPED_ROTATE =
  "niche: accepted loss (0 ROL / ROR of an untyped literal in the six corpora) — the AST fold gives an untyped literal under a rotation no width without a typed context (`UNTYPED_OPERAND`)"
const KNOWN: Readonly<Record<string, string>> = Object.fromEntries([
  ["dt_library_enum_storage_values: SIZEOF(w)", LIBRARY_ENUM_STORAGE],
  // …each pair with its lone-CR and CRLF twins (`quick-fixes/line-end-twins.ts`), which fold as the pair does
  ...["", "_cr", "_crlf"].flatMap((twin) => [
    [`qf_c0228_before_subrange${twin}: cap + 1`, SUBRANGE_BARE_CONSTANT],
    [`qf_c0228_before_subrange${twin}: cap`, SUBRANGE_BARE_CONSTANT],
    [`qf_c0228_before_inline_subrange${twin}: cap + 1`, SUBRANGE_BARE_CONSTANT],
    [`qf_c0228_before_inline_subrange${twin}: cap`, SUBRANGE_BARE_CONSTANT],
  ]),
  ...[
    "ca_direct_address_expression: %MW30 + 1",
    "var_input_constant: iLimit",
    "var_input_constant_default_as_step: n",
    // lowered for the first time by model 4 (transpile-restructure 5.5: a FUNCTION's VAR initializer that runs per call)
    "var_input_constant_default_in_init: n * 10",
    "var_input_constant_default_in_init: n",
    "flw_assign_input_constant: limit_",
    "inout_const_string_literal_3: text = 'abc'",
    "inout_const_variable_7: value * 2",
    "inout_const_variable_7: value",
    "inout_const_string_constant_8: text = 'abc'",
    "inout_const_method_9: value * 2",
    "inout_const_method_9: value",
    "inout_const_method_9: text = 'abc'",
    "inout_const_fb_variable_10: threshold * 2",
    "inout_const_fb_variable_10: threshold",
    "inout_const_fb_variable_10: label = 'abc'",
    // lowered for the first time by network-text-lowering (an FBD body's FUNCTION box over a VAR_IN_OUT CONSTANT)
    "ng_m_function_constant_in_out: c * 10",
    "ng_m_function_constant_in_out: c",
  ].map((id) => [id, NOT_A_CONSTANT]),
  ...[
    "tr_a14_shift_untyped_literal_variable_count: SHL(1, 65)",
    "tr_a14_shift_untyped_literal_variable_count: SHR(SHL(1, 40), 8)",
    "tr_a14_shift_untyped_literal_variable_count: SHL(1, 40)",
    "tr_a14_shift_untyped_literal_wide: SHL(1, 40)",
    "tr_a14_shift_untyped_literal_wide: SHL(1, 33)",
    "tr_a14_shift_untyped_literal_wide: SHL(3, 62)",
    "tr_a14_shift_untyped_literal_wide: SHR(16#80000000, 4)",
    "tr_a14_shift_untyped_literal_wide: SHL(16#FF, 28)",
  ].map((id) => [id, UNTYPED_SHIFT]),
  ...[
    "tr_a30_rotate_untyped_literal: ROL(129, 1)",
    "tr_a30_rotate_untyped_literal: ROR(1, 1)",
    "tr_a30_rotate_untyped_literal: ROL(16#80000001, 1)",
    "tr_a30_rotate_untyped_literal_into_int: ROL(129, 1)",
    "tr_a30_rotate_untyped_literal_into_int: ROR(1, 1)",
  ].map((id) => [id, UNTYPED_ROTATE]),
])

whole("the AST fold and the IR fold give every constant expression the lowered fixtures hold the same value", () => {
  let compared = 0
  const disagree = new Map<string, string>()
  const agreeing = new Set<string>()
  for (const t of SELECTION.selected) {
    const { source, gvls } = assembleFixture(t, ALL_TESTS)
    // the IR BEFORE the constant fold (`lowerSource`'s `fold` false): folded, an all-constant expression is one `const`
    // and every constant sub-expression under it is gone — no longer compared, so a disagreement there went unseen
    const pou = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE, false).pou
    if (pou === undefined) continue
    const own = { uri: `file:///fold-agreement/${t.name}.pou`, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") }
    const lists = gvls.map((g) => ({ uri: g.uri, source: g.source, parseResult: parseSource(g.source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
    const ast = astExpressions(own.parseResult.units)
    const ownNames = new Set(own.parseResult.units.flatMap((u) => ("name" in u && u.name !== undefined ? [u.name.text.toUpperCase()] : [])))
    const ir = irBySpan(ownBodies(pou, ownNames))
    for (const f of [own, ...lists]) build.bindFile(PROJECT, f)
    build.relink(PROJECT, PROJECT_MANIFESTS)
    try {
      const constantRead = (at: Span): boolean => {
        const read = ast.get(key(at))
        const scope = read === undefined ? undefined : scopeForUnit(PROJECT, read.unit)
        return read !== undefined && scope !== undefined && constancyOf(read.expr, scope) === "constant"
      }
      for (const [at, { expr: e, slotOf }] of ir) {
        const node = ast.get(at)
        if (node === undefined) continue
        // a pointer, an instance, a STRING: no value the AST fold has
        if (e.type.kind !== "elementary" || e.type.elem.family === "string") continue
        const scope = scopeForUnit(PROJECT, node.unit)
        if (scope === undefined) throw new Error(`${t.name}: ${"name" in node.unit ? node.unit.name?.text : node.unit.kind} did not bind`)
        // ONLY what the front-end calls a CONSTANT. A VARIABLE is not a constant expression whatever its IR node holds
        // (lowering gives an ANY argument's size, an open array's length or a pointer's tag the argument's own span);
        // UNKNOWN is a call the front-end cannot decide (a METHOD, ADR, XSIZEOF), whose IR node is lowering's own
        if (constancyOf(node.expr, scope) !== "constant") continue
        const folded = constantValue(withConstantSlots(e, slotOf, constantRead))
        const value = asTyped(constEval(node.expr, scope), e.type.elem)
        compared += 1
        const id = `${t.name}: ${source.slice(node.expr.span.start, node.expr.span.end)}`
        if (folded === undefined || !same(value, folded)) disagree.set(id, `AST ${String(value)}, IR ${String(folded)}`)
        else agreeing.add(id)
      }
    } finally {
      for (const f of [own, ...lists]) build.unbindFile(PROJECT, f.uri)
      build.relink(PROJECT, PROJECT_MANIFESTS)
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  [fold agreement] ${compared} constant expressions compared, ${disagree.size} disagree (${Object.keys(KNOWN).length} known)`)
  // every disagreement is a known one, by name; a known one that agrees again, or is no longer compared, loses its mark
  expect([...disagree].filter(([id]) => KNOWN[id] === undefined).map(([id, why]) => `${id} — ${why}`)).toEqual([])
  expect(Object.keys(KNOWN).filter((id) => agreeing.has(id)).map((id) => `${id} now agrees — remove its mark (${KNOWN[id]})`)).toEqual([])
  expect(Object.keys(KNOWN).filter((id) => !disagree.has(id) && !agreeing.has(id)).map((id) => `${id} is no longer compared — remove its mark (${KNOWN[id]})`)).toEqual([])
  expect(compared).toBeGreaterThan(0)
  // A BUDGET PROPORTIONAL TO THE WORK, as `call-parameters.test.ts`, `map.test.ts` and `source-map.test.ts` have: this ran
  // on bun's 5s default — a default, not a decision — and lowers every fixture. Measured 2026-10-13 over 5850 fixtures:
  // ~5.0s alone (lowering 2.8s, assembling 0.9s, parse 0.7s, bind 0.4s, unbind 0.2s, the comparison 0.1s), so it failed
  // as a timeout (5.08s alone, 5.57s under the conformance suite's load), reading as a hang rather than as "there are
  // more fixtures now". Checked for the quadratic first: linear — half the fixtures took 2.9s of the 5.0s. 3ms a
  // fixture is ~3x the measured cost, so a real hang still fails. Not a hidden regression (gate review of step 4a,
  // finding 5): timed side by side in one scratch worktree, the commit that last changed this test (02ed3f0e19), the
  // pre-step-3 commit (c99a646580) and this step's base all took 10.6-11.7s there, and 02ed3f0e19 already timed out at
  // 5s — the cost did not move; the 5s default was never a margin.
}, Math.max(30_000, ALL_TESTS.length * 3))
