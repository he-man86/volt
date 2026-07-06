/**
 * unresolved-identifier (D.2 · names/). A bare identifier reference whose name resolves in NO reachable
 * scope → error `Identifier '<name>' not defined` (byte-identical on both compilers). Mirrors what the
 * IDE rejects; a compiler-parity check, so it runs always.
 *
 * Zero-FP is the whole game (the corpus compiles clean, so any error here is a false positive). A name is
 * only flagged after it fails EVERY resolution avenue:
 *   - a reserved system operator (`__`-prefixed) or a conversion call (`<T>_TO_<U>` / `TO_<U>`) — implicit,
 *     not a symbol in any scope;
 *   - a CODESYS compiler-provided implicit global (`IoConfig_Globals`, `TYPE_CLASS`);
 *   - a built-in operator / standard function / standard FB / elementary type — the reference catalog;
 *   - a referenced-library namespace or a device-tree instance — the workspace reference files;
 *   - a bare-accessible enum member (a non-`qualified_only` enum's constant);
 *   - anything in scope (parent chain + EXTENDS bases).
 *
 * Bodies with a conditional-compile pragma (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`) are SKIPPED whole: the
 * compilers strip dead branches before analysis but we have no preprocessor, so checking would
 * false-positive on stripped-branch references.
 *
 * ponytail: bare-reference resolution only. Member access (`a.b`) is DEFERRED — it needs the member's owning
 * type scope and is the highest-FP surface (library-typed bases, methods vs symbols); add it as a separately
 * gated follow-on once bare resolution holds 0-FP on the corpus.
 */
import {
  parseStatements,
  walkStatements,
  stmtExprs,
  type BodySpan,
  type Expr,
} from "../../../syntax/index.js"
import { lookupReference } from "../../../reference/index.js"
import { lookup, resolveBareEnumMember, type Scope } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"

/** `{IF ...}` / `{ELSIF ...}` / `{ELSE}` / `{END_IF}` — permissive on inner leading whitespace. */
const CONDITIONAL_PRAGMA_RE = /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i

/** A conversion-operator call shape: `INT_TO_REAL`, `WORD_TO_BYTE`, `TO_STRING`. Not a scope symbol. */
const CONVERSION_RE = /^(?:[A-Za-z][A-Za-z0-9]*_TO_[A-Za-z]|TO_[A-Za-z])/i

/**
 * Compiler-provided implicit references (lowercased) — never declared in project source, always valid:
 *   - `this` / `super` — the OOP self / base-class instance pointers (`THIS^`, `SUPER^.Method()`),
 *     implicit inside every FB method;
 *   - `ioconfig_globals` — the auto-generated I/O-mapping GVL (`IoConfig_Globals.<Device>.<pin>`);
 *   - `type_class` — the system enum used with `__VARINFO` / type reflection.
 */
const COMPILER_PROVIDED_IMPLICITS: ReadonlySet<string> = new Set([
  "this",
  "super",
  "ioconfig_globals",
  "type_class",
])

export function checkUnresolvedIdentifiers(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    if (bodyHasConditionalPragma(body)) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue

    walkStatements(parsed.statements, (stmt) => {
      for (const e of stmtExprs(stmt)) {
        collectBareRefs(e, (ref) => {
          if (!resolves(ref.name, scope, ctx)) {
            out.push({
              severity: "error",
              span: ref.span,
              source: SOURCE,
              code: "unresolved-identifier",
              message: ctx.messages.undefinedIdentifier(ref.name),
            })
          }
        })
      }
    })
  }
}

/** True when the body carries a conditional-compile directive (gates the whole-body skip). */
function bodyHasConditionalPragma(body: BodySpan): boolean {
  return body.tokens.some((t) => t.kind === "pragma" && CONDITIONAL_PRAGMA_RE.test(t.text))
}

/**
 * Visit only the identifiers that are BARE references (the root of a chain) — NOT member names (`.b` in
 * `a.b`) nor named-argument params (`p` in `f(p := v)`), both of which are `IdentExpr` in the tree but
 * resolve against a callee/type, not the local scope. Mirrors the traversal in `ast-walk` minus those.
 */
function collectBareRefs(e: Expr, emit: (ref: { name: string; span: Expr["span"] }) => void): void {
  switch (e.kind) {
    case "ident_expr":
      emit(e)
      return
    case "literal":
      return
    case "member":
      collectBareRefs(e.base, emit) // skip e.member (a member name, not a bare ref)
      return
    case "call":
      collectBareRefs(e.callee, emit)
      for (const a of e.args) if (a.value !== undefined) collectBareRefs(a.value, emit) // skip a.param
      return
    case "index":
      collectBareRefs(e.base, emit)
      for (const i of e.indices) collectBareRefs(i, emit)
      return
    case "deref":
      collectBareRefs(e.base, emit)
      return
    case "binary":
      collectBareRefs(e.left, emit)
      collectBareRefs(e.right, emit)
      return
    case "unary":
      collectBareRefs(e.operand, emit)
      return
    case "paren":
      collectBareRefs(e.inner, emit)
      return
    case "assign_expr":
      collectBareRefs(e.target, emit)
      collectBareRefs(e.value, emit)
      return
  }
}

/** Every resolution avenue for a bare name; true = valid (skip), false = unresolved (flag). */
function resolves(name: string, scope: Scope, ctx: CheckContext): boolean {
  const lower = name.toLowerCase()
  if (name.startsWith("__")) return true // reserved system operator (`__NEW`, `__ISVALIDREF`, …)
  if (CONVERSION_RE.test(name)) return true // conversion call — an implicit token, not a symbol
  if (COMPILER_PROVIDED_IMPLICITS.has(lower)) return true
  if (lookupReference(name) !== undefined) return true // built-in operator / std function / std FB / type
  if (ctx.references.libraryNamespaces.has(lower)) return true // referenced-library namespace root
  if (ctx.references.deviceInstances.has(lower)) return true // device-tree instance
  if (resolveBareEnumMember(ctx.project, name) !== undefined) return true // non-qualified_only enum member
  if (lookup(scope, name) !== undefined) return true // parent chain + EXTENDS bases
  return false
}
