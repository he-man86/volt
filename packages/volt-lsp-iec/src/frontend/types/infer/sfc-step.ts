/**
 * SFC STEPS — the names an SFC chart puts in its POU's scope (openspec `lsp-sfc-step-names` 2.1; conformance
 * `fixtures/names/sfc-steps.ts`, CODESYS SP21 2026-10-03). A POU whose body is SFC has each of its chart's steps in scope as
 * an instance of IecSfc's `SFCStepType` — `x` and `_x` BOOL, `t` and `_t` TIME (`system.ts`) — readable bare inside the
 * POU (its actions, methods, transitions) and through its program or instance from outside (`PRG.S_Boot.x`).
 *
 * THE CHART IS NOT IN THE TEXT: Volt materializes an SFC body as `IMPLEMENTATION SFC UNSUPPORTED`, so no step list reaches
 * the LSP. What it does instead is a BET, recorded as DIALECT D40 (`packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md`): a
 * base read WITH A MEMBER (`X.m`) in an SFC POU is that chart's step when
 *   - the POU does not declare `X` (its own variables, its bases', the member's locals, its actions and methods) — a
 *     step's name is no variable's (CODESYS: "Variable 'S_Boot' has to be of type 'IecSfc.SFCStepType'"), so a declared
 *     name is the declaration; and
 *   - nothing else `X` names could answer a member: it names nothing, an enum member, a FUNCTION, or a variable of a type
 *     with no members (an INT or a POINTER global). CODESYS binds the STEP over each of those (S13, S14, S15); a GVL, a
 *     namespace, a type or a POU name keeps its own meaning, and so does a variable OF A TYPE WITH MEMBERS — AGAINST the
 *     measurement (S15: CODESYS binds the step over a struct or FB global too), because a global struct's member read in an
 *     SFC action is common and a step named like that global rare;
 *   - the member is a NAME: a bit (`gw.3`, `gw.cBit` with `cBit` a CONSTANT, `gw.GVL.cBit`) or partial access (`gw.%X3`)
 *     is never a step's.
 * `P.X.m` is a step of `P`'s chart when `P` is an SFC program or an instance of an SFC FB that does not declare `X` (S3).
 *
 * What the bet costs, with no chart to ask: a TYPO read with a member (`S_Bot.x`) is taken for a step and not reported
 * (CODESYS: "Identifier 'S_Bot' not defined"), or, with a member no step has (`S_Bot.y`), reported as a step's unknown member;
 * a pointer global that is no step read with a member is taken for one ("no structured variable" on CODESYS); a step read BARE (`SIZEOF(S_Boot)`, `bx := S_Boot`) is not evidenced and stays
 * the unknown name. 0 SFC charts with code reading a step in the six corpora.
 */
import { enclosingPou, lookupLocal, lookupMember, memoByProject, rootOf, type Scope } from "../../symbols/index.js"
import type { MemberExpr } from "../../syntax/index.js"
import { resolveBareName } from "../names.js"
import { resolveTypeExpr } from "../resolve.js"
import { inferExprType } from "./expr.js"
import { memberScopeOf } from "./member.js"

/** Is the base of `access` (`base.m`), read in `scope`, a step of an SFC chart (the bet above)? A BIT access (`gw.3`) or a
 *  PARTIAL access (`gw.%X3`) names no member at all — a step has neither — so it is never a step's: it stays the base's
 *  own, as in an ST POU (step 2 review: `'3' is no component of 'SFCStepType'` on a WORD global's bit). */
export function isSfcStepBase(access: MemberExpr, scope: Scope, project: Scope): boolean {
  if (!hasSfcPou(project)) return false
  const m = access.member.name
  if (/^[0-9]/.test(m) || m.startsWith("%") || numbersABit(m, scope)) return false
  const base = access.base
  if (base.kind === "ident_expr") return isStepName(base.name, scope)
  if (base.kind === "member") {
    // `P.X` — X a step of P's chart: P an SFC program or an SFC FB's instance that does not declare X
    const holder = memberScopeOf(inferExprType(base.base, scope, project))
    return holder !== undefined && holder.kind === "pou" && isSfcPou(holder) && lookupMember(holder, base.member.name) === undefined
  }
  return false
}

/** Does the member name `m` number a BIT rather than name a member — a CONSTANT in scope (`gw.cBit`, a GVL or a local
 *  VAR CONSTANT: S16 `sfc_step_bit_const_global`, `_local`, CODESYS builds both), or a global list qualifying one
 *  (`gw.GVL.cBit`: CODESYS refuses it, "Bit access requires literal or symbolic integer constant", S16 `_qualified` — a
 *  bit access all the same, no step's)? A step's member is none of those (gate step 2 review). */
function numbersABit(m: string, scope: Scope): boolean {
  const named = resolveBareName(scope, m)
  if (named.kind !== "declared") return false
  const sym = named.symbol
  return ((sym.kind === "gvl_var" || sym.kind === "var") && sym.constant === true) || sym.kind === "gvl_block"
}

/** Is the bare `name`, written in `scope`, bet to be a step of the SFC POU `scope` sits in? */
function isStepName(name: string, scope: Scope): boolean {
  const pou = enclosingPou(scope)
  if (pou === undefined || !isSfcPou(pou)) return false
  // declared by the POU — a member's local, the POU's own or inherited variable, an action or a method: the declaration
  for (let s: Scope | undefined = scope; s !== undefined && s !== pou; s = s.parent) if (lookupLocal(s, name).length > 0) return false
  if (lookupMember(pou, name) !== undefined) return false
  const named = resolveBareName(scope, name)
  switch (named.kind) {
    case "none":
    case "ambiguous":
    case "enum-member":
      return true
    case "declared": {
      const sym = named.symbol
      if (sym.kind === "function") return true
      if (sym.kind !== "gvl_var" && sym.kind !== "var") return false
      // a variable of a type with no members cannot answer `.m`; one whose type has members (or is unknown) keeps it
      if (sym.typeExpr === undefined) return false
      const t = resolveTypeExpr(sym.typeExpr, rootOf(scope), 0, sym.owner, sym.uri)
      return t.kind !== "unknown" && memberScopeOf(t) === undefined
    }
    default:
      return false
  }
}

/** Is the POU scope `pou` a PROGRAM's or FUNCTION_BLOCK's whose body is SFC — `IMPLEMENTATION SFC UNSUPPORTED`? */
function isSfcPou(pou: Scope): boolean {
  let hit = SFC_POU.get(pou)
  if (hit === undefined) SFC_POU.set(pou, (hit = bodyIsSfc(pou)))
  return hit
}
/** Per POU scope: a rebind makes new scopes, so an entry never outlives the text it was read from. */
const SFC_POU = new WeakMap<Scope, boolean>()

function bodyIsSfc(pou: Scope): boolean {
  if (pou.parent === undefined) return false
  const sym = lookupLocal(pou.parent, pou.name).find(
    (s) => (s.kind === "program" || s.kind === "function_block") && s.declarationSpan === pou.span,
  )
  const ast = sym?.ast
  if (ast === undefined || (ast.kind !== "program" && ast.kind !== "function_block")) return false
  const statement = ast.body.implementation?.statement
  return (statement?.kind === "unsupported" || statement?.kind === "bare-hidden") && statement.language.toUpperCase() === "SFC"
}

/** Does the project hold any SFC POU at all? Keeps every member access in a project without one free of the question. */
const hasSfcPou = memoByProject((project: Scope): boolean => {
  const visit = (parent: Scope): boolean =>
    parent.children.some((c) => (c.kind === "pou" && isSfcPou(c)) || (c.kind === "namespace" && visit(c)))
  return visit(project)
})
