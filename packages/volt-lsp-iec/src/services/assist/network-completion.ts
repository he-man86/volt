/**
 * Completion of the network words in a plain-ST network body, each only where the text takes it: after `JMP.` the labels
 * of the body; where a value stands — a statement's start, a call's argument, after `:=` — `ASSIGN`, the marks `INVERT`,
 * `RISING`, `FALLING`, `RAIL()` and the network's own boxes; in an `ASSIGN`'s arguments its outputs `Q`, `Q_SET`,
 * `Q_RESET`, `Q_INVERTED`; after `=>` the operand comment. A plain ST body is never offered one (`completion` asks only in
 * a network body).
 */
import { CompletionItemKind, type CompletionItem } from "vscode-languageserver-protocol"
import type { BodySpan } from "../../frontend/syntax/index.js"
import { NETWORK_MEANINGS, networkLabels, type NetworkForm } from "../shared/index.js"

const MARKS: readonly NetworkForm[] = ["INVERT", "RISING", "FALLING"]
const VALUES: readonly NetworkForm[] = ["ASSIGN", "RAIL", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND", "COMMENT"]
const ASSIGN_OUTPUTS: readonly NetworkForm[] = ["Q", "Q_SET", "Q_RESET", "Q_INVERTED"]

/** After `JMP.`: the labels of this body; undefined anywhere else. */
export function jumpLabelCompletions(source: string, offset: number, body: BodySpan): CompletionItem[] | undefined {
  if (!/\bJMP\s*\.\s*\w*$/i.test(source.slice(lineStart(source, offset), offset))) return undefined
  return networkLabels(body).map((label) => ({ label, kind: CompletionItemKind.Reference, detail: "the network's label" }))
}

/** The network words the position before `offset` takes. */
export function networkWordCompletions(source: string, offset: number): CompletionItem[] {
  let at = offset
  while (at > 0 && /\w/.test(source[at - 1]!)) at-- // the partial word being typed
  const before = source.slice(0, at).trimEnd()
  const linePrefix = source.slice(lineStart(source, at), at)
  if (before.endsWith("=>")) return values().filter((v) => v.label === "COMMENT")
  // in an ASSIGN's arguments, past its value: its outputs
  if (before.endsWith(",") && /\bASSIGN\s*\([^()]*(\([^()]*\)[^()]*)*,$/i.test(linePrefix.trimEnd())) return outputs()
  if (before.endsWith("(") || before.endsWith(",") || before.endsWith(":=") || linePrefix.trim() === "") return [...marks(), ...values()]
  return []
}

/** INVERT, RISING, FALLING: a mark on the value written inside it. */
function marks(): CompletionItem[] {
  return MARKS.map((m) => ({ label: m, kind: CompletionItemKind.Function, detail: NETWORK_MEANINGS[m] }))
}

/** ASSIGN's outputs, each a target's mark. */
function outputs(): CompletionItem[] {
  return ASSIGN_OUTPUTS.map((o) => ({ label: o, kind: CompletionItemKind.Field, detail: NETWORK_MEANINGS[o] }))
}

function values(): CompletionItem[] {
  return VALUES.map((v) => ({
    label: v === "RAIL" ? "RAIL()" : v,
    kind: CompletionItemKind.Function,
    detail: NETWORK_MEANINGS[v],
  }))
}

function lineStart(source: string, offset: number): number {
  return Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1
}
