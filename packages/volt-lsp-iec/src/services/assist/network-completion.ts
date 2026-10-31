/**
 * Completion of the network words in a plain-ST network body, each only where the text takes it: after `JMP.` the labels
 * of the body; before a receiver (a statement's start, a call's argument) the mark words; where a value or a call stands
 * `RAIL()` and the network's own boxes. A plain ST body is never offered one (`completion` asks only in a network body).
 */
import { CompletionItemKind, type CompletionItem } from "vscode-languageserver-protocol"
import type { BodySpan } from "../../frontend/syntax/index.js"
import { NETWORK_MEANINGS, networkLabels, type NetworkForm } from "../shared/index.js"

const MARKS: readonly NetworkForm[] = ["RISING", "FALLING"]
const VALUES: readonly NetworkForm[] = ["RAIL", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND"]

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
  if (before.endsWith("(") || before.endsWith(",")) return [...marks(), ...values()]
  if (/(:=|S=|R=)$/i.test(before)) return values()
  if (linePrefix.trim() === "") return [...marks(), ...values().filter((v) => v.label === "EXECUTE")]
  return []
}

/** NOT, RISING, FALLING before a receiver (NOT is an ST keyword completion already offers). */
function marks(): CompletionItem[] {
  return [
    { label: "NOT", kind: CompletionItemKind.Keyword, detail: "a negation mark on the receiver it stands before" },
    ...MARKS.map((m) => ({ label: m, kind: CompletionItemKind.Keyword, detail: `${m === "RISING" ? "a rising" : "a falling"}-edge mark on the receiver it stands before` })),
  ]
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
