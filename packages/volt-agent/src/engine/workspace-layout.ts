/**
 * Workspace-layout constants.
 *
 * The agent treats the workspace as a Bun project: PLC source files
 * synced from the IDE live under `src/`; everything else (`.volt/`
 * state, `package.json`, `tests/`, `scripts/`, `.gitignore`) lives at
 * the project root.
 *
 * `srcRoot(workspaceRoot)` is the single boundary every workspace-FS
 * function in `snapshot.ts` must route through — keeps the IDE's
 * project-tree shape (POUs/, Devices/, Types/, …) intact inside `src/`
 * while leaving the project root free for tooling files.
 */
import { join } from "node:path";

/** Top-level folder under the workspace root that mirrors the IDE's
 *  project tree. Bun-project convention; matches `tests/`, `scripts/`. */
export const WORKSPACE_SRC_DIR = "src";

/** Absolute path of the IDE-synced source root inside a workspace. */
export function srcRoot(workspaceRoot: string): string {
	return join(workspaceRoot, WORKSPACE_SRC_DIR);
}
