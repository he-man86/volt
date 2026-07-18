import type { BrowserWindow, WebContentsView } from "electron"
import type { VoltStatus } from "@volt/control"

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
  panelOpen: boolean
  // Which vendor bridges are live with a project — gates the Initialize buttons (a vendor's button enables only
  // when its IDE is actually connected), mirroring the VS Code welcome's codesysLive/twincatLive.
  vendorsLive: { codesys: boolean; twincat: boolean }
}
