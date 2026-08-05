import type { BrowserWindow } from "electron"
import type { VoltStatus, DetectedProject } from "@volt/control"

/**
 * The desktop shell's mutable state, shared by `main` (window + lifecycle), `panel` (the status feed the
 * renderer draws) and `commands` (pull/push/init). One object so the concern-split files read and write the
 * same live refs — the Electron equivalent of the extension's module-scoped maps.
 */
export interface Shell {
  win: BrowserWindow | null
  status: VoltStatus | null
  boundRoot: string | undefined // the workspace currently bound (restored on launch, or picked by the user)
  // True until the connector has been probed once. Splits the unbound panel between "Looking for open PLC
  // projects…" (cold start) and a known empty state, so the first second doesn't claim the connector is down
  // before we've actually asked it.
  awaiting: boolean
  projects: DetectedProject[]
  // Whether the connector control plane answered at all — lets onboarding tell "connector not running" apart from
  // "connector up, no IDE project open" (both otherwise show an empty `projects`).
  connectorUp: boolean
}
