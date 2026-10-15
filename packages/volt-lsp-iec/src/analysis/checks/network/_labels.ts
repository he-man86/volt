/**
 * The network-text LABEL check (`network-analysis.ts` runs it once per body): labels and jumps, at the build's words.
 */
import type { NetworkTextNetwork, NetworkName } from "../../../frontend/syntax/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import type { Messages } from "../../messages/index.js"

/**
 * Labels and jumps, at parity with the builds census 1.15 recorded on both vendors (DIALECT N19;
 * `nwl-labels.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log`), `tc-labels-edge-names.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log`)). Both IDEs HOLD every shape below, so none is a gate
 * refusal; the build reports them, and so does the LSP — with the build's words and nothing more:
 *
 *   a JMP to a label no ENABLED network carries   error    No such label 'X' within the scope of the JMP statement
 *                                                          (TwinCAT adds a full stop)
 *   one label on two enabled networks             error    The label 'X' is a duplicate          (any case)
 *   an enabled label no enabled JMP names         warning  The label 'X' has not been referenced (once per name)
 *
 * A DISABLED network is not compiled: its label is no jump target (a jump to it is "No such label"), and a JMP inside
 * it references nothing (its label reads "not referenced"). SCOPE IS THE BODY, NOT THE NETWORK — a jump in FBD/LD
 * exists to leave its network, so a legitimate jump names a label its own network does not carry. Labels match
 * case-insensitively, as IEC names do (measured on both vendors: `JMP DONE` to `LABEL: Done` builds clean).
 *
 * The TwinCAT half used to be silent (measured 2026-07-07 on v1 text). Census 1.15 re-measured it on network text v2
 * and TwinCAT does report a missing label, so the vendor exception went with the text that produced it.
 *
 * The codes are the ST label check's (`checks/flow/jump-labels`): one compiler rule (C0116-C0118), so one slug, one
 * `Cnnnn` on the wire and one configuration switch — a label unreferenced in a ladder is the warning the project's
 * configuration says it is, exactly as in ST. (The network check had a slug of its own, `network-undefined-label`,
 * on the unmapped list; it is gone from there.)
 */
export function checkLabels(networks: readonly NetworkTextNetwork[], messages: Messages, out: DiagnosticItem[]): void {
  const enabled = networks.filter((n) => !n.disabled)
  const labels = new Map<string, NetworkName>() // upper-cased name → its first enabled occurrence
  for (const n of enabled) {
    if (n.label === undefined) continue
    const key = n.label.text.toUpperCase()
    if (labels.has(key))
      out.push({ severity: "error", span: n.label.span, source: SOURCE, code: "jump-label-duplicate", message: messages.jumpLabelDuplicate(n.label.text) })
    else labels.set(key, n.label)
  }
  const referenced = new Set<string>()
  for (const n of enabled)
    for (const s of n.statements) {
      if (s.kind !== "jump") continue
      const key = s.target.text.toUpperCase()
      referenced.add(key)
      if (!labels.has(key))
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "jump-label-undefined", message: messages.jumpLabelUndefined(s.target.text) })
    }
  for (const [key, label] of labels)
    if (!referenced.has(key))
      out.push({ severity: "warning", span: label.span, source: SOURCE, code: "jump-label-unreferenced", message: messages.jumpLabelUnreferenced(label.text) })
}
