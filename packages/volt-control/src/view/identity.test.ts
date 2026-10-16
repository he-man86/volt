import { expect, test } from "bun:test"
import { ideIdentity } from "./identity.js"
import type { DetectedProject } from "../bridge/connector.js"

// openspec ide-identity-report 2.5 (design E3): one line naming the vendor, the product, its own version and the
// platform under it. The SP/patch is CODESYS's own numbering, read from `ideVersion` — formatting only; the scheme is
// picked by the row's `vendor`, never guessed from the number. A part the bridge did not state is shown as unknown.
const row = (over: Partial<DetectedProject>): DetectedProject => ({
  id: "x",
  vendor: "codesys",
  dirty: false,
  projectName: "P",
  ...over,
})

test.each([
  // S1: plain CODESYS SP21 Patch 4, measured live
  [
    { productVendor: "CODESYS Development GmbH", productName: "CODESYS", productVersion: "3.5.21.40", ideVersion: "3.5.21.40" },
    "CODESYS Development GmbH CODESYS 3.5.21.40 — CODESYS 3.5 SP21 Patch 4",
  ],
  // the spec's OEM scenario: an OEM on 3.5.19.50
  [
    { productVendor: "Lenze Automation GmbH", productName: "PLC Designer", productVersion: "4.1.0.37740", ideVersion: "3.5.19.50" },
    "Lenze Automation GmbH PLC Designer 4.1.0.37740 — CODESYS 3.5 SP19 Patch 5",
  ],
  // patch 0
  [
    { productVendor: "CODESYS Development GmbH", productName: "CODESYS", productVersion: "3.5.15.0", ideVersion: "3.5.15.0" },
    "CODESYS Development GmbH CODESYS 3.5.15.0 — CODESYS 3.5 SP15 Patch 0",
  ],
  // a hotfix build (non-zero last digit): no hotfix scheme is measured, so the number is shown verbatim
  [
    { productVendor: "X", productName: "Y", productVersion: "1", ideVersion: "3.5.21.41" },
    "X Y 1 — CODESYS 3.5.21.41",
  ],
  // not 3.5 at all: verbatim
  [
    { productVendor: "X", productName: "Y", productVersion: "1", ideVersion: "3.6.0.10" },
    "X Y 1 — CODESYS 3.6.0.10",
  ],
  // a non-numeric part: verbatim
  [
    { productVendor: "X", productName: "Y", productVersion: "1", ideVersion: "3.5.SP21.40" },
    "X Y 1 — CODESYS 3.5.SP21.40",
  ],
  // nothing stated: every part says unknown, none is dropped
  [{}, "unknown vendor unknown product unknown version — CODESYS version unknown"],
  [
    { productVendor: null, productName: "CODESYS", productVersion: "3.5.21.40", ideVersion: null },
    "unknown vendor CODESYS 3.5.21.40 — CODESYS version unknown",
  ],
] as [Partial<DetectedProject>, string][])("CODESYS %o → %s", (fields, line) => {
  expect(ideIdentity(row(fields))).toBe(line)
})

test("TwinCAT shows its build verbatim, never as a CODESYS service pack", () => {
  const tc = row({ vendor: "twincat", productVendor: "Beckhoff", productName: "TcXaeShell", productVersion: "15.0", ideVersion: "3.1.4024.74", bridgeVersion: "0.1.17258" })
  expect(ideIdentity(tc)).toBe("Beckhoff TcXaeShell 15.0 — TwinCAT 3.1.4024.74")
  // a 3.5-shaped number on a TwinCAT row is still not a CODESYS SP: the scheme follows the vendor
  expect(ideIdentity({ ...tc, ideVersion: "3.5.21.40" })).toBe("Beckhoff TcXaeShell 15.0 — TwinCAT 3.5.21.40")
  expect(ideIdentity({ ...tc, ideVersion: null })).toBe("Beckhoff TcXaeShell 15.0 — TwinCAT version unknown")
})
