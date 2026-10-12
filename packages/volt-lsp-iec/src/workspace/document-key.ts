/**
 * A WORKSPACE FILE'S IDENTITY — the key an open buffer and its disk file collapse to, and the folder boundary a folder
 * event is matched at (split from `workspace-store.ts`, openspec lsp-server-scheduling 2.2).
 */
import { sep } from "node:path"
import { fileURLToPath } from "node:url"

// Windows and macOS default to case-insensitive filesystems; Linux is case-sensitive. Case-fold the key on
// the former so an open buffer and its disk crawl (which may differ in path case) collapse to one entry.
export const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin"

/** Collapse a URI to a stable identity key so an open buffer and its disk file are one entry.
 *  ponytail: whole-path case-fold on case-insensitive filesystems — good enough for the drive-letter/case
 *  mismatches a client sends; swap for per-segment folding only if a case-sensitive path ever collides. */
export function normalizeKey(uri: string): string {
  try {
    const p = fileURLToPath(uri)
    return CASE_INSENSITIVE_FS ? p.toLowerCase() : p
  } catch {
    return uri
  }
}

/** Whether two URIs name the same file — the client's spelling and the server's may differ in case and escaping. */
export const sameDocument = (a: string, b: string): boolean => normalizeKey(a) === normalizeKey(b)

/** The key prefix of everything UNDER a folder — `folder + sep`, never a bare prefix: `POUs/Motor` does not hold
 *  `POUs/MotorControl/…`. */
export const folderKey = (uri: string): string => normalizeKey(uri).replace(/[\\/]+$/, "") + sep

/** Whether `uri` lies under the folder `folderUri`. */
export const isUnder = (uri: string, folderUri: string): boolean => normalizeKey(uri).startsWith(folderKey(folderUri))

