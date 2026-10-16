/**
 * The network-text checks of the FORMAT, not the compiler (readability.md P9, P12, P13): what the text says that a
 * reader may misread. None is a build message, so none is an error: a split defined in two networks of one body is a
 * warning (legal — VarIds are per network — but a pasted or agent-written network that reuses one is worth a look; 0 in
 * the six corpora), and an enable shown with nothing wired, or a coil on the rail, is a hint.
 */
import { walkValues, type NetworkTextNetwork, type NetworkTextStatement } from "../../../frontend/syntax/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** P9: a `split<n>` defined in two networks of one body — once per later definition, naming the first network. */
export function checkSplitsReused(networks: readonly NetworkTextNetwork[], out: DiagnosticItem[]): void {
  const first = new Map<number, number>() // VarId → the network index that defines it first
  for (const n of networks)
    for (const s of n.splits) {
      const at = first.get(s.varId)
      if (at === undefined) first.set(s.varId, n.index)
      else
        emit(out, s.name.span, "network-split-reused",
          `${s.name.text} is also defined in network ${at + 1}: a split is its network's own (VarIds are per network), so this is legal — but a pasted network that reuses one is worth a second look (P9).`,
          "warning")
    }
}

/** P13 / P12: `EN` with nothing after it (the enable shown, nothing wired), and a coil on the rail (`x R= ;`). */
export function checkFormatHints(statements: readonly NetworkTextStatement[], out: DiagnosticItem[]): void {
  for (const s of statements) {
    if (s.kind === "assign" && s.value.kind === "empty_slot")
      emit(out, s.span, "network-coil-on-rail", "a coil on the rail: nothing drives it but the left rail (P12).", "hint")
    for (const v of walkValues(s))
      if ((v.kind === "word" || v.kind === "call" || v.kind === "execute") && v.en?.kind === "empty_slot" && v.enSpan !== undefined)
        emit(out, v.enSpan, "network-en-unwired", "EN shown, nothing wired (P13).", "hint")
  }
}
