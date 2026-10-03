import type { DetectedProject } from "../bridge/connector.js"
import type { Vendor } from "../bridge/health.js"

/**
 * The IDE a detected project is open in, as ONE line both shells render (openspec ide-identity-report 2.5, design E3):
 * `<vendor> <product> <productVersion> — <platform>`, e.g.
 * `CODESYS Development GmbH CODESYS 3.5.21.40 — CODESYS 3.5 SP21 Patch 4` or
 * `Beckhoff TcXaeShell 15.0 — TwinCAT 3.1.4024.74`.
 *
 * Every part is the bridge's own statement off `health`; a part it did not state is shown as unknown, never dropped
 * and never filled from another. The platform is how each vendor numbers its `ideVersion`, picked by the row's
 * `vendor` through an exhaustive table — adding a vendor fails to compile until it says how to read its number. The
 * vendor stays out of the project's LABEL (that rule holds); it only decides how a version number reads.
 */
export function ideIdentity(p: DetectedProject): string {
  const product = [p.productVendor ?? "unknown vendor", p.productName ?? "unknown product", p.productVersion ?? "unknown version"]
  return `${product.join(" ")} — ${PLATFORM[p.vendor](p.ideVersion ?? null, (p.bridgeVersion ?? null) === null)}`
}

/** `older`: the row carries no `bridgeVersion`. A bridge since ide-identity-report always sends one (design A), so
 *  its absence means a bridge from before the change, whose `ideVersion` may mean something else. On TwinCAT it DID:
 *  the worker sent `DTE.Version` (`15.0`, the shell), so it is not shown as the TwinCAT build. On CODESYS it never
 *  changed meaning (the platform since codesys-minimum-version, the constant `3.5` before — both read correctly). */
const PLATFORM: Record<Vendor, (ideVersion: string | null, older: boolean) => string> = {
  codesys: (v) => (v === null ? "CODESYS version unknown" : `CODESYS ${codesysRelease(v)}`),
  twincat: (v, older) =>
    older ? "TwinCAT build not reported (older bridge)" : v === null ? "TwinCAT version unknown" : `TwinCAT ${v}`,
}

/** CODESYS's own release numbering — formatting only: `3.5.<sp>.<p>` with `p % 10 == 0` is `3.5 SP<sp> Patch <p/10>`
 *  (`3.5.21.40` → SP21 Patch 4). Anything else — not 3.5, a non-zero last digit (a hotfix build, whose scheme is not
 *  measured), a non-numeric part — is the number verbatim: no scheme is invented. */
function codesysRelease(v: string): string {
  const m = /^3\.5\.(\d+)\.(\d+)$/.exec(v)
  if (m === null) return v
  const patch = Number(m[2])
  return patch % 10 === 0 ? `3.5 SP${Number(m[1])} Patch ${patch / 10}` : v
}
