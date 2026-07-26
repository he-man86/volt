import type { BrowserWindow, WebContentsView } from "electron"
import type { VoltStatus, DetectedProject } from "@volt/control"

/**
 * The desktop shell's mutable state, shared by `main` (window + lifecycle), `panel` (the status feed the
 * renderer draws) and `commands` (pull/push/init). One object so the concern-split files read and write the
 * same live refs — the Electron equivalent of the extension's module-scoped maps.
 */
export interface Shell {
  win: BrowserWindow | null
  view: WebContentsView | null
  status: VoltStatus | null
  boundRoot: string | undefined // the project currently bound (from opencode's active dir / VOLT_WORKSPACE)
  // True until opencode's active-project state is first learned (cold start). Splits the unbound panel between
  // "Connecting to opencode…" (awaiting) and "Open a PLC project…" (a known no-project state). Set false the
  // moment any active-project signal — a bind OR a release — is processed.
  awaitingOpencode: boolean
  panelOpen: boolean
  // The detected projects across all IDEs (from the connector) — the init surface. The user picks one; there is
  // no vendor button. Vendor rides along on each project as a badge.
  projects: DetectedProject[]
  // Whether the connector control plane answered at all — lets onboarding tell "connector not running" apart from
  // "connector up, no IDE project open" (both otherwise show an empty `projects`).
  connectorUp: boolean
}
