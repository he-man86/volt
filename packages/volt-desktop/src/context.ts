import type { BrowserWindow } from "electron"
import type { VoltStatus, DetectedProject, RefusedIde } from "@volt/control"

/**
 * The desktop shell's mutable state, shared by `main` (window + lifecycle), `panel` (the status feed the
 * renderer draws) and `commands` (pull/push/init). One object so the concern-split files read and write the
 * same live refs — the Electron equivalent of the extension's module-scoped maps.
 */
export interface Shell {
  win: BrowserWindow | null
  status: VoltStatus | null
  projects: DetectedProject[]
  // The IDEs whose bridge refused the connector (@volt/control's refusedIdes) — drawn beside the detected list with
  // their reason, so an IDE that is open but unreachable is named, not missing (environment-dependency-audit 2.2).
  refused: RefusedIde[]
  // Whether the connector control plane answered at all — lets onboarding tell "connector not running" apart from
  // "connector up, no IDE project open" (both otherwise show an empty `projects`).
  //
  // UNDEFINED until the first probe answers, which is the cold start: `onboardingMode` reads it as "probing" and
  // the panel says it is still looking. This was a SECOND field (`awaiting: boolean`) crossed with this one, so the
  // refresh below had to clear the flag before its early return or a machine with the connector down and no
  // projects — where nothing ever changes — spun on "Looking for…" forever. Three states in one field cannot have
  // that bug: `undefined !== false`, so the first probe always differs from the seed and always pushes.
  connectorUp: boolean | undefined
}
