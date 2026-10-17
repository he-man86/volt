/**
 * The network-text checks of the FORMAT, not the compiler (readability.md P9, P12, P13): what the text says that a
 * reader may misread. None is a build message, so none is an error: a split defined in two networks of one body is a
 * warning (legal — VarIds are per network — but a pasted or agent-written network that reuses one is worth a look; 0 in
 * the six corpora), and `ENO => v` (the IDE stores and builds it, and never writes `v`: v2-measurements 7a), an enable
 * shown with nothing wired, or a coil on the rail, is a hint — no build says a word about them, and the LSP's errors and
 * warnings are the build's (the conformance replay's zero-false-positive gate).
 */
import { walkValues, type NetworkPinState, type NetworkTextNetwork, type NetworkTextStatement } from "../../../frontend/syntax/index.js"
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

/** `EN` with nothing after it (the enable shown, nothing wired), a coil on the rail (`x R= ;` — a jump or a return on the
 *  rail is the unconditional one, `JMP l := ;`, and says nothing), and `ENO => v`, which never writes `v`. */
export function checkFormatHints(statements: readonly NetworkTextStatement[], out: DiagnosticItem[]): void {
  for (const s of statements) {
    if (s.kind === "assign" && s.value.kind === "empty_slot" && !s.targets.every((t) => t.jump === true || t.ret === true))
      emit(out, s.span, "network-coil-on-rail", "a coil on the rail: nothing drives it but the left rail.", "hint")
    for (const v of walkValues(s)) {
      if (v.kind !== "word" && v.kind !== "call" && v.kind !== "execute") continue
      const box: NetworkPinState = v
      if (box.en?.kind === "empty_slot" && box.enSpan !== undefined) emit(out, box.enSpan, "network-en-unwired", "EN shown, nothing wired.", "hint")
      const wired = box.eno?.target
      if (wired !== undefined)
        emit(out, wired.span, "network-eno-pin-unwritten",
          `\`ENO => ${wired.text}\` never writes '${wired.text}': the IDE stores and builds the wired ENO pin, and runs it writing nothing — read the box through its ENO instead, \`${wired.text} := … ENO EN c\`.`,
          "hint")
    }
  }
}
